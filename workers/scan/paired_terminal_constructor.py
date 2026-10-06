"""Evidence-input symmetric two-terminal package constructor.

No board/family identities are built in. Owned PCB lands define terminal
reference windows; a separately reviewed manufacturer profile defines the body.
The native structural seed supplies bounded field formats, never geometry or
teaching. Local-frame interpretation remains an explicit Eagle qualification.
"""
from collections import Counter
from copy import deepcopy
from hashlib import sha256
import base64
import math
import re
from xml.etree import ElementTree as ET

from .accel_ascii import _parse, AccelLimits
from .disabled_draft import _text, _one, _number, _record, _rectangle, _set, _decimal
from .qualification_candidate import _fail

KIND = 'symmetric-two-terminal-body-v1'


def validate_profiles(profiles):
    if not isinstance(profiles, list) or len(profiles) > 20:
        _fail('PACKAGE_PROFILE', 'At most 20 explicit package evidence profiles are supported.')
    ids = set()
    for p in profiles:
        if isinstance(p, dict) and p.get('kind') == 'polarized-three-terminal-body-v1':
            from .three_terminal_constructor import validate_profile
            validate_profile(p)
            if p['id'] in ids:
                _fail('PACKAGE_PROFILE', 'Package evidence profile IDs must be unique.')
            ids.add(p['id'])
            continue
        if isinstance(p, dict) and p.get('kind') == 'polarized-two-terminal-body-v1':
            from .diode_constructor import validate_profile
            validate_profile(p)
            if p['id'] in ids:
                _fail('PACKAGE_PROFILE', 'Package evidence profile IDs must be unique.')
            ids.add(p['id'])
            continue
        keys = {'id', 'kind', 'patternRef', 'graphicsRef', 'compRef', 'attachedPatternName', 'nativePartNames', 'drawing',
                'body', 'electrode', 'padPinMap', 'seedPartId', 'seedMasterKey', 'bodyWindowId', 'terminalWindowId'}
        if not isinstance(p, dict) or set(p) != keys or p['kind'] != KIND:
            _fail('PACKAGE_PROFILE', 'Unknown or incomplete package constructor profile.')
        for k in ('id', 'patternRef', 'graphicsRef', 'compRef', 'attachedPatternName', 'seedPartId', 'seedMasterKey', 'bodyWindowId', 'terminalWindowId'):
            if not isinstance(p[k], str) or not 0 < len(p[k]) <= 2048 or '\0' in p[k]:
                _fail('PACKAGE_PROFILE', 'Package identity fields must be bounded literal strings.')
        if p['id'] in ids:
            _fail('PACKAGE_PROFILE', 'Package evidence profile IDs must be unique.')
        ids.add(p['id'])
        if not isinstance(p['nativePartNames'], list) or not 1 <= len(p['nativePartNames']) <= 20 or any(
                not isinstance(n, str) or not 0 < len(n) <= 2048 for n in p['nativePartNames']):
            _fail('PACKAGE_PROFILE', 'Explicit native package identities are required.')
        d = p['drawing']
        if not isinstance(d, dict) or set(d) != {'url', 'sha256', 'page', 'matchEvidence'} or not isinstance(d['url'], str) or not d['url'].startswith('https://') or len(d['url']) > 2048 or not re.fullmatch('[a-f0-9]{64}', str(d['sha256'])) or type(d['page']) is not int or not 1 <= d['page'] <= 100 or not isinstance(d['matchEvidence'], str) or not 1 <= len(d['matchEvidence']) <= 4096:
            _fail('PACKAGE_DRAWING', 'A reviewed manufacturer drawing identity and match explanation are required.')
        for name, keys in [('body', {'widthMm', 'heightMm', 'offsetAlongMm', 'offsetAcrossMm'}),
                           ('electrode', {'widthMm', 'heightMm', 'centerSeparationMm', 'minimumOverlapFraction'})]:
            v = p[name]
            if not isinstance(v, dict) or set(v) != keys or any(type(x) not in (int, float) or not math.isfinite(x) or abs(x) > 1000 for x in v.values()):
                _fail('PACKAGE_GEOMETRY', 'Finite bounded body and electrode drawing dimensions are required.')
            if v['widthMm'] <= 0 or v['heightMm'] <= 0:
                _fail('PACKAGE_GEOMETRY', 'Drawing dimensions must be positive.')
        if p['electrode']['centerSeparationMm'] <= 0 or not .5 <= p['electrode']['minimumOverlapFraction'] <= 1:
            _fail('PACKAGE_GEOMETRY', 'A positive electrode separation and conservative overlap requirement are required.')
        mapping = p['padPinMap']
        if not isinstance(mapping, dict) or len(mapping) != 2 or len(set(mapping.values())) != 2 or any(
                not isinstance(x, str) or not re.fullmatch('[1-9][0-9]{0,3}', x) for x in [*mapping, *mapping.values()]):
            _fail('PACKAGE_PIN_MAP', 'Exactly two distinct explicit numeric pad/pin identities are required.')
    return profiles


def pin_mapping(pcb, target, profile, count=2):
    ast, _ = _parse(pcb.decode('latin-1'), AccelLimits(), Counter())
    nodes = []
    def visit(n):
        nodes.append(n)
        for child in n.children:
            visit(child)
    visit(ast)
    defs = [n for n in nodes if n.tag == 'compDef' and n.args == [target['component']['compRef']]]
    if len(defs) != 1:
        _fail('PACKAGE_COMPONENT_DEFINITION', 'Exactly one linked component definition is required.')
    attached = defs[0].all('attachedPattern')
    def scalar(n, tag):
        rows = n.all(tag)
        return rows[0].args[0] if len(rows) == 1 and len(rows[0].args) == 1 else None
    attached = [n for n in attached if scalar(n, 'patternName') == profile['attachedPatternName']]
    if len(attached) != 1 or len(attached[0].all('padPinMap')) != 1:
        _fail('PACKAGE_PIN_MAP', 'One attached-pattern pad/pin map must match the owned footprint.')
    children = attached[0].all('padPinMap')[0].children
    if len(children) != count*2 or [n.tag for n in children] != ['padNum', 'compPinRef'] * count or any(len(n.args) != 1 or n.children for n in children):
        _fail('PACKAGE_PIN_MAP', 'Unsupported, partial or ambiguous pad/pin map.')
    pairs = [(children[i].args[0], children[i+1].args[0]) for i in range(0, count*2, 2)]
    pins = defs[0].all('compPin')
    if len(pins) != count or any(len(n.args) != 1 for n in pins) or {n.args[0] for n in pins} != {b for _, b in pairs} or scalar(attached[0], 'numPads') != str(count):
        _fail('PACKAGE_PIN_MAP', 'Mapped pins must close on the exact literal component-definition pins and declared pads.')
    if len(set(a for a, _ in pairs)) != count or len(set(b for _, b in pairs)) != count:
        _fail('PACKAGE_PIN_MAP', 'Duplicate pad/pin identity is not supported.')
    return dict(pairs), attached[0].path


def source_geometry(target, profile, pcb):
    if target['identityHolds'] or not target['ownedPadCentersAvailable'] or target['mountingEvidence'] != 'explicit-zero-holes':
        _fail('PACKAGE_SOURCE', 'Unique unflipped zero-hole owned pad geometry is required.')
    layers = target['explicitLayerGeometry']
    if len(layers) != 1 or str(layers[0]['layerNumber']) != '1' or len(layers[0]['pads']) != 2:
        _fail('PACKAGE_LAYER', 'This constructor supports exactly two explicit top-layer lands; side qualification remains required.')
    pads = sorted(layers[0]['pads'], key=lambda x: str(x['padNumber']))
    mapping, path = pin_mapping(pcb, target, profile)
    if mapping != profile['padPinMap'] or set(mapping) != {str(p['padNumber']) for p in pads}:
        _fail('PACKAGE_PIN_MAP', 'Fresh owned pad identities and linked pin mapping differ from the reviewed profile.')
    if any(p['shape'] != 'Rect' or p['localRotationDegrees'] % 90 for p in pads):
        _fail('PACKAGE_PAD_SHAPE', 'Only explicit cardinal rectangular terminal lands are supported.')
    outlines = [(p['widthMm'], p['heightMm']) if p['localRotationDegrees'] % 180 == 0 else (p['heightMm'], p['widthMm']) for p in pads]
    if any(abs(a-b) > 1e-6 for a,b in zip(outlines[0], outlines[1])):
        _fail('PACKAGE_LAND_ASYMMETRY', 'Congruent opposite lands are required to use their midpoint as the symmetric package anchor.')
    points = [(p['local']['xMm'], p['local']['yMm']) for p in pads]
    dx, dy = points[1][0]-points[0][0], points[1][1]-points[0][1]
    separation = math.hypot(dx, dy)
    if separation <= 0 or min(abs(dx), abs(dy)) > 1e-6:
        _fail('PACKAGE_AXIS', 'Distinct cardinal terminal centers are required.')
    ux, uy = dx/separation, dy/separation
    vx, vy = -uy, ux
    mid = ((points[0][0]+points[1][0])/2, (points[0][1]+points[1][1])/2)
    body = profile['body']
    center = (mid[0]+ux*body['offsetAlongMm']+vx*body['offsetAcrossMm'], mid[1]+uy*body['offsetAlongMm']+vy*body['offsetAcrossMm'])
    terminal = []
    for p, (x, y), sign in zip(pads, points, (-1, 1)):
        # Resolve pad rotation before comparing the physical electrode projection.
        w, h = p['widthMm'], p['heightMm']
        if p['localRotationDegrees'] % 180:
            w, h = h, w
        along, across = (w, h) if abs(ux) > .5 else (h, w)
        e = profile['electrode']
        electrode_center = sign*e['centerSeparationMm']/2 + body['offsetAlongMm']
        land_center = sign*separation/2
        overlap_along = max(0, min(land_center+along/2, electrode_center+e['heightMm']/2)-max(land_center-along/2, electrode_center-e['heightMm']/2))
        overlap_across = max(0, min(across/2, body['offsetAcrossMm']+e['widthMm']/2)-max(-across/2, body['offsetAcrossMm']-e['widthMm']/2))
        fraction = overlap_along*overlap_across/(e['widthMm']*e['heightMm'])
        if fraction + 1e-8 < e['minimumOverlapFraction']:
            _fail('PACKAGE_DRAWING_LAND_MISMATCH', 'Owned land geometry does not sufficiently overlap the matched drawing electrodes.')
        terminal.append({'padNumber': str(p['padNumber']), 'pin': mapping[str(p['padNumber'])],
                         'cx': x-center[0], 'cy': y-center[1], 'w': w, 'h': h, 'a': 0,
                         'sourcePath': p['padSourcePath'], 'electrodeOverlapFraction': fraction})
    # Body dimensions are expressed across / along the terminal pair, transformed
    # into the pattern axes. Rotating a rectangular body cannot swap its anchor.
    bw, bh = (body['heightMm'], body['widthMm']) if abs(ux) > .5 else (body['widthMm'], body['heightMm'])
    return {'center': center, 'bodyWidth': bw, 'bodyHeight': bh, 'terminals': terminal,
            'pinMapSourcePath': path, 'axis': [ux, uy]}


def construct(j, m, layout, pcb, choice, profile, allocate):
    from .native_preparation import PART, MODEL, WINDOW, _contract, _neutral, _cad
    matches = [p for p in layout['placements'] if p['sourcePath'] == choice['targetSourcePath']]
    if len(matches) != 1:
        _fail('PACKAGE_SOURCE', 'One literal source placement is required.')
    target = matches[0]
    if (target['patternRef'], target['patternGraphicsNameRef'], target['component']['compRef']) != (profile['patternRef'], profile['graphicsRef'], profile['compRef']):
        _fail('PACKAGE_IDENTITY', 'Source package identities differ from the reviewed drawing profile.')
    module = choice['moduleId']
    _record(j, 'ModuleDataList/ModuleData', 'ID', module)
    if any(_text(p, 'RefID') == target['refdes'] and _text(p, 'ParentId') == module for p in j.findall('PartDataList/PartData')):
        _fail('PREPARATION_ALREADY_PRESENT', 'This native component scope is already present.')
    cad = _cad(j, target['refdes'], module)
    if _text(cad, 'PrntPartName') not in profile['nativePartNames']:
        _fail('PACKAGE_IDENTITY', 'Native CAD identity is not one of the explicitly matched drawing identities.')
    polarized = profile['kind'] in {'polarized-two-terminal-body-v1', 'polarized-three-terminal-body-v1'}
    if profile['kind'] == 'polarized-three-terminal-body-v1':
        from .three_terminal_constructor import source_geometry as three_geometry
        geom = three_geometry(target, profile, pcb)
    elif polarized:
        from .diode_constructor import source_geometry as diode_geometry
        geom = diode_geometry(target, profile, pcb)
    else:
        geom = source_geometry(target, profile, pcb)
    angle = target['rotation']['degrees'] % 360
    native_angle = float(_number(cad, 'Ang')) % 360
    if angle % 90 or native_angle % 90 or (angle + native_angle) % 360:
        _fail('PACKAGE_ORIENTATION', 'Only directly corresponding source/cardinal native clockwise angle literals are supported.')
    # Require multiple independent 2-D controls and a held-out correspondence.
    controls = []
    for p in layout['placements']:
        rows = [c for c in j.findall('CadData/CpList/Cp') if _text(c, 'RefID') == p['refdes'] and _text(c, 'ModuleID') == module]
        if len(rows) == 1 and not p['identityHolds'] and p['anchor'] and p['rotation']['degrees'] is not None:
            c = rows[0]
            controls.append((p['refdes'], p['anchor']['xMm'], p['anchor']['yMm'],
                             float(_number(c, 'X'))-p['anchor']['xMm'], float(_number(c, 'Y'))-p['anchor']['yMm']))
    tx, ty = float(_number(cad, 'X'))-target['anchor']['xMm'], float(_number(cad, 'Y'))-target['anchor']['yMm']
    controls = [c for c in controls if c[0] != target['refdes'] and abs(c[3]-tx) <= 1e-5 and abs(c[4]-ty) <= 1e-5]
    a = controls[0] if controls else None
    b = next((b for b in controls[1:] if abs(b[1]-a[1])+abs(b[2]-a[2]) > 1e-6), None) if a else None
    noncollinear = bool(b and any(abs((b[1]-a[1])*(c[2]-a[2])-(b[2]-a[2])*(c[1]-a[1])) > 1e-6 for c in controls))
    if len(controls) < 4 or not noncollinear:
        _fail('PACKAGE_NATIVE_FRAME', 'At least four other noncollinear source/native CAD correspondences must support the 1:1 translation hypothesis.')
    part = _record(j, 'PartDataList/PartData', 'ID', profile['seedPartId'])
    model = _record(m, 'PartDataList/PartData', 'MasterKey', profile['seedMasterKey'])
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
    # No allocation occurs before all source, drawing and native checks pass.
    pid, key, number = allocate(), allocate(), allocate()
    newpart, newmodel = deepcopy(part), deepcopy(model)
    radians = math.radians(angle)
    ox, oy = geom['center']
    wx, wy = ox*math.cos(radians)-oy*math.sin(radians), ox*math.sin(radians)+oy*math.cos(radians)
    cx, cy = float(_number(cad, 'X'))+wx, float(_number(cad, 'Y'))+wy
    name = _text(cad, 'PrntPartName')
    for n in (newpart, newmodel):
        for path, value in {'MasterKey': key, 'No': number, 'RefID': target['refdes'], 'Name': name, 'PartCode': name,
                            'CommonCategory': 'SCAN qualification', 'FCtgr': '',
                            'Roi/w': _decimal(geom['bodyWidth']), 'Roi/h': _decimal(geom['bodyHeight']), 'Roi/a': _decimal(native_angle)}.items():
            _set(n, path, value)
        _one(n, 'FovList').clear()
    for path, value in {'ID': pid, 'ENABLE': 'False', 'Roi/cx': _decimal(cx), 'Roi/cy': _decimal(cy),
                        'CenterPosX': '0', 'CenterPosY': '0', 'ptSetPolarPos/X': '0', 'ptSetPolarPos/Y': '0'}.items():
        _set(newpart, path, value)
    for child in newpart:
        if child.tag == 'WND_PAD' or child.tag.startswith(('ListGerPadId', 'ListGerbPadId')):
            child.clear()
    for path, value in {'Roi/cx': _decimal(cx), 'Roi/cy': _decimal(cy), 'CadOffset/X': _decimal(ox), 'CadOffset/Y': _decimal(oy), 'DRun': '0', 'ModelNo': '0', 'MatchedPartDate': '0', 'UpdateDate': '0'}.items():
        _set(newmodel, path, value)
    newwindows, roles = [], []
    regions = [{'cx': 0, 'cy': 0, 'w': geom['bodyWidth'], 'h': geom['bodyHeight'], 'a': 0}, *geom['terminals']]
    for i, region in enumerate(regions):
        w = deepcopy(seeds[0 if i == 0 else 1])
        wid = f'window{i+1}'
        label = 'Body reference' if i == 0 else 'Terminal land pin ' + region['pin']
        if polarized and i:
            label += ' ' + region['terminalRole']
        for path, value in {'ID': wid, 'ParentId': key, 'GroupID': str(i+1), 'ENABLE': 'False', 'ParentWndId': '0',
                            'ALIGNWND': 'False', 'AlignWndID': '', 'Name': base64.b64encode(label.encode('utf-16le')).decode()}.items():
            _set(w, path, value)
        for axis in ('cx', 'cy', 'w', 'h', 'a'):
            _set(w, 'RelRoi/' + axis, _decimal(region[axis]))
        _one(w, 'AlgorithmDataList').clear()
        newwindows.append(w)
        roles.append({'windowId': wid, 'role': 'manufacturer-body-reference' if i == 0 else 'source-owned-terminal-land-reference',
                      'padNumber': region.get('padNumber'), 'pin': region.get('pin'), 'sourcePath': region.get('sourcePath')})
        if polarized and i:
            roles[-1]['terminalRole'] = region['terminalRole']
    changes = []
    for role, container, node in [('job', 'PartDataList', newpart), ('master', 'PartDataList', newmodel), *[('master', 'WindowDataList', w) for w in newwindows]]:
        node.tail = None
        changes.append({'document': role, 'container': 'JobContainer/' + container, 'operation': 'append-record', 'before': None, 'afterXml': ET.tostring(node, encoding='unicode')})
    result = {'selection': choice, 'reference': target['refdes'], 'templateReference': _text(part, 'RefID'), 'enabled': False,
            'changes': changes, 'dependencies': {'partId': pid, 'masterKey': key, 'number': number, 'moduleId': module,
                'windowIds': [r['windowId'] for r in roles], 'groupIds': [str(i+1) for i in range(len(roles))], 'windowPreparation': 'constructed-body-terminal-geometry',
                'windowRoles': roles, 'omittedWindows': [], 'newAlgorithms': 0, 'templateAlgorithmsNotTransferred': sum(len(_one(w, 'AlgorithmDataList')) for w in seeds), 'sharedLibrariesChanged': False},
            'basis': {'geometryRoute': profile['kind'], 'packageProfileId': profile['id'], 'drawing': profile['drawing'],
                      'bodyGeometryMm': profile['body'], 'terminalGeometry': geom['terminals'], 'pinMap': profile['padPinMap'], 'pinMapSourcePath': geom['pinMapSourcePath'],
                      'sourceBodyOriginMm': list(geom['center']), 'sourceAngleDegrees': angle, 'nativeCadAngleDegrees': native_angle,
                      'translationNativeUnits': [cx-float(_number(part, 'Roi/cx')), cy-float(_number(part, 'Roi/cy'))],
                      'originOffsetPreserved': False, 'storedCenterPolicy': 'new-unlearned-zero-sentinel',
                      'nativeCadTargetId': _text(cad, 'ID'), 'nativeFrameControlCount': len(controls), 'nativeFrameControls': [c[0] for c in controls],
                      'nativeLengthUnit': 'source-mm-to-native-literal-1:1-supported-by-CAD-controls-runtime-unverified',
                      'nativeModelRoiPolicy': 'new-placement-body-center-structural-reference-runtime-unverified',
                      'nativeWindowFrame': 'pattern-axes-relative-to-body-clockwise-native-angle-hypothesis-unverified', 'modelNoPolicy': 'new-unlearned-zero'},
            'prepared': 'disabled-placement-new-local-model-manufacturer-body-owned-terminal-reference-windows',
            'remaining': ['native-length-origin-rotation-window-frame-Eagle-qualification-required', 'manufacturer-profile-match-input-review-required',
                          'native-window-properties-and-model-metadata-qualification-required', 'pad-binding-unresolved-native-WND_PAD-semantics-unqualified',
                          'terminal-land-reference-is-not-taught-lead-or-solder-inspection', 'image-algorithms-not-prepared', 'FOV-assignment-required',
                          'population-side-stage-decision-required', 'Eagle-open-save-reopen-unverified', 'physical-inspection-unverified'],
            'qualificationOnly': True, 'machineExportAllowed': False}
    if polarized:
        result['basis'].update(bodyAnchorEvidence=geom['anchor'], polarityEvidence=geom['polarity'],
                               cathodeDirectionPatternAxes=geom['axis'],
                               cathodeDirectionNativeBoardAxes=[geom['axis'][0]*math.cos(radians)-geom['axis'][1]*math.sin(radians),
                                                                geom['axis'][0]*math.sin(radians)+geom['axis'][1]*math.cos(radians)],
                               nativePolaritySetting='unlearned-zero-sentinel-runtime-unverified')
        result['remaining'].extend(['cathode-mark-image-teaching-required', 'native-polarity-position-and-teaching-frame-unverified'])
        if any(r.get('terminalRole') == 'no-connection' for r in roles):
            result['remaining'].append('no-connection-is-a-physical-lead-review-solder-inspection-not-an-exclusion')
    return result
