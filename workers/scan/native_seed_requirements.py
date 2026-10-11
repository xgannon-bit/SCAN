"""Exact job-local constructor seed checks and UI-ready starter limitations.

No default native records are shipped. Existing seed fields are a bounded
format example, never evidence that their geometry or inspection is correct.
"""
from hashlib import sha256
from xml.etree import ElementTree as ET

from .disabled_draft import _record, _text, _one, _rectangle
from .native_record_insertion import collection_layout
from .qualification_candidate import _xml, _fail
from .snapshot_capture import CaptureBlocked


def constructor_seed(j, m, module, profile):
    """Validate the exact linked placement/Master/Mount/Solder seed contract."""
    from .native_preparation import PART, MODEL, WINDOW, _contract, _neutral
    part = _record(j, 'PartDataList/PartData', 'ID', profile['seedPartId'])
    model = _record(m, 'PartDataList/PartData', 'MasterKey', profile['seedMasterKey'])
    _record(j, 'ModuleDataList/ModuleData', 'ID', module)
    if _text(part, 'MasterKey') != profile['seedMasterKey'] or _text(part, 'ParentId') != module:
        _fail('PACKAGE_SEED_IDENTITY', 'Selected native schema seed identities do not link in this module.')
    _contract(part, PART); _contract(model, MODEL); _neutral(part, model)
    windows = [w for w in m.findall('WindowDataList/WindowData') if _text(w, 'ParentId') == profile['seedMasterKey']]
    seeds = []
    for key in ('bodyWindowId', 'terminalWindowId'):
        candidates = [w for w in windows if _text(w, 'ID') == profile[key]]
        if len(candidates) != 1:
            _fail('PACKAGE_WINDOW_SEED', 'Selected native window format seed must be unique in its Master.')
        w = candidates[0]; _contract(w, WINDOW); _rectangle(w, 'RelRoi')
        if _text(w, 'ParentWndId') != '0' or _text(w, 'UseWndPoly') not in {'0', 'False'} or _text(w, 'ALIGNWND') != 'False' or _text(w, 'Shape') != '1':
            _fail('PACKAGE_WINDOW_SEED', 'Independent rectangular, nonpolygon window formats are required.')
        if (_one(w, 'WndDataInfo').text or '') not in {'', '0'} or _text(w, 'PropertyType') != ('Mount' if key == 'bodyWindowId' else 'Solder'):
            _fail('PACKAGE_WINDOW_SEED', 'The body Mount and terminal Solder format seeds must have no opaque learned window data.')
        seeds.append(w)
    return part, model, seeds


def seed_requirements(job, master, profiles=()):
    """Read-only diagnostic; never changes recipes, decisions or source bytes."""
    report = {'artifactType': 'scan.native-seed-requirements', 'schemaVersion': '1',
              'source': {'jobSha256': sha256(job).hexdigest(), 'masterSha256': sha256(master).hexdigest()},
              'status': 'held', 'containers': [], 'requiredContents': [], 'profileSeeds': [],
              'qualificationOnly': True, 'genuineStarterQualification': 'not-performed',
              'emptyContainerInsertion': 'supported-serialization-only',
              'noUniversalSeed': True,
              'remaining': ['Source-owned geometry and package evidence must independently justify each new model.',
                            'New records stay disabled with no transferred algorithms, native bindings or FOV assignment.',
                            'A genuine scan/fiducials/color-only Eagle starter and Eagle open/save/reopen remain unqualified.']}
    roots = {}
    for role, raw, paths in [('job', job, ('JobContainer/PartDataList',)),
                             ('master', master, ('JobContainer/PartDataList', 'JobContainer/WindowDataList'))]:
        try:
            _xml(raw)
            roots[role] = ET.fromstring(raw)
            for path, c in collection_layout(raw, paths).items():
                report['containers'].append({'document': role, 'path': path, 'status': 'supported',
                    'serialization': 'self-closing' if c.self_closing else 'explicit', 'recordCount': c.record_count,
                    'code': None, 'reason': 'Only this collection delimiter and reviewed new records may change.'})
        except CaptureBlocked as error:
            report['containers'].append({'document': role, 'path': None, 'status': 'held', 'recordCount': None,
                'serialization': None, 'code': error.code, 'reason': str(error)})
    if set(roots) != {'job', 'master'}:
        return report
    j, m = roots['job'], roots['master']
    for rid, root, path, label, action in [
        ('module', j, 'ModuleDataList/ModuleData', 'Native module identity', 'Supply an explicitly selected main job with its native module record.'),
        ('native-cad', j, 'CadData/CpList/Cp', 'Native CAD records', 'Matching native CAD identities and positions are required; SCAN does not invent them.'),
        ('placement-seed', j, 'PartDataList/PartData', 'Job-local placement format seed', 'At least one compatible job-local PartData placement is required by the current writer.'),
        ('master-seed', m, 'PartDataList/PartData', 'Job-local Master format seed', 'A uniquely linked compatible local Master is required; an unrelated library is not a default.'),
        ('window-seeds', m, 'WindowDataList/WindowData', 'Job-local window format seeds', 'Constructors require independent Mount and Solder rectangle seeds without opaque learned window data; template reuse needs its closed supported window set.')]:
        count = len(root.findall(path))
        report['requiredContents'].append({'id': rid, 'label': label, 'state': 'present-unqualified' if count else 'missing',
            'count': count, 'code': None if count else 'PREPARATION_SEED_REQUIRED', 'nextAction': action})
    for profile in profiles:
        result = {'profileId': profile['id'], 'seedPartId': profile['seedPartId'], 'seedMasterKey': profile['seedMasterKey'],
                  'bodyWindowId': profile['bodyWindowId'], 'terminalWindowId': profile['terminalWindowId']}
        try:
            part = _record(j, 'PartDataList/PartData', 'ID', profile['seedPartId'])
            module = _text(part, 'ParentId')
            constructor_seed(j, m, module, profile)
            result.update(status='supported-structure-only', module=module, code=None,
                          reason='Exact local placement, Master and body/terminal seed formats pass; target geometry and Eagle behavior need separate checks.')
        except CaptureBlocked as error:
            result.update(status='held', module=None, code=error.code, reason=str(error))
        report['profileSeeds'].append(result)
    if all(c['status'] == 'supported' for c in report['containers']) and all(r['count'] for r in report['requiredContents']):
        report['status'] = 'selected-seed-held' if any(p['status'] == 'held' for p in report['profileSeeds']) else 'records-present-requires-per-model-review'
    return report
