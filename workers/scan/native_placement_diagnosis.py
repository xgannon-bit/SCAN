"""Independent source-to-native ROI hypotheses for isolated offline qualification.

The frame is fitted from owned PCB footprint origins and original native CAD,
never from the ROI under diagnosis or a corrected archive. Native conventions
are explicit reviewed experimental inputs. Runtime propagation, binding,
acquisition coverage and physical correctness are deliberately not qualified.
"""
from collections import defaultdict
from copy import deepcopy
from hashlib import sha256
import json
import math
from pathlib import Path
import re
import warnings
from xml.etree import ElementTree as ET
import zipfile

from .accel_ascii import read_accel
from .bom_intake import normalize_bom
from .origin_evidence import body_evidence
from .paired_terminal_constructor import validate_profiles
from .placement_intake import IntakeError, MAX_BYTES, normalize, read_table
from .qualification_candidate import _xml
from .snapshot_capture import CaptureBlocked, _fresh_hash

VERSION = 'source-owned-native-placement-diagnosis-1'
SETTINGS = {'schemaVersion', 'module', 'sourceRevision', 'nativeRevision', 'bomRevision',
            'sourceSide', 'nativeSide', 'nativeUnits', 'nativeYDirection', 'nativeRotation',
            'nativeRoiAnchor', 'frameStatement', 'toleranceMm', 'toleranceBasis',
            'fitReferences', 'checkReferences', 'framesConfirmed'}
CONTEXT = {'schemaVersion', 'settings', 'source', 'placementConfig', 'bomConfig', 'packageProfiles'}
HOST_INPUT = {'layoutSource', 'placementSource', 'bomSource', 'layoutName', 'placementName', 'bomName'}
HASH = re.compile(r'[a-f0-9]{64}\Z')
NUMBER = re.compile(r'[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)\Z')


def digest(value):
    return sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True,
                             allow_nan=False).encode()).hexdigest()


def fail(code, message):
    raise CaptureBlocked(code, message)


def text(value, limit=512):
    return isinstance(value, str) and len(value) <= limit and '\0' not in value


def validate_settings(value):
    if not isinstance(value, dict) or set(value) != SETTINGS or value['schemaVersion'] != '1':
        fail('DIAGNOSIS_SETTINGS', 'Native diagnosis requires the exact versioned interpretation fields.')
    for key in ('module', 'sourceRevision', 'nativeRevision', 'bomRevision', 'toleranceMm'):
        if not text(value[key]):
            fail('DIAGNOSIS_SETTINGS', 'Native diagnosis interpretation text is invalid.')
    for key in ('frameStatement', 'toleranceBasis'):
        if not text(value[key], 4000):
            fail('DIAGNOSIS_SETTINGS', 'Native diagnosis evidence exceeds its bound.')
    for key, allowed in (('sourceSide', ('top', 'bottom', 'unknown')), ('nativeSide', ('top', 'bottom', 'unknown')),
                         ('nativeUnits', ('mm', 'mil', 'unknown')), ('nativeYDirection', ('up', 'down', 'unknown')),
                         ('nativeRotation', ('ccw', 'cw', 'unknown')),
                         ('nativeRoiAnchor', ('body-center', 'footprint-origin', 'unknown'))):
        if value[key] not in allowed:
            fail('DIAGNOSIS_SETTINGS', 'Native diagnosis uses an unsupported frame convention.')
    if type(value['framesConfirmed']) is not bool:
        fail('DIAGNOSIS_SETTINGS', 'Explicit frame review must be a boolean.')
    for key in ('fitReferences', 'checkReferences'):
        refs = value[key]
        if not isinstance(refs, list) or len(refs) > 32 or any(not text(r, 128) or not r.strip() for r in refs) or len(set(refs)) != len(refs):
            fail('DIAGNOSIS_SETTINGS', 'Fit and independent check reference selections are invalid.')
    return deepcopy(value)


def validate_context(value, *, require_digest=False):
    expected = CONTEXT | ({'diagnosisSha256'} if require_digest else set())
    if not isinstance(value, dict) or set(value) != expected or value['schemaVersion'] != '1' or len(json.dumps(value)) > 900000:
        fail('DIAGNOSIS_CONTEXT', 'Diagnosis context is missing, incompatible or exceeds its bound.')
    validate_settings(value['settings'])
    if not isinstance(value['source'], dict) or set(value['source']) != {'layoutSha256', 'placementSha256', 'bomSha256'} or any(not isinstance(v, str) or not HASH.fullmatch(v) for v in value['source'].values()):
        fail('DIAGNOSIS_CONTEXT', 'All three immutable diagnosis source hashes are required.')
    if require_digest and (not isinstance(value['diagnosisSha256'], str) or not HASH.fullmatch(value['diagnosisSha256'])):
        fail('DIAGNOSIS_CONTEXT', 'The frozen independently derived finding hash is required.')
    for key in ('placementConfig', 'bomConfig'):
        config = value[key]
        if not isinstance(config, dict) or set(config) != {'config', 'sheet', 'delimiter'} or not isinstance(config['config'], dict) or type(config['sheet']) is not int or not 0 <= config['sheet'] < 20 or config['delimiter'] not in (',', ';', '\t'):
            fail('DIAGNOSIS_CONTEXT', 'Explicit diagnosis source mapping and worksheet are required.')
    validate_profiles(value['packageProfiles'])
    return deepcopy(value)


def one(node, field):
    if node is None:
        return None
    rows = node.findall(field)
    return rows[0].text or '' if len(rows) == 1 and not rows[0].attrib and not len(rows[0]) else None


def finite(value):
    try:
        number = float(value)
        return number if math.isfinite(number) and abs(number) < 1000000 else None
    except (TypeError, ValueError, OverflowError):
        return None


def norm(value):
    return (value or '').strip().upper()


def grouped(rows, key):
    result = defaultdict(list)
    for row in rows:
        result[key(row)].append(row)
    return result


def point(placement):
    anchor = (placement or {}).get('anchor') or {}
    x, y = finite(anchor.get('xMm')), finite(anchor.get('yMm'))
    return None if x is None or y is None else [x, y]


def distance(a, b):
    return math.hypot(a[0]-b[0], a[1]-b[1]) if a is not None and b is not None else None


def noncollinear(points):
    if len(points) < 3:
        return False
    cx, cy = (sum(p[i] for p in points)/len(points) for i in (0, 1))
    xx = sum((p[0]-cx)**2 for p in points); yy = sum((p[1]-cy)**2 for p in points)
    xy = sum((p[0]-cx)*(p[1]-cy) for p in points)
    return xx+yy > 1e-12 and (xx*yy-xy*xy)/(xx+yy)**2 > 1e-6


def apply(point_value, transform):
    if point_value is None or transform is None:
        return None
    a, b = transform['matrix']
    return [a[0]*point_value[0]+a[1]*point_value[1]+a[2], b[0]*point_value[0]+b[1]*point_value[1]+b[2]]


def rigid(a, b):
    if not noncollinear(a) or not noncollinear(b):
        fail('DIAGNOSIS_CONTROL_GEOMETRY', 'Fit controls must span distinct noncollinear physical origins.')
    ax, ay = (sum(p[i] for p in a)/len(a) for i in (0, 1))
    bx, by = (sum(p[i] for p in b)/len(b) for i in (0, 1))
    h00 = sum((p[0]-ax)*(q[0]-bx) for p, q in zip(a, b))
    h01 = sum((p[0]-ax)*(q[1]-by) for p, q in zip(a, b))
    h10 = sum((p[1]-ay)*(q[0]-bx) for p, q in zip(a, b))
    h11 = sum((p[1]-ay)*(q[1]-by) for p, q in zip(a, b))
    if h00*h11-h01*h10 <= 0:
        fail('DIAGNOSIS_REFLECTION', 'Correspondences imply an unsupported mirror or contradictory frame; no fitted reflection is permitted.')
    angle = math.atan2(h01-h10, h00+h11); c, s = math.cos(angle), math.sin(angle)
    return {'angleDegrees': angle*180/math.pi, 'scale': 1, 'mirror': False,
            'matrix': [[c, -s, bx-c*ax+s*ay], [s, c, by-s*ax-c*ay]]}


def angle_distance(a, b):
    return abs((a-b+180) % 360-180)


def revision_hint(name):
    match = re.search(r'(?:REV(?:ISION)?[ _.-]*|_V)(\d+)', name, re.I)
    return str(int(match[1])) if match else ''


def decimal_literal(value):
    # Deterministic bounded serialization; actual coordinates are never fitted
    # per component. Formatting noise is suppressed by the reviewed tolerance.
    if abs(value) < 5e-10:
        value = 0
    return f'{value:.9f}'.rstrip('0').rstrip('.')


def diagnose(job, master, pcb, placement, bom, context, native_source, source_names=None):
    context = validate_context(context)
    settings = context['settings']; source_names = source_names or {}
    _xml(job, supported_versions=('10.1', '10.2')); _xml(master, supported_versions=('10.1', '10.2'))
    j, m = ET.fromstring(job), ET.fromstring(master)
    layout = read_accel(pcb)
    if layout.get('status') not in ('success', 'partial') or not layout.get('placements'):
        fail('DIAGNOSIS_LAYOUT', 'A supported PCB with owned placements is required.')
    if placement.get('sourceSha256') != context['source']['placementSha256'] or bom.get('sourceSha256') != context['source']['bomSha256'] or layout['sourceSha256'] != context['source']['layoutSha256']:
        fail('DIAGNOSIS_STALE_SOURCE', 'Freshly parsed source hashes differ from the requested diagnosis.')
    if not isinstance(native_source, dict) or any(not isinstance(native_source.get(k), str) or not HASH.fullmatch(native_source[k]) for k in ('archiveSha256', 'jobSha256', 'masterSha256')) or sha256(job).hexdigest() != native_source['jobSha256'] or sha256(master).hexdigest() != native_source['masterSha256']:
        fail('DIAGNOSIS_STALE_NATIVE', 'Fresh main and Master selection hashes are required for diagnosis.')
    bodies = body_evidence(pcb, context['packageProfiles'], bom)
    all_holds = []
    def hold(code, message):
        all_holds.append({'code': code, 'message': message})
    tolerance = finite(settings['toleranceMm'])
    if tolerance is None or not 0 < tolerance <= 1:
        hold('DIAGNOSIS_TOLERANCE', 'Use a positive source-comparison tolerance of at most 1 mm; it is not an inspection limit.')
        tolerance = 0.001
    if not settings['framesConfirmed'] or not settings['frameStatement'].strip() or not settings['toleranceBasis'].strip():
        hold('DIAGNOSIS_FRAME_REVIEW', 'Explicitly establish the source/native units, side, handedness, anchor and angle conventions and tolerance basis.')
    revisions = [settings[k].strip() for k in ('sourceRevision', 'nativeRevision', 'bomRevision')]
    if not all(revisions) or len(set(revisions)) != 1:
        hold('DIAGNOSIS_REVISION', 'PCB, selected native main and actual BOM revisions must agree before native preparation.')
    for role, name in source_names.items():
        expected = settings['nativeRevision'] if role == 'nativeName' else settings['bomRevision'] if role == 'bomName' else settings['sourceRevision']
        hint = revision_hint(name)
        if hint and hint != expected.strip():
            hold('DIAGNOSIS_REVISION_HINT', 'A selected source filename revision contradicts the reviewed revision.')
    bom_revision = bom.get('config', {}).get('revision', '')
    if bom_revision and bom_revision != settings['bomRevision']:
        hold('DIAGNOSIS_BOM_REVISION', 'Parsed BOM revision differs from the reviewed diagnosis revision.')
    if one(j, 'JobXmlVersion') != one(m, 'JobXmlVersion'):
        hold('DIAGNOSIS_NATIVE_SCHEMA', 'Selected main and Master schema claims differ; choose a compatible exact snapshot pair before deriving edits.')
    if placement.get('status') != 'success':
        hold('DIAGNOSIS_PLACEMENT_INTAKE', 'Resolve placement column, unit, side, rotation and row errors before native proposals.')
    if bom.get('status') != 'success':
        hold('DIAGNOSIS_BOM_INTAKE', 'Resolve BOM identity, quantity and unsafe-cell errors before native proposals.')
    if settings['sourceSide'] == 'unknown' or settings['nativeSide'] == 'unknown':
        hold('DIAGNOSIS_SIDE_UNKNOWN', 'Physical source and native board sides must be explicitly established; unflipped does not mean top.')
    elif settings['sourceSide'] != settings['nativeSide']:
        hold('DIAGNOSIS_SIDE_MIRROR', 'Different board sides need an independent mirror contract; this proper-rotation profile cannot infer one.')
    if 'unknown' in (settings['nativeUnits'], settings['nativeYDirection'], settings['nativeRotation'], settings['nativeRoiAnchor']):
        hold('DIAGNOSIS_NATIVE_CONVENTION', 'Native units, Y direction, rotation convention and ROI anchor must be explicitly reviewed.')
    modules = [node for node in j.findall('ModuleDataList/ModuleData') if one(node, 'ID') == settings['module']]
    if not settings['module'].strip() or len(modules) != 1 or modules[0].attrib:
        hold('DIAGNOSIS_MODULE', 'Select one exact plain native module identity; a reference-only join cannot establish module ownership.')
    scale = 0.0254 if settings['nativeUnits'] == 'mil' else 1
    sy = -1 if settings['nativeYDirection'] == 'down' else 1
    def native_point(node):
        x, y = finite(one(node, 'X')), finite(one(node, 'Y'))
        return None if x is None or y is None else [x*scale, y*scale*sy]
    def to_native(p):
        return None if p is None else [p[0]/scale, p[1]/scale*sy]
    source = grouped(layout['placements'], lambda p: norm(p['refdes']))
    csv = grouped(placement.get('placements', []), lambda p: norm(p['refdes']))
    bom_groups = grouped(bom.get('references', []), lambda p: p['normalizedRefdes'])
    cads = grouped([c for c in j.findall('CadData/CpList/Cp') if one(c, 'ModuleID') == settings['module']], lambda c: norm(one(c, 'RefID')))
    cad_ids = grouped([c for c in j.findall('CadData/CpList/Cp') if one(c, 'ModuleID') == settings['module']], lambda c: one(c, 'ID'))
    part_rows = [(i, p) for i, p in enumerate(j.findall('PartDataList/PartData'), 1) if one(p, 'ParentId') == settings['module']]
    parts = grouped(part_rows, lambda row: norm(one(row[1], 'RefID')))
    part_ids = grouped(part_rows, lambda row: one(row[1], 'ID'))
    control_refs = settings['fitReferences'] + settings['checkReferences']
    if len(settings['fitReferences']) < 3 or len(settings['checkReferences']) < 1 or len(control_refs) > 32 or len({norm(r) for r in control_refs}) != len(control_refs):
        hold('DIAGNOSIS_CONTROLS', 'Choose at least three noncollinear fit origins and one distinct independent check origin, with disjoint identities.')
    controls = []
    for index, reference in enumerate(control_refs):
        ref = norm(reference); ps, cs, ss = source[ref], cads[ref], csv[ref]
        record = {'reference': ref, 'role': 'fit' if index < len(settings['fitReferences']) else 'check', 'sourcePath': None, 'nativeCadId': None, 'sourceOriginMm': None, 'primaryPointMm': None, 'sourceRegistrationResidualMm': None, 'nativeOriginCanonicalMm': None, 'residualMm': None}
        controls.append(record)
        if len(ps) != 1 or len(cs) != 1 or len(ss) != 1:
            hold('DIAGNOSIS_CONTROL_IDENTITY', 'A fit/check reference is missing or duplicated in source PCB, placement or selected native CAD module.')
            continue
        p, cp, supplied = ps[0], cs[0], ss[0]
        a, b = point(p), native_point(cp)
        supplied_point = [finite(supplied.get('xMm')), finite(supplied.get('yMm'))]
        side = (p.get('side') or '').lower()
        if p.get('identityHolds') or p.get('isFlippedRaw') not in (None, 'False', 'false') or cp.attrib or len(cad_ids[one(cp, 'ID')]) != 1 or any(one(cp, k) in (None, '') for k in ('ID', 'RefID', 'ModuleID', 'X', 'Y')) or a is None or b is None:
            hold('DIAGNOSIS_CONTROL_GEOMETRY', 'A fit/check has unresolved ownership, flip or finite coordinate semantics.')
            continue
        if settings['sourceSide'] != 'unknown' and (supplied.get('side', '').lower() != settings['sourceSide'] or side and side != settings['sourceSide']):
            hold('DIAGNOSIS_CONTROL_SIDE', 'A fit/check side contradicts the explicitly reviewed physical board side.')
        if None in supplied_point:
            hold('DIAGNOSIS_CONTROL_ANCHOR', 'Every selected control needs finite primary coordinates and an independently reviewed footprint-origin correspondence.')
        record.update(sourcePath=p['sourcePath'], nativeCadId=one(cp, 'ID'), sourceOriginMm=a, primaryPointMm=None if None in supplied_point else supplied_point, nativeOriginCanonicalMm=b)
    transform = None
    source_transform = None
    ready = len(controls) == len(control_refs) and len(settings['fitReferences']) >= 3 and len(settings['checkReferences']) >= 1 and all(c['sourceOriginMm'] is not None and c['nativeOriginCanonicalMm'] is not None for c in controls)
    if ready:
        fit = [c for c in controls if c['role'] == 'fit']
        try:
            if not all(c['primaryPointMm'] is not None for c in controls):
                fail('DIAGNOSIS_SOURCE_CONTROLS', 'Finite primary fit/check coordinates are required for separate source-origin registration.')
            source_transform = rigid([c['primaryPointMm'] for c in fit], [c['sourceOriginMm'] for c in fit])
            for control in controls:
                control['sourceRegistrationResidualMm'] = distance(apply(control['primaryPointMm'], source_transform), control['sourceOriginMm'])
                if control['sourceRegistrationResidualMm'] > tolerance:
                    hold('DIAGNOSIS_SOURCE_FRAME_RESIDUAL', 'A primary-to-PCB fit or independent checkpoint fails; separate global datum/unit/revision issues from local offsets before native proposals.')
                primary = csv[control['reference']][0]; owned = source[control['reference']][0]
                a, b = finite(primary.get('rotationCcwDegrees')), finite(owned.get('rotation', {}).get('degrees'))
                if a is None or b is None or angle_distance(a+source_transform['angleDegrees'], b) > .01:
                    hold('DIAGNOSIS_SOURCE_CONTROL_ROTATION', 'A primary-to-PCB control rotation contradicts the reviewed package/angle datum.')
            for i, a in enumerate(fit):
                for b in fit[:i]:
                    if abs(distance(a['primaryPointMm'], b['primaryPointMm'])-distance(a['sourceOriginMm'], b['sourceOriginMm'])) > 2*tolerance:
                        hold('DIAGNOSIS_SOURCE_FRAME_SCALE', 'Primary-to-PCB control distances contradict fixed units; no scale fitting is allowed.')
        except CaptureBlocked as error:
            hold('DIAGNOSIS_SOURCE_FRAME', str(error))
        try:
            transform = rigid([c['sourceOriginMm'] for c in fit], [c['nativeOriginCanonicalMm'] for c in fit])
            for i, control in enumerate(controls):
                for earlier in controls[:i]:
                    if distance(control['sourceOriginMm'], earlier['sourceOriginMm']) < 1e-6 or distance(control['nativeOriginCanonicalMm'], earlier['nativeOriginCanonicalMm']) < 1e-6:
                        hold('DIAGNOSIS_CONTROL_IDENTITY', 'Controls must identify distinct physical origins, not repeated CAD markers.')
                control['residualMm'] = distance(apply(control['sourceOriginMm'], transform), control['nativeOriginCanonicalMm'])
                if control['residualMm'] > tolerance:
                    hold('DIAGNOSIS_FRAME_RESIDUAL', 'A fit or independent check fails the fixed-scale frame hypothesis; check units, revision, origin or module.')
            for i, a in enumerate(fit):
                for b in fit[:i]:
                    if abs(distance(a['sourceOriginMm'], b['sourceOriginMm'])-distance(a['nativeOriginCanonicalMm'], b['nativeOriginCanonicalMm'])) > 2*tolerance:
                        hold('DIAGNOSIS_FRAME_SCALE', 'Source/native control distances contradict fixed scale; no scale fitting or ROI compensation is permitted.')
        except CaptureBlocked as error:
            hold(error.code, str(error))
    body_groups = grouped(bodies['records'], lambda p: p['sourcePath'])
    window_paths = {id(w): f'JobContainer/WindowDataList/WindowData[{i}]'
                    for i, w in enumerate(m.findall('WindowDataList/WindowData'), 1)}
    rows = []
    for ordinal, part in part_rows:
        identity = {k: one(part, k) for k in ('ID', 'ParentId', 'MasterKey', 'RefID')}
        ref = norm(identity['RefID']); row_holds = []
        def row_hold(code, message):
            row_holds.append({'code': code, 'message': message})
        ps, cs, ss, bs = source[ref], cads[ref], csv[ref], bom_groups[ref]
        p, cp, supplied, population = (group[0] if len(group) == 1 else None for group in (ps, cs, ss, bs))
        before = {k: one(part, 'Roi/'+k) for k in ('cx', 'cy', 'w', 'h', 'a')}
        from .component_progress import component_checked
        component_checked('analysis-started', identity, before, before)
        if any(v in (None, '') for v in identity.values()) or part.attrib or len(parts[ref]) != 1:
            row_hold('DIAGNOSIS_NATIVE_DUPLICATE', 'Stable native placement identity is missing or repeated within the selected module; keeper review is separate.')
        if len(part_ids[identity['ID']]) != 1:
            row_hold('DIAGNOSIS_NATIVE_IDENTITY', 'The selected module reuses this native Part ID; distinct reference text cannot establish a unique native identity.')
        if len(ps) != 1 or len(ss) != 1:
            row_hold('DIAGNOSIS_SOURCE_IDENTITY', 'One exact owned PCB placement and primary placement identity are required; repeated module/reference sources stay held.')
        if len(cs) != 1 or cp is not None and (cp.attrib or one(cp, 'ID') in (None, '') or len(cad_ids[one(cp, 'ID')]) != 1):
            row_hold('DIAGNOSIS_CAD_IDENTITY', 'Exactly one native CAD marker in the selected module is required; repeated CAD markers are distinct from duplicate placements.')
        if len(bs) != 1 or not population or not population.get('quantityMatches'):
            row_hold('DIAGNOSIS_POPULATION', 'A unique quantity-reconciled actual BOM reference is required.')
        elif population['populationEvidence'] == 'engineering-dnp':
            row_hold('DIAGNOSIS_DNP', 'Engineering DNP is intentionally held; no population or enable state is changed.')
        elif not population.get('mpn'):
            row_hold('DIAGNOSIS_MPN', 'Populated package identity is missing; no compatible body is inferred.')
        if supplied and population and supplied.get('mpn') and population.get('mpn') and supplied['mpn'] != population['mpn']:
            row_hold('DIAGNOSIS_MPN_CONFLICT', 'Primary placement and actual BOM MPN differ; resolve the selected revision/package identity.')
        if p and (p.get('identityHolds') or p.get('isFlippedRaw') not in (None, 'False', 'false')):
            row_hold('DIAGNOSIS_SOURCE_FRAME', 'Owned PCB identity or flip semantics are unresolved.')
        if settings['sourceSide'] != 'unknown' and (supplied and supplied.get('side', '').lower() != settings['sourceSide'] or p and p.get('side') and p['side'].lower() != settings['sourceSide']):
            row_hold('DIAGNOSIS_SIDE_CONFLICT', 'Source evidence contradicts the reviewed physical side.')
        if population:
            scope = population.get('scope', {})
            if scope.get('module') and supplied and scope['module'] != supplied.get('module') or scope.get('side') and scope['side'].lower() != settings['sourceSide']:
                row_hold('DIAGNOSIS_BOM_SCOPE', 'BOM scope contradicts the selected placement module or side.')
        if any(not isinstance(v, str) or not NUMBER.fullmatch(v) or finite(v) is None for v in before.values()) or finite(before['w']) is not None and float(before['w']) <= 0 or finite(before['h']) is not None and float(before['h']) <= 0:
            row_hold('DIAGNOSIS_ROI', 'Complete bounded unique original ROI literals with positive dimensions are required.')
        origin = point(p); body_rows = body_groups[p['sourcePath']] if p else []; body = body_rows[0] if len(body_rows) == 1 else None
        center = body['bodyBoardMm'] if body and body['status'] == 'supported' and body['mpnMatched'] else None
        source_anchor = 'unknown'
        if supplied and origin:
            sp = [finite(supplied.get('xMm')), finite(supplied.get('yMm'))]
            if None not in sp and source_transform is not None:
                sp = apply(sp, source_transform)
                if distance(sp, origin) <= tolerance:
                    source_anchor = 'footprint-origin'
                elif center and distance(sp, center) <= tolerance:
                    source_anchor = 'body-center-explained-convention'
                else:
                    source_anchor = 'unexplained-source-coordinate'
                    row_hold('DIAGNOSIS_SOURCE_ORIGIN', 'Primary coordinate agrees with neither the owned footprint origin nor independently supported body center; do not hide a source error by moving native ROI.')
            else:
                row_hold('DIAGNOSIS_SOURCE_COORDINATE', 'Primary coordinates or their independently checked PCB frame are unavailable.')
        if p and supplied:
            source_angle = finite(p.get('rotation', {}).get('degrees')); supplied_angle = finite(supplied.get('rotationCcwDegrees'))
            if source_angle is None or supplied_angle is None or source_transform is None or angle_distance(source_angle, supplied_angle+source_transform['angleDegrees']) > .01:
                row_hold('DIAGNOSIS_SOURCE_ROTATION', 'Source PCB and primary package rotations differ; establish an independent angle/body datum before ROI editing.')
        mapped_origin = apply(origin, transform); cad_point = native_point(cp)
        cad_residual = distance(mapped_origin, cad_point)
        if cad_residual is None or cad_residual > tolerance:
            row_hold('DIAGNOSIS_CAD_OUTLIER', 'This native CAD origin is absent or contradicts the shared frame; hold its ROI edit and diagnose CAD/module alignment separately.')
        if cp is not None and p is not None and transform:
            native_angle, source_angle = finite(one(cp, 'Ang')), finite(p.get('rotation', {}).get('degrees'))
            expected_angle = None if source_angle is None else (source_angle+transform['angleDegrees']) * (-1 if settings['nativeRotation'] == 'cw' else 1)
            if native_angle is None or expected_angle is None or angle_distance(native_angle, expected_angle) > .01:
                row_hold('DIAGNOSIS_NATIVE_ROTATION', 'Native CAD angle disagrees with the declared package/frame rotation; no package offset is guessed.')
            elif finite(before['a']) is not None and angle_distance(float(before['a']), native_angle) > .01:
                row_hold('DIAGNOSIS_ROI_ROTATION', 'Existing ROI and CAD angles differ; a supported package/model orientation contract is needed.')
        if settings['nativeRoiAnchor'] == 'body-center' and center is None:
            row_hold('DIAGNOSIS_BODY_EVIDENCE', 'Matched source-owned pads, pin mapping and authoritative body datum are missing or held; a pad midpoint cannot substitute.')
            if body:
                row_holds.extend(body['holds'])
        if len(body_rows) > 1:
            row_hold('DIAGNOSIS_BODY_AMBIGUOUS', 'Competing body profiles must be resolved independently.')
        models = [model for model in m.findall('PartDataList/PartData') if one(model, 'MasterKey') == identity['MasterKey']]
        if len(models) != 1 or models[0].attrib:
            row_hold('DIAGNOSIS_MASTER', 'Exactly one plain selected MasterKey model is required; no teaching donor is chosen by reference.')
        desired = center if settings['nativeRoiAnchor'] == 'body-center' else origin if settings['nativeRoiAnchor'] == 'footprint-origin' else None
        proposed_center = to_native(apply(desired, transform)); original_center = [finite(before['cx']), finite(before['cy'])]
        offset_mm = None if None in original_center or proposed_center is None else distance([original_center[0]*scale, original_center[1]*scale*sy], apply(desired, transform))
        original_master_center = None
        if len(models) == 1:
            mx, my = finite(one(models[0], 'Roi/cx')), finite(one(models[0], 'Roi/cy'))
            if mx is not None and my is not None:
                original_master_center = [mx, my]
        master_supports_datum = original_master_center is not None and proposed_center is not None and distance([original_master_center[0]*scale, original_master_center[1]*scale*sy], apply(desired, transform)) <= tolerance
        shared_count = sum(one(q, 'MasterKey') == identity['MasterKey'] for q in j.findall('PartDataList/PartData'))
        # Nominal source geometry does not disprove intentional local teaching.
        # This first route requires an independently corroborating, uniquely
        # used existing Master body datum. Shared masters need a local-frame
        # compatibility contract, rather than comparing unrelated global ROIs.
        if offset_mm is not None and offset_mm > tolerance and (not master_supports_datum or shared_count != 1):
            row_hold('DIAGNOSIS_TAUGHT_ADJUSTMENT', 'The ROI differs from nominal source geometry without a uniquely used existing Master corroborating that exact body datum. Preserve possible intentional teaching; no nominal-coordinate normalization is proposed.')
        windows = [window for window in m.findall('WindowDataList/WindowData') if one(window, 'ParentId') == identity['MasterKey']]
        local_offset_mm = None
        within_body_envelope = None
        if center and body and transform and None not in original_center:
            # Convert the native discrepancy through the inverse proper frame,
            # then source package rotation. Compare in body/pattern axes, not
            # global XY: asymmetric cardinal fixtures catch swapped envelopes.
            dx = original_center[0]*scale-apply(center, transform)[0]
            dy = original_center[1]*scale*sy-apply(center, transform)[1]
            angle = math.radians(transform['angleDegrees']+body['sourceRotationDegrees'])
            c, s = math.cos(angle), math.sin(angle)
            local_offset_mm = [c*dx+s*dy, -s*dx+c*dy]
            size = body.get('bodySizeMm')
            if size and len(size) == 2 and all(finite(v) is not None and v > 0 for v in size):
                within_body_envelope = abs(local_offset_mm[0]) <= size[0]/2+tolerance and abs(local_offset_mm[1]) <= size[1]/2+tolerance
        existing_teaching_records = any(w.findall('AlgorithmDataList/AlgorithmData') for w in windows)
        if offset_mm is not None and offset_mm > tolerance and existing_teaching_records and within_body_envelope is not False:
            row_hold('DIAGNOSIS_TAUGHT_ADJUSTMENT', 'Existing taught ROI center remains within the independently supported package body envelope, or that envelope is unavailable. Preserve possible local teaching/alignment adjustment; arithmetic tolerance alone cannot justify normalization. Only a gross independently corroborated placement/model disagreement is eligible for this isolated route.')
        classification = 'held'
        proposals = []
        if not all_holds and not row_holds and proposed_center is not None:
            if offset_mm <= tolerance:
                classification = 'already-aligned'
            else:
                classification = 'local-body-origin-offset' if center and origin and distance([original_center[0]*scale, original_center[1]*scale*sy], mapped_origin) <= tolerance else 'local-native-roi-offset'
                for key, after in zip(('cx', 'cy'), proposed_center):
                    if abs(float(before[key])-after)*scale > 1e-8:
                        proposals.append({'field': 'Roi/'+key, 'before': before[key], 'after': decimal_literal(after)})
        dependency_holds = [{'code': 'DIAGNOSIS_RUNTIME_UNQUALIFIED', 'message': 'Native ROI anchor and frame interpretation are reviewed experimental inputs; Eagle behavior and physical placement remain unverified.'},
                            {'code': 'DIAGNOSIS_WINDOW_PROPAGATION', 'message': 'Existing Master/window bytes are preserved; dependent geometry and propagation require an isolated Eagle observation.'},
                            {'code': 'DIAGNOSIS_BINDING_FOV', 'message': 'Native binding ownership and optical acquisition coverage remain unqualified; no binding or FOV fields are written.'}]
        # These are owned source intentions, never a guessed native-pad join.
        # A declared profile map is exposed only after its independent geometry
        # and manufacturer/pin evidence actually passed the source reader.
        supported_profile = next((profile for profile in context['packageProfiles']
                                  if body and body['status'] == 'supported' and body['mpnMatched']
                                  and profile['id'] == body['profileId']), None)
        pin_map = supported_profile['padPinMap'] if supported_profile else {}
        pin_roles = supported_profile.get('polarity', {}).get('pinRoles', {}) if supported_profile else {}
        source_intentions = []
        for pad in p.get('sourceOwnedPads', []) if p else []:
            bp = pad.get('sourceBoardPoint')
            board_point = [bp.get('xMm'), bp.get('yMm')] if isinstance(bp, dict) else None
            center_established = bool(p['ownedPadCentersAvailable'] and board_point and all(finite(v) is not None for v in board_point))
            pin = pin_map.get(pad['padNumber']); role = pin_roles.get(pin)
            source_intentions.append({'padNumber': pad['padNumber'], 'sourcePath': pad['sourcePath'],
                'placementSourcePath': pad['placementSourcePath'],
                'sourceBoardPointMm': board_point if center_established else None,
                'sourceCenterEstablished': center_established, 'physicalPin': pin, 'physicalRole': role,
                'opticalAccess': 'not-a-physical-lead' if role == 'no-physical-lead' else
                    'underside-hidden-not-an-AOI-inspection' if role == 'underside-thermal-pad' else 'unverified',
                'opticalInspectionEstablished': False, 'bindingPrepared': False})
        rows.append({'sourcePath': f'JobContainer/PartDataList/PartData[{ordinal}]', 'identity': identity, 'beforeRoi': before,
                     'sourceIdentity': supplied.get('placementId') if supplied else None, 'layoutSourcePath': p['sourcePath'] if p else None,
                     'classification': classification, 'sourceAnchor': source_anchor, 'footprintOrigin': origin, 'bodyCenter': center,
                     'bodyProfileId': body['profileId'] if body else None, 'drawingSha256': body['drawingSha256'] if body else None,
                     'originalMasterCenterNative': original_master_center, 'masterSupportsSourceDatum': master_supports_datum,
                     'bodyLocalOffsetMm': local_offset_mm, 'withinBodyEnvelope': within_body_envelope,
                     'proposedCenterNative': proposed_center, 'deltaMm': offset_mm, 'nativeCadResidualMm': cad_residual,
                     'proposals': proposals, 'holds': row_holds, 'dependencyHolds': dependency_holds, 'completeRepairClaimHeld': True,
                     'dependencyInventory': {'masterKey': identity['MasterKey'], 'masterMatches': len(models), 'windows': len(windows),
                                             'algorithms': sum(len(w.findall('AlgorithmDataList/AlgorithmData')) for w in windows),
                                             'sharedPlacements': shared_count,
                                             'bindingLiteralPresent': bool(one(part, 'WND_PAD')), 'fovAssignmentLiterals': [c.text or '' for c in part.findall('FovList/*')],
                                             'sourcePadIntentions': source_intentions,
                                             'existingWindows': [{'sourcePath': window_paths[id(w)],
                                                 **{key: one(w, key) for key in ('ID', 'ParentId', 'GroupID', 'ParentWndId', 'AlignWndID', 'ENABLE')},
                                                 'algorithmCount': len(w.findall('AlgorithmDataList/AlgorithmData'))} for w in windows],
                                             'nativeWindowFrameQualified': False, 'sourceToNativePadFrameQualified': False,
                                             'bindingTupleMeaningQualified': False,
                                             'requiredEvidence': [
                                                 'Controlled Eagle before/after for one owned pad and its dependent window, preserving the original snapshots, to establish local window frame and placement propagation.',
                                                 'Numbered owned source-layer to exact native Gerber block transform with independent controls/checks; pad dimensions, PartNo and repeated IDs cannot establish ownership.',
                                                 'Controlled tuple/list write observation for exact schema/Eagle build to qualify WND_PAD positions, individual/common lists and native record scope.',
                                                 'Calibrated usable camera area and qualified assignment domain/frame before optical coverage can be established.']},
                     'existingEnabledLiteral': one(part, 'ENABLE'), 'nativeEditsApplied': False})
        event_after = dict(before)
        for proposal in proposals:
            event_after[proposal['field'].split('/')[-1]] = proposal['after']
        component_checked('analysis-held' if all_holds or row_holds else 'analysis-checked', identity, before, event_after)
    report = {'status': 'success', 'artifactType': 'scan.native-placement-diagnosis', 'schemaVersion': '1', 'analyzerVersion': VERSION,
              'settings': settings, 'source': {**context['source'], **native_source}, 'sourceNames': source_names,
              'interpretationSha256': digest(context), 'bodyEvidenceSha256': bodies['evidenceSha256'],
              'sourceRegistration': {'transform': source_transform, 'controls': [{'reference': c['reference'], 'role': c['role'], 'primaryPointMm': c['primaryPointMm'], 'sourceOriginMm': c['sourceOriginMm'], 'residualMm': c['sourceRegistrationResidualMm']} for c in controls],
                                     'interpretation': 'Primary source to owned PCB footprint origins, independently fitted and checked before native diagnosis. A shared datum transform is not a local component displacement.'},
              'frame': {'transform': transform, 'controls': controls, 'holds': all_holds,
                        'interpretation': 'Source PCB footprint origin to original native CAD; fixed-scale proper rigid transform in reviewed canonical mm/Y-up frame. Angle convention is declared in that canonical frame. Native runtime is unqualified.'},
              'rows': rows, 'counts': {'nativeParts': len(rows), 'alreadyAligned': sum(r['classification'] == 'already-aligned' for r in rows),
                                      'supportedQualificationRows': sum(bool(r['proposals']) for r in rows), 'proposedScalars': sum(len(r['proposals']) for r in rows),
                                      'held': sum(r['classification'] == 'held' for r in rows), 'completeRepairs': 0},
              'basis': 'independent-source-derived-experimental-placement', 'machineQualified': False,
              'physicalCorrectnessVerified': False, 'bindingQualified': False, 'fovCoverageQualified': False,
              'nativeEditsApplied': False, 'machineExportAllowed': False}
    report['diagnosisSha256'] = digest(report)
    if len(json.dumps(report)) > 4000000:
        fail('DIAGNOSIS_LIMIT', 'Diagnosis exceeds its bounded result size; no partial diagnosis is returned.')
    return report


def diagnose_files(source, review, context, host_input):
    has_digest = isinstance(context, dict) and 'diagnosisSha256' in context
    context = validate_context(context, require_digest=has_digest)
    archive_hash = _fresh_hash(Path(source), 100000000)[0]
    if archive_hash != review['preflight']['source']['sha256']:
        fail('DIAGNOSIS_STALE_NATIVE', 'The complete selected archive changed after preflight; unrelated payloads are part of its source identity.')
    if not isinstance(host_input, dict) or set(host_input) != HOST_INPUT:
        fail('DIAGNOSIS_FILES', 'Fresh captured PCB, placement and BOM inputs are required for this diagnosis.')
    paths = [Path(host_input[k]) for k in ('layoutSource', 'placementSource', 'bomSource')]
    parent = Path(source).parent
    if any(not p.is_absolute() or p.parent != parent or p == Path(source) for p in paths) or len(set(paths)) != 3:
        fail('DIAGNOSIS_FILES', 'Diagnosis sources must be distinct local captured files beside the selected archive.')
    names = {k: host_input[k] for k in ('layoutName', 'placementName', 'bomName')}
    if any(not text(n, 512) or not n or '/' in n or '\\' in n for n in names.values()) or not names['layoutName'].lower().endswith('.pcb'):
        fail('DIAGNOSIS_FILES', 'Original bounded source filenames and a PCB layout are required.')
    kinds = [Path(names[k]).suffix.lower().lstrip('.') for k in ('placementName', 'bomName')]
    if any(k not in ('csv', 'xls', 'xlsx') for k in kinds):
        fail('DIAGNOSIS_FILES', 'Diagnosis placement and BOM formats are unsupported.')
    before = [_fresh_hash(p, MAX_BYTES)[0] for p in paths]
    if before != [context['source'][k] for k in ('layoutSha256', 'placementSha256', 'bomSha256')]:
        fail('DIAGNOSIS_STALE_SOURCE', 'Fresh captured input bytes differ from the frozen diagnosis source hashes.')
    pcb, placement_bytes, bom_bytes = [p.read_bytes() for p in paths]
    pc, bc = context['placementConfig'], context['bomConfig']
    with warnings.catch_warnings():
        warnings.simplefilter('ignore')
        placement = normalize(read_table(placement_bytes, kinds[0], pc['sheet'], pc['delimiter'], pc['config'].get('encoding', 'utf-8'), pc['config'].get('csvRecovery', False)), placement_bytes, pc['config'])
        bom = normalize_bom(read_table(bom_bytes, kinds[1], bc['sheet'], bc['delimiter']), bom_bytes, bc['config'])
    selected = review['preflight']['selection']; sm = selected.get('master')
    if selected['job']['role'] != 'main' or not sm or sm['role'] != 'main':
        fail('DIAGNOSIS_SNAPSHOT', 'Independent native proposals require separately selected main job and main Master snapshots.')
    with zipfile.ZipFile(source) as archive:
        job, master = archive.read(selected['job']['member']), archive.read(sm['member'])
    native_source = {'archiveSha256': review['preflight']['source']['sha256'], 'jobSha256': selected['job']['sha256'], 'masterSha256': sm['sha256'],
                     'root': selected['root'], 'jobMember': selected['job']['member'], 'masterMember': sm['member'], 'schemaVersion': ET.fromstring(job).findtext('JobXmlVersion')}
    names['nativeName'] = selected['job']['member'].split('/')[-1]
    expected = context.pop('diagnosisSha256', None)
    report = diagnose(job, master, pcb, placement, bom, context, native_source, names)
    if before != [_fresh_hash(p, MAX_BYTES)[0] for p in paths] or archive_hash != _fresh_hash(Path(source), 100000000)[0]:
        fail('DIAGNOSIS_STALE_SOURCE', 'A source changed while diagnosis was being rebuilt.')
    if expected is not None and expected != report['diagnosisSha256']:
        fail('DIAGNOSIS_STALE_FINDING', 'The source interpretation, body evidence, native selection or frozen diagnosis differs; review the rebuilt finding first.')
    return report


def verify_request(request, report):
    """Require every derived scalar to be exact and grouped, without trusting prose."""
    if request['diagnosis']['diagnosisSha256'] != report['diagnosisSha256']:
        fail('DIAGNOSIS_STALE_FINDING', 'Reviewed proposal refers to a different independently derived diagnosis.')
    if report['frame']['holds']:
        fail('DIAGNOSIS_HELD', 'The source/native frame contains unresolved evidence; derived placement export is held.')
    matched = defaultdict(list)
    evidence = {e['id']: e for e in request.get('evidence', [])}
    for proposal in request.get('proposals', []):
        candidates = [r for r in report['rows'] if r['sourcePath'] == proposal['path'].rsplit('/Roi/', 1)[0] and r['identity'] == proposal['identity']]
        if len(candidates) != 1 or not candidates[0]['proposals'] or candidates[0]['holds']:
            fail('DIAGNOSIS_PROPOSAL', 'A proposed placement does not have one unheld independently supported source finding.')
        row = candidates[0]; field = proposal['path'].rsplit(']/', 1)[-1]
        derived = [p for p in row['proposals'] if p['field'] == field]
        if len(derived) != 1 or proposal['before'] != derived[0]['before'] or proposal['after'] != derived[0]['after'] or proposal.get('beforeRoi') != row['beforeRoi']:
            fail('DIAGNOSIS_PROPOSAL', 'Requested scalar differs from the freshly derived fields, before-values or complete ROI guard.')
        refs = [evidence.get(eid) for eid in proposal.get('evidenceIds', [])]
        if not refs or any(not e or e.get('kind') != 'independent-source-support' or e.get('independentSupport') is not True or not any(ref.get('sha256') == report['diagnosisSha256'] for ref in e.get('references', [])) for e in refs):
            fail('DIAGNOSIS_EVIDENCE', 'Derived evidence must bind the frozen diagnosis hash and cannot be declared historical replay.')
        matched[row['sourcePath']].append(field)
    for path, fields in matched.items():
        row = next(r for r in report['rows'] if r['sourcePath'] == path)
        if sorted(fields) != sorted(p['field'] for p in row['proposals']):
            fail('DIAGNOSIS_PARTIAL', 'The exact derived placement group must include every required axis; partial repairs cannot leak into export.')
    if not matched:
        fail('DIAGNOSIS_EMPTY', 'No independently derived placement group was selected.')
    return {'diagnosisSha256': report['diagnosisSha256'], 'basis': 'source-derived-diagnosis',
            'derivedPlacementGroups': len(matched), 'derivedScalars': sum(len(v) for v in matched.values()),
            'completeRepairClaimHeld': True, 'machineQualified': False, 'physicalCorrectnessVerified': False}
