"""Disabled two-pad structural trial, not a qualified Eagle creation adapter.

The deliberately narrow template contract has only been tested on authored
synthetic documents. Unknown template fields, image algorithms, binding lists,
nonzero CAD offsets or linked windows BLOCK cloning. Real observed templates
currently exceed this contract. No browser/native export route invokes it.
The geometry and every new record are computed before an exact digest approval.
Existing XML bytes are never serialized. No inspection is enabled or taught.
"""
from __future__ import annotations

from collections import Counter
from copy import deepcopy
from dataclasses import asdict, dataclass
from hashlib import sha256
import json
import math
import re
from xml.parsers import expat
from xml.etree import ElementTree as ET

from .accel_ascii import read_accel
from .qualification_candidate import _xml, _canonical, _fail


PROFILE = 'disabled-two-rect-pad-structural-1'


@dataclass(frozen=True)
class DraftSelection:
    source_path: str
    layer_number: str
    module_id: str
    template_part_id: str
    template_master_key: str
    # An explicit trial hypothesis, NOT established native registration.
    translation_mm: tuple[float, float]


def _one(node, path):
    matches = node.findall(path)
    if len(matches) != 1:
        _fail('DRAFT_AMBIGUOUS', 'A required native template field or container is missing or repeated.')
    return matches[0]


def _text(node, path):
    item = _one(node, path)
    if len(item) or item.attrib or item.text is None:
        _fail('DRAFT_SCALAR', 'Native draft identities and geometry require unique plain scalar fields.')
    return item.text


def _number(node, path):
    value = _text(node, path)
    if not re.fullmatch(r'[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)', value):
        _fail('DRAFT_NUMBER', 'Native draft geometry must be bounded finite plain decimal text.')
    number = float(value)
    if not math.isfinite(number) or abs(number) > 1e6:
        _fail('DRAFT_NUMBER', 'Native draft geometry exceeds its bound.')
    return number


def _fields(node, names):
    if node.attrib or Counter(child.tag for child in node) != Counter(names) or not names and node.text and node.text.strip():
        _fail('DRAFT_TEMPLATE_CONTRACT', 'Template fields exceed the supported disabled structural profile; unknown dependencies cannot be cloned.')


def _record(root, path, field, value):
    matches = [node for node in root.findall(path) if len(node.findall(field)) == 1 and _text(node, field) == value]
    if len(matches) != 1:
        _fail('DRAFT_IDENTITY', 'The selected native template identity is not unique.')
    return matches[0]


def _rectangle(node, path):
    rectangle = _one(node, path)
    _fields(rectangle, ('cx', 'cy', 'w', 'h', 'a'))
    values = {key: _number(rectangle, key) for key in ('cx', 'cy', 'w', 'h', 'a')}
    if values['w'] <= 0 or values['h'] <= 0:
        _fail('DRAFT_GEOMETRY', 'A native template rectangle has invalid dimensions.')
    return values


def _set(node, path, value):
    _one(node, path).text = str(value)


def _decimal(value):
    # Rounding policy is part of the exact reviewed recipe, never an implicit
    # modification to source geometry or existing native records.
    return format(value, '.9f').rstrip('0').rstrip('.') or '0'


def _closing_offsets(raw, paths=('JobContainer/PartDataList', 'JobContainer/WindowDataList')):
    parser = expat.ParserCreate()
    stack, offsets = [], {}
    def start(tag, _attrs):
        stack.append(tag)
    def end(_tag):
        path = '/'.join(stack)
        if path in paths:
            offset = parser.CurrentByteIndex
            if path in offsets or not raw[offset:].startswith(b'</'):
                _fail('DRAFT_CONTAINER', 'Insertion requires one explicit non-self-closing record collection.')
            offsets[path] = offset
        stack.pop()
    parser.StartElementHandler = start
    parser.EndElementHandler = end
    # _xml validates bounds, entities, namespaces and schema before this pass.
    parser.Parse(raw, True)
    return offsets


def plan_disabled_draft(job: bytes, master: bytes, pcb: bytes, selection: DraftSelection):
    """Compute a single complete disabled operation or raise a bounded hold.

    Native translation is a caller-declared qualification hypothesis. No source
    reference match or name match promotes it to established geometry semantics.
    """
    if not isinstance(selection, DraftSelection):
        _fail('DRAFT_SELECTION', 'A typed draft selection is required.')
    if any(not isinstance(value, str) or not value or len(value) > 2048 for value in
           (selection.source_path, selection.layer_number, selection.module_id,
            selection.template_part_id, selection.template_master_key)):
        _fail('DRAFT_SELECTION', 'Draft scope and template identities must be explicit bounded strings.')
    if len(selection.translation_mm) != 2 or any(type(v) not in (int, float) or not math.isfinite(v) or abs(v) > 1e6 for v in selection.translation_mm):
        _fail('DRAFT_FRAME', 'The trial requires an explicit finite translation hypothesis.')
    for raw in (job, master):
        _xml(raw)
        _closing_offsets(raw)
    j, m = ET.fromstring(job), ET.fromstring(master)
    source = read_accel(pcb)
    placements = [item for item in source['placements'] if item['sourcePath'] == selection.source_path]
    if len(placements) != 1:
        _fail('DRAFT_SOURCE', 'The source placement must resolve uniquely in freshly parsed source bytes.')
    placed = placements[0]
    if placed['identityHolds'] or not placed['ownedPadCentersAvailable'] or placed['mountingEvidence'] != 'explicit-zero-holes':
        _fail('DRAFT_SOURCE', 'Unique unflipped source-owned geometry and explicit zero-hole evidence are required.')
    layers = [item for item in placed['explicitLayerGeometry'] if item['layerNumber'] == selection.layer_number]
    if len(layers) != 1 or layers[0]['unresolvedClassPaths']:
        _fail('DRAFT_LAYER', 'The selected trial layer must be unique without unresolved layer-class rules.')
    pads = layers[0]['pads']
    if len(pads) != 2 or any(p['shape'] != 'Rect' or p['localRotationDegrees'] % 90 != 0 for p in pads):
        _fail('DRAFT_FAMILY', 'Only two cardinally oriented rectangular surface pads are supported by this trial profile.')
    a, b = pads
    pad_angle = a['localRotationDegrees'] % 180
    separated = (a['local']['yMm'] == b['local']['yMm'] and abs(a['local']['xMm'] - b['local']['xMm']) > (a['widthMm'] if pad_angle == 0 else a['heightMm'])
        or a['local']['xMm'] == b['local']['xMm'] and abs(a['local']['yMm'] - b['local']['yMm']) > (a['heightMm'] if pad_angle == 0 else a['widthMm']))
    if (a['widthMm'], a['heightMm'], pad_angle) != (b['widthMm'], b['heightMm'], b['localRotationDegrees'] % 180) or not separated:
        _fail('DRAFT_FAMILY', 'The first family requires equal separated rectangles on one source-local row or column.')
    if any(len(p.findall('RefID')) != 1 or len(p.findall('ParentId')) != 1 for p in j.findall('PartDataList/PartData')):
        _fail('DRAFT_IDENTITY', 'Existing placement identities are incomplete; absence cannot be proved.')
    if any(_text(p, 'RefID') == placed['refdes'] and _text(p, 'ParentId') == selection.module_id for p in j.findall('PartDataList/PartData')):
        _fail('DRAFT_ALREADY_PRESENT', 'This reference already has native placement structure in the selected module.')
    _record(j, 'ModuleDataList/ModuleData', 'ID', selection.module_id)
    cad = [p for p in j.findall('CadData/CpList/Cp') if _text(p, 'RefID') == placed['refdes'] and _text(p, 'ModuleID') == selection.module_id]
    if len(cad) != 1:
        _fail('DRAFT_CAD_IDENTITY', 'One existing native CAD reference in the selected module is required; CAD records are never invented.')
    template = _record(j, 'PartDataList/PartData', 'ID', selection.template_part_id)
    model = _record(m, 'PartDataList/PartData', 'MasterKey', selection.template_master_key)
    _fields(template, ('ID', 'ParentId', 'MasterKey', 'RefID', 'ENABLE', 'Roi', 'CenterPosX', 'CenterPosY'))
    _fields(model, ('MasterKey', 'RefID', 'Roi', 'CadOffset'))
    if _text(template, 'MasterKey') != selection.template_master_key or _text(template, 'ParentId') != selection.module_id or _text(template, 'ENABLE') != 'False':
        _fail('DRAFT_TEMPLATE_STATE', 'A disabled template in the selected module and exact Master scope is required.')
    roi = _rectangle(template, 'Roi')
    mr = _rectangle(model, 'Roi')
    _fields(_one(model, 'CadOffset'), ('X', 'Y'))
    if _number(model, 'CadOffset/X') != 0 or _number(model, 'CadOffset/Y') != 0 or mr['cx'] != 0 or mr['cy'] != 0 or mr['a'] != 0 or (roi['w'], roi['h']) != (mr['w'], mr['h']):
        _fail('DRAFT_ORIGIN', 'Only an explicit zero-offset template-local origin with matching ROI size is supported.')
    windows = [w for w in m.findall('WindowDataList/WindowData') if _text(w, 'ParentId') == selection.template_master_key]
    if len(windows) != 2:
        _fail('DRAFT_WINDOWS', 'The profile requires exactly two independent pad windows.')
    matched = []
    for pad in pads:
        candidates = []
        for window in windows:
            _fields(window, ('ParentId', 'ID', 'ENABLE', 'ParentWndId', 'GroupID', 'RelRoi', 'AlgorithmDataList'))
            _fields(_one(window, 'AlgorithmDataList'), ())
            if _text(window, 'ENABLE') != 'False' or _text(window, 'ParentWndId') != '0':
                _fail('DRAFT_WINDOW_STATE', 'Only disabled independent windows without image algorithms are supported.')
            r = _rectangle(window, 'RelRoi')
            if (r['cx'], r['cy'], r['w'], r['h'], r['a'] % 180) == (pad['local']['xMm'], pad['local']['yMm'], pad['widthMm'], pad['heightMm'], pad['localRotationDegrees'] % 180):
                candidates.append(window)
        if len(candidates) != 1 or candidates[0] in matched:
            _fail('DRAFT_TEMPLATE_GEOMETRY', 'Template local pad geometry must match each owned source pad exactly, without guessing its origin.')
        matched.append(candidates[0])
    reserved = {int(node.text) for root in (j, m) for node in root.iter()
                if node.tag in ('ID', 'MasterKey', 'ParentId', 'ParentWndId', 'GroupID')
                and node.text and re.fullmatch('[0-9]{1,9}', node.text)}
    first = max(reserved | {0}) + 1
    if first + 5 > 999_999_999:
        _fail('DRAFT_ID_LIMIT', 'The deterministic ID allocation exceeds its bounded range.')
    part_id, master_key, window_a, window_b, group_a, group_b = map(str, range(first, first + 6))
    part, new_model = deepcopy(template), deepcopy(model)
    x = placed['anchor']['xMm'] + selection.translation_mm[0]
    y = placed['anchor']['yMm'] + selection.translation_mm[1]
    angle = placed['rotation']['degrees'] % 360
    if abs(x) > 1e6 or abs(y) > 1e6:
        _fail('DRAFT_FRAME', 'Translated trial placement exceeds the bounded native coordinate range.')
    for path, value in {'ID': part_id, 'MasterKey': master_key, 'RefID': placed['refdes'], 'ENABLE': 'False',
                        'Roi/cx': _decimal(x), 'Roi/cy': _decimal(y), 'Roi/a': _decimal(angle),
                        'CenterPosX': _decimal(x), 'CenterPosY': _decimal(y)}.items():
        _set(part, path, value)
    for path, value in {'MasterKey': master_key, 'RefID': placed['refdes']}.items():
        _set(new_model, path, value)
    new_windows = []
    for window, wid, gid in zip(matched, (window_a, window_b), (group_a, group_b)):
        new = deepcopy(window)
        for path, value in {'ID': wid, 'ParentId': master_key, 'GroupID': gid, 'ENABLE': 'False'}.items():
            _set(new, path, value)
        new_windows.append(new)
    changes = []
    for document, container, node in [('job', 'PartDataList', part), ('master', 'PartDataList', new_model), *[('master', 'WindowDataList', w) for w in new_windows]]:
        node.tail = None
        changes.append({'document': document, 'container': 'JobContainer/' + container,
                        'operation': 'append-record', 'before': None, 'afterXml': ET.tostring(node, encoding='unicode')})
    recipe = {'artifactType': 'scan.disabled-draft-recipe', 'schemaVersion': '1', 'profile': PROFILE,
              'source': {'jobSha256': sha256(job).hexdigest(), 'masterSha256': sha256(master).hexdigest(), 'layoutSha256': sha256(pcb).hexdigest()},
              'selection': asdict(selection), 'reference': placed['refdes'], 'changes': changes,
              'dependencies': {'moduleId': selection.module_id, 'partId': part_id, 'masterKey': master_key,
                               'windowIds': [window_a, window_b], 'groupIds': [group_a, group_b],
                               'newAlgorithms': 0, 'sharedLibrariesChanged': False},
              'qualificationOnly': True, 'profileQualification': 'synthetic-structural-tests-only',
              'sourceGeometry': layers[0], 'enabled': False, 'populationApproved': False,
              'remaining': ['native-frame-hypothesis-unverified', 'pad-binding-unresolved', 'Eagle-open-save-reopen-unverified', 'image-teaching-required', 'physical-inspection-unverified'],
              'machineExportAllowed': False}
    # JSON-native normalization keeps recipe approval stable across serialization.
    return json.loads(_canonical(recipe))


def recipe_digest(recipe):
    return sha256(_canonical(recipe)).hexdigest()


def apply_disabled_draft(job, master, pcb, recipe, accepted_digest):
    """Re-derive the complete operation; never trust caller-authored XML changes."""
    selection = DraftSelection(**recipe['selection'])
    fresh = plan_disabled_draft(job, master, pcb, selection)
    if fresh != recipe or recipe_digest(fresh) != accepted_digest:
        _fail('DRAFT_STALE_APPROVAL', 'The exact recipe must match fresh source-derived records and its reviewed digest.')
    output = {}
    for role, raw in (('job', job), ('master', master)):
        offsets = _closing_offsets(raw)
        inserts = {}
        for change in fresh['changes']:
            if change['document'] == role:
                point = offsets.get(change['container'])
                if point is None:
                    _fail('DRAFT_CONTAINER', 'The exact native insertion container is unavailable.')
                inserts.setdefault(point, []).append(change['afterXml'].encode('utf-8'))
        current = raw
        spans = []
        added = 0
        for point in sorted(inserts):
            payload = b''.join(inserts[point])
            spans.append((point + added, point + added + len(payload)))
            added += len(payload)
        for point in sorted(inserts, reverse=True):
            current = current[:point] + b''.join(inserts[point]) + current[point:]
        _xml(current)
        recovered = current
        for start, end in reversed(spans):
            recovered = recovered[:start] + recovered[end:]
        if recovered != raw:
            _fail('DRAFT_PRESERVATION', 'Removing only the planned insertions did not restore the exact original bytes.')
        output[role] = current
    return output
