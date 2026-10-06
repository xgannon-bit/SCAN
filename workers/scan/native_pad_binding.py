"""Source-owned pad evidence and exact native binding work, without guessed writes.

The existing native PartNo/CAD join and six-position WND_PAD syntax are observed
relationships, not qualified component ownership. This reader records actual
source ownership and local native closure independently. It explicitly keeps the
native artwork/source frame, middle tuple positions and dependent windows held.
It never substitutes a nearest pad, overwrites teaching or creates a binding.
"""
from collections import Counter, defaultdict
from decimal import Decimal, InvalidOperation
from hashlib import sha256
from io import BytesIO
import json
from xml.etree import ElementTree as ET

from .accel_ascii import read_accel
from .native_bindings import report_native_bindings
from .native_records import read_native_records
from .qualification_candidate import _xml
from .snapshot_capture import CaptureBlocked


PROFILE = 'source-owned-native-binding-diagnosis-1'
MAX_ROWS = 10_000
MAX_OUTPUT_BYTES = 2_000_000
MESSAGES = {
    'BINDING_CAD_IDENTITY': 'Resolve the repeated or incomplete native CAD module/reference identity.',
    'BINDING_SOURCE_IDENTITY': 'Select one matching source-owned component and resolve its identity holds.',
    'BINDING_HOLE_BEARING': 'This source has physical holes; classify through-hole work separately from populated SMT preparation.',
    'BINDING_SOURCE_GEOMETRY': 'Resolve missing source-owned pad centers or complete explicit numbered-layer outlines.',
    'BINDING_NATIVE_PART_MISSING': 'Create a supported local native placement and Master before preparing its bindings.',
    'BINDING_NATIVE_PART_DUPLICATE': 'Resolve the duplicated native placement scope before selecting any binding target.',
    'BINDING_MASTER_SCOPE': 'Resolve the exact native placement/Master identity before interpreting dependent windows.',
    'BINDING_WINDOW_SCOPE': 'Resolve repeated local window keys, group keys or links outside this Master.',
    'BINDING_SCALAR_MISSING': 'Prepare WND_PAD only after the native/source frame and tuple meaning are qualified; no old binding is borrowed.',
    'BINDING_SCALAR_AMBIGUOUS': 'Resolve the repeated WND_PAD scalar without selecting or combining one of its values.',
    'BINDING_TUPLE_SYNTAX': 'Resolve unsupported native binding syntax without silently selecting part of the text.',
    'BINDING_LITERAL_CLOSURE': 'Resolve the exact native group/pad scope or tuple/pad-coordinate discrepancy before geometry review.',
    'BINDING_SOURCE_NATIVE_FRAME_UNQUALIFIED': 'Establish a source-owned numbered-layer to native Gerber block transform using noncollinear controls and an independent check.',
    'BINDING_ARTWORK_EQUIVALENCE_UNQUALIFIED': 'Complete source-to-native outline equivalence has not been established: the source dimensions do not all appear in native WH values. Verify the actual inspection artwork/layer and shape semantics.',
    'BINDING_TUPLE_FIELDS_UNQUALIFIED': 'Qualify WND_PAD positions 3/4 and individual/common pad-list semantics with preserved native examples; literal joins alone do not prove the write contract.',
    'BINDING_DEPENDENT_WINDOWS_UNVERIFIED': 'Verify each dependent window in its own native local frame against the intended owned pad; do not move correct CAD to hide a window error.',
}


def _scalar(node, key):
    matches = node.findall(key)
    if len(matches) != 1 or matches[0].attrib or len(matches[0]):
        return None
    return matches[0].text or ''


def _pair(value):
    if not isinstance(value, str) or len(value) > 256:
        return None
    fields = value.split(',')
    if len(fields) != 2:
        return None
    try:
        values = tuple(Decimal(v) for v in fields)
    except InvalidOperation:
        return None
    return values if all(v.is_finite() and v.copy_abs() <= 1_000_000 for v in values) else None


def _failure(code):
    return {'artifactType': 'scan.native-pad-binding-work', 'schemaVersion': '1',
            'analyzerVersion': PROFILE, 'status': 'blocked', 'code': code,
            'inventoryComplete': False, 'components': [], 'sharedBlockers': [], 'counts': None,
            'nativeEditsApplied': False, 'bindingPreparationQualified': False,
            'inspectionRepairEstablished': False, 'machineExportAllowed': False}


def diagnose_pad_bindings(job, master, pcb):
    """Return one row per actual CAD record and exact per-placement binding work.

    Inputs are the selected main snapshots and original source bytes. No machine
    approval, prior candidate receipt or acceptance oracle is an analyzer input.
    Whole source hashes bind the result. Complete literal closure is deliberately
    never called complete pad binding or a completed inspection.
    """
    try:
        if not all(isinstance(raw, bytes) for raw in (job, master, pcb)):
            return _failure('BINDING_INVALID_INPUT')
        _xml(job); _xml(master)
        documents = {role: read_native_records(BytesIO(raw), len(raw))
                     for role, raw in (('job', job), ('master', master))}
        if any(document['status'] != 'recorded' for document in documents.values()):
            return _failure('BINDING_NATIVE_INVENTORY_UNAVAILABLE')
        literal = report_native_bindings(documents)
        if literal['status'] != 'recorded' or not literal['literalObservationsComplete']:
            return _failure('BINDING_NATIVE_INVENTORY_UNAVAILABLE')
        layout = read_accel(pcb)
        if layout['status'] not in ('success', 'partial'):
            return _failure('BINDING_SOURCE_INVENTORY_UNAVAILABLE')
        j, m = ET.fromstring(job), ET.fromstring(master)
        cads = j.findall('CadData/CpList/Cp')
        if len(cads) > MAX_ROWS:
            return _failure('BINDING_LIMIT')
        source, parts, models, windows = (defaultdict(list) for _ in range(4))
        for item in layout['placements']:
            source[item['refdes']].append(item)
        for item in j.findall('PartDataList/PartData'):
            parts[(_scalar(item, 'ParentId'), _scalar(item, 'RefID'))].append(item)
        for item in m.findall('PartDataList/PartData'):
            models[_scalar(item, 'MasterKey')].append(item)
        for item in m.findall('WindowDataList/WindowData'):
            windows[_scalar(item, 'ParentId')].append(item)
        cad_counts = Counter((_scalar(c, 'ModuleID'), _scalar(c, 'RefID')) for c in cads)
        literal_parts = {p['sourcePath']: p for p in literal['parts']}
        literal_bindings = defaultdict(list)
        for binding in literal['bindings']:
            literal_bindings[binding['partSourcePath']].append(binding)
        literal_paths = {id(p): 'JobContainer/PartDataList/PartData[' + str(i) + ']'
                         for i, p in enumerate(j.findall('PartDataList/PartData'), 1)}
        sizes = []
        for pad in j.findall('GerberList/GerberPad'):
            wh = _pair(_scalar(pad, 'WH'))
            if wh is not None and all(v > 0 for v in wh):
                sizes.append(tuple(sorted(wh)))
        size_index = set(sizes)
        result = _failure('BINDING_WORK_RECORDED')
        result.update(status='recorded', inventoryComplete=True,
                      source={'jobSha256': sha256(job).hexdigest(), 'masterSha256': sha256(master).hexdigest(),
                              'layoutSha256': sha256(pcb).hexdigest()},
                      interpretation='Source pad ownership and native literal closure are separate evidence. No ownership, frame, teaching or binding write is implied by matching IDs or counts.',
                      literalClosureCounts=literal['counts'],
                      partNoCadJoin={'state': 'unqualified-relation-experiment-only',
                          'ownershipEvidence': False,
                          'padJoinCounts': literal['padCadRelationExperiment']['padJoinCounts'],
                          'boundReferenceComparisons': literal['padCadRelationExperiment']['boundPartReferenceComparisonCounts']},
                      sourceLayerPolicy='Explicit numbered layers remain distinct; signal, paste, physical side and native Gerber block are not silently equated.')
        shared = defaultdict(list)
        for ordinal, cad in enumerate(cads, 1):
            module, ref = _scalar(cad, 'ModuleID'), _scalar(cad, 'RefID')
            scope = (module, ref)
            matches = source.get(ref, [])
            src = matches[0] if len(matches) == 1 else None
            matching_parts = parts.get(scope, [])
            holds, observations = [], []
            def hold(code):
                if code not in holds:
                    holds.append(code)
            if module in (None, '') or ref in (None, '') or cad_counts[scope] != 1:
                hold('BINDING_CAD_IDENTITY')
            if src is None or src.get('identityHolds'):
                hold('BINDING_SOURCE_IDENTITY')
            if src is not None:
                if src['mountingEvidence'] == 'hole-bearing':
                    hold('BINDING_HOLE_BEARING')
                if not src['ownedPadCentersAvailable'] or not src['explicitLayerGeometry']:
                    hold('BINDING_SOURCE_GEOMETRY')
            if not matching_parts:
                hold('BINDING_NATIVE_PART_MISSING')
            elif len(matching_parts) != 1:
                hold('BINDING_NATIVE_PART_DUPLICATE')
            source_layers = []
            for layer in src['explicitLayerGeometry'] if src else []:
                dimension_matches = sum(tuple(sorted((Decimal(str(p['widthMm'])), Decimal(str(p['heightMm']))))) in size_index
                                        for p in layer['pads'])
                source_layers.append({'layerNumber': layer['layerNumber'], 'ownedPadCount': len(layer['pads']),
                                      'exactNativeSizeOnlyMatchCount': dimension_matches,
                                      'sizeOnlyComparisonEstablishesOwnership': False,
                                      'pasteOrInspectionLayerQualified': False})
            if source_layers and not any(l['ownedPadCount'] and l['exactNativeSizeOnlyMatchCount'] == l['ownedPadCount'] for l in source_layers):
                hold('BINDING_ARTWORK_EQUIVALENCE_UNQUALIFIED')
            for part in matching_parts:
                key = _scalar(part, 'MasterKey')
                ws = windows.get(key, [])
                ids = [_scalar(w, 'ID') for w in ws]
                groups = [_scalar(w, 'GroupID') for w in ws]
                if key in (None, '') or len(models.get(key, [])) != 1:
                    hold('BINDING_MASTER_SCOPE')
                ids_valid = None not in ids and '' not in ids and len(set(ids)) == len(ids)
                link_valid = ids_valid and all(_scalar(w, 'ParentWndId') in {'0', *ids}
                       and _scalar(w, 'AlignWndID') in {'', *ids} for w in ws)
                # Repeated nonzero groups are not rewritten: they may be a
                # supported multi-window group, but this reader cannot qualify
                # that scope for a new native binding write.
                group_valid = None not in groups and len([g for g in groups if g != '0']) == len(set(g for g in groups if g != '0'))
                if not ws or not link_valid or not group_valid:
                    hold('BINDING_WINDOW_SCOPE')
                path = literal_paths[id(part)]
                observed = literal_parts.get(path)
                bindings = literal_bindings.get(path, [])
                if observed and observed['state'] == 'repeated-scalar':
                    hold('BINDING_SCALAR_AMBIGUOUS')
                elif not observed or observed['state'] in ('missing-scalar', 'empty-scalar'):
                    hold('BINDING_SCALAR_MISSING')
                if any(b['state'] != 'recorded' for b in bindings):
                    hold('BINDING_TUPLE_SYNTAX')
                closed = sum(b['state'] == 'recorded' and b['window']['state'] == 'unique-literal-match'
                       and b['pad']['state'] == 'unique-literal-match'
                       and b['coordinateComparison']['state'] in ('literal-pair-equal', 'decimal-equal-text-differs') for b in bindings)
                if closed != len(bindings):
                    hold('BINDING_LITERAL_CLOSURE')
                # List suffixes, tuple ordinals and window GroupID are distinct
                # identity domains. Record one explicitly labelled ordinal
                # experiment without treating it as a native dependency.
                ordinal_list_matches = sum(b['state'] == 'recorded' and
                    _scalar(part, 'ListGerPadId' + str(i)) == b['tokens'][1]
                    for i, b in enumerate(bindings, 1))
                observations.append({'partId': _scalar(part, 'ID'), 'masterKey': key,
                    'windowCount': len(ws), 'windowLocalLinksClosed': bool(link_valid),
                    'nonzeroGroupsUnique': group_valid, 'bindingTupleCount': len(bindings),
                    'literalClosedTupleCount': closed,
                    'individualListOrdinalComparison': {'matches': ordinal_list_matches,
                        'comparedTuples': len(bindings), 'semanticsQualified': False,
                        'interpretation': 'Tuple ordinal compared with ListGerPadId suffix only; suffix and GroupID are not equated.'},
                    'commonListSemanticsQualified': False,
                    'literalState': 'closed-observed-syntax' if bindings and closed == len(bindings) else 'incomplete-or-unresolved',
                    'sourcePadCountEqualsTupleCount': bool(src) and len(src['sourceOwnedPads']) == len(bindings),
                    'countEqualityProvesBindingCompleteness': False,
                    'inspectionRepairEstablished': False})
            # These are shared qualification causes, even when local syntax is
            # perfectly closed. Do not promote an old malformed assignment or
            # a new empty binding to a supported engineering correction.
            hold('BINDING_SOURCE_NATIVE_FRAME_UNQUALIFIED')
            hold('BINDING_TUPLE_FIELDS_UNQUALIFIED')
            hold('BINDING_DEPENDENT_WINDOWS_UNVERIFIED')
            row = {'reference': ref, 'moduleId': module, 'cadId': _scalar(cad, 'ID'),
                'cadSourcePath': 'JobContainer/CadData/CpList/Cp[' + str(ordinal) + ']',
                'sourcePath': src['sourcePath'] if src else None,
                'sourceOwnership': 'explicit-pattern-pad-number' if src and src['ownedPadCentersAvailable'] else 'unavailable',
                'sourceOwnedPadCount': len(src['sourceOwnedPads']) if src else 0,
                'mountingEvidence': src['mountingEvidence'] if src else 'unknown',
                'sourceLayers': source_layers, 'nativePlacementCount': len(matching_parts),
                'placements': observations, 'bindingStatus': 'unresolved',
                'holdCodes': holds, 'nextAction': MESSAGES[holds[0]],
                'requiredEvidence': [MESSAGES[code] for code in holds],
                'bindingPreparationQualified': False, 'inspectionRepairEstablished': False}
            result['components'].append(row)
            for code in holds:
                shared[code].append({'reference': ref, 'moduleId': module, 'cadId': row['cadId']})
        result['sharedBlockers'] = [{'code': code, 'message': MESSAGES[code], 'componentCount': len(rows), 'components': rows}
                                    for code, rows in shared.items()]
        result['counts'] = {'cadRecords': len(cads), 'nativePlacements': len(literal['parts']),
            'sourceOwnedComponents': sum(c['sourceOwnership'] == 'explicit-pattern-pad-number' for c in result['components']),
            'componentsWithObservedClosedBindingSyntax': sum(any(p['literalState'] == 'closed-observed-syntax' for p in c['placements']) for c in result['components']),
            'bindingPreparationQualified': 0, 'inspectionRepairsEstablished': 0,
            'blockerComponentCounts': {code: len(rows) for code, rows in shared.items()}}
        if len(json.dumps(result, ensure_ascii=True, allow_nan=False).encode('ascii')) > MAX_OUTPUT_BYTES:
            return _failure('BINDING_LIMIT')
        return result
    except (CaptureBlocked, ValueError, TypeError, KeyError, ET.ParseError, InvalidOperation, OverflowError):
        return _failure('BINDING_INVALID_OR_UNSUPPORTED_INPUT')
