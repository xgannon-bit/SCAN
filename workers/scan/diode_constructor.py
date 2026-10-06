"""Polarized two-terminal geometry from explicit reviewed evidence, never names.

An unequal pair of lands does not define a package body center. The numbered
footprint datum and electrical roles are separate required, source-bound inputs.
Native polarity teaching and pad-binding semantics remain unqualified.
"""
from hashlib import sha256
import math
import re

from .qualification_candidate import _fail

KIND = 'polarized-two-terminal-body-v1'


def _dimensions(value, fields, positive=()):
    if not isinstance(value, dict) or set(value) != set(fields) or any(
            type(n) not in (int, float) or not math.isfinite(n) or abs(n) > 1000 for n in value.values()) or any(value[k] <= 0 for k in positive):
        _fail('PACKAGE_GEOMETRY', 'Finite bounded diode drawing dimensions are required.')


def _evidence(e):
    keys = {'documentId', 'sha256', 'page', 'locator', 'statement', 'layoutSha256', 'method'}
    if not isinstance(e, dict) or set(e) != keys or e['method'] not in {
            'numbered-footprint', 'component-library', 'dimensioned-assembly', 'manufacturer-package-correspondence'}:
        _fail('PACKAGE_DIODE_EVIDENCE', 'Use an explicit numbered footprint/library or dimensioned package correspondence; names and appearance are not evidence.')
    if any(not isinstance(e[k], str) or not 0 < len(e[k]) <= 4096 or '\0' in e[k] for k in ('documentId', 'locator', 'statement')) or any(
            not re.fullmatch('[a-f0-9]{64}', str(e[k])) for k in ('sha256', 'layoutSha256')) or type(e['page']) is not int or not 1 <= e['page'] <= 100:
        _fail('PACKAGE_DIODE_EVIDENCE', 'Bounded document/hash/page/locator and source-layout identity are required.')


def validate_profile(p):
    from .paired_terminal_constructor import validate_profiles, KIND as LEGACY
    common = {'id', 'kind', 'patternRef', 'graphicsRef', 'compRef', 'attachedPatternName', 'nativePartNames',
              'drawing', 'body', 'padPinMap', 'seedPartId', 'seedMasterKey', 'bodyWindowId', 'terminalWindowId'}
    if set(p) != common | {'anchor', 'polarity', 'electrodes'}:
        _fail('PACKAGE_PROFILE', 'Unknown or incomplete diode constructor profile.')
    _dimensions(p['body'], ('widthMm', 'heightMm'), ('widthMm', 'heightMm'))
    # Preserve the existing route's validation and serialized profiles unchanged.
    legacy = {k: p[k] for k in common}
    legacy.update(kind=LEGACY, body={**p['body'], 'offsetAlongMm': 0, 'offsetAcrossMm': 0},
                  electrode={'widthMm': 1, 'heightMm': 1, 'centerSeparationMm': 1, 'minimumOverlapFraction': .5})
    validate_profiles([legacy])
    if p['anchor'] is not None:
        a = p['anchor']
        if not isinstance(a, dict) or set(a) != {'padNumber', 'offsetAlongMm', 'offsetAcrossMm', 'evidence'} or not isinstance(a['padNumber'], str) or a['padNumber'] not in p['padPinMap']:
            _fail('PACKAGE_DIODE_ANCHOR', 'The body datum must name one mapped source pad.')
        _dimensions({k: a[k] for k in ('offsetAlongMm', 'offsetAcrossMm')}, ('offsetAlongMm', 'offsetAcrossMm'))
        _evidence(a['evidence'])
    if p['polarity'] is not None:
        q = p['polarity']
        if not isinstance(q, dict) or set(q) != {'pinRoles', 'evidence'} or not isinstance(q['pinRoles'], dict) or set(q['pinRoles']) != set(p['padPinMap'].values()) or sorted(q['pinRoles'].values()) != ['anode', 'cathode']:
            _fail('PACKAGE_DIODE_POLARITY', 'Explicit distinct anode/cathode roles must close on the linked source pins.')
        _evidence(q['evidence'])
    if p['electrodes'] is not None:
        es = p['electrodes']
        if not isinstance(es, list) or len(es) != 2 or any(not isinstance(e, dict) or e.get('role') not in {'anode', 'cathode'} for e in es) or {e['role'] for e in es} != {'anode', 'cathode'}:
            _fail('PACKAGE_DIODE_ELECTRODES', 'Two separately dimensioned manufacturer terminal roles are required.')
        fields = {'widthMm', 'heightMm', 'centerAlongMm', 'centerAcrossMm', 'minimumOverlapFraction'}
        for e in es:
            if set(e) != fields | {'role'}:
                _fail('PACKAGE_DIODE_ELECTRODES', 'Unknown terminal geometry fields.')
            _dimensions({k: e[k] for k in fields}, fields, ('widthMm', 'heightMm'))
            if not .5 <= e['minimumOverlapFraction'] <= 1:
                _fail('PACKAGE_DIODE_ELECTRODES', 'Conservative manufacturer electrode overlap is required.')
        anode = next(e for e in es if e['role'] == 'anode')
        cathode = next(e for e in es if e['role'] == 'cathode')
        if cathode['centerAlongMm'] <= anode['centerAlongMm']:
            _fail('PACKAGE_DIODE_POLARITY', 'Drawing axes must run from anode to cathode.')


def source_geometry(target, profile, pcb):
    from .paired_terminal_constructor import pin_mapping
    missing = [name for name in ('anchor', 'polarity', 'electrodes') if profile[name] is None]
    if missing:
        _fail('PACKAGE_DIODE_EVIDENCE_MISSING', 'Missing diode evidence: ' + ', '.join(missing) +
              '. Supply a numbered footprint body-center datum and pad-to-anode/cathode assignment matched to the manufacturer drawing; no midpoint or polarity guess is permitted.')
    for e in (profile['anchor']['evidence'], profile['polarity']['evidence']):
        if e['layoutSha256'] != sha256(pcb).hexdigest():
            _fail('PACKAGE_DIODE_EVIDENCE_STALE', 'Diode body/polarity evidence belongs to a different source layout.')
    if target['identityHolds'] or not target['ownedPadCentersAvailable'] or target['mountingEvidence'] != 'explicit-zero-holes':
        _fail('PACKAGE_SOURCE', 'Unique unflipped zero-hole owned pad geometry is required.')
    layers = target['explicitLayerGeometry']
    if len(layers) != 1 or str(layers[0]['layerNumber']) != '1' or len(layers[0]['pads']) != 2:
        _fail('PACKAGE_LAYER', 'Exactly two explicit top-layer diode lands are supported.')
    pads = sorted(layers[0]['pads'], key=lambda p: str(p['padNumber']))
    mapping, path = pin_mapping(pcb, target, profile)
    if mapping != profile['padPinMap'] or set(mapping) != {str(p['padNumber']) for p in pads}:
        _fail('PACKAGE_PIN_MAP', 'Fresh owned pad identities and linked diode pins differ from the reviewed profile.')
    if any(p['shape'] != 'Rect' or p['localRotationDegrees'] % 90 for p in pads):
        _fail('PACKAGE_PAD_SHAPE', 'Explicit cardinal rectangular diode lands are required.')
    roles = profile['polarity']['pinRoles']
    by_role = {roles[mapping[str(p['padNumber'])]]: p for p in pads}
    ap, kp = by_role['anode']['local'], by_role['cathode']['local']
    dx, dy = kp['xMm']-ap['xMm'], kp['yMm']-ap['yMm']
    separation = math.hypot(dx, dy)
    if separation <= 0 or min(abs(dx), abs(dy)) > 1e-6:
        _fail('PACKAGE_AXIS', 'Distinct cardinal diode terminal centers are required.')
    ux, uy = dx/separation, dy/separation
    vx, vy = -uy, ux
    datum = next(p['local'] for p in pads if str(p['padNumber']) == profile['anchor']['padNumber'])
    a = profile['anchor']
    center = (datum['xMm']+ux*a['offsetAlongMm']+vx*a['offsetAcrossMm'],
              datum['yMm']+uy*a['offsetAlongMm']+vy*a['offsetAcrossMm'])
    terminals = []
    for p in pads:
        role = roles[mapping[str(p['padNumber'])]]
        e = next(e for e in profile['electrodes'] if e['role'] == role)
        w, h = (p['widthMm'], p['heightMm']) if p['localRotationDegrees'] % 180 == 0 else (p['heightMm'], p['widthMm'])
        along, across = (w, h) if abs(ux) > .5 else (h, w)
        x, y = p['local']['xMm']-center[0], p['local']['yMm']-center[1]
        lc, ac = x*ux+y*uy, x*vx+y*vy
        oa = max(0, min(lc+along/2, e['centerAlongMm']+e['heightMm']/2)-max(lc-along/2, e['centerAlongMm']-e['heightMm']/2))
        ob = max(0, min(ac+across/2, e['centerAcrossMm']+e['widthMm']/2)-max(ac-across/2, e['centerAcrossMm']-e['widthMm']/2))
        fraction = oa*ob/(e['widthMm']*e['heightMm'])
        if fraction + 1e-8 < e['minimumOverlapFraction']:
            _fail('PACKAGE_DRAWING_LAND_MISMATCH', 'Owned diode land does not overlap its explicitly assigned manufacturer terminal; check body datum and polarity.')
        terminals.append({'padNumber': str(p['padNumber']), 'pin': mapping[str(p['padNumber'])], 'terminalRole': role,
                          'cx': x, 'cy': y, 'w': w, 'h': h, 'a': 0, 'sourcePath': p['padSourcePath'], 'electrodeOverlapFraction': fraction})
    body = profile['body']
    bw, bh = (body['heightMm'], body['widthMm']) if abs(ux) > .5 else (body['widthMm'], body['heightMm'])
    return {'center': center, 'bodyWidth': bw, 'bodyHeight': bh, 'terminals': terminals,
            'pinMapSourcePath': path, 'axis': [ux, uy], 'polarity': profile['polarity'], 'anchor': profile['anchor']}
