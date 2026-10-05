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

from .qualification_candidate import _request, _patch_xml, proposal_digest, create_qualification_candidate
from .snapshot_capture import CaptureBlocked


def review_request(source, review, draft):
    request = deepcopy(draft)
    selected = review['preflight']['selection']
    expected = {'archiveSha256': review['preflight']['source']['sha256'],
                'jobSha256': selected['job']['sha256'], 'root': selected['root'],
                'jobMember': selected['job']['member'], 'jobRole': selected['job']['role']}
    if request.get('source') != expected or expected['jobRole'] != 'main':
        raise CaptureBlocked('STALE_SOURCE', 'Proposal must match the currently selected main snapshot and all source hashes. Temp/backup remain read-only.')
    for item in request.get('proposals', []):
        if item.get('path', '').split(']/')[-1] not in ('Roi/cx', 'CenterPosX', 'ENABLE'):
            raise CaptureBlocked('BINDING_HELD', 'Dependent binding writes require qualified ownership and native semantics; retain this proposal as held.')
    # Validate the entire proposal set without publishing or authorizing anything.
    request['acceptances'] = [{'proposalId': p['id'], 'proposalSha256': proposal_digest(request, p),
                               'decision': 'accepted', 'reviewer': request['reviewer']} for p in request['proposals']]
    request = _request(request)
    with zipfile.ZipFile(source) as archive:
        raw = archive.read(expected['jobMember'])
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
            'adapter': 'browser-qualification-1', 'writer': 'qualification-byte-patch-2',
            'codeSha256': {name: sha256((root / 'workers' / 'scan' / name).read_bytes()).hexdigest()
                           for name in ('repair_review.py', 'qualification_candidate.py', 'archive_browser_cli.py')}}


def run(source, review, control):
    try:
        checked = review_request(source, review, control['request'])
        if control['action'] == 'repair-review':
            return {'status': 'success', 'artifactType': 'scan.repair-review', 'request': checked,
                    'machineExportAllowed': False, 'evidenceAuthority': 'operator-declared; not independently qualified by writer'}
        if control.get('acknowledgement') != 'QUALIFICATION ONLY':
            raise CaptureBlocked('ACKNOWLEDGEMENT_REQUIRED', 'Acknowledge qualification-only export and unresolved binding/inspection behavior.')
        request = control['request']
        result = create_qualification_candidate(source, Path(source).parent / 'result.scan-qualification.zip', request)
        if result['status'] != 'success':
            return result
        preflight = review['preflight']
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
                         'repair-request.json': request}
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
                'candidateSha256': result['candidate']['sha256'], 'sourceSha256': preflight['source']['sha256']}
    except CaptureBlocked as error:
        return {'status': 'blocked', 'code': error.code, 'reason': str(error), 'machineExportAllowed': False}
    except (KeyError, TypeError, ValueError):
        return {'status': 'blocked', 'code': 'INVALID_REPAIR_REQUEST', 'reason': 'Invalid bounded repair request; no candidate published.', 'machineExportAllowed': False}
