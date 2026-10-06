"""Three physical terminals from numbered package evidence and an owned body datum.

Electrical NC remains a physical terminal. Reviewed graphics paths designate a
body rectangle; names, bounding boxes and nearest lands never establish it.
"""
from collections import Counter
from hashlib import sha256
import math
import re

from .accel_ascii import _parse, AccelLimits, _quantity, _FACTORS
from .diode_constructor import _evidence, _dimensions
from .qualification_candidate import _fail

KIND = 'polarized-three-terminal-body-v1'


def validate_profile(p):
    from .paired_terminal_constructor import validate_profiles, KIND as LEGACY
    common = {'id', 'kind', 'patternRef', 'graphicsRef', 'compRef', 'attachedPatternName', 'nativePartNames',
              'drawing', 'body', 'padPinMap', 'seedPartId', 'seedMasterKey', 'bodyWindowId', 'terminalWindowId'}
    if set(p) != common | {'anchor', 'polarity', 'electrodes', 'packageRotationDegrees'}:
        _fail('PACKAGE_PROFILE', 'Unknown or incomplete three-terminal profile.')
    body = p['body']
    fields = ('widthMm', 'heightMm', 'minWidthMm', 'maxWidthMm', 'minHeightMm', 'maxHeightMm')
    _dimensions(body, fields, fields)
    if not body['minWidthMm'] <= body['widthMm'] <= body['maxWidthMm'] or not body['minHeightMm'] <= body['heightMm'] <= body['maxHeightMm']:
        _fail('PACKAGE_GEOMETRY', 'Manufacturer body bounds must contain nominal dimensions.')
    mapping = p['padPinMap']
    if not isinstance(mapping, dict) or len(mapping) != 3 or len(set(mapping.values())) != 3 or any(
            not isinstance(n, str) or not re.fullmatch('[1-9][0-9]{0,3}', n) for n in [*mapping, *mapping.values()]):
        _fail('PACKAGE_PIN_MAP', 'Exactly three distinct numeric pad and physical pin identities are required.')
    # Reuse literal/drawing/schema-seed validation without modifying legacy data.
    legacy = {k: p[k] for k in common}
    legacy.update(kind=LEGACY, body={'widthMm': body['widthMm'], 'heightMm': body['heightMm'], 'offsetAlongMm': 0, 'offsetAcrossMm': 0},
                  electrode={'widthMm': 1, 'heightMm': 1, 'centerSeparationMm': 1, 'minimumOverlapFraction': .5},
                  padPinMap=dict(list(mapping.items())[:2]))
    validate_profiles([legacy])
    if type(p['packageRotationDegrees']) not in (int, float) or p['packageRotationDegrees'] not in (0, 90, 180, 270):
        _fail('PACKAGE_ORIENTATION', 'A cardinal numbered drawing-to-pattern rotation is required; mirroring is unsupported.')
    anchor = p['anchor']
    if not isinstance(anchor, dict) or set(anchor) != {'layerNumber', 'linePaths', 'evidence'} or not isinstance(anchor['layerNumber'], str) or not re.fullmatch('[1-9][0-9]{0,3}', anchor['layerNumber']) or not isinstance(anchor['linePaths'], list) or len(anchor['linePaths']) != 4 or len(set(anchor['linePaths'])) != 4 or any(not isinstance(n, str) or not n.startswith('/') or len(n) > 4096 for n in anchor['linePaths']):
        _fail('PACKAGE_BODY_DATUM', 'Four distinct reviewed owned body-rectangle paths and an explicit layer are required.')
    _evidence(anchor['evidence'])
    polarity = p['polarity']
    if not isinstance(polarity, dict) or set(polarity) != {'pinRoles', 'evidence'} or not isinstance(polarity['pinRoles'], dict) or set(polarity['pinRoles']) != set(mapping.values()) or sorted(polarity['pinRoles'].values()) != ['anode', 'cathode', 'no-connection']:
        _fail('PACKAGE_PHYSICAL_ROLES', 'Three explicit physical pins must include distinct anode, cathode and no-connection roles.')
    _evidence(polarity['evidence'])
    electrodes = p['electrodes']
    if not isinstance(electrodes, list) or len(electrodes) != 3 or any(not isinstance(e, dict) for e in electrodes) or {e.get('pin') for e in electrodes} != set(mapping.values()):
        _fail('PACKAGE_PHYSICAL_ROLES', 'Drawing geometry must include every physical pin, including no connection.')
    for e in electrodes:
        fields = {'centerXmm', 'centerYmm', 'widthMm', 'heightMm', 'minimumOverlapFraction'}
        if set(e) != fields | {'pin'}:
            _fail('PACKAGE_GEOMETRY', 'Unknown manufacturer terminal geometry fields.')
        _dimensions({k: e[k] for k in fields}, fields, ('widthMm', 'heightMm'))
        if not .5 <= e['minimumOverlapFraction'] <= 1:
            _fail('PACKAGE_GEOMETRY', 'Conservative physical-electrode overlap is required.')


def source_geometry(target, profile, pcb, count=3, physical_pins=None):
    from .paired_terminal_constructor import pin_mapping
    if any(e['layoutSha256'] != sha256(pcb).hexdigest() for e in (profile['anchor']['evidence'], profile['polarity']['evidence'])):
        _fail('PACKAGE_EVIDENCE_STALE', 'Body and physical-pin evidence must identify this exact layout.')
    if target['identityHolds'] or not target['ownedPadCentersAvailable'] or target['mountingEvidence'] != 'explicit-zero-holes':
        _fail('PACKAGE_SOURCE', 'Unique unflipped zero-hole owned pad geometry is required.')
    layers = target['explicitLayerGeometry']
    if len(layers) != 1 or str(layers[0]['layerNumber']) != '1' or len(layers[0]['pads']) != count:
        _fail('PACKAGE_LAYER', 'The exact reviewed count of explicit top-layer owned lands is required.')
    pads = sorted(layers[0]['pads'], key=lambda p: str(p['padNumber']))
    mapping, path = pin_mapping(pcb, target, profile, count=count)
    if mapping != profile['padPinMap'] or set(mapping) != {str(p['padNumber']) for p in pads}:
        _fail('PACKAGE_PIN_MAP', 'Fresh owned pad/pin mapping differs from the numbered package evidence.')
    if any(p['shape'] != 'Rect' or p['localRotationDegrees'] % 90 for p in pads):
        _fail('PACKAGE_PAD_SHAPE', 'Cardinal rectangular owned physical lands are required.')
    ast, _ = _parse(pcb.decode('latin-1'), AccelLimits(), Counter())
    nodes = {}
    def visit(n):
        nodes[n.path] = n
        for c in n.children: visit(c)
    visit(ast)
    header = ast.all('asciiHeader')
    units = header[0].all('fileUnits') if len(header) == 1 else []
    factor = _FACTORS.get(units[0].args[0].lower()) if len(units) == 1 and len(units[0].args) == 1 else None
    if factor is None:
        _fail('PACKAGE_BODY_DATUM', 'Explicit source units are required for body graphics.')
    owners = {p['patternSourcePath'] for p in target['sourceOwnedPads']}
    if len(owners) != 1:
        _fail('PACKAGE_BODY_DATUM', 'All terminal and body geometry must have one pattern owner.')
    owner = next(iter(owners))
    definition = nodes.get(owner)
    graphics = [n for n in definition.all('patternGraphicsDef') if len(n.all('patternGraphicsNameDef')) == 1 and n.all('patternGraphicsNameDef')[0].args == [profile['graphicsRef']]] if definition else []
    if len(graphics) != 1:
        _fail('PACKAGE_BODY_DATUM', 'Exact selected graphics variant must own the body datum.')
    selected = []
    for layer in graphics[0].all('layerContents'):
        if len(layer.all('layerNumRef')) == 1 and layer.all('layerNumRef')[0].args == [profile['anchor']['layerNumber']]:
            selected.extend(layer.all('line'))
    lines = [nodes.get(path) for path in profile['anchor']['linePaths']]
    if any(n is None or not any(n is s for s in selected) or len(n.all('pt')) != 2 for n in lines):
        _fail('PACKAGE_BODY_DATUM', 'Reviewed lines must be owned by the selected pattern graphics and layer.')
    vertices, edges = Counter(), []
    for line in lines:
        pts = []
        for n in line.all('pt'):
            holds = []
            if len(n.args) != 2:
                _fail('PACKAGE_BODY_DATUM', 'Explicit two-dimensional body vertices are required.')
            pt = tuple(_quantity(v, holds, n.path, factor) for v in n.args)
            if holds or any(v is None for v in pt):
                _fail('PACKAGE_BODY_DATUM', 'Unsupported body graphic units.')
            pts.append(tuple(float(v) for v in pt))
        a, b = pts
        if a == b or (a[0] != b[0] and a[1] != b[1]):
            _fail('PACKAGE_BODY_DATUM', 'A nondegenerate cardinal body rectangle is required.')
        vertices.update(pts); edges.append(frozenset(pts))
    xs, ys = sorted({x for x, y in vertices}), sorted({y for x, y in vertices})
    if len(vertices) != 4 or set(vertices.values()) != {2} or len(set(edges)) != 4 or len(xs) != 2 or len(ys) != 2:
        _fail('PACKAGE_BODY_DATUM', 'Four unique connected edges must close an exact rectangle, without markings.')
    center = ((xs[0]+xs[1])/2, (ys[0]+ys[1])/2)
    bw, bh = xs[1]-xs[0], ys[1]-ys[0]
    quarter = profile['packageRotationDegrees'] % 180 != 0
    body = profile['body']
    dw, dh = (body['heightMm'], body['widthMm']) if quarter else (body['widthMm'], body['heightMm'])
    bounds = (body['minHeightMm'],body['maxHeightMm'],body['minWidthMm'],body['maxWidthMm']) if quarter else (body['minWidthMm'],body['maxWidthMm'],body['minHeightMm'],body['maxHeightMm'])
    if not bounds[0]-1e-8 <= bw <= bounds[1]+1e-8 or not bounds[2]-1e-8 <= bh <= bounds[3]+1e-8:
        _fail('PACKAGE_BODY_DRAWING_MISMATCH', 'Owned body rectangle must fit the matched manufacturer body bounds; clearance and marking rectangles are not bodies.')
    angle = math.radians(profile['packageRotationDegrees']); c,s = math.cos(angle), math.sin(angle)
    terminals = []
    for pad in pads:
        pin = mapping[str(pad['padNumber'])]
        if physical_pins is not None and pin not in physical_pins:
            continue
        e = next(e for e in profile['electrodes'] if e['pin'] == pin)
        ex,ey = e['centerXmm']*c-e['centerYmm']*s, e['centerXmm']*s+e['centerYmm']*c
        ew,eh = (e['heightMm'],e['widthMm']) if quarter else (e['widthMm'],e['heightMm'])
        w,h = (pad['heightMm'],pad['widthMm']) if pad['localRotationDegrees']%180 else (pad['widthMm'],pad['heightMm'])
        x,y = pad['local']['xMm']-center[0],pad['local']['yMm']-center[1]
        overlap = max(0,min(x+w/2,ex+ew/2)-max(x-w/2,ex-ew/2))*max(0,min(y+h/2,ey+eh/2)-max(y-h/2,ey-eh/2))/(ew*eh)
        if overlap+1e-8 < e['minimumOverlapFraction']:
            _fail('PACKAGE_DRAWING_LAND_MISMATCH', 'Numbered manufacturer physical lead fails owned-land overlap: check anchor, rotation and pin mapping; no mirror guess.')
        terminals.append({'padNumber':str(pad['padNumber']),'pin':pin,'terminalRole':profile['polarity']['pinRoles'][pin],
                          'cx':x,'cy':y,'w':w,'h':h,'a':0,'sourcePath':pad['padSourcePath'],'electrodeOverlapFraction':overlap})
    a = next(t for t in terminals if t['terminalRole']=='anode'); k = next(t for t in terminals if t['terminalRole']=='cathode')
    length=math.hypot(k['cx']-a['cx'],k['cy']-a['cy'])
    if length <= 0:
        _fail('PACKAGE_PHYSICAL_ROLES', 'Distinct anode/cathode physical lands are required.')
    return {'center':center,'bodyWidth':dw,'bodyHeight':dh,'terminals':terminals,'pinMapSourcePath':path,
            'axis':[(k['cx']-a['cx'])/length,(k['cy']-a['cy'])/length], 'anchor':profile['anchor'],'polarity':profile['polarity']}
