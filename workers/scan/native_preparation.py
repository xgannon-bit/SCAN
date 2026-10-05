"""Source-derived job-local model copying, for disabled offline qualification.

This is a version-bounded structural adapter, not an optical teaching adapter.
It joins source footprint ownership to an existing unique native CAD placement;
it never uses private expected outputs, nearest pads or global registration.
Existing records remain byte-identical. Only complete reviewed new records are
inserted. Binding/FOV lists and algorithms are deliberately empty in NEW records.
"""
from collections import Counter
from copy import deepcopy
from hashlib import sha256
import json
import re
from xml.etree import ElementTree as ET

from .accel_ascii import read_accel
from .disabled_draft import _one, _text, _number, _record, _rectangle, _set, _decimal, _closing_offsets, recipe_digest
from .qualification_candidate import _xml, _canonical, _fail
from .snapshot_capture import CaptureBlocked

PROFILE = 'job-local-same-footprint-disabled-1'
# Observed field names describe the schema contract, never a private job oracle.
COMMON = set('BkBDLv CntSeparatedX CntSeparatedY ColorRangeMax ColorRangeMin ColorXYID CommonCategory DetailInsp FCtgr FiducialID FovList IsFidu LinkagePart MTLOPT MTrendline MasterKey Name No OCRFontAngle OCRRate OCRWindowCheck PackageName PartCode PatternFiduID PropType RefID RefPartNo RefPartNo2 Roi SWIR SeparatedPart TalHei Toler3DV TypeShape U3G UseColorRange UseFontAngle UsePatternFidu VerPart3DOPT ZMapROIData eUserLevel'.split())
PART = COMMON | set('CenterPosX CenterPosY ENABLE FovOPT Gap Gen2D Gen3D Grp3D ID OCRWindowCheck ParentId ProtectApply SubFovNum UseSlave WND_PAD Zero ptSetPolarPos'.split())
MODEL = COMMON | set('CadOffset DRun MatchedPartDate ModelNo UpdateDate'.split())
WINDOW = set('ALIGNWND AlgorithmDataList AlignWndID Dir ENABLE GroupID ID InspCameraType InspWndBodPos LeadType Name ParentId ParentWndId PropertyType RelRoi Shape UseWndPoly W_F_O WndDataInfo WndInspLayer WndInspType btTP eUserLevel'.split())
REMAINING = ['pad-binding-unresolved', 'dependent-window-geometry-unverified', 'template-settings-unverified-for-target',
             'polarity-position-frame-unqualified',
             'image-algorithms-not-prepared', 'FOV-assignment-required', 'population-decision-required',
             'Eagle-open-save-reopen-unverified', 'physical-inspection-unverified']


def _contract(node, allowed):
    tags = [child.tag for child in node]
    if node.attrib or any(n != 1 for n in Counter(tags).values()) or any(
            tag not in allowed and not (allowed is PART and re.fullmatch(r'ListGer(?:b)?PadId(?:_Common)?[0-9]{1,2}', tag)) for tag in tags):
        _fail('PREPARATION_SCHEMA', 'Template fields exceed the supported job-local profile or are repeated.')
    containers = {'Roi': {'cx', 'cy', 'w', 'h', 'a'}, 'RelRoi': {'cx', 'cy', 'w', 'h', 'a'},
                  'CadOffset': {'X', 'Y'}, 'ptSetPolarPos': {'X', 'Y'}, 'FovList': {'Fov0'}}
    for child in node:
        if child.tag == 'AlgorithmDataList':
            # Existing algorithms are preserved in the original model. They are
            # NOT transferred to a different component, so no asset links leak.
            continue
        if child.attrib or (len(child) and (child.tag not in containers or
                set(x.tag for x in child) - containers[child.tag] or
                any(x.attrib or len(x) for x in child) or
                any(n != 1 for n in Counter(x.tag for x in child).values()))):
            _fail('PREPARATION_DEPENDENCY', 'An unknown nested dependency cannot be copied into a new component.')


def _neutral(part, model):
    for node in (part, model):
        for key, allowed in {'RefPartNo': {'-1'}, 'RefPartNo2': {'-1'}, 'PatternFiduID': {'-1'},
                             'FiducialID': {''}, 'LinkagePart': {'False'}, 'SeparatedPart': {'False'},
                             'IsFidu': {'False'}, 'UsePatternFidu': {'False'}, 'ZMapROIData': {'0'}}.items():
            scalar = _one(node, key)
            if len(scalar) or scalar.attrib or (scalar.text or '') not in allowed:
                _fail('PREPARATION_SPECIAL_LINK', 'A fiducial, separated, linked or Z-map template requires a different adapter.')
    if _text(part, 'SubFovNum') != '-1' or _text(part, 'FovOPT') != '0':
        _fail('PREPARATION_FOV', 'A special FOV template cannot be transferred by this profile.')
    if len(_one(model, 'FovList')):
        _fail('PREPARATION_FOV', 'A model with FOV dependencies requires a different adapter.')
    for axis in ('X', 'Y'):
        _number(part, 'ptSetPolarPos/' + axis)


def _cad(root, ref, module):
    rows = [x for x in root.findall('CadData/CpList/Cp') if _text(x, 'RefID') == ref and _text(x, 'ModuleID') == module]
    if len(rows) != 1:
        _fail('PREPARATION_CAD', 'Exactly one native CAD record is required in the chosen module.')
    return rows[0]


def _footprint(placed):
    # Pattern identity AND freshly parsed owned local pad outlines. Board points,
    # reference strings and anchors are intentionally outside this signature.
    return {'pattern': placed['patternRef'], 'graphics': placed['patternGraphicsNameRef'],
            'pads': [{k: v for k, v in pad.items() if k not in ('sourcePath', 'sourceBoardPoint')}
                     for layer in placed['explicitLayerGeometry'] for pad in layer['pads']],
            'layers': [(layer['layerNumber'], len(layer['pads'])) for layer in placed['explicitLayerGeometry']]}


def _plan(j, m, layout, choice, allocate):
    if set(choice) != {'targetSourcePath', 'moduleId', 'templatePartId', 'templateMasterKey'} or any(
            not isinstance(v, str) or not v or len(v) > 2048 for v in choice.values()):
        _fail('PREPARATION_SELECTION', 'Explicit bounded source, module, placement and Master identities are required.')
    candidates = [p for p in layout['placements'] if p['sourcePath'] == choice['targetSourcePath']]
    if len(candidates) != 1:
        _fail('PREPARATION_SOURCE', 'The target source placement is not unique.')
    target = candidates[0]
    module = choice['moduleId']
    _record(j, 'ModuleDataList/ModuleData', 'ID', module)
    parts = j.findall('PartDataList/PartData')
    if any(_text(p, 'RefID') == target['refdes'] and _text(p, 'ParentId') == module for p in parts):
        _fail('PREPARATION_ALREADY_PRESENT', 'A native placement already exists for this module/reference.')
    part = _record(j, 'PartDataList/PartData', 'ID', choice['templatePartId'])
    model = _record(m, 'PartDataList/PartData', 'MasterKey', choice['templateMasterKey'])
    if _text(part, 'MasterKey') != choice['templateMasterKey'] or _text(part, 'ParentId') != module:
        _fail('PREPARATION_IDENTITY', 'Selected placement, Master and module do not form one exact scope.')
    ref = _text(part, 'RefID')
    if len([p for p in parts if _text(p, 'RefID') == ref and _text(p, 'ParentId') == module]) != 1:
        _fail('PREPARATION_TEMPLATE_DUPLICATE', 'A duplicated native reference cannot establish this template origin.')
    origins = [p for p in layout['placements'] if p['refdes'] == ref]
    if len(origins) != 1:
        _fail('PREPARATION_TEMPLATE_SOURCE', 'The existing placement needs one source-owned footprint.')
    origin = origins[0]
    for p in (target, origin):
        if p['identityHolds'] or not p['ownedPadCentersAvailable'] or p['mountingEvidence'] != 'explicit-zero-holes' or not p['explicitLayerGeometry']:
            _fail('PREPARATION_SOURCE', 'Unique unflipped, zero-hole source-owned explicit outlines are required.')
    if _footprint(target) != _footprint(origin) or target['rotation'] != origin['rotation'] or target['side'] != origin['side']:
        _fail('PREPARATION_FOOTPRINT', 'Footprint ownership, source orientation and side must match exactly; names alone are insufficient.')
    tc, oc = _cad(j, target['refdes'], module), _cad(j, ref, module)
    if (_number(tc, 'Ang') - _number(oc, 'Ang')) % 360 != 0:
        _fail('PREPARATION_ANGLE', 'This adapter supports translation in the existing native CAD frame, without rotation inference.')
    _contract(part, PART); _contract(model, MODEL); _neutral(part, model)
    for node in (part, model):
        if _text(node, 'Name') != _text(oc, 'PrntPartName') or _text(node, 'PartCode') != _text(oc, 'PrntPartName'):
            _fail('PREPARATION_IDENTITY', 'Template identity differs from its native CAD correspondence.')
    roi = _rectangle(part, 'Roi'); _rectangle(model, 'Roi')
    _number(part, 'CenterPosX'); _number(part, 'CenterPosY')
    for axis in ('X', 'Y'):
        _number(model, 'CadOffset/' + axis)
    windows = [w for w in m.findall('WindowDataList/WindowData') if _text(w, 'ParentId') == choice['templateMasterKey']]
    if not windows or len(windows) > 256:
        _fail('PREPARATION_WINDOWS', 'A bounded complete template window set is required.')
    ids = [_text(w, 'ID') for w in windows]
    if len(set(ids)) != len(ids) or any(not re.fullmatch(r'[1-9][0-9]{0,8}', wid) for wid in ids):
        _fail('PREPARATION_WINDOW_ID', 'Template window IDs are not unique within the selected Master scope.')
    for w in windows:
        _contract(w, WINDOW); _rectangle(w, 'RelRoi')
        if _text(w, 'ParentWndId') not in {'0', *ids} or (_one(w, 'AlignWndID').text or '') not in {'', *ids}:
            _fail('PREPARATION_WINDOW_LINK', 'A template window has a dependency outside the selected local model.')
        if not re.fullmatch(r'(?:0|[1-9][0-9]{0,8})', _text(w, 'GroupID')):
            _fail('PREPARATION_WINDOW_LINK', 'A noncanonical window group identity cannot be transferred.')
        if _text(w, 'UseWndPoly') not in {'False', '0'}:
            _fail('PREPARATION_POLYGON', 'Polygon window geometry is outside this rectangle profile.')
    pid, key, number = allocate(), allocate(), allocate()
    wid_map = {wid: allocate() for wid in ids}
    gid_map = {gid: allocate() for gid in sorted({_text(w, 'GroupID') for w in windows}) if gid != '0'}
    newpart, newmodel = deepcopy(part), deepcopy(model)
    dx, dy = _number(tc, 'X') - _number(oc, 'X'), _number(tc, 'Y') - _number(oc, 'Y')
    if any(abs(value) > 1e6 for value in (roi['cx'] + dx, roi['cy'] + dy,
            _number(part, 'CenterPosX') + dx, _number(part, 'CenterPosY') + dy)):
        _fail('PREPARATION_GEOMETRY', 'The translated native placement exceeds the bounded coordinate range.')
    name = _text(tc, 'PrntPartName')
    for node in (newpart, newmodel):
        for path, value in {'MasterKey': key, 'RefID': target['refdes'], 'Name': name, 'PartCode': name, 'No': number}.items():
            _set(node, path, value)
    for path, value in {'ID': pid, 'ENABLE': 'False', 'Roi/cx': _decimal(roi['cx'] + dx), 'Roi/cy': _decimal(roi['cy'] + dy),
                        'CenterPosX': _decimal(_number(part, 'CenterPosX') + dx), 'CenterPosY': _decimal(_number(part, 'CenterPosY') + dy)}.items():
        _set(newpart, path, value)
    for child in newpart:
        if child.tag in {'WND_PAD', 'FovList'} or child.tag.startswith(('ListGerPadId', 'ListGerbPadId')):
            child.clear()
    newwindows = []
    omitted_algorithms = 0
    for w in windows:
        new = deepcopy(w)
        for path, value in {'ID': wid_map[_text(w, 'ID')], 'ParentId': key, 'ENABLE': 'False',
                            'ParentWndId': wid_map.get(_text(w, 'ParentWndId'), '0'),
                            'GroupID': gid_map.get(_text(w, 'GroupID'), '0'),
                            'AlignWndID': wid_map.get(_one(w, 'AlignWndID').text or '', '')}.items():
            _set(new, path, value)
        algorithms = _one(new, 'AlgorithmDataList')
        omitted_algorithms += len(algorithms)
        algorithms.clear()
        newwindows.append(new)
    changes = []
    for role, container, node in [('job', 'PartDataList', newpart), ('master', 'PartDataList', newmodel),
                                  *[('master', 'WindowDataList', w) for w in newwindows]]:
        node.tail = None
        changes.append({'document': role, 'container': 'JobContainer/' + container, 'operation': 'append-record',
                        'before': None, 'afterXml': ET.tostring(node, encoding='unicode')})
    return {'selection': choice, 'reference': target['refdes'], 'templateReference': ref, 'enabled': False,
            'changes': changes, 'dependencies': {'partId': pid, 'masterKey': key, 'number': number,
             'moduleId': module, 'windowIds': list(wid_map.values()), 'groupIds': list(gid_map.values()),
             'newAlgorithms': 0, 'templateAlgorithmsNotTransferred': omitted_algorithms, 'sharedLibrariesChanged': False},
            'basis': {'footprint': _footprint(target), 'nativeCadTargetId': _text(tc, 'ID'), 'nativeCadTemplateId': _text(oc, 'ID'),
                      'translationNativeMm': [dx, dy], 'originOffsetPreserved': True,
                      'polarPositionPolicy': 'copied-template-unqualified-not-translated', 'modelNoPolicy': 'preserved-template-setting-unqualified'},
            'prepared': 'disabled-placement-model-and-local-window-structure', 'remaining': REMAINING,
            'qualificationOnly': True, 'machineExportAllowed': False}


def plan_preparation(job, master, pcb, choices):
    if not isinstance(choices, list) or len(choices) > 1000:
        _fail('PREPARATION_SELECTION', 'At most 1000 explicit missing-part/template scopes are supported.')
    for raw, paths in ((job, ('JobContainer/PartDataList',)), (master, ('JobContainer/PartDataList', 'JobContainer/WindowDataList'))):
        _xml(raw); _closing_offsets(raw, paths)
    j, m, layout = ET.fromstring(job), ET.fromstring(master), read_accel(pcb)
    used = set()
    for root in (j, m):
        for node in root.iter():
            if node.tag in {'ID', 'No', 'MasterKey', 'ParentId', 'ParentWndId', 'AlignWndID', 'GroupID'} and node.text and re.fullmatch('[0-9]{1,9}', node.text):
                used.add(int(node.text))
    cursor = max(used | {0})
    def allocate():
        nonlocal cursor
        cursor += 1
        if cursor > 999_999_999:
            _fail('PREPARATION_ID_LIMIT', 'Unique deterministic allocation exceeds its bounded range.')
        return str(cursor)
    seen, items = set(), []
    for choice in choices:
        scope = (choice.get('targetSourcePath'), choice.get('moduleId')) if isinstance(choice, dict) else None
        if scope is None or scope in seen:
            _fail('PREPARATION_SELECTION', 'Missing-part scopes must be unique.')
        seen.add(scope)
        # Allocate only after every compatibility check, so held items consume no IDs.
        try:
            item = _plan(j, m, layout, choice, allocate)
            item['digest'] = recipe_digest(item)
            items.append({'status': 'ready-for-review', **item})
        except CaptureBlocked as error:
            refs = [p['refdes'] for p in layout['placements'] if p['sourcePath'] == choice['targetSourcePath']]
            items.append({'status': 'held', 'selection': choice, 'reference': refs[0] if len(refs) == 1 else None,
                          'code': error.code, 'reason': str(error)})
    return json.loads(_canonical({'artifactType': 'scan.native-preparation-plan', 'schemaVersion': '1', 'profile': PROFILE,
        'source': {'jobSha256': sha256(job).hexdigest(), 'masterSha256': sha256(master).hexdigest(), 'layoutSha256': sha256(pcb).hexdigest()},
        'choices': choices, 'items': items, 'remaining': REMAINING, 'qualificationOnly': True, 'machineExportAllowed': False}))


def apply_preparation(job, master, pcb, recipe, accepted_digest):
    fresh = plan_preparation(job, master, pcb, recipe['choices'])
    accepted = recipe.get('accepted', [])
    if not isinstance(accepted, list) or not accepted or len(set(accepted)) != len(accepted):
        _fail('PREPARATION_APPROVAL', 'Review and accept at least one unique exact component proposal.')
    if {**fresh, 'accepted': accepted} != recipe or recipe_digest(recipe) != accepted_digest:
        _fail('PREPARATION_STALE', 'Exact source-derived proposals or their approved digest changed.')
    ready = {item['digest']: item for item in fresh['items'] if item['status'] == 'ready-for-review'}
    if set(accepted) - set(ready):
        _fail('PREPARATION_APPROVAL', 'A held or unknown item cannot be approved.')
    output = {}
    for role, raw in (('job', job), ('master', master)):
        offsets = _closing_offsets(raw, ('JobContainer/PartDataList',) if role == 'job' else ('JobContainer/PartDataList', 'JobContainer/WindowDataList')); inserts = {}
        for item in fresh['items']:
            if item.get('digest') not in accepted:
                continue
            for change in item['changes']:
                if change['document'] == role:
                    inserts.setdefault(offsets[change['container']], []).append(change['afterXml'].encode())
        current, spans, added = raw, [], 0
        for point in sorted(inserts):
            size = sum(map(len, inserts[point])); spans.append((point + added, point + added + size)); added += size
        for point in sorted(inserts, reverse=True):
            current = current[:point] + b''.join(inserts[point]) + current[point:]
        _xml(current)
        tree = ET.fromstring(current)
        for item in ready.values():
            if item['digest'] not in accepted:
                continue
            dep = item['dependencies']
            if role == 'job':
                newpart = _record(tree, 'PartDataList/PartData', 'ID', dep['partId'])
                if (_text(newpart, 'MasterKey'), _text(newpart, 'RefID'), _text(newpart, 'ParentId'), _text(newpart, 'ENABLE')) != (dep['masterKey'], item['reference'], dep['moduleId'], 'False'):
                    _fail('PREPARATION_CLOSURE', 'New placement scope did not survive parsing.')
            else:
                _record(tree, 'PartDataList/PartData', 'MasterKey', dep['masterKey'])
                windows = [w for w in tree.findall('WindowDataList/WindowData') if _text(w, 'ParentId') == dep['masterKey']]
                if { _text(w, 'ID') for w in windows } != set(dep['windowIds']) or any(
                        _text(w, 'ENABLE') != 'False' or len(_one(w, 'AlgorithmDataList')) or
                        _text(w, 'ParentWndId') not in {'0', *dep['windowIds']} or
                        (_one(w, 'AlignWndID').text or '') not in {'', *dep['windowIds']} for w in windows):
                    _fail('PREPARATION_CLOSURE', 'New disabled windows or their local links did not survive parsing.')
        recovered = current
        for start, end in reversed(spans):
            recovered = recovered[:start] + recovered[end:]
        if recovered != raw:
            _fail('PREPARATION_PRESERVATION', 'Original XML bytes did not survive insertion rollback exactly.')
        output[role] = current
    return output


def suggest_choices(job, pcb):
    """Join owned source patterns to unique existing native references, no oracle."""
    _xml(job)
    root, layout = ET.fromstring(job), read_accel(pcb)
    choices = []
    parts = root.findall('PartDataList/PartData')
    for target in layout['placements']:
        for cad in root.findall('CadData/CpList/Cp'):
            if _text(cad, 'RefID') != target['refdes']:
                continue
            module = _text(cad, 'ModuleID')
            if any(_text(p, 'ParentId') == module and _text(p, 'RefID') == target['refdes'] for p in parts):
                continue
            templates = []
            for part in parts:
                origins = [p for p in layout['placements'] if p['refdes'] == _text(part, 'RefID')]
                if _text(part, 'ParentId') == module and len(origins) == 1 and origins[0]['patternRef'] == target['patternRef']:
                    try:
                        oc = _cad(root, _text(part, 'RefID'), module)
                        if (_number(cad, 'Ang') - _number(oc, 'Ang')) % 360 == 0:
                            templates.append(part)
                    except CaptureBlocked:
                        pass
            # Expose every same-angle candidate; review adapter chooses a supported
            # one rather than hiding alternatives behind a literal package name.
            for part in templates:
                choices.append({'targetSourcePath': target['sourcePath'], 'moduleId': module,
                                'templatePartId': _text(part, 'ID'), 'templateMasterKey': _text(part, 'MasterKey')})
    return choices


def automatic_plan(job, master, pcb):
    """Prefer the first structurally supported source-derived template per scope.

    This is a proposal selection, never approval. Alternative failures are kept
    privately in the review so one unsupported template cannot mask a useful one.
    """
    _xml(master)
    j, m, layout = ET.fromstring(job), ET.fromstring(master), read_accel(pcb)
    alternatives = {}
    for choice in suggest_choices(job, pcb):
        alternatives.setdefault((choice['targetSourcePath'], choice['moduleId']), []).append(choice)
    chosen = []
    for options in alternatives.values():
        preferred = options[0]
        for choice in options:
            trial_ids = iter(map(str, range(900_000_000, 900_001_000)))
            try:
                _plan(j, m, layout, choice, lambda: next(trial_ids))
                preferred = choice
                break
            except CaptureBlocked:
                continue
        chosen.append(preferred)
    return plan_preparation(job, master, pcb, chosen)


def component_accounting(job, plan, accepted=()):
    """Account for every native CAD component from actual parsed placement rows."""
    _xml(job)
    j = ET.fromstring(job)
    parts = j.findall('PartDataList/PartData')
    prepared = {(item['selection']['moduleId'], item['reference']): item for item in plan['items']
                if item.get('digest') in accepted and item['status'] == 'ready-for-review'}
    pending = {(item['selection']['moduleId'], item.get('reference')): item for item in plan['items'] if item['status'] == 'ready-for-review'}
    held = {(item['selection']['moduleId'], item.get('reference')): item for item in plan['items'] if item['status'] == 'held'}
    rows = []
    for cad in j.findall('CadData/CpList/Cp'):
        ref, module = _text(cad, 'RefID'), _text(cad, 'ModuleID')
        actual = [p for p in parts if _text(p, 'RefID') == ref and _text(p, 'ParentId') == module]
        item = prepared.get((module, ref))
        if item and (len(actual) != 1 or _text(actual[0], 'ID') != item['dependencies']['partId'] or
                     _text(actual[0], 'MasterKey') != item['dependencies']['masterKey'] or _text(actual[0], 'ENABLE') != 'False'):
            _fail('PREPARATION_ACCOUNTING', 'Prepared status requires exactly the actual newly inserted disabled placement identity.')
        rows.append({'reference': ref, 'module': module, 'nativeCadId': _text(cad, 'ID'),
                     'placementIds': [_text(p, 'ID') for p in actual], 'masterKeys': [_text(p, 'MasterKey') for p in actual],
                     'status': 'prepared-disabled' if item else 'existing-structure-preserved' if actual else 'proposal-awaiting-review' if (module, ref) in pending else 'held-no-supported-template',
                     'prepared': item['prepared'] if item else None, 'existingTeaching': 'preserved-unverified' if actual and not item else 'not-transferred',
                     'population': 'unresolved', 'intentionallyExcluded': False, 'enabledNewInspection': False,
                     'remaining': item['remaining'] if item else ['population-and-existing-teaching-review', 'machine-verification-required'] if actual else ['native-model-preparation-required', 'population-decision-required'],
                     'holdCode': held.get((module, ref), {}).get('code') if not actual else None,
                     'nextAction': 'Review new origin/local windows, bind owned pads/FOVs and teach image algorithms at Athena.' if item else
                         'Review existing teaching and duplicate/shared scope; preserve the current work.' if actual else
                         'Review and accept the exact disabled preparation proposal.' if (module, ref) in pending else
                         held.get((module, ref), {}).get('reason', 'Provide a compatible same-angle job-local template or prepare this unsupported model at Athena.'),
                     'machineValidated': False, 'released': False})
    return rows
