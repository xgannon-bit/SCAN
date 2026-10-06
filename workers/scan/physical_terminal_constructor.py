"""Numbered physical leads separate from extra owned footprint lands.

Every absent lead requires source-bound manufacturer evidence. An extra land is
retained in source accounting but never turned into a physical-lead window.
"""
from hashlib import sha256
import math
import re

from .diode_constructor import _evidence
from .qualification_candidate import _fail

KIND = 'numbered-physical-terminal-body-v1'
ROLES = {'anode', 'cathode', 'ground', 'output', 'supply', 'no-connection', 'no-physical-lead'}


def validate_profile(p):
    from .three_terminal_constructor import validate_profile as validate_three, KIND as THREE
    keys = {'id', 'kind', 'patternRef', 'graphicsRef', 'compRef', 'attachedPatternName', 'nativePartNames',
            'drawing', 'body', 'padPinMap', 'seedPartId', 'seedMasterKey', 'bodyWindowId', 'terminalWindowId',
            'anchor', 'polarity', 'electrodes', 'packageRotationDegrees', 'absenceEvidence', 'pin1'}
    if set(p) != keys:
        _fail('PACKAGE_PROFILE', 'Unknown or incomplete numbered physical-lead profile.')
    mapping = p['padPinMap']
    if not isinstance(mapping, dict) or not 4 <= len(mapping) <= 24 or len(set(mapping.values())) != len(mapping) or any(
            not isinstance(n, str) or not re.fullmatch('[1-9][0-9]{0,3}', n) for n in [*mapping, *mapping.values()]):
        _fail('PACKAGE_PIN_MAP', 'Four to 24 distinct literal footprint pad/component pin identities are required.')
    q = p['polarity']
    if not isinstance(q, dict) or set(q) != {'pinRoles', 'evidence'} or not isinstance(q['pinRoles'], dict) or set(q['pinRoles']) != set(mapping.values()) or any(not isinstance(r, str) or r not in ROLES for r in q['pinRoles'].values()):
        _fail('PACKAGE_PHYSICAL_ROLES', 'Every mapped pin needs an explicit physical or absent-lead role.')
    roles = q['pinRoles']; physical = {pin for pin,role in roles.items() if role != 'no-physical-lead'}
    absent = set(roles)-physical
    if len(physical) < 3 or not absent or list(roles.values()).count('anode') != 1 or list(roles.values()).count('cathode') != 1:
        _fail('PACKAGE_PHYSICAL_ROLES', 'This route requires at least three physical leads, explicit absent lead(s) and one anode/cathode pair.')
    es = p['electrodes']
    if not isinstance(es, list) or len(es) != len(physical) or any(not isinstance(e, dict) for e in es) or {e.get('pin') for e in es} != physical:
        _fail('PACKAGE_PHYSICAL_ROLES', 'Manufacturer electrode geometry must include every physical lead and no absent lead.')
    if not isinstance(p['absenceEvidence'], dict) or set(p['absenceEvidence']) != absent:
        _fail('PACKAGE_ABSENT_LEAD_EVIDENCE', 'Each source land without a physical lead needs explicit matched manufacturer evidence.')
    for e in [q['evidence'], *p['absenceEvidence'].values()]: _evidence(e)
    first = p['pin1']
    if not isinstance(first, dict) or set(first) != {'pin', 'evidence'} or first['pin'] != '1' or first['pin'] not in physical:
        _fail('PACKAGE_PIN1_EVIDENCE', 'The numbered package pin 1 must be an explicit physical pin with orientation evidence.')
    _evidence(first['evidence'])
    # Reuse all bounded identity/body/anchor/electrode checks, without changing
    # legacy profiles or using this validation shim as geometry evidence.
    subset = sorted(physical)[:3]
    shim = {k:v for k,v in p.items() if k not in {'absenceEvidence', 'pin1'}}
    shim.update(kind=THREE, padPinMap={a:b for a,b in mapping.items() if b in subset},
                polarity={'pinRoles':dict(zip(subset, ['anode', 'no-connection', 'cathode'])), 'evidence':q['evidence']},
                electrodes=[e for e in es if e['pin'] in subset])
    validate_three(shim)
    # The shim checked only its three electrodes; apply the same bounds to all.
    from .diode_constructor import _dimensions
    fields = {'centerXmm', 'centerYmm', 'widthMm', 'heightMm', 'minimumOverlapFraction'}
    for e in es:
        if set(e) != fields | {'pin'}:
            _fail('PACKAGE_GEOMETRY', 'Unknown physical electrode fields.')
        _dimensions({k:e[k] for k in fields}, fields, ('widthMm','heightMm'))
        if not .5 <= e['minimumOverlapFraction'] <= 1:
            _fail('PACKAGE_GEOMETRY', 'Conservative physical electrode overlap is required.')


def source_geometry(target, profile, pcb):
    from .three_terminal_constructor import source_geometry as owned_geometry
    evidence = [profile['anchor']['evidence'],profile['polarity']['evidence'],profile['pin1']['evidence'], *profile['absenceEvidence'].values()]
    if any(e['layoutSha256'] != sha256(pcb).hexdigest() or e['sha256'] != profile['drawing']['sha256'] for e in evidence):
        _fail('PACKAGE_EVIDENCE_STALE', 'Pin-1 and absent-lead evidence must bind the exact source layout and matched drawing.')
    physical = {pin for pin,role in profile['polarity']['pinRoles'].items() if role != 'no-physical-lead'}
    geom = owned_geometry(target, profile, pcb, count=len(profile['padPinMap']), physical_pins=physical)
    excluded = []
    for pad in target['explicitLayerGeometry'][0]['pads']:
        pin = profile['padPinMap'][str(pad['padNumber'])]
        if pin in physical: continue
        x,y = pad['local']['xMm']-geom['center'][0],pad['local']['yMm']-geom['center'][1]
        w,h = (pad['heightMm'],pad['widthMm']) if pad['localRotationDegrees']%180 else (pad['widthMm'],pad['heightMm'])
        if any(abs(x-t['cx']) < (w+t['w'])/2 and abs(y-t['cy']) < (h+t['h'])/2 for t in geom['terminals']):
            _fail('PACKAGE_ABSENT_LEAD_GEOMETRY', 'An absent-lead land must not overlap a mapped physical terminal land; clarify ownership or the package.')
        excluded.append({'padNumber':str(pad['padNumber']), 'pin':pin, 'sourcePath':pad['padSourcePath'],
                         'role':'no-physical-lead', 'nativeWindowCreated':False, 'sourceGeometryPreserved':True,
                         'componentExcluded':False, 'evidence':profile['absenceEvidence'][pin]})
    first = next(t for t in geom['terminals'] if t['pin'] == profile['pin1']['pin'])
    length = math.hypot(first['cx'],first['cy'])
    if length <= 0:
        _fail('PACKAGE_PIN1_EVIDENCE', 'Pin 1 must have a distinct direction from the established body center.')
    geom.update(unrepresentedSourceLands=excluded, pin1=profile['pin1'], pin1Direction=[first['cx']/length,first['cy']/length])
    return geom
