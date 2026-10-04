from __future__ import annotations

from dataclasses import asdict, dataclass
from hashlib import sha256
from pathlib import Path, PurePosixPath
import os
import re
import stat
import zipfile
from typing import Iterable, Literal
from .zip_budget import ZipBudgetExceeded, check_zip_directory

InventoryStatus = Literal["success", "blocked", "unsupported"]
SnapshotRole = Literal["main", "temp", "backup", "unknown"]

_DRIVE_ABSOLUTE = re.compile(r"^[A-Za-z]:[/\\\\]")
_ALLOWED_COMPRESSION = {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED}


@dataclass(frozen=True)
class IntakeLimits:
    max_entries: int = 10_000
    max_total_uncompressed: int = 1_000_000_000
    max_entry_uncompressed: int = 250_000_000
    max_compression_ratio: float = 250.0
    max_path_length: int = 512

    def validate(self) -> None:
        if self.max_entries < 1:
            raise ValueError("max_entries must be positive")
        if self.max_total_uncompressed < 1:
            raise ValueError("max_total_uncompressed must be positive")
        if self.max_entry_uncompressed < 1:
            raise ValueError("max_entry_uncompressed must be positive")
        if self.max_compression_ratio < 1:
            raise ValueError("max_compression_ratio must be at least 1")
        if self.max_path_length < 1:
            raise ValueError("max_path_length must be positive")


@dataclass(frozen=True)
class ArchiveEntry:
    path: str
    size: int
    compressed_size: int
    is_directory: bool
    kind: str
    snapshot_role: SnapshotRole


@dataclass(frozen=True)
class JobRootCandidate:
    root: str
    job_name: str
    main_candidates: tuple[str, ...]
    temp_candidates: tuple[str, ...]
    backup_candidates: tuple[str, ...]
    master_candidates: tuple[str, ...]
    image_candidates: tuple[str, ...]
    history_candidates: tuple[str, ...]


@dataclass(frozen=True)
class InventoryResult:
    status: InventoryStatus
    archive_sha256: str
    archive_size: int
    entry_count: int
    total_uncompressed: int
    entries: tuple[ArchiveEntry, ...]
    job_roots: tuple[JobRootCandidate, ...]
    reasons: tuple[str, ...]

    def to_dict(self) -> dict:
        return asdict(self)


class IntakeBlocked(Exception):
    pass


class IntakeUnsupported(Exception):
    pass


def _hash_file(path: Path) -> str:
    digest = sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _normalize_member_name(raw_name: str, max_length: int) -> str:
    if "\x00" in raw_name:
        raise IntakeBlocked("archive member contains a NUL character")
    name = raw_name.replace("\\", "/")
    if len(name) > max_length:
        raise IntakeBlocked("archive member path exceeds configured length limit")
    if (
        name.startswith("/")
        or name.startswith("//")
        or _DRIVE_ABSOLUTE.match(name)
    ):
        raise IntakeBlocked("archive member uses an absolute path")

    parts: list[str] = []
    for part in name.split("/"):
        if part in ("", "."):
            continue
        if part == "..":
            raise IntakeBlocked("archive member attempts path traversal")
        parts.append(part)

    normalized = "/".join(parts)
    if not normalized and not raw_name.endswith(("/", "\\")):
        raise IntakeBlocked("archive member normalizes to an empty file path")
    return normalized


def _is_symlink(info: zipfile.ZipInfo) -> bool:
    mode = (info.external_attr >> 16) & 0xFFFF
    return stat.S_ISLNK(mode)


def _classify_path(
    path: str,
    is_directory: bool,
) -> tuple[str, SnapshotRole]:
    if is_directory:
        return "directory", "unknown"

    lower = path.lower()
    lower_name = PurePosixPath(path).name.lower()

    if lower_name.endswith(".xml.bak") or lower_name.endswith(".bak"):
        return "backup", "backup"
    if lower_name.endswith("_temp.xml"):
        return "job-xml", "temp"
    if lower_name == "master.xml" and "/master/" in f"/{lower}":
        return "master-xml", "unknown"
    if lower_name.endswith(".xml"):
        return "xml", "unknown"
    if lower_name.endswith(
        (".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff")
    ):
        return "image", "unknown"
    if lower_name.endswith((".his", ".history", ".log")):
        return "history", "unknown"
    return "other", "unknown"


def _discover_job_roots(
    entries: Iterable[ArchiveEntry],
) -> tuple[JobRootCandidate, ...]:
    files = [entry for entry in entries if not entry.is_directory]
    all_paths = {entry.path for entry in files}
    roots: list[JobRootCandidate] = []

    for entry in files:
        path = PurePosixPath(entry.path)
        if path.suffix.lower() != ".xml":
            continue
        if (
            path.name.lower().endswith("_temp.xml")
            or path.name.lower() == "master.xml"
        ):
            continue
        if path.stem != path.parent.name:
            continue

        root = str(path.parent)
        job_name = path.stem
        group_root = path.parent.parent
        prefix = f"{root}/"

        main_candidates = sorted(
            candidate for candidate in all_paths if candidate == entry.path
        )
        temp_candidates = sorted(
            candidate
            for candidate in all_paths
            if candidate.startswith(prefix)
            and PurePosixPath(candidate).name.lower()
            == f"{job_name.lower()}_temp.xml"
        )
        backup_candidates = sorted(
            candidate
            for candidate in all_paths
            if candidate.startswith(prefix)
            and (
                PurePosixPath(candidate).name.lower()
                == f"{job_name.lower()}.xml.bak"
                or (
                    PurePosixPath(candidate).name.lower().startswith(
                        job_name.lower()
                    )
                    and PurePosixPath(candidate).name.lower().endswith(".bak")
                )
            )
        )

        master_prefix = (
            f"{group_root}/Master/"
            if str(group_root) != "."
            else "Master/"
        )
        master_candidates = sorted(
            candidate
            for candidate in all_paths
            if candidate.casefold()
            == f"{master_prefix}Master.xml".casefold()
            or candidate.casefold()
            == f"{master_prefix}Master_Temp.xml".casefold()
            or candidate.casefold()
            == f"{master_prefix}Master.xml.bak".casefold()
        )

        image_candidates = sorted(
            candidate
            for candidate in all_paths
            if candidate.startswith(prefix)
            and PurePosixPath(candidate).suffix.lower()
            in {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff"}
        )
        history_candidates = sorted(
            candidate
            for candidate in all_paths
            if candidate.startswith(prefix)
            and PurePosixPath(candidate).suffix.lower()
            in {".his", ".history", ".log"}
        )

        roots.append(
            JobRootCandidate(
                root=root,
                job_name=job_name,
                main_candidates=tuple(main_candidates),
                temp_candidates=tuple(temp_candidates),
                backup_candidates=tuple(backup_candidates),
                master_candidates=tuple(master_candidates),
                image_candidates=tuple(image_candidates),
                history_candidates=tuple(history_candidates),
            )
        )

    roots.sort(key=lambda item: (item.root.casefold(), item.root))
    return tuple(roots)


def inventory_zip(
    path: str | os.PathLike[str],
    limits: IntakeLimits | None = None,
) -> InventoryResult:
    source = Path(path)
    limits = limits or IntakeLimits()
    limits.validate()

    if not source.is_file():
        return InventoryResult(
            status="blocked",
            archive_sha256="",
            archive_size=0,
            entry_count=0,
            total_uncompressed=0,
            entries=(),
            job_roots=(),
            reasons=(
                "source archive is missing or is not a regular file",
            ),
        )

    before_stat = source.stat()
    before_hash = _hash_file(source)
    entries: list[ArchiveEntry] = []
    reasons: list[str] = []

    try:
        check_zip_directory(source, limits.max_entries)
        with zipfile.ZipFile(source, "r") as archive:
            infos = archive.infolist()
            if len(infos) > limits.max_entries:
                raise IntakeBlocked(
                    "archive entry count exceeds configured limit"
                )

            total_uncompressed = 0
            normalized_seen: dict[str, str] = {}
            casefold_seen: dict[str, str] = {}

            for info in infos:
                normalized = _normalize_member_name(
                    info.filename,
                    limits.max_path_length,
                )
                is_directory = info.is_dir()

                exact_key = normalized
                case_key = normalized.casefold()
                if exact_key in normalized_seen:
                    raise IntakeBlocked(
                        "archive contains duplicate normalized member paths"
                    )
                if (
                    case_key in casefold_seen
                    and casefold_seen[case_key] != normalized
                ):
                    raise IntakeBlocked(
                        "archive contains case-insensitive path collisions"
                    )
                normalized_seen[exact_key] = info.filename
                casefold_seen[case_key] = normalized

                if info.flag_bits & 0x1:
                    raise IntakeUnsupported(
                        "encrypted archive entries are unsupported"
                    )
                if _is_symlink(info):
                    raise IntakeUnsupported(
                        "symbolic-link archive entries are unsupported"
                    )
                if info.compress_type not in _ALLOWED_COMPRESSION:
                    raise IntakeUnsupported(
                        "archive compression method is unsupported"
                    )
                if info.file_size < 0 or info.compress_size < 0:
                    raise IntakeBlocked(
                        "archive declares a negative member size"
                    )
                if info.file_size > limits.max_entry_uncompressed:
                    raise IntakeBlocked(
                        "archive member exceeds configured "
                        "uncompressed size limit"
                    )

                total_uncompressed += info.file_size
                if (
                    total_uncompressed
                    > limits.max_total_uncompressed
                ):
                    raise IntakeBlocked(
                        "archive total uncompressed size exceeds "
                        "configured limit"
                    )

                if not is_directory and info.file_size > 0:
                    compressed = max(info.compress_size, 1)
                    ratio = info.file_size / compressed
                    if ratio > limits.max_compression_ratio:
                        raise IntakeBlocked(
                            "archive member exceeds configured "
                            "compression-ratio limit"
                        )

                kind, role = _classify_path(
                    normalized,
                    is_directory,
                )
                entries.append(
                    ArchiveEntry(
                        path=normalized,
                        size=info.file_size,
                        compressed_size=info.compress_size,
                        is_directory=is_directory,
                        kind=kind,
                        snapshot_role=role,
                    )
                )

    except zipfile.BadZipFile:
        return InventoryResult(
            status="unsupported",
            archive_sha256=before_hash,
            archive_size=before_stat.st_size,
            entry_count=0,
            total_uncompressed=0,
            entries=(),
            job_roots=(),
            reasons=("source is not a supported ZIP archive",),
        )
    except IntakeUnsupported as error:
        return InventoryResult(
            status="unsupported",
            archive_sha256=before_hash,
            archive_size=before_stat.st_size,
            entry_count=0,
            total_uncompressed=0,
            entries=(),
            job_roots=(),
            reasons=(str(error),),
        )
    except (IntakeBlocked, ZipBudgetExceeded) as error:
        return InventoryResult(
            status="blocked",
            archive_sha256=before_hash,
            archive_size=before_stat.st_size,
            entry_count=0,
            total_uncompressed=0,
            entries=(),
            job_roots=(),
            reasons=(str(error),),
        )

    after_stat = source.stat()
    after_hash = _hash_file(source)
    if (
        before_hash != after_hash
        or before_stat.st_size != after_stat.st_size
    ):
        return InventoryResult(
            status="blocked",
            archive_sha256=before_hash,
            archive_size=before_stat.st_size,
            entry_count=0,
            total_uncompressed=0,
            entries=(),
            job_roots=(),
            reasons=("source archive changed during inventory",),
        )

    entries.sort(key=lambda item: (item.path.casefold(), item.path))
    job_roots = _discover_job_roots(entries)

    if len(job_roots) == 0:
        reasons.append("no supported nested job root was discovered")
    elif len(job_roots) > 1:
        reasons.append(
            "multiple job roots were discovered; "
            "explicit selection is required"
        )

    for root in job_roots:
        if not root.master_candidates:
            reasons.append(
                f"job root {root.root} has no related "
                "Master XML candidate"
            )

    status: InventoryStatus = (
        "success" if not reasons else "blocked"
    )
    return InventoryResult(
        status=status,
        archive_sha256=before_hash,
        archive_size=before_stat.st_size,
        entry_count=len(entries),
        total_uncompressed=sum(entry.size for entry in entries),
        entries=tuple(entries),
        job_roots=job_roots,
        reasons=tuple(reasons),
    )
