"""Bounded browser review/apply for complete, disabled job-local part models."""
from hashlib import sha256
import json
from pathlib import Path
import zipfile

from .disabled_draft_package import create_disabled_draft_package, package_digest
from .native_preparation import automatic_plan, component_accounting, recipe_digest, apply_preparation
from .native_pad_binding import diagnose_pad_bindings
from .repair_review import _csv, _software_identity, _remaining_rows
from .snapshot_capture import SnapshotSelection, CaptureBlocked


def run(source, layout_path, review, control):
    try:
        expected = {'action', 'layoutSha256'} if control.get('action') == 'draft-review' else {'action', 'layoutSha256', 'reviewDigest', 'accepted', 'reviewer', 'acknowledgement'}
        if set(control) - {'packageProfiles'} != expected:
            raise CaptureBlocked('PREPARATION_REQUEST', 'Preparation review fields are missing or unexpected.')
        selected = review['preflight']['selection']
        if selected['job']['role'] != 'main' or not selected['master'] or selected['master']['role'] != 'main':
            raise CaptureBlocked('PREPARATION_MAIN', 'Select both main documents explicitly; Temp and backup remain read-only.')
        path = Path(layout_path)
        if not path.is_absolute() or path.parent != Path(source).parent or path.name != 'layout.pcb':
            raise CaptureBlocked('PREPARATION_INPUT', 'The local host must capture the source layout alongside its archive.')
        if not 0 < path.stat().st_size <= 8_000_000:
            raise CaptureBlocked('PREPARATION_INPUT', 'A nonempty source layout no larger than 8 MB is required.')
        pcb = path.read_bytes()
        if sha256(pcb).hexdigest() != control.get('layoutSha256'):
            raise CaptureBlocked('PREPARATION_STALE', 'The verified source layout changed; recompute the review.')
        with zipfile.ZipFile(source) as original:
            job, master = original.read(selected['job']['member']), original.read(selected['master']['member'])
        if any(len(x) > 16_000_000 for x in (job, master)):
            raise CaptureBlocked('XML_LIMIT', 'Selected documents exceed the bounded preparation profile.')
        plan = automatic_plan(job, master, pcb, control.get('packageProfiles'))
        selection = SnapshotSelection(selected['root'], selected['job']['member'], 'main', selected['master']['member'], 'main')
        archive_hash = review['preflight']['source']['sha256']
        digest = package_digest(archive_hash, selection, plan)
        if control['action'] == 'draft-review':
            return {'status': 'success', 'artifactType': 'scan.native-preparation-review', 'plan': plan, 'digest': digest,
                    'accounting': component_accounting(job, plan), 'padBindingWork': diagnose_pad_bindings(job, master, pcb),
                    'qualificationOnly': True, 'machineExportAllowed': False}
        if set(control) - {'packageProfiles'} != {'action', 'layoutSha256', 'reviewDigest', 'accepted', 'reviewer', 'acknowledgement'} or control['reviewDigest'] != digest:
            raise CaptureBlocked('PREPARATION_STALE', 'The complete reviewed plan must match fresh source bytes and selected snapshots.')
        if control['acknowledgement'] != 'QUALIFICATION ONLY' or not isinstance(control['reviewer'], str) or not 0 < len(control['reviewer'].strip()) <= 256:
            raise CaptureBlocked('PREPARATION_APPROVAL', 'Name the reviewer and acknowledge disabled qualification-only output.')
        recipe = {**plan, 'accepted': control['accepted']}
        # Fresh re-derivation proves every accepted record before any package write.
        changed = apply_preparation(job, master, pcb, recipe, recipe_digest(recipe))
        accounting = component_accounting(changed['job'], plan, recipe['accepted'])
        binding_work = diagnose_pad_bindings(changed['job'], changed['master'], pcb)
        package = Path(source).parent / 'parts.scan-draft-qualification.zip'
        result = create_disabled_draft_package(source, package, pcb, selection, archive_hash, recipe,
                                               package_digest(archive_hash, selection, recipe))
        if result['status'] != 'success':
            return result
        # Rebuild the actual candidate's placement/Master/window/algorithm work,
        # rather than relabeling a baseline report as prepared coverage.
        from .worker_cli import dispatch
        candidate_path = Path(source).parent / 'prepared-candidate.zip'
        with zipfile.ZipFile(package) as wrapper, wrapper.open('CANDIDATE.zip') as incoming, candidate_path.open('xb') as outgoing:
            while chunk := incoming.read(1024 * 1024):
                outgoing.write(chunk)
        snapshot = Path(source).parent / 'candidate.scan-snapshot'
        capture = dispatch({'protocolVersion': '1', 'action': 'capture', 'source': str(candidate_path), 'destination': str(snapshot),
                            'expectedArchiveSha256': result['candidateSha256'], 'selection': {
                                'root': selection.root, 'jobMember': selection.job_member, 'jobRole': 'main',
                                'masterMember': selection.master_member, 'masterRole': 'main'}})
        if capture['status'] != 'success':
            return capture
        candidate_review = dispatch({'protocolVersion': '1', 'action': 'inspect-snapshot', 'source': str(snapshot),
                                     'expectedPackageSha256': capture['package_sha256']})
        if candidate_review['status'] != 'success':
            return candidate_review
        result['reviewer'] = control['reviewer'].strip()
        result['software'] = _software_identity()
        result['software']['adapter'] = 'browser-native-preparation-1'
        result['software']['writer'] = plan['profile']
        for name in ('native_preparation.py', 'native_preparation_review.py', 'disabled_draft.py',
                     'disabled_draft_package.py', 'accel_ascii.py', 'snapshot_capture.py', 'job_intake.py',
                     'native_pad_binding.py', 'native_model_geometry.py', 'native_window_subset.py', 'paired_terminal_constructor.py'):
            result['software']['codeSha256'][name] = sha256(Path(__file__).with_name(name).read_bytes()).hexdigest()
        applied = [item for item in plan['items'] if item.get('digest') in recipe['accepted']]
        output = Path(source).parent / 'result.engineering.zip'
        with zipfile.ZipFile(output, 'x', compression=zipfile.ZIP_DEFLATED) as bundle:
            with zipfile.ZipFile(package) as trial:
                for name in trial.namelist():
                    with trial.open(name) as incoming, bundle.open(name, 'w') as outgoing:
                        while chunk := incoming.read(1024 * 1024):
                            outgoing.write(chunk)
            for name, document in {'manifest.json': result, 'proposals.json': plan,
                    'applied_changes.json': applied, 'decisions.json': {'reviewer': result['reviewer'], 'acceptedDigests': recipe['accepted'], 'reviewDigest': digest},
                    'component_accounting.json': accounting, 'baseline_component_accounting.json': component_accounting(job, plan),
                    'native-inspection-work.json': candidate_review.get('nativeInspectionWork'),
                    'pad-binding-work.json': binding_work,
                    'candidate-native-accounting.json': candidate_review.get('nativeAccounting'),
                    'qualification.json': {'originalXmlByteRecovery': 'passed', 'archivePayloadAndMetadataPreservation': 'passed',
                    'newPlacementMasterWindowClosure': 'passed', 'newInspectionEnabled': False,
                    'preparedWithCompleteTemplateWindowCopy': sum(i['dependencies']['windowPreparation'] == 'complete-template-window-copy' for i in applied),
                    'preparedWithPartialWindows': sum(i['dependencies']['windowPreparation'] == 'partial-closed-window-subset' for i in applied),
                    'preparedWithConstructedGeometry': sum(i['dependencies']['windowPreparation'] == 'constructed-body-terminal-geometry' for i in applied),
                    'padBinding': 'unresolved', 'dependentWindowGeometry': 'unverified', 'EagleOpenSaveReopen': 'not-performed',
                    'opticalTeaching': 'not-transferred', 'machineValidation': 'not-performed', 'release': 'not-granted'}}.items():
                bundle.writestr(name, json.dumps(document, ensure_ascii=True, indent=2))
            bundle.writestr('component_coverage.csv', _csv(accounting))
            bundle.writestr('remaining_work.csv', _csv([{'reference': item['reference'], 'module': item['module'], 'status': item['status'], 'remaining': item['remaining'], 'omittedWindows': item['omittedWindows']} for item in accounting] + _remaining_rows(candidate_review)))
            bundle.writestr('START_HERE.txt', 'QUALIFICATION ONLY — DISABLED NATIVE PART PREPARATION\n'
                'CANDIDATE.zip is a complete separate copy of the original native tree. Never overwrite the original, live machine job or shared library.\n'
                'Only individually accepted new placements, job-local Masters and disabled windows are appended. Existing teaching is byte-preserved.\n'
                'Partial-window preparations explicitly list omitted template windows and their causes; these remain unfinished Eagle work, not intentional inspection exclusions.\n'
                'New binding/FOV lists and algorithms are empty. Template-copy routes retain local geometry and origins; constructed routes derive body and terminal references from exact saved package evidence and owned source pads. Native runtime frames and new-record settings remain unqualified.\n'
                'Temp/backup snapshots still contain ORIGINAL state; never silently substitute them.\n'
                'At Eagle verify disabled placement identities, local origin and every dependent window, assign owned pads/FOVs and perform image-dependent teaching.\n'
                'Record exact Eagle build and machine identity; compare original control save and candidate open/save/reopen. Stop on conversion or sync prompts.\n'
                'Opening alone does not validate inspection. Keep Athena 1/2 evidence distinct. RCP owns release.\n'
                'Rollback: abandon the candidate and use the untouched original.\n')
        digest_output = sha256()
        with output.open('rb') as incoming:
            while chunk := incoming.read(1024 * 1024):
                digest_output.update(chunk)
        return {'status': 'success', 'artifactType': 'scan.engineering-download', 'qualificationOnly': True, 'machineExportAllowed': False,
                'sha256': digest_output.hexdigest(), 'size': output.stat().st_size,
                'candidateSha256': result['candidateSha256'], 'sourceSha256': archive_hash}
    except CaptureBlocked as error:
        return {'status': 'blocked', 'code': error.code, 'reason': str(error), 'machineExportAllowed': False}
    except (KeyError, TypeError, ValueError, OSError):
        return {'status': 'blocked', 'code': 'PREPARATION_REQUEST', 'reason': 'Invalid preparation request; no source contents logged or originals modified.', 'machineExportAllowed': False}
