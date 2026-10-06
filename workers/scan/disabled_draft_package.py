"""Atomic private transport for exact reviewed disabled qualification profiles.

Both the legacy minimal trial and complete job-local adapter re-derive all new
records from immutable source bytes. Unsupported records stay held; transport
never grants schema, image-teaching or machine qualification.
"""
from copy import copy
from dataclasses import asdict
from hashlib import sha256
import os
from pathlib import Path
import tempfile
import zipfile

from .disabled_draft import apply_disabled_draft, recipe_digest
from .job_intake import IntakeLimits, inventory_zip, _normalize_member_name
from .qualification_candidate import _canonical, _check, _copy_stream, _fail, MAX_ARCHIVE, MAX_XML, MAX_CANDIDATE
from .snapshot_capture import CaptureBlocked, SnapshotSelection, _fresh_hash, _fingerprint, _validate_selection, _publish_no_overwrite


def package_digest(archive_sha256, selection, recipe):
    return sha256(_canonical({'archiveSha256': archive_sha256, 'selection': asdict(selection), 'recipe': recipe})).hexdigest()


def create_disabled_draft_package(source_path, destination_path, pcb, selection: SnapshotSelection,
                                  archive_sha256, recipe, accepted_digest, *, cancelled=None):
    published = False
    result = None
    try:
        if selection.job_role != 'main' or selection.master_role != 'main' or not selection.master_member:
            _fail('DRAFT_MAIN_REQUIRED', 'Draft trials require explicitly selected main job and main Master snapshots.')
        if package_digest(archive_sha256, selection, recipe) != accepted_digest:
            _fail('DRAFT_STALE_APPROVAL', 'Archive, both selected snapshots and exact draft recipe must match the reviewed package digest.')
        source = Path(source_path).absolute()
        destination = Path(destination_path).absolute()
        parent = destination.parent.resolve(strict=True)
        repository = Path(__file__).resolve().parents[2]
        if parent.is_relative_to(repository) or str(parent).startswith(('\\\\', '//')) or not destination.name.endswith('.scan-draft-qualification.zip'):
            _fail('DESTINATION_POLICY', 'Use an isolated local output outside the repository with a new .scan-draft-qualification.zip name.')
        destination = parent / destination.name
        if os.path.lexists(destination):
            _fail('DESTINATION_EXISTS', 'Existing output is never overwritten.')
        original_hash, original_stat = _fresh_hash(source, MAX_ARCHIVE)
        if original_hash != archive_sha256:
            _fail('STALE_SOURCE', 'Source archive bytes differ from the exact reviewed identity.')
        _check(cancelled)
        with tempfile.TemporaryDirectory(prefix='.scan-disabled-draft-', dir=parent) as temporary:
            stage = Path(temporary)
            frozen = stage / 'source.zip'
            with source.open('rb') as incoming, frozen.open('xb') as outgoing:
                frozen_hash, size = _copy_stream(incoming, outgoing, MAX_ARCHIVE, cancelled)
            if (frozen_hash, size) != (original_hash, original_stat.st_size):
                _fail('SOURCE_CHANGED', 'Original changed during immutable capture.')
            limits = IntakeLimits()
            inventory = inventory_zip(frozen, limits)
            _validate_selection(inventory, selection)
            entries = {entry.path: entry for entry in inventory.entries}
            selected = {'job': selection.job_member, 'master': selection.master_member}
            with zipfile.ZipFile(frozen) as original:
                actual_names = {_normalize_member_name(info.filename, limits.max_path_length): info for info in original.infolist()}
                raw = {}
                for role, name in selected.items():
                    info = actual_names[name]
                    if info.file_size > MAX_XML:
                        _fail('XML_LIMIT', 'Selected draft XML exceeds its bounded reader.')
                    with original.open(info) as handle:
                        raw[role] = handle.read(MAX_XML + 1)
                    if len(raw[role]) > MAX_XML:
                        _fail('XML_LIMIT', 'Selected draft XML exceeds its bounded reader.')
                if recipe.get('profile') == 'job-local-owned-footprint-disabled-2':
                    from .native_preparation import apply_preparation
                    changed = apply_preparation(raw['job'], raw['master'], pcb, recipe, recipe_digest(recipe))
                else:
                    changed = apply_disabled_draft(raw['job'], raw['master'], pcb, recipe, recipe_digest(recipe))
                replacements = {selected[role]: data for role, data in changed.items()}
                candidate = stage / 'candidate.zip'
                files, total = [], 0
                with zipfile.ZipFile(candidate, 'x') as output:
                    output.comment = original.comment
                    for info in original.infolist():
                        _check(cancelled)
                        member = _normalize_member_name(info.filename, limits.max_path_length)
                        entry = entries[member]
                        budget = min(limits.max_entry_uncompressed, limits.max_total_uncompressed - total)
                        with original.open(info) as incoming:
                            if member in replacements:
                                before_hash, size = _copy_stream(incoming, None, budget, cancelled)
                                replacement = replacements[member]
                                output.writestr(copy(info), replacement)
                                after_hash, after_size = sha256(replacement).hexdigest(), len(replacement)
                            else:
                                with output.open(copy(info), 'w') as outgoing:
                                    before_hash, size = _copy_stream(incoming, outgoing, budget, cancelled)
                                after_hash, after_size = before_hash, size
                        if size != entry.size or entry.is_directory and size:
                            _fail('INVALID_ARCHIVE', 'Entry payload differs from its bounded inventory.')
                        total += size
                        files.append({'path': info.filename, 'beforeSha256': before_hash, 'afterSha256': after_hash, 'size': after_size})
                with zipfile.ZipFile(candidate) as verified:
                    if verified.namelist() != original.namelist() or verified.comment != original.comment:
                        _fail('DRAFT_PRESERVATION', 'Archive member order or comment changed.')
                    for info, old_info, record in zip(verified.infolist(), original.infolist(), files):
                        for key in ('filename', 'date_time', 'comment', 'extra', 'internal_attr', 'external_attr', 'compress_type', 'create_system'):
                            if getattr(info, key) != getattr(old_info, key):
                                _fail('DRAFT_PRESERVATION', 'Archive entry metadata changed.')
                        with verified.open(info) as incoming:
                            digest, size = _copy_stream(incoming, None, limits.max_entry_uncompressed + MAX_XML, cancelled)
                        if (digest, size) != (record['afterSha256'], record['size']):
                            _fail('DRAFT_PRESERVATION', 'Independently reopened payload differs from the exact expected bytes.')
            candidate_hash, _ = _fresh_hash(candidate, MAX_CANDIDATE)
            receipt = {'artifactType': 'scan.disabled-draft-trial-receipt', 'status': 'success', 'schemaVersion': '1',
                'qualificationOnly': True, 'machineExportAllowed': False, 'profileQualification': recipe.get('profile', 'synthetic-structural-tests-only'),
                'archiveSha256': original_hash, 'selection': asdict(selection), 'recipe': recipe,
                'acceptedDigest': accepted_digest, 'candidateSha256': candidate_hash, 'files': files,
                'snapshotWarning': 'Unselected Temp and backup payloads retain their ORIGINAL state. Never silently substitute them for the two selected candidate main documents.',
                'remaining': recipe['remaining']}
            package = stage / 'package.zip'
            with zipfile.ZipFile(package, 'x') as wrapper:
                wrapper.write(candidate, 'CANDIDATE.zip')
                wrapper.writestr('disabled-draft-receipt.json', _canonical(receipt))
                wrapper.writestr('README.txt', 'QUALIFICATION ONLY — DISABLED STRUCTURAL PREPARATION\nProfile: ' + str(receipt['profileQualification']) + '\nEagle compatibility, pad binding and inspection behavior unverified.\n' + receipt['snapshotWarning'] + '\nDo not copy over a live job or shared library.\n')
            digest, _ = _fresh_hash(package, MAX_CANDIDATE + 4_000_000)
            current_hash, current_stat = _fresh_hash(source, MAX_ARCHIVE)
            if current_hash != original_hash or _fingerprint(current_stat) != _fingerprint(original_stat):
                _fail('SOURCE_CHANGED', 'Original archive changed before publication.')
            _check(cancelled)
            result = {**receipt, 'packageSha256': digest}
            _publish_no_overwrite(package, destination)
            published = True
            return result
    except Exception as error:
        if published:
            return {**result, 'cleanupWarning': 'Published package is complete; owned staging cleanup did not finish.'}
        return {'status': 'blocked', 'code': error.code if isinstance(error, CaptureBlocked) else 'DRAFT_FAILED',
                'reason': str(error) if isinstance(error, CaptureBlocked) else 'Draft packaging failed without publishing a partial package.',
                'qualificationOnly': True, 'machineExportAllowed': False}
