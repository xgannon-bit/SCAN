"""Copy-only snapshot packages. No XML parsing, geometry inference or machine output."""
from __future__ import annotations

from dataclasses import asdict, dataclass
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import stat
import tempfile
from typing import BinaryIO, Literal
import zipfile
import zlib

from .job_intake import IntakeLimits, InventoryResult, _normalize_member_name, inventory_zip

Role = Literal["main", "temp", "backup"]
_HASH = re.compile(r"^[a-fA-F0-9]{64}$")
_CHUNK = 1024 * 1024


@dataclass(frozen=True)
class SnapshotSelection:
    root: str
    job_member: str
    job_role: Role
    master_member: str | None = None
    master_role: Role | None = None


@dataclass(frozen=True)
class CaptureLimits:
    max_archive_bytes: int = 100_000_000
    intake: IntakeLimits = IntakeLimits()

    def validate(self) -> None:
        if self.max_archive_bytes < 1:
            raise ValueError("max_archive_bytes must be positive")
        self.intake.validate()


@dataclass(frozen=True)
class CaptureResult:
    status: Literal["success", "blocked", "unsupported"]
    code: str
    reasons: tuple[str, ...]
    snapshot_id: str | None = None
    package_sha256: str | None = None
    manifest: dict | None = None

    def to_dict(self) -> dict:
        return asdict(self)


class CaptureBlocked(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def _stream(source: BinaryIO, destination: BinaryIO | None, maximum: int) -> tuple[str, int]:
    digest = sha256()
    size = 0
    while chunk := source.read(min(_CHUNK, maximum - size + 1)):
        size += len(chunk)
        if size > maximum:
            raise CaptureBlocked("SIZE_LIMIT", "Stream exceeded its configured byte limit.")
        digest.update(chunk)
        if destination is not None:
            destination.write(chunk)
    return digest.hexdigest(), size


def _fingerprint(source_stat: os.stat_result) -> tuple:
    return (source_stat.st_dev, source_stat.st_ino, source_stat.st_size, source_stat.st_mtime_ns)


def _fresh_hash(source: Path, maximum: int) -> tuple[str, os.stat_result]:
    if source.is_symlink() or source.is_junction():
        raise CaptureBlocked("SOURCE_LINK", "Select a regular source file, not a link.")
    before_open = source.stat()
    if not stat.S_ISREG(before_open.st_mode) or before_open.st_size > maximum:
        raise CaptureBlocked("SIZE_LIMIT", "Source must be a regular file within the archive byte limit.")
    with source.open("rb") as handle:
        before = os.fstat(handle.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_size > maximum:
            raise CaptureBlocked("SIZE_LIMIT", "Source must be a regular file within the archive byte limit.")
        digest, _ = _stream(handle, None, maximum)
        if _fingerprint(before) != _fingerprint(os.fstat(handle.fileno())):
            raise CaptureBlocked("SOURCE_CHANGED", "Source changed while being read.")
    return digest, before


def _validate_selection(inventory: InventoryResult, selection: SnapshotSelection) -> tuple[str, ...]:
    # A03 keeps entries/roots for actionable selection holds, and clears them for
    # rejected archive structure. Never treat every 'blocked' inventory as safe.
    if not inventory.entries or not inventory.job_roots:
        raise CaptureBlocked("INVENTORY_REJECTED", "Archive has no safely inventoried job root to capture.")
    roots = [root for root in inventory.job_roots if root.root == selection.root]
    if len(roots) != 1:
        raise CaptureBlocked("INVALID_SELECTION", "Select one exact inventoried job root.")
    root = roots[0]
    candidates = {"main": root.main_candidates, "temp": root.temp_candidates, "backup": root.backup_candidates}
    if selection.job_role not in candidates or selection.job_member not in candidates[selection.job_role]:
        raise CaptureBlocked("INVALID_SELECTION", "Job member does not match the selected root and snapshot role. Inventory the source again and select an exact job XML snapshot in that root; companion backups and nested files are not job snapshots.")
    if selection.master_member is None:
        if selection.master_role is not None:
            raise CaptureBlocked("INVALID_SELECTION", "A master role requires an exact master member.")
        return ("No master snapshot was selected; dependent analysis remains blocked.",)
    if selection.master_member not in root.master_candidates:
        raise CaptureBlocked("INVALID_SELECTION", "Master member does not belong to the selected root.")
    name = selection.master_member.rsplit("/", 1)[-1].casefold()
    role = {"master.xml": "main", "master_temp.xml": "temp", "master.xml.bak": "backup"}.get(name)
    if role is None or role != selection.master_role:
        raise CaptureBlocked("INVALID_SELECTION", "Master member does not match its explicitly selected role.")
    return ()


def _zip_bytes(package: zipfile.ZipFile, name: str, content: bytes) -> None:
    info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
    info.compress_type = zipfile.ZIP_STORED
    package.writestr(info, content)


def _zip_file(package: zipfile.ZipFile, name: str, source: Path, maximum: int) -> tuple[str, int]:
    info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
    info.compress_type = zipfile.ZIP_STORED
    with source.open("rb") as incoming, package.open(info, "w", force_zip64=True) as outgoing:
        return _stream(incoming, outgoing, maximum)


def _publish_no_overwrite(staged: Path, destination: Path) -> None:
    # Same-volume hard-link creation atomically publishes the already closed file
    # and fails if the destination exists. Never fall back to copy or replace.
    os.link(staged, destination)


def capture_snapshot(
    source_path: str | os.PathLike[str],
    destination_path: str | os.PathLike[str],
    expected_archive_sha256: str,
    selection: SnapshotSelection,
    limits: CaptureLimits | None = None,
) -> CaptureResult:
    """Capture opaque source bytes into a new .scan-snapshot package.

    Destination parent must already exist outside the checkout. A completed
    package is immutable by this API; hashes detect later external alteration.
    This does not provide OS access control or validate any native schema.
    """
    limits = limits or CaptureLimits()
    limits.validate()
    if not isinstance(expected_archive_sha256, str) or not _HASH.fullmatch(expected_archive_sha256):
        return CaptureResult("blocked", "INVALID_HASH", ("A previously inventoried SHA-256 is required.",))
    expected = expected_archive_sha256.lower()
    source = Path(source_path).absolute()
    destination = Path(destination_path).absolute()
    repository = Path(__file__).resolve().parents[2]
    try:
        parent = destination.parent.resolve(strict=True)
        if not parent.is_dir() or parent.is_relative_to(repository):
            raise CaptureBlocked("DESTINATION_POLICY", "Capture destination must be a directory outside this checkout.")
        if destination.suffix != ".scan-snapshot":
            raise CaptureBlocked("DESTINATION_POLICY", "Use a .scan-snapshot destination, not a machine job extension.")
        destination = parent / destination.name
        if os.path.lexists(destination):
            raise CaptureBlocked("DESTINATION_EXISTS", "Destination already exists; capture never overwrites it.")
        original_hash, original_stat = _fresh_hash(source, limits.max_archive_bytes)
        if original_hash != expected:
            raise CaptureBlocked("STALE_SOURCE", "Source hash no longer matches the selected inventory. Inventory it again.")

        # Only this newly allocated directory is cleaned; never archive member paths.
        with tempfile.TemporaryDirectory(prefix=".scan-capture-", dir=parent) as temporary:
            stage = Path(temporary).resolve()
            if stage.parent != parent or not stage.name.startswith(".scan-capture-"):
                raise CaptureBlocked("DESTINATION_POLICY", "Capture staging directory is outside its expected parent.")
            copied_source = stage / "source.zip"
            with source.open("rb") as incoming, copied_source.open("xb") as outgoing:
                copied_hash, copied_size = _stream(incoming, outgoing, limits.max_archive_bytes)
            if copied_hash != expected or copied_size != original_stat.st_size:
                raise CaptureBlocked("SOURCE_CHANGED", "Source changed during capture. No completed snapshot was published.")

            inventory = inventory_zip(copied_source, limits.intake)
            if inventory.status == "unsupported":
                return CaptureResult("unsupported", "UNSUPPORTED_ARCHIVE", inventory.reasons)
            holds = _validate_selection(inventory, selection)
            selected_members = {selection.job_member: "job.bin"}
            if selection.master_member is not None:
                selected_members[selection.master_member] = "master.bin"
            members: list[dict] = []
            total_read = 0
            entries = {entry.path: entry for entry in inventory.entries}
            # Read every payload to completion: ZIP metadata alone cannot verify CRC
            # or the actual decompressed bytes. Member names are never OS paths.
            with zipfile.ZipFile(copied_source, "r") as archive:
                for info in archive.infolist():
                    normalized = _normalize_member_name(info.filename, limits.intake.max_path_length)
                    entry = entries[normalized]
                    if info.is_dir():
                        if info.file_size:
                            raise CaptureBlocked("INVALID_ARCHIVE", "Directory entry unexpectedly contains payload bytes.")
                        continue
                    selected_file = selected_members.get(normalized)
                    with archive.open(info, "r") as incoming:
                        if selected_file:
                            with (stage / selected_file).open("xb") as outgoing:
                                digest, size = _stream(incoming, outgoing, min(limits.intake.max_entry_uncompressed, limits.intake.max_total_uncompressed - total_read))
                        else:
                            digest, size = _stream(incoming, None, min(limits.intake.max_entry_uncompressed, limits.intake.max_total_uncompressed - total_read))
                    if size != entry.size:
                        raise CaptureBlocked("INVALID_ARCHIVE", "Member payload size differs from the archive inventory.")
                    total_read += size
                    members.append({"originalName": info.filename, "path": normalized, "sha256": digest, "size": size, "kind": entry.kind, "inventoryRole": entry.snapshot_role})
            members.sort(key=lambda member: member["path"])
            member_map = {member["path"]: member for member in members}

            def selected_record(member: str | None, role: str | None, stored: str) -> dict | None:
                if member is None:
                    return None
                item = member_map[member]
                return {"member": member, "role": role, "storedPath": stored, "sha256": item["sha256"], "size": item["size"]}

            identity = {"archiveSha256": expected, "selection": asdict(selection)}
            snapshot_id = sha256(json.dumps(identity, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
            manifest = {
                "schemaVersion": "1", "artifactType": "scan.source-snapshot", "status": "complete", "snapshotId": snapshot_id,
                "source": {"sha256": expected, "size": copied_size, "storedPath": "source/archive.zip"},
                "selection": {"root": selection.root, "job": selected_record(selection.job_member, selection.job_role, "selected/job.bin"), "master": selected_record(selection.master_member, selection.master_role, "selected/master.bin")},
                "members": members, "jobRoots": [asdict(root) for root in inventory.job_roots],
                "holds": list(holds), "nativeSchemaValidated": False, "machineExportAllowed": False,
                "limits": asdict(limits),
            }
            manifest_bytes = (json.dumps(manifest, indent=2, sort_keys=True) + "\n").encode("utf-8")
            manifest = json.loads(manifest_bytes)
            staged_package = stage / "complete.scan-snapshot"
            with zipfile.ZipFile(staged_package, "x", compression=zipfile.ZIP_STORED) as package:
                _zip_bytes(package, "manifest.json", manifest_bytes)
                if _zip_file(package, "source/archive.zip", copied_source, limits.max_archive_bytes)[0] != expected:
                    raise CaptureBlocked("SOURCE_CHANGED", "Staged source changed before publication.")
                for member, stored in selected_members.items():
                    if _zip_file(package, f"selected/{stored}", stage / stored, limits.intake.max_entry_uncompressed)[0] != member_map[member]["sha256"]:
                        raise CaptureBlocked("SOURCE_CHANGED", "Selected bytes changed before publication.")
            # Windows _commit/fsync requires a writable handle; this only flushes
            # our new staging file and never opens the original for writing.
            with staged_package.open("r+b") as completed:
                os.fsync(completed.fileno())
                package_hash, _ = _stream(completed, None, limits.max_archive_bytes + 2 * limits.intake.max_entry_uncompressed + 20_000_000)
            fresh_hash, fresh_stat = _fresh_hash(source, limits.max_archive_bytes)
            if fresh_hash != expected or _fingerprint(fresh_stat) != _fingerprint(original_stat):
                raise CaptureBlocked("SOURCE_CHANGED", "Source changed before publication. Inventory it again.")
            try:
                _publish_no_overwrite(staged_package, destination)
            except FileExistsError:
                raise CaptureBlocked("DESTINATION_EXISTS", "Destination appeared during capture; nothing was overwritten.") from None
            except OSError:
                return CaptureResult("blocked", "PUBLICATION_FAILED", ("Filesystem refused atomic no-overwrite publication. No copy fallback was attempted.",))
            return CaptureResult("success", "CAPTURED", (), snapshot_id, package_hash, manifest)
    except CaptureBlocked as error:
        return CaptureResult("blocked", error.code, (str(error),))
    except (zipfile.BadZipFile, EOFError, zlib.error, RuntimeError, NotImplementedError):
        return CaptureResult("blocked", "INVALID_PAYLOAD", ("Archive payload failed decompression or integrity verification.",))
    except OSError:
        return CaptureResult("blocked", "FILESYSTEM_ERROR", ("Source or destination could not be accessed. No filesystem details were logged.",))
