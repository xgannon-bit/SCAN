"""Local browser qualification adapter. Evidence is operator supplied, never an oracle.

The underlying writer remains the source/identity/byte-preservation authority.
Browser binding writes are deliberately held until ownership semantics qualify.
"""
from copy import deepcopy
from hashlib import sha256
import csv
import io
import json
from pathlib import Path
import subprocess
import zipfile

from .qualification_candidate import _request, _patch_xml, proposal_digest, create_qualification_candidate, verify_guarded_master
from .snapshot_capture import CaptureBlocked
from .placement_intake import IntakeError


def review_request(source, review, draft):
    request = deepcopy(draft)
    selected = review['preflight']['selection']
    expected = {'archiveSha256': review['preflight']['source']['sha256'],
                'jobSha256': selected['job']['sha256'], 'root': selected['root'],
                'jobMember': selected['job']['member'], 'jobRole': selected['job']['role']}
    guarded = any('beforeRoi' in item for item in request.get('proposals', []))
    master_keys = {'masterMember', 'masterSha256', 'masterRole'}
    if guarded or master_keys.intersection(request.get('source', {})):
        if not selected.get('master') or selected['master']['role'] != 'main':
            raise CaptureBlocked('MASTER_SELECTION_REQUIRED', 'A guarded placement edit needs an explicitly selected main Master; missing, temporary or backup selections stay held.')
        expected.update(masterMember=selected['master']['member'], masterSha256=selected['master']['sha256'], masterRole='main')
    if request.get('source') != expected or expected['jobRole'] != 'main':
        raise CaptureBlocked('STALE_SOURCE', 'Proposal must match the currently selected main snapshot and all source hashes. Temp/backup remain read-only.')
    for item in request.get('proposals', []):
        if item.get('path', '').split(']/')[-1] not in ('Roi/cx', 'Roi/cy', 'CenterPosX', 'ENABLE'):
            raise CaptureBlocked('BINDING_HELD', 'Dependent binding writes require qualified ownership and native semantics; retain this proposal as held.')
    # Validate the entire proposal set without publishing or authorizing anything.
    request['acceptances'] = [{'proposalId': p['id'], 'proposalSha256': proposal_digest(request, p),
                               'decision': 'accepted', 'reviewer': request['reviewer']} for p in request['proposals']]
    request = _request(request)
    with zipfile.ZipFile(source) as archive:
        raw = archive.read(expected['jobMember'])
        if guarded:
            master = archive.read(expected['masterMember'])
            if sha256(master).hexdigest() != expected['masterSha256']:
                raise CaptureBlocked('STALE_MASTER', 'Selected Master bytes differ from the exact reviewed hash.')
            verify_guarded_master(raw, master, request['proposals'])
    if sha256(raw).hexdigest() != expected['jobSha256']:
        raise CaptureBlocked('STALE_JOB', 'Selected XML differs from the review.')
    _patch_xml(raw, request['proposals'])
    for acceptance in request['acceptances']:
        acceptance['decision'] = 'pending'
    return request


def _csv(rows):
    stream = io.StringIO(newline='')
    keys = list(dict.fromkeys(key for row in rows for key in row))
    writer = csv.DictWriter(stream, fieldnames=keys)
    writer.writeheader()
    for row in rows:
        # Spreadsheet exports never execute a source literal as a formula.
        writer.writerow({key: ("'" + value if value.startswith(('=', '+', '-', '@', '\t', '\r')) else value)
                         for key, value in ((key, json.dumps(value, ensure_ascii=False) if isinstance(value, (dict, list)) else str(value)) for key, value in row.items())})
    return stream.getvalue()


def _remaining_rows(preflight):
    """Portable component/window work, keeping shared scopes and unknowns explicit."""
    accounting = preflight.get('nativeAccounting', {})
    queue = preflight.get('nativeInspectionWork', {})
    parts = {part['sourcePath']: part for part in queue.get('parts', [])}
    scopes = {scope['id']: scope for scope in queue.get('scopes', [])}
    windows = {window['id']: window for window in queue.get('windows', [])}
    instances = {instance['id']: instance for instance in accounting.get('nativeInstances', [])}
    groups = {group['id']: group for group in accounting.get('correspondenceGroups', [])}
    rows = []
    for component in accounting.get('componentCoverage', []):
        group = groups.get(component.get('groupId'), {})
        linked = [instances[key] for key in group.get('nativeInstanceIds', []) if key in instances]
        base = {'reference': component.get('referenceLiteral'), 'module': component.get('moduleLiteral'),
                'coverageId': component['id'], 'sourcePath': component['sourcePath'],
                'machineVerification': 'not-performed', 'release': 'not-granted'}
        if not linked:
            rows.append({**base, 'reason': 'No unambiguous native inspection correspondence. Population/stage not established.',
                         'nextAction': 'Use current work-order/stage evidence to decide required inspection or intentional exclusion. Do not enable automatically.'})
        for instance in linked:
            part = parts.get(instance['sourcePath'], {})
            scope = scopes.get(part.get('scopeId'), {})
            identity = part.get('identityLiterals', {})
            placement = {**base, 'nativeId': identity.get('ID'), 'masterKey': identity.get('MasterKey'),
                         'placementPath': instance['sourcePath'], 'sharedPlacementCount': len(scope.get('partIds', []))}
            rows.append({**placement, 'reason': 'Placement/origin and population require review; teaching unverified.',
                         'nextAction': 'Review source identity, local geometry, duplicate scope and physical-board teaching; preserve legitimate origins.'})
            for key in scope.get('windowIds', []):
                window = windows.get(key)
                if window:
                    if len(rows) >= 100_000:
                        raise CaptureBlocked('REPORT_LIMIT', 'Component/window expansion exceeds 100,000 rows; candidate download is held rather than truncated.')
                    rows.append({**placement, 'windowId': window['rawFields'].get('ID'), 'windowPath': window['sourcePath'],
                                 'algorithms': window.get('algorithmIds', []),
                                 'reason': 'Binding ownership, window geometry and algorithm teaching unresolved.',
                                 'nextAction': 'At Athena verify owned visible feature, window position and appropriate teaching; perform fresh-board optical checks. Shared changes affect all listed scope placements.'})
    return rows


def _software_identity():
    root = Path(__file__).resolve().parents[2]
    def git(*arguments):
        try:
            value = subprocess.run(['git', *arguments], cwd=root, capture_output=True, text=True, timeout=5,
                                   creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            return value.stdout.strip() if value.returncode == 0 else None
        except (OSError, subprocess.TimeoutExpired):
            return None
    revision = git('rev-parse', 'HEAD')
    status = git('status', '--porcelain', '--untracked-files=normal')
    return {'commit': revision, 'workingTreeModified': bool(status) if status is not None else None,
            'adapter': 'browser-qualification-2', 'writer': 'qualification-byte-patch-3',
            'codeSha256': {name: sha256((root / 'workers' / 'scan' / name).read_bytes()).hexdigest()
                           for name in ('repair_review.py', 'qualification_candidate.py', 'archive_browser_cli.py',
                                        'repair_composition.py', 'native_placement_diagnosis.py', 'origin_evidence.py',
                                        'accel_ascii.py', 'placement_intake.py', 'bom_intake.py',
                                        'paired_terminal_constructor.py', 'diode_constructor.py', 'three_terminal_constructor.py',
                                        'physical_terminal_constructor.py', 'thermal_terminal_constructor.py',
                                        'native_preparation.py', 'native_model_geometry.py', 'native_window_subset.py',
                                        'native_record_insertion.py', 'disabled_draft.py', 'native_records.py', 'native_bindings.py',
                                        'native_pad_binding.py', 'native_fov.py', 'snapshot_capture.py')}}


def run(source, review, control, layout_path=None, diagnosis_input=None):
    try:
        diagnosis_report = None
        diagnosis_receipt = None
        if isinstance(control.get('request'), dict) and 'diagnosis' in control['request']:
            from .native_placement_diagnosis import diagnose_files, verify_request
            diagnosis_report = diagnose_files(source, review, control['request']['diagnosis'], diagnosis_input)
            diagnosis_receipt = verify_request(control['request'], diagnosis_report)
        checked = review_request(source, review, control['request'])
        if control['action'] == 'repair-review':
            expected_job = None
            if any(value.get('decision') == 'accepted' for value in control['request'].get('acceptances', [])):
                accepted_request = _request(control['request'])
                accepted_ids = {d['proposalId'] for d in accepted_request['acceptances'] if d['decision'] == 'accepted'}
                with zipfile.ZipFile(source) as archive:
                    original = archive.read(accepted_request['source']['jobMember'])
                expected_job = sha256(_patch_xml(original, [p for p in accepted_request['proposals'] if p['id'] in accepted_ids])).hexdigest()
            return {'status': 'success', 'artifactType': 'scan.repair-review', 'request': checked,
                    'expectedAcceptedJobSha256': expected_job,
                    **({'diagnosis': diagnosis_report, 'diagnosisReceipt': diagnosis_receipt} if diagnosis_report else {}),
                    'machineExportAllowed': False, 'evidenceAuthority': 'Fresh source-derived experimental geometry; native runtime and physical correctness remain unverified.' if diagnosis_report else 'Historical replay or caller-declared support; no automatic diagnosis or physical correctness established.'}
        if control.get('acknowledgement') != 'QUALIFICATION ONLY':
            raise CaptureBlocked('ACKNOWLEDGEMENT_REQUIRED', 'Acknowledge qualification-only export and unresolved binding/inspection behavior.')
        if 'preparation' in control:
            from .repair_composition import compose_preparation
            return compose_preparation(source, layout_path, review, control,
                                       diagnosis_report=diagnosis_report, diagnosis_receipt=diagnosis_receipt)
        request = control['request']
        result = create_qualification_candidate(source, Path(source).parent / 'result.scan-qualification.zip', request)
        if result['status'] != 'success':
            return result
        baseline = review['preflight']
        # Re-open the actual complete candidate and rebuild its reports. The
        # reviewed original remains a separately named baseline, never a stale
        # candidate work queue after coordinates changed.
        from .worker_cli import dispatch
        candidate_path = Path(source).parent / 'repaired-candidate.zip'
        with zipfile.ZipFile(Path(source).parent / 'result.scan-qualification.zip') as trial:
            with trial.open('CANDIDATE.zip') as incoming, candidate_path.open('xb') as outgoing:
                while chunk := incoming.read(1024 * 1024):
                    outgoing.write(chunk)
        selection = baseline['selection']
        selected_master = selection.get('master')
        snapshot = Path(source).parent / 'repair-candidate.scan-snapshot'
        capture = dispatch({'protocolVersion': '1', 'action': 'capture', 'source': str(candidate_path), 'destination': str(snapshot),
            'expectedArchiveSha256': result['candidate']['sha256'], 'selection': {
                'root': selection['root'], 'jobMember': selection['job']['member'], 'jobRole': 'main',
                'masterMember': selected_master['member'] if selected_master else None,
                'masterRole': selected_master['role'] if selected_master else None}})
        if capture['status'] != 'success':
            return capture
        preflight = dispatch({'protocolVersion': '1', 'action': 'inspect-snapshot', 'source': str(snapshot),
                              'expectedPackageSha256': capture['package_sha256']})
        if preflight['status'] != 'success':
            return preflight
        accounting = preflight.get('nativeAccounting', {})
        instructions = ('QUALIFICATION ONLY — NOT MACHINE VALIDATED\n'
            'CANDIDATE.zip is the complete copied native tree. Extract separately; never overwrite the original or a live machine job.\n'
            'Only accepted scalar changes are applied. See applied_changes.json for exact scope. Shared Masters, libraries, images and other payloads are preserved.\n'
            'Temp/backup snapshots retain their original state. Do not substitute them for the selected main XML.\n'
            'Binding ownership, dependent-window geometry, teaching and inspection behavior remain unresolved.\n'
            'AT EAGLE: record machine identity and exact software build; first open the original separately. Record a no-intentional-edit save as control.\n'
            'Open the separate candidate using the verified local job-open procedure; stop and record any conversion/sync/rematch prompt.\n'
            'Check each changed placement and retained controls; compare pad/window relationships, OCR, limits, images and shared models.\n'
            'Save, close and reopen; copy the complete returned job for comparison. Perform fresh-board optical checks. Opening alone is not inspection validation.\n'
            'Keep Athena 1 and Athena 2 results separate. RCP controls validation/release.\n'
            'ROLLBACK: abandon this candidate and return to the untouched original using the established machine procedure.\n')
        output = Path(source).parent / 'result.engineering.zip'
        with zipfile.ZipFile(output, 'x', compression=zipfile.ZIP_DEFLATED) as bundle:
            with zipfile.ZipFile(Path(source).parent / 'result.scan-qualification.zip') as trial:
                for name in trial.namelist():
                    with trial.open(name) as incoming, bundle.open(name, 'w') as outgoing:
                        while chunk := incoming.read(1024 * 1024):
                            outgoing.write(chunk)
            documents = {'manifest.json': {**result, 'software': _software_identity()}, 'findings.json': accounting,
                         'proposals.json': request['proposals'], 'decisions.json': request['acceptances'],
                         'applied_changes.json': result['changes'], 'qualification.json': {
                             'structuralParse': 'passed', 'protectedPayloadPreservation': 'passed',
                             'dependencies': 'unqualified', 'intendedGeometry': 'unverified', 'eagleOpenSaveReopen': 'not-performed',
                             'machineIdentity': 'unverified', 'freshBoardOpticalTests': 'not-performed', 'release': 'not-granted'},
                         'native-inspection-work.json': preflight.get('nativeInspectionWork'),
                         'candidate-native-accounting.json': accounting,
                         'candidate-literal-dependencies.json': preflight.get('literalDependencies'),
                         'native-fov-assignments.json': preflight.get('nativeFovAssignments'),
                         'candidate-analysis.json': {'source': preflight['source'], 'snapshotId': preflight['snapshotId'],
                             'selection': preflight['selection'], 'qualificationOnly': True,
                             'derivedFrom': 'fresh-capture-and-reanalysis-of-actual-candidate'},
                         'baseline/native-inspection-work.json': baseline.get('nativeInspectionWork'),
                         'baseline/native-accounting.json': baseline.get('nativeAccounting'),
                         'baseline/native-fov-assignments.json': baseline.get('nativeFovAssignments'),
                         'repair-request.json': request}
            if diagnosis_report:
                accepted_ids = {a['proposalId'] for a in request['acceptances'] if a['decision'] == 'accepted'}
                accepted = [p for p in request['proposals'] if p['id'] in accepted_ids]
                documents['independent-placement-diagnosis.json'] = diagnosis_report
                documents['independent-diagnosis-receipt.json'] = {**diagnosis_receipt,
                    'acceptedScalars': len(accepted), 'acceptedPlacementGroups': len({p['path'].rsplit('/Roi/', 1)[0] for p in accepted})}
            for name, document in documents.items():
                bundle.writestr(name, json.dumps(document, ensure_ascii=True, indent=2))
            bundle.writestr('component_coverage.csv', _csv(accounting.get('componentCoverage', [])))
            bundle.writestr('remaining_work.csv', _csv(_remaining_rows(preflight)))
            bundle.writestr('START_HERE.txt', instructions)
        digest = sha256()
        with output.open('rb') as handle:
            while chunk := handle.read(1024 * 1024):
                digest.update(chunk)
        return {'status': 'success', 'artifactType': 'scan.engineering-download', 'machineExportAllowed': False,
                'qualificationOnly': True, 'sha256': digest.hexdigest(), 'size': output.stat().st_size,
                'candidateSha256': result['candidate']['sha256'], 'sourceSha256': baseline['source']['sha256']}
    except CaptureBlocked as error:
        return {'status': 'blocked', 'code': error.code, 'reason': str(error), 'machineExportAllowed': False}
    except IntakeError:
        return {'status': 'blocked', 'code': 'DIAGNOSIS_INTAKE', 'reason': 'Diagnosis source mapping, units or format are malformed or unsupported; no source contents were logged and no candidate published.', 'machineExportAllowed': False}
    except (KeyError, TypeError, ValueError):
        return {'status': 'blocked', 'code': 'INVALID_REPAIR_REQUEST', 'reason': 'Invalid bounded repair request; no candidate published.', 'machineExportAllowed': False}
