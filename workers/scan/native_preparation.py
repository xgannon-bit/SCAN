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
from .native_model_geometry import derive_model_geometry, equivalent_source_geometry
from .native_window_subset import closed_window_subset

PROFILE = 'job-local-owned-footprint-disabled-2'
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
            'pads': [{k: v for k, v in pad.items() if k not in ('sourcePath', 'sourceBoardPoint', 'sourceBoardRotationDegrees')}
                     for layer in placed['explicitLayerGeometry'] for pad in layer['pads']],
            'layers': [(layer['layerNumber'], len(layer['pads'])) for layer in placed['explicitLayerGeometry']]}


def _coverage(j, layout, items):
    """Every CAD scope gets a reason, including scopes without any proposal.

    Drill evidence is not a population exclusion. Engineering BOM population
    belongs to its separately hash-bound source reconciliation, not this writer.
    """
    parts = j.findall('PartDataList/PartData')
    placements = layout['placements']
    scopes = Counter((_text(c, 'ModuleID'), _text(c, 'RefID')) for c in j.findall('CadData/CpList/Cp'))
    selected = {(i['selection']['moduleId'], i.get('reference')): i for i in items}
    rows = []
    for cad in j.findall('CadData/CpList/Cp'):
        ref, module = _text(cad, 'RefID'), _text(cad, 'ModuleID')
        actual = [p for p in parts if _text(p, 'ParentId') == module and _text(p, 'RefID') == ref]
        sources = [p for p in placements if p['refdes'] == ref]
        source = sources[0] if len(sources) == 1 else None
        evidence = {'sourcePath': source['sourcePath'] if source else None,
                    'mountingEvidence': source.get('mountingEvidence', 'unknown') if source else 'unknown',
                    'identityHoldCodes': sorted({h['code'] for h in source.get('identityHolds', [])}) if source else [],
                    'ownedPadCentersAvailable': bool(source and source.get('ownedPadCentersAvailable')),
                    'explicitLayerOutlinesAvailable': bool(source and source.get('explicitLayerGeometry'))}
        item = selected.get((module, ref))
        code, reason = None, None
        if actual:
            state = 'existing-duplicate-scope-preserved' if len(actual) > 1 else 'existing-structure-preserved'
        elif scopes[(module, ref)] != 1:
            state, code, reason = 'held', 'PREPARATION_CAD_AMBIGUOUS', 'The module/reference has multiple native CAD records; resolve that scope before creating a placement.'
        elif len(sources) != 1:
            state, code, reason = 'held', 'PREPARATION_SOURCE_IDENTITY', 'Exactly one source-owned layout placement is required for this literal reference.'
        elif source.get('identityHolds') or not source.get('ownedPadCentersAvailable'):
            state, code, reason = 'held', 'PREPARATION_SOURCE_GEOMETRY', 'Source ownership or pad centers are held: ' + ', '.join(sorted({h['code'] for h in source.get('identityHolds', [])}))
        elif source.get('mountingEvidence') == 'hole-bearing':
            state, code, reason = 'held', 'PREPARATION_THROUGH_HOLE', 'Source drill evidence is nonzero. The surface-pad adapter does not create this model; decide stage-specific inspection separately.'
        elif source.get('mountingEvidence') != 'explicit-zero-holes':
            state, code, reason = 'held', 'PREPARATION_DRILL_UNKNOWN', 'Explicit zero-hole evidence is required by this surface-pad adapter.'
        elif not source.get('explicitLayerGeometry'):
            state, code, reason = 'held', 'PREPARATION_LAYER_GEOMETRY', 'Complete numbered-layer owned outlines are unavailable; no inspection geometry is invented.'
        elif item:
            state = item['status']
            code, reason = item.get('code'), item.get('reason')
        else:
            templates = []
            for part in parts:
                if _text(part, 'ParentId') != module:
                    continue
                origins = [p for p in placements if p['refdes'] == _text(part, 'RefID')]
                if len(origins) == 1 and origins[0].get('explicitLayerGeometry') and _footprint(origins[0]) == _footprint(source):
                    templates.append(part)
            state = 'held'
            if templates:
                code, reason = 'PREPARATION_ANGLE_TEMPLATE', 'The source-owned footprint has existing native templates, but none supplies the supported native CAD angle and origin contract.'
            else:
                code, reason = 'PREPARATION_MODEL_GEOMETRY', 'No existing source-owned identical footprint model is present. A supported model/window geometry contract is required for this family.'
        rows.append({'reference': ref, 'module': module, 'nativeCadId': _text(cad, 'ID'),
                     'state': state, 'holdCode': code, 'holdReason': reason, **evidence})
    return rows


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
    tc, oc = _cad(j, target['refdes'], module), _cad(j, ref, module)
    _contract(part, PART); _contract(model, MODEL); _neutral(part, model)
    for node in (part, model):
        if _text(node, 'Name') != _text(oc, 'PrntPartName') or _text(node, 'PartCode') != _text(oc, 'PrntPartName'):
            _fail('PREPARATION_IDENTITY', 'Template identity differs from its native CAD correspondence.')
    roi = _rectangle(part, 'Roi'); _rectangle(model, 'Roi')
    _number(part, 'CenterPosX'); _number(part, 'CenterPosY')
    for axis in ('X', 'Y'):
        _number(model, 'CadOffset/' + axis)
    geometry = derive_model_geometry(target, origin, part, model, tc, oc)
    windows = [w for w in m.findall('WindowDataList/WindowData') if _text(w, 'ParentId') == choice['templateMasterKey']]
    if not windows or len(windows) > 256:
        _fail('PREPARATION_WINDOWS', 'A bounded complete template window set is required.')
    ids = [_text(w, 'ID') for w in windows]
    if len(set(ids)) != len(ids) or any(not re.fullmatch(r'(?:[1-9][0-9]{0,8}|[A-Za-z][A-Za-z0-9]{0,127})', wid) for wid in ids):
        _fail('PREPARATION_WINDOW_ID', 'Template window IDs are not unique within the selected Master scope.')
    for w in windows:
        _contract(w, WINDOW); _rectangle(w, 'RelRoi')
        if not re.fullmatch(r'(?:0|[1-9][0-9]{0,8})', _text(w, 'GroupID')):
            _fail('PREPARATION_WINDOW_LINK', 'A noncanonical window group identity cannot be transferred.')
        if _text(w, 'UseWndPoly') not in {'False', '0'}:
            _fail('PREPARATION_POLYGON', 'Polygon window geometry is outside this rectangle profile.')
    subset = closed_window_subset(windows)
    all_windows, windows = windows, subset['retained']
    ids = [_text(w, 'ID') for w in windows]
    for omitted in subset['omitted']:
        original = all_windows[omitted['templateWindowOrdinal'] - 1]
        omitted['templateAlgorithmsNotTransferred'] = len(_one(original, 'AlgorithmDataList'))
    pid, key, number = allocate(), allocate(), allocate()
    # The source reuses local window keys across different Masters. These are
    # not global placement identities (real keys can be alphabetic). Keep their
    # exact native format and local group meanings; only their Master scope moves.
    wid_map = {wid: wid for wid in ids}
    gid_map = {gid: gid for gid in sorted({_text(w, 'GroupID') for w in windows}) if gid != '0'}
    newpart, newmodel = deepcopy(part), deepcopy(model)
    name = _text(tc, 'PrntPartName')
    for node in (newpart, newmodel):
        for path, value in {'MasterKey': key, 'RefID': target['refdes'], 'Name': name, 'PartCode': name, 'No': number}.items():
            _set(node, path, value)
    for path, value in {'ID': pid, 'ENABLE': 'False', **geometry['partUpdates']}.items():
        _set(newpart, path, value)
    for child in newpart:
        if child.tag in {'WND_PAD', 'FovList'} or child.tag.startswith(('ListGerPadId', 'ListGerbPadId')):
            child.clear()
    newwindows = []
    omitted_algorithms = sum(len(_one(w, 'AlgorithmDataList')) for w in all_windows)
    for w in windows:
        new = deepcopy(w)
        for path, value in {'ID': wid_map[_text(w, 'ID')], 'ParentId': key, 'ENABLE': 'False',
                            'ParentWndId': _text(w, 'ParentWndId'),
                            'GroupID': _text(w, 'GroupID'),
                            'AlignWndID': _one(w, 'AlignWndID').text or ''}.items():
            _set(new, path, value)
        algorithms = _one(new, 'AlgorithmDataList')
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
             'windowKeyPolicy': 'exact-template-local-keys-in-new-master-scope',
             'groupKeyPolicy': 'exact-template-local-groups-in-new-master-scope',
             'windowPreparation': 'complete-template-window-copy' if subset['complete'] else 'partial-closed-window-subset',
             'omittedWindows': subset['omitted'], 'windowSubsetAdapter': subset['profile'],
             'newAlgorithms': 0, 'templateAlgorithmsNotTransferred': omitted_algorithms, 'sharedLibrariesChanged': False},
            'basis': {'footprint': _footprint(target), 'nativeCadTargetId': _text(tc, 'ID'), 'nativeCadTemplateId': _text(oc, 'ID'),
                      **geometry['basis'], 'geometryAdapter': geometry['profile'],
                      'polarPositionPolicy': 'copied-template-unqualified-not-translated', 'modelNoPolicy': 'preserved-template-setting-unqualified'},
            'prepared': 'disabled-placement-model-and-local-window-structure' if subset['complete'] else 'disabled-placement-model-and-partial-local-window-structure',
            'remaining': REMAINING + geometry['remaining'] + subset['remaining'],
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
        'choices': choices, 'items': items, 'coverage': _coverage(j, layout, items),
        'remaining': REMAINING, 'qualificationOnly': True, 'machineExportAllowed': False}))


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
                if _text(part, 'ParentId') == module and len(origins) == 1:
                    try:
                        if equivalent_source_geometry(target, origins[0]):
                            templates.append(part)
                    except CaptureBlocked:
                        pass
            # Expose every exact-local-geometry candidate; review chooses a supported
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
        preferred_code = None
        partial = None
        for choice in options:
            trial_ids = iter(map(str, range(900_000_000, 900_001_000)))
            try:
                result = _plan(j, m, layout, choice, lambda: next(trial_ids))
                if result['dependencies']['windowPreparation'] == 'complete-template-window-copy':
                    preferred = choice
                    partial = None
                    break
                if partial is None:
                    partial = choice
            except CaptureBlocked as error:
                # A real unique template's geometry hold is more useful than
                # hiding it behind the first duplicated template encountered.
                if preferred_code is None or preferred_code == 'PREPARATION_TEMPLATE_DUPLICATE' and error.code != 'PREPARATION_TEMPLATE_DUPLICATE':
                    preferred, preferred_code = choice, error.code
        if partial is not None:
            preferred = partial
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
    coverage = {(item['module'], item['reference']): item for item in plan.get('coverage', [])}
    rows = []
    for cad in j.findall('CadData/CpList/Cp'):
        ref, module = _text(cad, 'RefID'), _text(cad, 'ModuleID')
        actual = [p for p in parts if _text(p, 'RefID') == ref and _text(p, 'ParentId') == module]
        item = prepared.get((module, ref))
        source = coverage.get((module, ref), {})
        if item and (len(actual) != 1 or _text(actual[0], 'ID') != item['dependencies']['partId'] or
                     _text(actual[0], 'MasterKey') != item['dependencies']['masterKey'] or _text(actual[0], 'ENABLE') != 'False'):
            _fail('PREPARATION_ACCOUNTING', 'Prepared status requires exactly the actual newly inserted disabled placement identity.')
        rows.append({'reference': ref, 'module': module, 'nativeCadId': _text(cad, 'ID'),
                     'placementIds': [_text(p, 'ID') for p in actual], 'masterKeys': [_text(p, 'MasterKey') for p in actual],
                     'status': ('prepared-partial-disabled' if item['dependencies']['windowPreparation'] == 'partial-closed-window-subset' else 'prepared-disabled') if item else 'existing-structure-preserved' if actual else 'proposal-awaiting-review' if (module, ref) in pending else 'held-no-supported-template',
                     'windowPreparation': item['dependencies']['windowPreparation'] if item else None,
                     'omittedWindows': item['dependencies']['omittedWindows'] if item else [],
                     'prepared': item['prepared'] if item else None, 'existingTeaching': 'preserved-unverified' if actual and not item else 'not-transferred',
                     'population': 'unresolved', 'intentionallyExcluded': False, 'enabledNewInspection': False,
                     'remaining': item['remaining'] if item else ['population-and-existing-teaching-review', 'machine-verification-required'] if actual else ['native-model-preparation-required', 'population-decision-required'],
                     'mountingEvidence': source.get('mountingEvidence', 'unknown'),
                     'sourcePath': source.get('sourcePath'),
                     'holdCode': (source.get('holdCode') or held.get((module, ref), {}).get('code')) if not actual else None,
                     'holdReason': source.get('holdReason') if not actual else None,
                     'nextAction': 'Review new origin/local windows, bind owned pads/FOVs and teach image algorithms at Athena.' if item else
                         'Review existing teaching and duplicate/shared scope; preserve the current work.' if actual else
                         'Review and accept the exact disabled preparation proposal.' if (module, ref) in pending else
                         source.get('holdReason') or held.get((module, ref), {}).get('reason', 'Provide a compatible job-local template or prepare this unsupported model at Athena.'),
                     'machineValidated': False, 'released': False})
    return rows
