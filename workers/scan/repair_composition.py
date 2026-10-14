"""Compose two independently reviewed, original-bound offline operations.

Preparation appends disabled local records first. The original-bound scalar
request then patches only its accepted leaves. Neither operation inherits the
other's approval; source hashes, recipes, identities and before values are all
checked again. This is a qualification copy, not a semantic repair claim.
"""
from copy import copy
from hashlib import sha256
import json
from pathlib import Path
import zipfile

from .qualification_candidate import _patch_xml, _request, _xml, reverse_proposals
from .snapshot_capture import CaptureBlocked


def _copy_file(incoming, outgoing):
    while chunk := incoming.read(1024 * 1024):
        outgoing.write(chunk)


def scalar_trial_accounting(accounting, final_job, approved):
    """Overlay only applied, uniquely verified scalar identities on final rows.

    Existing record retention and teaching preservation are distinct from an
    unchanged placement. This describes the receipt; it grants no qualification.
    """
    from copy import deepcopy
    rows = deepcopy(accounting)
    leaves, _, _ = _xml(final_job)
    for proposal in approved:
        path = proposal['path']; part_path, field = path.split(']/', 1)
        part_path += ']'
        identity = proposal['identity']
        for key, expected in identity.items():
            found = leaves.get(part_path + '/' + key, [])
            if len(found) != 1 or not found[0]['plain'] or found[0]['literal'] != expected:
                raise CaptureBlocked('SCALAR_ACCOUNTING_IDENTITY', 'The applied scalar identity does not match its actual candidate placement.')
        value = leaves.get(path, [])
        if len(value) != 1 or not value[0]['plain'] or value[0]['literal'] != proposal['after']:
            raise CaptureBlocked('SCALAR_ACCOUNTING_VALUE', 'Applied scalar accounting requires the exact actual candidate after value.')
        matches = [r for r in rows if r['reference'] == identity['RefID'] and r['module'] == identity['ParentId']
                   and identity['ID'] in r['placementIds'] and identity['MasterKey'] in r.get('masterKeys', [])]
        if len(matches) != 1:
            raise CaptureBlocked('SCALAR_ACCOUNTING_SCOPE', 'The applied scalar must resolve to exactly one intended component scope.')
        row = matches[0]
        row.setdefault('stateBeforeScalarTrial', row['status'])
        if row['status'] == 'existing-structure-preserved':
            row['status'] = 'existing-scalar-trial-applied'
        row.setdefault('appliedScalarTrials', []).append({
            'proposalId': proposal['id'], 'path': path, 'field': field, 'identity': deepcopy(identity),
            'before': proposal['before'], 'after': proposal['after'], 'qualificationOnly': True,
            'inspectionRepairEstablished': False})
        checks = row.setdefault('scalarTrialChecks', [])
        checks.append(f"Verify placement ID {identity['ID']}, module {identity['ParentId']}, Master {identity['MasterKey']}: qualification-only {field} changed from {proposal['before']} to {proposal['after']}; confirm the exact selected main snapshot.")
        if field == 'ENABLE':
            checks.append('Verify only the selected placement is disabled; check the retained placement, useful teaching and intended inspection coverage before accepting the suppression trial.')
        else:
            checks.append('Check the intended body/origin geometry independently. Verify all dependent Master windows and owned pad bindings; the scalar change does not establish an inspection repair or complete binding.')
            checks.append('Check placement ROI, stored center and native CAD separately against the exact change log; fields absent from that log were preserved. Do not move CAD to conceal a misplaced window.')
        for check in ('Preserve existing teaching. Verify dependent window behavior and shared Master scope after any binding or teaching action.',
                      'Record original-control and candidate open/save/reopen evidence; verify exact scalar/position retention after binding and teaching. Eagle behavior remains unverified.'):
            if check not in checks: checks.append(check)
        row['remaining'] = list(dict.fromkeys([*row.get('remaining', []), 'applied-scalar-trial-qualification-required',
            'binding-and-dependent-window-review-required', 'scalar-and-position-retention-after-teaching-unverified']))
        row['nextAction'] = 'Qualify the recorded scalar trial and its dependent geometry/bindings at Eagle; preserve existing teaching. See scalarTrialChecks for the exact changed placement and remaining steps.'
    return rows


def compose_preparation(source, layout_path, review, control, *, diagnosis_report=None, diagnosis_receipt=None):
    # Lazy import avoids the preparation adapter's shared report-helper import.
    from .native_preparation_review import run as prepare
    from .worker_cli import dispatch
    from .repair_review import _remaining_rows, _csv, _software_identity
    from .native_preparation import component_accounting
    from .native_pad_binding import diagnose_pad_bindings
    from .preparation_intents import preparation_intents

    request = _request(control['request'])
    decisions = {item['proposalId']: item['decision'] for item in request['acceptances']}
    approved = [item for item in request['proposals'] if decisions.get(item['id']) == 'accepted']
    preparation = control['preparation']
    if not isinstance(preparation, dict) or 'action' in preparation or 'acknowledgement' in preparation:
        raise CaptureBlocked('COMPOSITION_REQUEST', 'Supply the exact separately reviewed preparation selection.')
    result = prepare(source, layout_path, review, {**preparation, 'action': 'draft-export', 'acknowledgement': 'QUALIFICATION ONLY'})
    if result['status'] != 'success':
        return result
    root = Path(source).parent
    prepared_bundle = root / 'prepared.engineering.zip'
    (root / 'result.engineering.zip').rename(prepared_bundle)
    prepared = root / 'prepared-candidate.zip'
    candidate = root / 'composed-candidate.zip'
    member = request['source']['jobMember']
    files = []
    with zipfile.ZipFile(prepared) as before, zipfile.ZipFile(candidate, 'x') as after:
        after.comment = before.comment
        for info in before.infolist():
            if info.filename == member:
                raw = before.read(info)
                changed = _patch_xml(raw, approved, progress=True)
                reverse = reverse_proposals(approved)
                if _patch_xml(changed, reverse) != raw:
                    raise CaptureBlocked('COMPOSITION_ROLLBACK', 'Scalar rollback did not recover the exact prepared document.')
                after.writestr(copy(info), changed)
                files.append({'path': info.filename, 'beforeSha256': sha256(raw).hexdigest(), 'afterSha256': sha256(changed).hexdigest(), 'changed': True})
            else:
                digest = sha256()
                with before.open(info) as incoming, after.open(copy(info), 'w') as outgoing:
                    while chunk := incoming.read(1024 * 1024):
                        digest.update(chunk); outgoing.write(chunk)
                files.append({'path': info.filename, 'beforeSha256': digest.hexdigest(), 'afterSha256': digest.hexdigest(), 'changed': False})
    # Reopen every payload and check content + transport metadata independently
    # of ZIP writing. All preparations are in the rollback baseline.
    metadata = ('filename', 'date_time', 'compress_type', 'comment', 'extra', 'create_system', 'create_version', 'extract_version', 'external_attr', 'internal_attr')
    with zipfile.ZipFile(prepared) as before, zipfile.ZipFile(candidate) as after:
        if before.namelist() != after.namelist() or before.comment != after.comment:
            raise CaptureBlocked('COMPOSITION_PRESERVATION', 'Archive order or comment changed.')
        for old, new, expected in zip(before.infolist(), after.infolist(), files):
            if any(getattr(old, key) != getattr(new, key) for key in metadata):
                raise CaptureBlocked('COMPOSITION_PRESERVATION', 'Unapproved archive metadata changed.')
            digest = sha256()
            with after.open(new) as incoming:
                while chunk := incoming.read(1024 * 1024): digest.update(chunk)
            if digest.hexdigest() != expected['afterSha256']:
                raise CaptureBlocked('COMPOSITION_PRESERVATION', 'Candidate payload differs from its exact expected bytes.')
    candidate_hash = sha256(candidate.read_bytes()).hexdigest()
    selection = review['preflight']['selection']
    snapshot = root / 'composed.scan-snapshot'
    capture = dispatch({'protocolVersion': '1', 'action': 'capture', 'source': str(candidate), 'destination': str(snapshot),
                        'expectedArchiveSha256': candidate_hash, 'selection': {
                            'root': selection['root'], 'jobMember': selection['job']['member'], 'jobRole': 'main',
                            'masterMember': selection['master']['member'], 'masterRole': 'main'}})
    if capture['status'] != 'success': return capture
    fresh = dispatch({'protocolVersion': '1', 'action': 'inspect-snapshot', 'source': str(snapshot), 'expectedPackageSha256': capture['package_sha256']})
    if fresh['status'] != 'success': return fresh
    with zipfile.ZipFile(candidate) as archive:
        final_job = archive.read(selection['job']['member'])
        final_master = archive.read(selection['master']['member'])
    pcb = Path(layout_path).read_bytes()
    receipt = {'artifactType': 'scan.composed-qualification-receipt', 'schemaVersion': '1',
               'source': request['source'], 'preparationReviewDigest': preparation['reviewDigest'],
               'acceptedPreparationDigests': preparation['accepted'], 'preparedCandidateSha256': result['candidateSha256'],
               'candidateSha256': candidate_hash, 'scalarRequest': request, 'appliedScalarChanges': approved,
               'unappliedScalarProposals': [item for item in request['proposals'] if decisions.get(item['id']) != 'accepted'],
               'filesComparedToPreparedCopy': files, 'scalarRollbackRecoversPreparedXml': True,
               'qualificationOnly': True, 'machineExportAllowed': False, 'inspectionRepairEstablished': False,
               'binding': 'unresolved', 'dependentWindows': 'unresolved', 'eagleOpenSaveReopen': 'not-performed',
               'approvalScope': 'Two separate original-bound reviewed sets; development acceptance is not operator approval.',
               'snapshotWarning': 'Temp/backup snapshots retain original state. Never substitute them for selected main.'}
    output = root / 'result.engineering.zip'
    with zipfile.ZipFile(prepared_bundle) as prior, zipfile.ZipFile(output, 'x', compression=zipfile.ZIP_DEFLATED) as bundle:
        replaced = {'CANDIDATE.zip', 'manifest.json', 'applied_changes.json', 'decisions.json', 'qualification.json', 'disabled-draft-receipt.json', 'README.txt',
                    'component_accounting.json', 'component_coverage.csv', 'pad-binding-work.json', 'offline-binding-fov-intents.json',
                    'native-inspection-work.json', 'candidate-native-accounting.json', 'remaining_work.csv', 'START_HERE.txt'}
        for name in prior.namelist():
            if name in replaced:
                if name != 'CANDIDATE.zip': bundle.writestr('preparation-baseline/' + name, prior.read(name))
                continue
            with prior.open(name) as incoming, bundle.open(name, 'w') as outgoing: _copy_file(incoming, outgoing)
        bundle.write(candidate, 'CANDIDATE.zip')
        prior_manifest = json.loads(prior.read('manifest.json'))
        manifest = {'artifactType': 'scan.composed-native-candidate', 'schemaVersion': '1',
                    'archiveSha256': request['source']['archiveSha256'], 'candidateSha256': candidate_hash,
                    'qualificationOnly': True, 'machineExportAllowed': False, 'composition': receipt, 'software': _software_identity()}
        manifest['software']['codeSha256']['repair_composition.py'] = sha256(Path(__file__).read_bytes()).hexdigest()
        manifest['software']['codeSha256'] = {**prior_manifest['software']['codeSha256'], **manifest['software']['codeSha256']}
        plan = json.loads(prior.read('proposals.json'))
        applied = [item for item in plan['items'] if item.get('digest') in preparation['accepted']]
        accounting = scalar_trial_accounting(component_accounting(final_job, plan, preparation['accepted']), final_job, approved)
        docs = {'manifest.json': manifest, 'composed-qualification-receipt.json': receipt,
                'applied_changes.json': {'preparations': json.loads(prior.read('applied_changes.json')), 'scalars': approved},
                'decisions.json': {'preparation': json.loads(prior.read('decisions.json')), 'scalar': request['acceptances']},
                'repair-request.json': request, 'qualification.json': {**json.loads(prior.read('qualification.json')),
                    'scalarRollbackRecoversPreparedXml': True, 'inspectionRepairEstablished': False},
                'component_accounting.json': accounting,
                'pad-binding-work.json': diagnose_pad_bindings(final_job, final_master, pcb),
                'offline-binding-fov-intents.json': preparation_intents(final_job, final_master, pcb, applied, applied=True),
                'native-inspection-work.json': fresh.get('nativeInspectionWork'), 'candidate-native-accounting.json': fresh.get('nativeAccounting'),
                'candidate-duplicate-review.json': fresh.get('nativeDuplicateReview')}
        if diagnosis_report is not None:
            from .native_placement_diagnosis import verify_request
            verified = verify_request(request, diagnosis_report)
            if verified != diagnosis_receipt:
                raise CaptureBlocked('DIAGNOSIS_COMPOSITION', 'Composed output diagnosis proof differs from the original source-derived review.')
            docs['independent-placement-diagnosis.json'] = diagnosis_report
            docs['independent-diagnosis-receipt.json'] = {**verified, 'acceptedScalars': len(approved),
                'acceptedPlacementGroups': len({p['path'].rsplit('/Roi/', 1)[0] for p in approved}),
                'preparationReviewDigest': preparation['reviewDigest'], 'acceptedPreparationDigests': preparation['accepted']}
            receipt['independentDiagnosis'] = docs['independent-diagnosis-receipt.json']
        for name, value in docs.items(): bundle.writestr(name, json.dumps(value, ensure_ascii=True, indent=2))
        bundle.writestr('component_coverage.csv', _csv(accounting))
        bundle.writestr('remaining_work.csv', _csv([{'reference': item['reference'], 'module': item['module'], 'status': item['status'], 'remaining': item['remaining'], 'omittedWindows': item['omittedWindows'],
            'appliedScalarTrials': item.get('appliedScalarTrials', []), 'scalarTrialChecks': item.get('scalarTrialChecks', [])} for item in accounting] + _remaining_rows(fresh)))
        bundle.writestr('START_HERE.txt', 'QUALIFICATION ONLY — COMPOSED PREPARATION AND SCALAR TRIAL\n'
            'CANDIDATE.zip contains the separately accepted disabled preparations AND the separately accepted scalar changes.\n'
            'Read composed-qualification-receipt.json for both exact original-bound reviewed sets and byte preservation.\n'
            'Only selected main scalar leaves change after preparation. Masters, windows, teaching, shared libraries and all unrelated payloads retain the prepared baseline.\n'
            'Temp/backup snapshots retain ORIGINAL state; never silently substitute them.\n'
            'A scalar geometry experiment does not repair binding or dependent inspections. Binding, teaching, FOV and Eagle open/save/reopen remain unresolved.\n'
            'Extract to a separate candidate directory; preserve the original and earlier candidates. Rollback by using the untouched original.\n'
            'Development-test acceptance is not operator approval or machine validation. No release is granted.\n')
    return {'status': 'success', 'artifactType': 'scan.engineering-download', 'qualificationOnly': True, 'machineExportAllowed': False,
            'sha256': sha256(output.read_bytes()).hexdigest(), 'size': output.stat().st_size,
            'candidateSha256': candidate_hash, 'sourceSha256': request['source']['archiveSha256']}
