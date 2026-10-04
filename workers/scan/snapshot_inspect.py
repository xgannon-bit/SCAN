"""Verify captured bytes before read-only XML envelope inspection. No native adapter."""
from __future__ import annotations

from collections import Counter
from dataclasses import asdict, dataclass
from hashlib import sha256
import io
import json
import math
from pathlib import Path
import re
import stat
import tempfile
import zipfile
from xml.etree.ElementTree import ParseError
from xml.parsers.expat import ErrorString

from defusedxml.ElementTree import DefusedXMLParser

from .job_intake import _normalize_member_name, _discover_job_roots, inventory_zip
from .snapshot_capture import CaptureBlocked, CaptureLimits, SnapshotSelection, _fingerprint, _fresh_hash, _stream, _validate_selection
from .zip_budget import ZipBudgetExceeded, check_zip_directory
from .native_records import read_native_records


@dataclass(frozen=True)
class InspectLimits:
    max_package_bytes: int = 620_000_000
    max_manifest_bytes: int = 20_000_000
    max_xml_bytes: int = 16_000_000
    max_xml_nodes: int = 250_000
    max_xml_depth: int = 128
    max_xml_names: int = 4096
    capture: CaptureLimits = CaptureLimits()


def _fail(code, reason):
    raise CaptureBlocked(code, reason)


def _same(left, right):
    # Unlike Python equality, canonical JSON distinguishes true from 1.
    return json.dumps(left, sort_keys=True, separators=(',', ':'), allow_nan=False) == json.dumps(right, sort_keys=True, separators=(',', ':'), allow_nan=False)


def _json_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result: _fail('INVALID_MANIFEST', 'Manifest has duplicate JSON keys.')
        result[key] = value
    return result


def _bad_constant(_):
    _fail('INVALID_MANIFEST', 'Nonfinite JSON numbers are unsupported.')


def _hash_text(value):
    if not isinstance(value, str) or not re.fullmatch(r'[0-9a-f]{64}', value):
        _fail('INVALID_MANIFEST', 'Expected a lowercase SHA-256 hash.')
    return value


def _text(value):
    if not isinstance(value, str) or not value or len(value) > 512 or '\0' in value:
        _fail('INVALID_MANIFEST', 'Manifest identity is invalid.')
    return value


def _manifest(raw):
    manifest = json.loads(raw.decode('utf-8'), object_pairs_hook=_json_pairs, parse_constant=_bad_constant)
    if not isinstance(manifest, dict): _fail('INVALID_MANIFEST', 'Manifest must be an object.')
    if manifest.get('schemaVersion') != '1': _fail('UNSUPPORTED_SNAPSHOT_VERSION', 'Snapshot schema version is unsupported.')
    fields = {'schemaVersion', 'artifactType', 'status', 'snapshotId', 'source', 'selection', 'members', 'jobRoots', 'holds', 'nativeSchemaValidated', 'machineExportAllowed', 'limits'}
    if set(manifest) != fields or manifest['artifactType'] != 'scan.source-snapshot' or manifest['status'] != 'complete':
        _fail('INVALID_MANIFEST', 'Manifest fields or artifact type are invalid.')
    if manifest['nativeSchemaValidated'] is not False or manifest['machineExportAllowed'] is not False:
        _fail('INVALID_MANIFEST', 'A source snapshot cannot authorize a native schema or writer.')
    _hash_text(manifest['snapshotId'])
    limits = manifest['limits']
    # Recorded creation limits are provenance only, never authority to raise ours.
    if not isinstance(limits, dict) or set(limits) != {'max_archive_bytes', 'intake'}:
        _fail('INVALID_MANIFEST', 'Recorded capture limits are invalid.')
    if type(limits['max_archive_bytes']) is not int or limits['max_archive_bytes'] < 1:
        _fail('INVALID_MANIFEST', 'Recorded archive limit is invalid.')
    intake = limits['intake']
    expected_keys = {'max_entries', 'max_total_uncompressed', 'max_entry_uncompressed', 'max_compression_ratio', 'max_path_length'}
    if not isinstance(intake, dict) or set(intake) != expected_keys:
        _fail('INVALID_MANIFEST', 'Recorded intake limits are invalid.')
    if any(type(v) not in ((int, float) if key == 'max_compression_ratio' else (int,)) or not math.isfinite(v) or v < 1 for key, v in intake.items()):
        _fail('INVALID_MANIFEST', 'Recorded limits must be positive numbers.')
    selected = manifest['selection']
    if not isinstance(selected, dict) or set(selected) != {'root', 'job', 'master'}:
        _fail('INVALID_MANIFEST', 'Snapshot selection is invalid.')
    for name in ('job', 'master'):
        record = selected[name]
        if name == 'master' and record is None: continue
        if not isinstance(record, dict) or set(record) != {'member', 'role', 'storedPath', 'sha256', 'size'}:
            _fail('INVALID_MANIFEST', 'Selected member record is invalid.')
        _text(record['member']); _hash_text(record['sha256'])
        if record['role'] not in ('main', 'temp', 'backup') or record['storedPath'] != f'selected/{name}.bin' or type(record['size']) is not int or record['size'] < 0:
            _fail('INVALID_MANIFEST', 'Selected role, stored path or size is invalid.')
    job, master = selected['job'], selected['master']
    selection = SnapshotSelection(_text(selected['root']), job['member'], job['role'], master['member'] if master else None, master['role'] if master else None)
    return manifest, selection


class _XmlEnvelope:
    """Streaming target retaining counts and bounded version claims, never a tree."""
    def __init__(self, limits):
        self.limits = limits
        self.depth = self.nodes = self.max_depth = self.attributes = self.comments = self.instructions = 0
        self.root = None
        self.tags = Counter()
        self.children = Counter()
        self.versions = []
        self.version_tag = None
        self.version_text = ''
        self.version_overflow = False

    def start(self, tag, attributes):
        self.nodes += 1; self.depth += 1
        self.max_depth = max(self.max_depth, self.depth)
        self.attributes += len(attributes)
        if self.nodes > self.limits.max_xml_nodes or self.depth > self.limits.max_xml_depth or len(tag) > 512 or len(attributes) > 64 or any(len(name) > 512 for name in attributes):
            _fail('XML_LIMIT', 'Selected XML exceeds node, depth, name or attribute limits.')
        self.tags[tag] += 1
        if len(self.tags) > self.limits.max_xml_names:
            _fail('XML_LIMIT', 'Selected XML contains too many distinct names.')
        if self.depth == 1:
            self.root = tag
            for name, value in attributes.items():
                if name.rsplit('}', 1)[-1].lower().endswith('version') and re.fullmatch(r'[A-Za-z0-9_. -]{1,64}', value):
                    self.versions.append({'location': 'root-attribute', 'name': name, 'claim': value})
        if self.depth == 2:
            self.children[tag] += 1
            if tag.rsplit('}', 1)[-1].lower().endswith('version'):
                self.version_tag = tag; self.version_text = ''; self.version_overflow = False
        elif self.depth > 2:
            self.version_tag = None  # A nested structure is not a scalar claim.

    def data(self, text):
        if self.depth == 2 and self.version_tag:
            self.version_overflow |= len(self.version_text) + len(text) > 64
            self.version_text = (self.version_text + text)[:65]

    def end(self, tag):
        if self.depth == 2 and self.version_tag:
            if not self.version_overflow and re.fullmatch(r'[A-Za-z0-9_. -]{1,64}', self.version_text.strip()):
                if len(self.versions) >= 64: _fail('XML_LIMIT', 'Too many XML version claims.')
                self.versions.append({'location': 'direct-child', 'name': tag, 'claim': self.version_text.strip()})
            self.version_tag = None
        self.depth -= 1

    def comment(self, text): self.comments += 1
    def pi(self, target, text): self.instructions += 1
    def close(self):
        return {'status': 'well-formed', 'rootName': self.root, 'elementCount': self.nodes, 'attributeCount': self.attributes,
                'maxDepth': self.max_depth, 'commentCount': self.comments, 'processingInstructionCount': self.instructions,
                'elementNames': dict(sorted(self.tags.items())), 'directChildNames': dict(sorted(self.children.items())),
                'versionClaims': self.versions, 'semanticInterpretation': 'unsupported'}


def xml_envelope(stream, size, limits):
    if size > limits.max_xml_bytes:
        return {'status': 'blocked', 'code': 'XML_LIMIT', 'reason': 'Selected XML exceeds the reader byte limit; its captured bytes were still verified.'}
    try:
        target = _XmlEnvelope(limits)
        parser = DefusedXMLParser(target=target, forbid_dtd=True, forbid_entities=True, forbid_external=True)
        remaining = limits.max_xml_bytes
        while chunk := stream.read(min(65536, remaining + 1)):
            remaining -= len(chunk)
            if remaining < 0: _fail('XML_LIMIT', 'Selected XML exceeds the reader byte limit.')
            parser.feed(chunk)
        return parser.close()
    except CaptureBlocked as error:
        return {'status': 'blocked', 'code': error.code, 'reason': str(error)}
    except ParseError as error:
        # Expat descriptions are fixed parser categories, unlike exception text
        # that may reveal source-derived names or values.
        category = ErrorString(error.code) or 'malformed XML'
        return {'status': 'blocked', 'code': 'XML_REJECTED', 'reason': f'Selected XML failed parsing: {category}. Original bytes remain preserved; review another explicit snapshot or a separate supported repair.'}
    except Exception:
        return {'status': 'blocked', 'code': 'XML_REJECTED', 'reason': 'Selected XML is malformed or contains a forbidden DTD/entity. No contents were logged.'}


def inspect_snapshot(source_path, expected_package_sha256, limits=None):
    """Inspect against an independent capture hash; return a report, never a candidate."""
    limits = limits or InspectLimits()
    source = Path(source_path).absolute()
    try:
        expected = _hash_text(expected_package_sha256)
        digest, source_stat = _fresh_hash(source, limits.max_package_bytes)
        if digest != expected: _fail('STALE_PACKAGE', 'Package differs from the expected capture hash. Inspection stopped.')
        with tempfile.TemporaryDirectory(prefix='scan-inspect-') as temporary:
            stage = Path(temporary).resolve()
            if stage.parent != Path(tempfile.gettempdir()).resolve() or not stage.name.startswith('scan-inspect-'):
                _fail('TEMPORARY_PATH', 'Inspection staging is outside its expected parent.')
            copied = stage / 'snapshot.bin'
            with source.open('rb') as incoming, copied.open('xb') as outgoing:
                copied_hash, copied_size = _stream(incoming, outgoing, limits.max_package_bytes)
            if copied_hash != expected or copied_size != source_stat.st_size:
                _fail('SOURCE_CHANGED', 'Package changed during its bounded local copy.')
            check_zip_directory(copied, 4, 256_000)
            with zipfile.ZipFile(copied) as outer:
                infos = outer.infolist()
                names = [i.filename for i in infos]
                permitted = {'manifest.json', 'source/archive.zip', 'selected/job.bin', 'selected/master.bin'}
                if len(infos) not in (3, 4) or len(set(names)) != len(names) or not set(names) <= permitted:
                    _fail('INVALID_PACKAGE', 'Snapshot has duplicate, missing or unexpected outer entries.')
                if not {'manifest.json', 'source/archive.zip', 'selected/job.bin'} <= set(names):
                    _fail('INVALID_PACKAGE', 'Snapshot required entries are missing.')
                for info in infos:
                    maximum = limits.max_manifest_bytes if info.filename == 'manifest.json' else limits.capture.max_archive_bytes if info.filename == 'source/archive.zip' else limits.capture.intake.max_entry_uncompressed
                    if info.is_dir() or stat.S_ISLNK(info.external_attr >> 16) or info.flag_bits & 1 or info.compress_type != zipfile.ZIP_STORED or info.file_size > maximum:
                        _fail('INVALID_PACKAGE', 'Snapshot has unsupported entry types, compression or sizes.')
                with outer.open('manifest.json') as handle:
                    manifest_raw = handle.read(limits.max_manifest_bytes + 1)
                if len(manifest_raw) > limits.max_manifest_bytes: _fail('SIZE_LIMIT', 'Manifest exceeds its reader byte limit.')
                manifest, selection = _manifest(manifest_raw)
                if ('selected/master.bin' in names) != (selection.master_member is not None):
                    _fail('INVALID_PACKAGE', 'Master payload and explicit selection disagree.')
                archive_path = stage / 'archive.zip'
                with outer.open('source/archive.zip') as incoming, archive_path.open('xb') as outgoing:
                    archive_hash, archive_size = _stream(incoming, outgoing, limits.capture.max_archive_bytes)
                if not _same(manifest['source'], {'sha256': archive_hash, 'size': archive_size, 'storedPath': 'source/archive.zip'}):
                    _fail('SOURCE_MISMATCH', 'Captured archive hash or size differs from its manifest.')
                inventory = inventory_zip(archive_path, limits.capture.intake)
                holds = _validate_selection(inventory, selection)
                entries = {e.path: e for e in inventory.entries}
                actual_members = []
                total_read = 0
                check_zip_directory(archive_path, limits.capture.intake.max_entries)
                with zipfile.ZipFile(archive_path) as archive:
                    for info in archive.infolist():
                        name = _normalize_member_name(info.filename, limits.capture.intake.max_path_length)
                        entry = entries[name]
                        if info.is_dir():
                            if info.file_size: _fail('INVALID_PACKAGE', 'An archive directory contains payload data.')
                            continue
                        maximum = min(limits.capture.intake.max_entry_uncompressed, limits.capture.intake.max_total_uncompressed - total_read)
                        with archive.open(info) as handle: member_hash, size = _stream(handle, None, maximum)
                        if size != entry.size: _fail('MEMBER_MISMATCH', 'Archive member size differs from its inventory.')
                        total_read += size
                        actual_members.append({'originalName': info.filename, 'path': name, 'sha256': member_hash, 'size': size, 'kind': entry.kind, 'inventoryRole': entry.snapshot_role})
                actual_members.sort(key=lambda item: item['path'])
                roots_match = _same(manifest['jobRoots'], [asdict(r) for r in inventory.job_roots])
                if not roots_match:
                    # Older captures did not discover orphan temp/backup roots.
                    # Accept only that exact historical derivation of the same
                    # verified bytes; selected members still pass current checks.
                    roots_match = _same(manifest['jobRoots'], [asdict(r) for r in _discover_job_roots(inventory.entries, include_recovery=False)])
                if not _same(manifest['members'], actual_members) or not roots_match or not _same(manifest['holds'], list(holds)):
                    _fail('INVENTORY_MISMATCH', 'Recorded inventory, roots or selection holds differ from verified source bytes.')
                identity = {'archiveSha256': archive_hash, 'selection': asdict(selection)}
                snapshot_id = sha256(json.dumps(identity, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
                if snapshot_id != manifest['snapshotId']: _fail('IDENTITY_MISMATCH', 'Snapshot identity does not match its archive and selection.')
                member_map = {m['path']: m for m in actual_members}
                documents = {}
                native_records = {}
                for role in ('job', 'master'):
                    selected = manifest['selection'][role]
                    if selected is None: continue
                    member = member_map[selected['member']]
                    with outer.open(selected['storedPath']) as handle:
                        selected_hash, selected_size = _stream(handle, None, limits.capture.intake.max_entry_uncompressed)
                    if not _same([selected_hash, selected_size], [member['sha256'], member['size']]) or not _same([selected['sha256'], selected['size']], [selected_hash, selected_size]):
                        _fail('SELECTED_MISMATCH', 'Selected payload differs from its exact archived member.')
                    with outer.open(selected['storedPath']) as handle:
                        documents[role] = xml_envelope(handle, selected_size, limits)
                    if documents[role]['status'] == 'well-formed':
                        with outer.open(selected['storedPath']) as handle:
                            native_records[role] = read_native_records(handle, selected_size)
                fresh, fresh_stat = _fresh_hash(source, limits.max_package_bytes)
                if fresh != expected or _fingerprint(fresh_stat) != _fingerprint(source_stat):
                    _fail('SOURCE_CHANGED', 'Source package changed during inspection.')
                report_holds = [{'code': 'NATIVE_ADAPTER_UNQUALIFIED', 'scope': 'job', 'reason': 'No native semantic reader/writer is qualified for this XML. Version text is an unverified source claim.', 'nextAction': 'Qualify a version-specific reader against authorized format evidence and independent synthetic fixtures.'},
                                {'code': 'DEPENDENCIES_UNKNOWN', 'scope': 'job', 'reason': 'Preserved file inventory does not establish required native dependencies.', 'nextAction': 'Resolve native model, image and other references through the qualified adapter.'},
                                {'code': 'MACHINE_EVIDENCE_MISSING', 'scope': 'job', 'reason': 'No candidate has authorized Eagle load/save/reopen evidence.', 'nextAction': 'After writer qualification, test the exact candidate through the approved Eagle workflow.'}]
                if selection.master_member is None:
                    report_holds.append({'code': 'MASTER_NOT_SELECTED', 'scope': 'job', 'reason': holds[0], 'nextAction': 'Capture an explicitly selected master if required by the supported format.'})
                for role, document in documents.items():
                    if document['status'] == 'blocked':
                        report_holds.append({'code': document['code'], 'scope': role, 'reason': document['reason'], 'nextAction': 'Resolve the XML preflight failure before semantic reading.'})
                for role, records in native_records.items():
                    if records['status'] != 'recorded':
                        report_holds.append({'code': 'NATIVE_RECORDS_' + records['status'].upper(), 'scope': role, 'reason': records['reason'], 'nextAction': 'Resolve the bounded native reader prerequisite before semantic interpretation; verified source bytes remain preserved.'})
                    elif records['duplicateScalarFields']:
                        report_holds.append({'code': 'NATIVE_SCALAR_AMBIGUITY', 'scope': role, 'reason': 'Repeated scalar fields occur in native records. Every value is retained; none was silently selected.', 'nextAction': 'Review the exact source paths and duplicate fields through the supported native-format workflow.'})
                return {'status': 'success', 'code': 'PREFLIGHT_RECORDED', 'artifactType': 'scan.snapshot-preflight', 'schemaVersion': '1',
                        'readerVersion': 'a05-records-2', 'packageSha256': expected, 'snapshotId': snapshot_id, 'source': manifest['source'],
                        'selection': manifest['selection'], 'integrity': {'status': 'verified-against-capture-hash', 'allArchivedFilesVerified': True},
                        'preservedFiles': actual_members, 'preservedDirectories': sorted(e.path for e in inventory.entries if e.is_directory),
                        'xmlEnvelopes': documents, 'nativeRecords': native_records, 'recordedCaptureLimits': manifest['limits'], 'readerLimits': asdict(limits),
                        'readiness': {'packageComplete': None, 'offlinePreparationCoverage': None, 'machineCompatibility': None, 'opticalTeachingValidation': None, 'productionRelease': None},
                        'coverage': {'represented': None, 'enabled': None, 'taught': None, 'verified': None, 'released': None},
                        'dependencyGraph': None, 'nativeSchemaSupported': False, 'machineExportAllowed': False, 'candidateId': None,
                        'changes': [], 'holds': report_holds}
    except ZipBudgetExceeded:
        return {'status': 'blocked', 'code': 'ZIP_METADATA_LIMIT', 'reasons': ['ZIP directory exceeds its entry or metadata byte limit.'], 'machineExportAllowed': False, 'candidateId': None}
    except CaptureBlocked as error:
        return {'status': 'unsupported' if error.code == 'UNSUPPORTED_SNAPSHOT_VERSION' else 'blocked', 'code': error.code, 'reasons': [str(error)], 'machineExportAllowed': False, 'candidateId': None}
    except Exception:
        return {'status': 'blocked', 'code': 'INVALID_SNAPSHOT', 'reasons': ['Snapshot is malformed, corrupt or inaccessible. No source contents were logged.'], 'machineExportAllowed': False, 'candidateId': None}
