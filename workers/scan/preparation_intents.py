"""Read-only owned-pad work plans; never native binding/FOV assignments.

The fresh constructor's exact local windows can be linked to owned numbered
source lands offline. Native artwork IDs, binding tuple fields and FOV/image
membership remain separate unqualified contracts.
"""
from hashlib import sha256
import json
import math
from xml.etree import ElementTree as ET

from .accel_ascii import read_accel
from .disabled_draft import _number, _text
from .qualification_candidate import _xml, _fail

CONTRACTS = [
    {'id': 'native-artwork-correspondence', 'owner': 'Eagle evidence', 'required': 'One controlled owned source land to native GerberPad ID/BlockID, shape, angle, units and layer correspondence; segmented paste apertures remain distinct.'},
    {'id': 'binding-serialization', 'owner': 'Eagle evidence', 'required': 'Before/after one manual pad binding: WND_PAD positions 3/4, window GroupID, individual ListGerPadId suffix and common ListGerbPadIdList scope. Literal closure alone is insufficient.'},
    {'id': 'fov-membership', 'owner': 'Eagle evidence', 'required': 'Before/after one FOV assignment: FovList, SubFovNum, FovOPT, FovSetInfo/Fov; prove ID/index meaning, image origin/pitch/extent, module transforms, margin and multi-FOV coverage.'},
    {'id': 'teaching-position-retention', 'owner': 'Eagle evidence', 'required': 'Separate bind, FOV and teach saves/reopens; compare placement ROI, CAD, angle, CenterPos, Master CadOffset, dependent-window geometry and module transforms. Keep disabled and job-local.'},
]


def preparation_intents(job, master, pcb, items, applied=False):
    """Rebuild intent from exact proposal records and immutable owned geometry.

    Applied mode additionally requires the actual candidate records to match.
    Unapplied plans are explicitly prospective, never completed preparation.
    """
    _xml(job); _xml(master)
    if not isinstance(items, list) or len(items) > 1000:
        _fail('PREPARATION_INTENT_LIMIT', 'Too many preparation records for an intent plan.')
    j, m = ET.fromstring(job), ET.fromstring(master)
    layout = read_accel(pcb)
    rows, seen = [], set()
    for item in items:
        if item.get('status') != 'ready-for-review': continue
        d, basis = item['dependencies'], item['basis']
        scope = (d['moduleId'], item['reference'])
        if scope in seen:
            _fail('PREPARATION_INTENT_IDENTITY', 'Intent scopes must be unique.')
        seen.add(scope)
        source = [p for p in layout['placements'] if p['sourcePath'] == item['selection']['targetSourcePath'] and p['refdes'] == item['reference']]
        if len(source) != 1 or source[0]['identityHolds']:
            _fail('PREPARATION_INTENT_IDENTITY', 'Fresh unique owned source identity is required.')
        src = source[0]
        appended = [ET.fromstring(c['afterXml']) for c in item['changes']]
        parts = [n for n in appended if n.tag == 'PartData' and n.findtext('ID') == d['partId']]
        models = [n for n in appended if n.tag == 'PartData' and n.findtext('MasterKey') == d['masterKey'] and n not in parts]
        windows = [n for n in appended if n.tag == 'WindowData']
        if len(parts) != 1 or len(models) != 1 or len(windows) != len(d['windowIds']):
            _fail('PREPARATION_INTENT_IDENTITY', 'Exact placement, local Master and window proposal records must close.')
        part = parts[0]
        if (part.findtext('RefID'), part.findtext('ParentId'), part.findtext('MasterKey')) != (item['reference'], *[d[k] for k in ('moduleId', 'masterKey')]):
            _fail('PREPARATION_INTENT_IDENTITY', 'Placement identity differs from its intent scope.')
        if applied:
            for root, nodes, key in [(j, parts, 'ID'), (m, models, 'MasterKey'), (m, windows, 'ID')]:
                for node in nodes:
                    candidates = [n for n in root.findall('WindowDataList/WindowData' if node.tag == 'WindowData' else 'PartDataList/PartData') if n.findtext(key) == node.findtext(key) and (node.tag != 'WindowData' or n.findtext('ParentId') == d['masterKey'])]
                    if len(candidates) != 1:
                        _fail('PREPARATION_INTENT_IDENTITY', 'Actual candidate identity is missing or ambiguous.')
                    actual = ET.fromstring(ET.tostring(candidates[0])); actual.tail = None
                    if ET.tostring(actual) != ET.tostring(node):
                        _fail('PREPARATION_INTENT_STALE', 'Actual candidate record differs from the exact reviewed preparation.')
        constructed = d['windowPreparation'] == 'constructed-body-terminal-geometry'
        roles, terminals = [], []
        pads = {p['padSourcePath']: p for layer in src['explicitLayerGeometry'] for p in layer['pads']}
        for role in d.get('windowRoles', [{'windowId':wid,'role':'preserved-template-window'} for wid in d['windowIds']]):
            w = next((w for w in windows if w.findtext('ID') == role['windowId']), None)
            if w is None or w.findtext('ParentId') != d['masterKey']:
                _fail('PREPARATION_INTENT_IDENTITY', 'Window is outside the new local Master.')
            r = {'windowId': role['windowId'], 'groupId': w.findtext('GroupID'), 'role': role['role'],
                 'nativeBindingWritten': False, 'nativeArtworkId': None, 'bindingQualified': False}
            if constructed and role.get('padNumber') is not None:
                pad = pads.get(role['sourcePath'])
                if pad is None or str(pad['padNumber']) != role['padNumber'] or basis['pinMap'].get(role['padNumber']) != role['pin']:
                    _fail('PREPARATION_INTENT_OWNERSHIP', 'Terminal window must close on its exact owned numbered land and mapped pin.')
                x, y = _number(w, 'RelRoi/cx'), _number(w, 'RelRoi/cy')
                ox, oy = basis['sourceBodyOriginMm']
                pw, ph = (pad['heightMm'], pad['widthMm']) if pad['localRotationDegrees'] % 180 else (pad['widthMm'], pad['heightMm'])
                if any(abs(a-b) > 1e-7 for a,b in zip((x+ox,y+oy,_number(w,'RelRoi/w'),_number(w,'RelRoi/h')), (pad['local']['xMm'],pad['local']['yMm'],pw,ph))):
                    _fail('PREPARATION_INTENT_GEOMETRY', 'Window no longer represents its owned source land in the recorded body frame.')
                r.update(padNumber=role['padNumber'], pin=role['pin'], sourcePath=role['sourcePath'],
                         layerNumber=next(layer['layerNumber'] for layer in src['explicitLayerGeometry'] if any(p is pad for p in layer['pads'])), sourceOwnership='exact-pattern-pad-path-number-pin-map',
                         terminalRole=role.get('terminalRole', 'nonpolar-terminal'), opticalAccess=role.get('opticalAccess', 'unverified'),
                         localLandGeometryMm={'cx':x,'cy':y,'w':pw,'h':ph},
                         bindingIntent='source-owned-correspondence-prepared-native-artwork-and-tuple-contract-held')
                terminals.append(r)
            else:
                r['bindingIntent'] = 'body-reference-no-pad-binding' if constructed else 'template-window-source-pad-correspondence-unestablished'
            roles.append(r)
        a = math.radians(basis.get('sourceAngleDegrees', -_number(part,'Roi/a')))
        c,s = math.cos(a),math.sin(a)
        extents = []
        for w in windows:
            x,y,ww,hh = [_number(w,'RelRoi/'+k) for k in ('cx','cy','w','h')]
            # A taught/template window may have its own angle. Keep that local
            # transform separate from the placement's hypothesized frame.
            wa=math.radians(-_number(w,'RelRoi/a'));wc,ws=math.cos(wa),math.sin(wa)
            corners=[]
            for dx,dy in [(-ww/2,-hh/2),(ww/2,-hh/2),(ww/2,hh/2),(-ww/2,hh/2)]:
                lx,ly=x+dx*wc-dy*ws,y+dx*ws+dy*wc
                corners.append([_number(part,'Roi/cx')+lx*c-ly*s,_number(part,'Roi/cy')+lx*s+ly*c])
            extents.append({'windowId':w.findtext('ID'),'cornersNativeFrameHypothesis':corners,'runtimeFrameQualified':False})
        rows.append({'reference':item['reference'],'moduleId':d['moduleId'],'partId':d['partId'],'masterKey':d['masterKey'],
                     'proposalDigest':item['digest'],'recordsApplied':applied,'windowPreparation':d['windowPreparation'],
                     'ownedTerminalBindingIntents':terminals,'windows':roles,
                     'unrepresentedSourceLands':d.get('unrepresentedSourceLands',[]),'thermalPads':d.get('thermalPads',[]),
                     'omittedWindows':d.get('omittedWindows',[]),
                     'fovPreparation':{'windowCoverageExtentsPreparedOffline':True,'extents':extents,
                         'nativeAssignmentWritten':False,'qualifiedFovIds':[],'assignmentStatus':'image-frame-and-membership-contract-held'},
                     'nativeBindingsWritten':0,'nativeFovAssignmentsWritten':0,'enabled':False,'taught':False})
    fov = j.findall('FovSetInfo/Fov')
    infos = j.findall('FovSetInfo/Fov/FovInfo')
    result = {'artifactType':'scan.native-preparation-intents','schemaVersion':'1','status':'prepared-offline-intents',
        'source':{'jobSha256':sha256(job).hexdigest(),'masterSha256':sha256(master).hexdigest(),'layoutSha256':sha256(pcb).hexdigest()},
        'recordsApplied':applied,'components':rows,'sharedContracts':CONTRACTS,
        'nativeFovInventory':{'serializedFovContainers':len(fov),'childFieldNames':sorted({n.tag for node in fov for n in node}),
            'fovInfoRecords':len(infos),'fovInfoFieldNames':sorted({n.tag for node in infos for n in node}),
            'observedFovIdentities':[{'ordinal':i,'idLiterals':[n.text or '' for n in node.findall('Id')],
                'pathIdLiterals':[n.text or '' for n in node.findall('PathId')],
                'meaningQualified':False} for i,node in enumerate(infos,1)],
            'payloadSha256':[sha256(ET.tostring(node)).hexdigest() for node in fov],
            'coordinateAndImageSemanticsQualified':False,'coverageAssignmentsProven':0},
        'counts':{'components':len(rows),'ownedTerminalBindingIntents':sum(len(r['ownedTerminalBindingIntents']) for r in rows),
            'newNativeBindings':0,'newNativeFovAssignments':0},'nativeEditsApplied':False,'machineExportAllowed':False}
    if len(json.dumps(result,allow_nan=False).encode()) > 2_000_000:
        _fail('PREPARATION_INTENT_LIMIT','Intent plan exceeds its bounded output size.')
    return result
