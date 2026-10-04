"""Bounded literal WND_PAD observations, without native ownership inference.

The six pipe-separated positions in each @-separated WND_PAD segment are
observations of an unqualified format. Position 1 is compared to a selected
Master window GroupID under the part's MasterKey; position 2 is compared to a
selected-job pad ID under exact ParentId/ModelID equality. A unique BlockID is
recorded, never inferred from the two uninterpreted middle positions. Coordinates
are compared exactly as decimal text values, without assigning a common frame.

PartNo -> CAD.ID is only a separately labelled relation experiment. Joinability
does not prove that PartNo denotes component ownership. Reference differences in
that experiment never generate findings or repair proposals. Nothing is edited.
"""
from collections import Counter, defaultdict
from decimal import Decimal
import json
import re


PROFILE = 'jobcontainer-10.2-observed-readonly-1'
MAX_RECORDS = 20_000
MAX_TUPLES = 20_000
MAX_OUTPUT_BYTES = 2_000_000
_KINDS = {'module-record', 'part-record', 'window-record', 'cad-record', 'pad-record', 'algorithm-record'}
_DECIMAL = re.compile(r'[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]{1,4})?\Z')


class _Limit(Exception):
    pass


def _json(value):
    return json.dumps(value, ensure_ascii=True, separators=(',', ':'), allow_nan=False).encode('ascii')


def _scalar(record, name):
    values = record['rawFields'].get(name, [])
    return values[0] if len(values) == 1 and values[0] != '' else None


def _key(record, names):
    values = tuple(_scalar(record, name) for name in names)
    return values if all(value is not None for value in values) else None


def _available(document):
    return isinstance(document, dict) and document.get('status') == 'recorded' and document.get('readerProfile') == PROFILE


def _validate(documents):
    if not isinstance(documents, dict):
        raise ValueError('documents')
    record_count = text_count = value_count = 0
    for role in ('job', 'master'):
        document = documents.get(role)
        if not _available(document):
            continue
        records = document.get('records')
        if not isinstance(records, list):
            raise ValueError('records')
        record_count += len(records)
        if record_count > MAX_RECORDS:
            raise _Limit()
        paths = set()
        for record in records:
            if not isinstance(record, dict) or record.get('kind') not in _KINDS:
                raise ValueError('record')
            path, fields = record.get('sourcePath'), record.get('rawFields')
            if not isinstance(path, str) or not path or len(path) > 2048 or path in paths:
                raise ValueError('path')
            paths.add(path)
            text_count += len(path)
            if not isinstance(fields, dict) or len(fields) > 64:
                raise ValueError('fields')
            for field, values in fields.items():
                if not isinstance(field, str) or not field or len(field) > 512 or not isinstance(values, list):
                    raise ValueError('field')
                value_count += len(values)
                if value_count > 500_000:
                    raise _Limit()
                for value in values:
                    if not isinstance(value, str) or len(value) > 2048:
                        raise ValueError('scalar')
                    text_count += len(value)
                    if text_count > 4_000_000:
                        raise _Limit()


def _failure(status, code, reason):
    return {'artifactType': 'scan.native-literal-bindings', 'schemaVersion': '1',
            'analyzerVersion': 'native-literal-bindings-1', 'status': status, 'code': code, 'reason': reason,
            'literalObservationsComplete': False, 'counts': None, 'parts': [], 'bindings': [], 'findings': [],
            'padCadRelationExperiment': None, 'ownershipQualified': False, 'nativeSchemaQualified': False,
            'machineExportAllowed': False, 'nativeEditsApplied': False, 'repairEligibility': 'unqualified'}


def _index(records, fields):
    result = defaultdict(list)
    unusable = 0
    for record in records:
        key = _key(record, fields)
        if key is None:
            unusable += 1
        else:
            result[key].append(record)
    return result, unusable


def _match(records, state=None):
    return {'state': state or ('unmatched' if not records else 'unique-literal-match' if len(records) == 1 else 'ambiguous'),
            'targetCount': len(records), 'targetSourcePaths': [record['sourcePath'] for record in records[:5]],
            'omittedTargetCount': max(0, len(records) - 5)}


def _number(value):
    stripped = value.strip()
    if len(stripped) > 128 or not _DECIMAL.fullmatch(stripped):
        return None
    return Decimal(stripped)


def _point_comparison(tokens, pad):
    values = pad['rawFields'].get('C', []) if pad is not None else []
    point = values[0].split(',') if len(values) == 1 else []
    result = {'tupleXYLiterals': list(tokens), 'padCenterLiterals': list(values), 'state': 'unavailable',
              'interpretation': 'Exact decimal equality only; units, frame and geometric ownership remain unqualified.'}
    if pad is None:
        return result
    if len(point) != 2 or any(_number(v) is None for v in [*tokens, *point]):
        result['state'] = 'unusable-coordinate-literal'
    elif tokens == point:
        result['state'] = 'literal-pair-equal'
    elif tuple(map(_number, tokens)) == tuple(map(_number, point)):
        result['state'] = 'decimal-equal-text-differs'
    else:
        result['state'] = 'different-decimal-values'
    return result


def report_native_bindings(documents):
    """Return exact source-path observations from read_native_records documents.

    Supported inputs and complete output are bounded; on a limit/invalid input,
    no partial observation list is represented as complete. Source strings and
    identity domains stay distinct. Missing selected Master records are reported
    unavailable, never mistaken for dangling window references.
    """
    try:
        _validate(documents)
        if not _available(documents.get('job')):
            return _failure('unavailable', 'NATIVE_BINDINGS_UNAVAILABLE', 'The selected job has no supported literal record inventory.')
        job = documents['job']['records']
        master_available = _available(documents.get('master'))
        master = documents['master']['records'] if master_available else []
        parts = [record for record in job if record['kind'] == 'part-record']
        pads = [record for record in job if record['kind'] == 'pad-record']
        cads = [record for record in job if record['kind'] == 'cad-record']
        windows = [record for record in master if record['kind'] == 'window-record']
        pad_index, unusable_pad_ids = _index(pads, ('ID',))
        scoped_pad_index, _ = _index(pads, ('ID', 'ModelID'))
        unusable_pad_models = {key for key, group in pad_index.items()
                               if any(_scalar(pad, 'ModelID') is None for pad in group)}
        unusable_pad_blocks = {key for key, group in scoped_pad_index.items()
                               if any(_scalar(pad, 'BlockID') is None for pad in group)}
        cad_index, unusable_cad_keys = _index(cads, ('ModuleID', 'ID'))
        window_index, unusable_window_keys = _index(windows, ('ParentId', 'GroupID'))
        result = {
            'artifactType': 'scan.native-literal-bindings', 'schemaVersion': '1',
            'analyzerVersion': 'native-literal-bindings-1', 'status': 'recorded',
            'code': 'NATIVE_LITERAL_BINDINGS_RECORDED', 'readerProfile': PROFILE,
            'literalObservationsComplete': True, 'ownershipQualified': False,
            'nativeSchemaQualified': False, 'machineExportAllowed': False,
            'nativeEditsApplied': False, 'repairEligibility': 'unqualified',
            'interpretation': 'Exact selected-document source-string comparisons; these are not qualified native dependencies, pad ownership or repair proposals.',
            'scopeRules': {
                'window': 'job part.MasterKey + WND_PAD position 1 compared with selected Master window.ParentId + GroupID; Window.ID is a distinct domain.',
                'pad': 'WND_PAD position 2 compared with job pad.ID; part.ParentId compared literally with pad.ModelID. BlockID must be unique among these matches; no tuple position is presumed to select a block.',
                'coordinates': 'WND_PAD positions 5/6 compared with comma-separated pad.C, using exact decimal equality without a transform or tolerance.',
                'sentinels': 'Empty, 0 and -1 are flagged as sentinel-like source strings only. Their meaning is unknown and a nonempty literal is still compared exactly.',
            },
            'parts': [], 'bindings': [], 'findings': [],
            'limitations': [
                'Middle tuple positions 3 and 4 remain uninterpreted.',
                'Literal matches do not qualify ID domains, coordinates, physical ownership, dependency completeness or Eagle compatibility.',
                'PartNo/CAD.ID correspondence is a separate relation experiment, not ownership evidence; its reference differences are not defects.',
                'No nearest-distance matching, ID arithmetic, ordinal fallback, repair generation or native edits are performed.',
            ],
        }
        budget = 0

        def append(section, item):
            nonlocal budget
            budget += len(_json(item)) + 1
            if budget > MAX_OUTPUT_BYTES:
                raise _Limit()
            result[section].append(item)

        def finding(code, part, message, ordinal=None):
            append('findings', {'code': code, 'severity': 'observation', 'sourcePath': part['sourcePath'],
                                'segmentOrdinal': ordinal, 'message': message,
                                'ownershipQualified': False, 'repairEligibility': 'unqualified'})

        experiment = {
            'status': 'relation-experiment-only', 'ownershipEvidence': False,
            'sourceFields': ['job.pad.ModelID', 'job.pad.PartNo'],
            'targetFields': ['job.cad.ModuleID', 'job.cad.ID'],
            'interpretation': 'Candidate exact-string join only. A unique join does not establish the meaning of PartNo or prove component ownership. Bound-part/CAD RefID differences are experimental comparisons, not findings.',
            'padJoinCounts': {}, 'boundPartReferenceComparisonCounts': {},
            'examples': [], 'omittedExampleCount': 0,
        }
        experiment_counts, reference_counts = Counter(), Counter()
        cad_for_pad = {}
        for pad in pads:
            key = _key(pad, ('ModelID', 'PartNo'))
            matches = cad_index.get(key, []) if key is not None else []
            state = 'unusable-source-key' if key is None else 'unmatched' if not matches else 'unique-literal-match' if len(matches) == 1 else 'ambiguous'
            experiment_counts[state] += 1
            if len(matches) == 1:
                cad_for_pad[pad['sourcePath']] = matches[0]

        counts, window_counts, pad_counts, coordinate_counts = Counter(), Counter(), Counter(), Counter()
        counts.update(parts=len(parts), padRecords=len(pads), cadRecords=len(cads), masterWindowRecords=len(windows),
                      unusablePadIdRecords=unusable_pad_ids, unusableCadKeyRecords=unusable_cad_keys,
                      unusableWindowKeyRecords=unusable_window_keys if master_available else 0)
        for part in parts:
            fields = part['rawFields']
            values = fields.get('WND_PAD', [])
            part_result = {'sourcePath': part['sourcePath'],
                           'identityLiterals': {name: list(fields.get(name, [])) for name in ('ID', 'ParentId', 'RefID', 'MasterKey')},
                           'wndPadLiterals': list(values), 'state': 'recorded', 'segmentCount': 0, 'emptySegmentOrdinals': []}
            if len(values) != 1:
                part_result['state'] = 'missing-scalar' if not values else 'repeated-scalar'
                counts[part_result['state']] += 1
                finding('WND_PAD_SCALAR_UNAVAILABLE', part, 'WND_PAD is missing or repeated; no scalar was selected or silently combined.')
                append('parts', part_result)
                continue
            if values[0] == '':
                part_result['state'] = 'empty-scalar'
                counts['empty-scalar'] += 1
                append('parts', part_result)
                continue
            segments = values[0].split('@')
            part_result['segmentCount'] = len(segments)
            for ordinal, raw in enumerate(segments, 1):
                if raw == '':
                    part_result['emptySegmentOrdinals'].append(ordinal)
                    counts['emptySegments'] += 1
                    continue
                counts['nonemptySegments'] += 1
                if counts['nonemptySegments'] > MAX_TUPLES:
                    raise _Limit()
                tokens = raw.split('|')
                binding = {'partSourcePath': part['sourcePath'], 'sourceField': 'WND_PAD', 'segmentOrdinal': ordinal,
                           'rawSegment': raw, 'tokens': tokens, 'state': 'recorded', 'ownership': 'unknown'}
                if len(tokens) != 6:
                    binding['state'] = 'unsupported-token-count'
                    counts['unsupportedTokenCount'] += 1
                    finding('WND_PAD_TOKEN_COUNT', part, 'A nonempty segment does not contain exactly six literal positions; it was preserved without interpreting a prefix.', ordinal)
                    append('bindings', binding)
                    continue
                counts['sixFieldSegments'] += 1
                binding['sentinelLikeLiterals'] = [{'position': pos, 'literal': token} for pos, token in enumerate(tokens, 1) if token in ('', '0', '-1')]
                binding['uninterpretedPositions'] = [3, 4]
                master_key, module = _scalar(part, 'MasterKey'), _scalar(part, 'ParentId')
                window_key = (master_key, tokens[0]) if master_key is not None and tokens[0] != '' else None
                matched_windows = window_index.get(window_key, []) if window_key is not None else []
                window_state = 'unavailable-document' if not master_available else 'unusable-source-key' if window_key is None else None
                binding['window'] = _match(matched_windows, window_state)
                binding['window']['sourceLiterals'] = {'partMasterKey': master_key, 'tupleGroupID': tokens[0]}
                binding['window']['selectedWindowLiterals'] = ({name: _scalar(matched_windows[0], name) for name in ('ID', 'ParentId', 'GroupID')}
                                                               if binding['window']['state'] == 'unique-literal-match' else None)
                window_counts[binding['window']['state']] += 1
                if binding['window']['state'] not in ('unique-literal-match', 'unavailable-document'):
                    finding('WND_PAD_WINDOW_LITERAL_UNRESOLVED', part, 'The exact MasterKey/GroupID comparison does not identify one selected Master window; no window identity was inferred.', ordinal)
                candidates = pad_index.get((tokens[1],), []) if tokens[1] != '' else []
                scoped = scoped_pad_index.get((tokens[1], module), []) if module is not None else []
                unusable_scope = (tokens[1],) in unusable_pad_models or (tokens[1], module) in unusable_pad_blocks
                state = ('unusable-source-key' if module is None or tokens[1] == '' else
                         'unusable-target-scope' if unusable_scope else
                         'module-literal-differs' if candidates and not scoped else None)
                binding['pad'] = _match(scoped, state)
                binding['pad']['sourceLiterals'] = {'partParentId': module, 'tuplePadID': tokens[1]}
                binding['pad']['unscopedIdMatchCount'] = len(candidates)
                binding['pad']['unscopedTargetSourcePaths'] = [pad['sourcePath'] for pad in candidates[:5]]
                pad = scoped[0] if binding['pad']['state'] == 'unique-literal-match' else None
                binding['pad']['selectedScopeLiterals'] = ({name: _scalar(pad, name) for name in ('ID', 'ModelID', 'BlockID')} if pad is not None else None)
                pad_counts[binding['pad']['state']] += 1
                if pad is None:
                    finding('WND_PAD_PAD_LITERAL_UNRESOLVED', part, 'The exact pad-ID/module comparison lacks one usable ModelID/BlockID-scoped record; no pad ownership was inferred.', ordinal)
                binding['coordinateComparison'] = _point_comparison(tokens[4:], pad)
                coordinate_state = binding['coordinateComparison']['state']
                coordinate_counts[coordinate_state] += 1
                if coordinate_state in ('unusable-coordinate-literal', 'different-decimal-values'):
                    finding('WND_PAD_COORDINATE_LITERAL_OBSERVATION', part, 'The tuple XY and selected pad.C cannot be read as equal decimal values. This does not establish a common coordinate frame or a repair.', ordinal)
                if pad is not None:
                    cad = cad_for_pad.get(pad['sourcePath'])
                    part_ref = _scalar(part, 'RefID')
                    cad_ref = _scalar(cad, 'RefID') if cad is not None else None
                    compare = ('unavailable-candidate-cad' if cad is None else 'unusable-reference-literal' if part_ref is None or cad_ref is None else
                               'equal-reference-literals' if part_ref == cad_ref else 'different-reference-literals')
                    reference_counts[compare] += 1
                    if len(experiment['examples']) < 25:
                        experiment['examples'].append({'partSourcePath': part['sourcePath'], 'segmentOrdinal': ordinal,
                            'padSourcePath': pad['sourcePath'], 'padModelIDLiteral': _scalar(pad, 'ModelID'), 'padPartNoLiteral': _scalar(pad, 'PartNo'),
                            'candidateCadSourcePath': cad['sourcePath'] if cad else None, 'partRefIDLiteral': part_ref,
                            'candidateCadIdentityLiterals': {name: _scalar(cad, name) for name in ('ID', 'ModuleID')} if cad else None,
                            'candidateCadRefIDLiteral': cad_ref, 'comparison': compare})
                    else:
                        experiment['omittedExampleCount'] += 1
                append('bindings', binding)
            append('parts', part_result)
        experiment['padJoinCounts'] = dict(experiment_counts)
        experiment['boundPartReferenceComparisonCounts'] = dict(reference_counts)
        result['padCadRelationExperiment'] = experiment
        result['counts'] = {**dict(counts), 'findings': len(result['findings']), 'windowMatches': dict(window_counts),
                            'padMatches': dict(pad_counts), 'coordinateComparisons': dict(coordinate_counts),
                            'masterDocumentAvailable': master_available}
        if len(_json(result)) > MAX_OUTPUT_BYTES:
            raise _Limit()
        return result
    except _Limit:
        return _failure('blocked', 'NATIVE_BINDINGS_LIMIT', 'Literal binding observations exceed bounded record, scalar, tuple or output limits; no partial report is returned.')
    except (ValueError, TypeError, KeyError):
        return _failure('blocked', 'NATIVE_BINDINGS_INVALID_INPUT', 'The literal reader record representation is invalid. No source contents were logged.')
