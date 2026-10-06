"""Numbered external-terminal geometry with separately accounted underside pads.

Geometry is never evidence of optical access. Hidden thermal pads receive no
native optical window or guessed binding; external joints remain unverified.
"""
from hashlib import sha256
import math
import re
from .diode_constructor import _evidence, _dimensions
from .qualification_candidate import _fail

KIND = 'numbered-external-terminal-thermal-body-v1'


def validate_profile(p):
    from .three_terminal_constructor import validate_profile as validate_three
    common = {'id','kind','patternRef','graphicsRef','compRef','attachedPatternName','nativePartNames','drawing','body','padPinMap','seedPartId','seedMasterKey','bodyWindowId','terminalWindowId','anchor','polarity','electrodes','packageRotationDegrees','pin1','thermalPads'}
    if set(p) != common:
        _fail('PACKAGE_PROFILE', 'Unknown or incomplete external-terminal/thermal-pad profile.')
    mapping=p['padPinMap']; q=p['polarity']; anchor=p['anchor']
    if not isinstance(mapping,dict) or not 4<=len(mapping)<=24 or any(not isinstance(n,str) or not re.fullmatch('[1-9][0-9]{0,3}',n) for n in [*mapping,*mapping.values()]) or len(set(mapping.values()))!=len(mapping):
        _fail('PACKAGE_PIN_MAP','Bounded distinct literal owned pad/component pin identities are required.')
    if not isinstance(q,dict) or set(q)!={'pinRoles','evidence'} or not isinstance(q['pinRoles'],dict) or set(q['pinRoles'])!=set(mapping.values()) or any(not isinstance(r,str) or r not in {'external-terminal','underside-thermal-pad'} for r in q['pinRoles'].values()):
        _fail('PACKAGE_THERMAL_ROLES','Every mapped pin needs an explicit external-terminal or underside-thermal-pad role.')
    external={n for n,r in q['pinRoles'].items() if r=='external-terminal'}; thermal=set(mapping.values())-external
    if len(external)<3 or not thermal:
        _fail('PACKAGE_THERMAL_ROLES','At least three external terminals and a separately evidenced underside pad are required.')
    es=p['electrodes']; ts=p['thermalPads']
    if not isinstance(es,list) or len(es)!=len(external) or any(not isinstance(e,dict) for e in es) or {e.get('pin') for e in es}!=external:
        _fail('PACKAGE_THERMAL_ROLES','Each external terminal and no thermal pad must have terminal electrode geometry.')
    if not isinstance(ts,list) or len(ts)!=len(thermal) or any(not isinstance(t,dict) for t in ts) or {t.get('pin') for t in ts}!=thermal:
        _fail('PACKAGE_THERMAL_EVIDENCE','Each underside pad needs separate manufacturer geometry and evidence.')
    fields={'centerXmm','centerYmm','widthMm','heightMm','minimumOverlapFraction'}
    for e in [*es,*ts]:
        expected=fields|{'pin'}|({'evidence'} if e in ts else set())
        if set(e)!=expected:
            _fail('PACKAGE_GEOMETRY','Unknown or incomplete terminal/thermal geometry fields.')
        _dimensions({k:e[k] for k in fields},fields,('widthMm','heightMm'))
        if not .5<=e['minimumOverlapFraction']<=1:
            _fail('PACKAGE_GEOMETRY','Conservative owned-land overlap is required.')
    for e in [q['evidence'],*[t['evidence'] for t in ts]]:_evidence(e)
    if not isinstance(anchor,dict) or set(anchor)!={'layerNumber','linePaths','edgeCount','evidence'} or type(anchor['edgeCount']) is not int or anchor['edgeCount'] not in {3,4} or not isinstance(anchor['linePaths'],list) or any(not isinstance(n,str) or not n.startswith('/') or len(n)>4096 for n in anchor['linePaths']) or len(anchor['linePaths'])!=anchor['edgeCount'] or len(set(anchor['linePaths']))!=anchor['edgeCount']:
        _fail('PACKAGE_BODY_DATUM','Three or four explicit manufacturer-matched body edge paths are required.')
    first=p['pin1']
    if not isinstance(first,dict) or set(first)!={'pin','evidence'} or first['pin']!='1' or first['pin'] not in external:
        _fail('PACKAGE_PIN1_EVIDENCE','External physical pin 1 needs numbered orientation evidence.')
    _evidence(first['evidence'])
    # A validation-only shim reuses bounded identities, dimensions and evidence.
    # Its dummy roles/path do not participate in source geometry or model writing.
    subset=sorted(external,key=int)[:3];a={k:v for k,v in anchor.items() if k!='edgeCount'}
    if len(a['linePaths'])==3:a={**a,'linePaths':[*a['linePaths'],'/validation-only-fourth-edge']}
    shim={k:v for k,v in p.items() if k not in {'pin1','thermalPads'}}
    shim.update(kind='polarized-three-terminal-body-v1',anchor=a,padPinMap={a:b for a,b in mapping.items() if b in subset},polarity={'pinRoles':dict(zip(subset,['anode','no-connection','cathode'])),'evidence':q['evidence']},electrodes=[e for e in es if e['pin'] in subset])
    validate_three(shim)


def source_geometry(target,profile,pcb):
    from .three_terminal_constructor import source_geometry as owned_geometry
    evidence=[profile['anchor']['evidence'],profile['polarity']['evidence'],profile['pin1']['evidence'],*[t['evidence'] for t in profile['thermalPads']]]
    if any(e['layoutSha256']!=sha256(pcb).hexdigest() or e['sha256']!=profile['drawing']['sha256'] for e in evidence):
        _fail('PACKAGE_EVIDENCE_STALE','Body, numbered pin 1 and thermal geometry must bind the exact layout and drawing.')
    # Check every physical terminal, including the underside pad, against its
    # owned land. Only external terminals will become native reference windows.
    both={**profile,'electrodes':profile['electrodes']+[{k:v for k,v in t.items() if k!='evidence'} for t in profile['thermalPads']]}
    geom=owned_geometry(target,both,pcb,count=len(profile['padPinMap']),body_edge_count=profile['anchor']['edgeCount'],polar_axis=False)
    external=sorted((t for t in geom['terminals'] if t['terminalRole']=='external-terminal'),key=lambda t:int(t['pin']))
    thermal=[t for t in geom['terminals'] if t['terminalRole']=='underside-thermal-pad']
    for t in thermal:
        if abs(t['cx'])+t['w']/2>geom['bodyWidth']/2+1e-8 or abs(t['cy'])+t['h']/2>geom['bodyHeight']/2+1e-8:
            _fail('PACKAGE_THERMAL_GEOMETRY','The owned underside thermal land must lie within the matched body.')
        if any(abs(t['cx']-e['cx'])<(t['w']+e['w'])/2 and abs(t['cy']-e['cy'])<(t['h']+e['h'])/2 for e in external):
            _fail('PACKAGE_THERMAL_GEOMETRY','Thermal and external lands must remain distinct, without overlapping ownership.')
        t.update(nativeWindowCreated=False,sourceGeometryPreserved=True,componentExcluded=False,opticallyInspectable=False,opticalAccess='underside-hidden-not-an-AOI-inspection',bindingPrepared=False,evidence=next(e['evidence'] for e in profile['thermalPads'] if e['pin']==t['pin']))
    for t in external:t.update(opticallyInspectable=None,opticalAccess='unverified-geometry-does-not-prove-joint-visibility')
    first=next(t for t in external if t['pin']=='1');length=math.hypot(first['cx'],first['cy'])
    if length<=0:_fail('PACKAGE_PIN1_EVIDENCE','Pin 1 needs a distinct direction from the body datum.')
    geom.update(terminals=external,thermalPads=thermal,pin1=profile['pin1'],pin1Direction=[first['cx']/length,first['cy']/length])
    return geom
