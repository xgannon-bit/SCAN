"""Bounded literal accounting of an existing job, without native repair semantics.

Rows describe selected-job CAD records and otherwise unrepresented native parts.
They are not a verified population list. Correspondence groups avoid expanding a
many-to-many CAD/part match into a quadratic collection of apparent components.
"""
from collections import Counter, defaultdict
from decimal import Decimal, localcontext
from hashlib import sha256
import json
import re


PROFILE = 'jobcontainer-10.2-observed-readonly-1'
MAX_RECORDS = 10_000
MAX_OUTPUT_BYTES = 3_000_000
_KINDS = {'module-record', 'part-record', 'cad-record', 'window-record', 'pad-record', 'algorithm-record'}
_NUMBER = re.compile(r'[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?\Z')
_COMPARE_FIELDS = (
    'Name', 'ModelNo', 'MasterKey', 'ENABLE', 'CenterPosX', 'CenterPosY',
    'CadOffset/X', 'CadOffset/Y', 'Roi/cx', 'Roi/cy', 'Roi/w', 'Roi/h', 'Roi/a',
)
_IDENTITY_FIELDS = {
    'module-record': ('ID',),
    'part-record': ('ID', 'ParentId', 'RefID', 'MasterKey'),
    'cad-record': ('ID', 'ModuleID', 'RefID'),
    'window-record': ('ID', 'ParentId'),
}
_NUMERIC_FIELDS = {
    'module-record': ('Angle', 'Shift/X', 'Shift/Y', 'RotCenter/X', 'RotCenter/Y'),
    'part-record': ('CenterPosX', 'CenterPosY', 'CadOffset/X', 'CadOffset/Y',
                    'Roi/cx', 'Roi/cy', 'Roi/w', 'Roi/h', 'Roi/a'),
    'cad-record': ('X', 'Y', 'Ang'),
    'window-record': ('RelRoi/cx', 'RelRoi/cy', 'RelRoi/w', 'RelRoi/h', 'RelRoi/a'),
}


class _Limit(Exception):
    pass


def _json(value):
    return json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(',', ':'), allow_nan=False)


def _scalar(record, field):
    values = record['rawFields'].get(field, [])
    return values[0] if len(values) == 1 and values[0] != '' else None


def _scope(record):
    field = 'ModuleID' if record['kind'] == 'cad-record' else 'ParentId'
    module, reference = _scalar(record, field), _scalar(record, 'RefID')
    return (module, reference) if module is not None and reference is not None else None


def _failure(status, code, reason):
    return {
        'artifactType': 'scan.native-accounting', 'schemaVersion': '1',
        'analyzerVersion': 'native-literal-accounting-2', 'status': status,
        'code': code, 'reason': reason, 'accountingComplete': False,
        'findings': [], 'componentCoverage': [], 'nativeInstances': [], 'coordinateComparisons': [], 'coordinatePatterns': [],
        'correspondenceGroups': [], 'moduleGroups': [], 'remainingWork': [], 'sharedBlockers': [],
        'counts': None, 'changes': [], 'machineExportAllowed': False,
        'nativeEditsApplied': False,
    }


def analyze_native(documents, source_context):
    """Account for literal records from preflight.nativeRecords without mutation.

    The 10,000-record limit applies to the selected job document. Master records
    are not interpreted here; the existing dependency report remains independent.
    On invalid reader structure or any limit failure, no partial accounting is
    returned. Missing, blank, repeated and nonnumeric source fields are retained
    as observations when the reader's record representation itself is valid.
    """
    try:
        keys = ('archiveSha256', 'snapshotId', 'jobMember', 'jobSha256')
        if not isinstance(source_context, dict) or any(k not in source_context for k in keys):
            raise ValueError('context')
        context = {k: source_context[k] for k in keys}
        if any(not isinstance(v, str) or not v or len(v) > 2048 for v in context.values()):
            raise ValueError('context')
        if any(re.fullmatch(r'[0-9a-f]{64}', context[k]) is None for k in ('archiveSha256', 'jobSha256')):
            raise ValueError('hash')
        if not isinstance(documents, dict):
            raise ValueError('documents')
        document = documents.get('job')
        if not isinstance(document, dict) or document.get('status') != 'recorded' or document.get('readerProfile') != PROFILE:
            return _failure('unavailable', 'NATIVE_RECORDS_UNAVAILABLE', 'The selected job has no supported literal record inventory. Population and preparation are unknown.')
        records = document.get('records')
        if not isinstance(records, list):
            raise ValueError('records')
        if len(records) > MAX_RECORDS:
            raise _Limit()
        paths, text_count, value_count = set(), 0, 0
        for record in records:
            if not isinstance(record, dict) or record.get('kind') not in _KINDS:
                raise ValueError('record')
            path, fields = record.get('sourcePath'), record.get('rawFields')
            if not isinstance(path, str) or not path or len(path) > 2048 or path in paths:
                raise ValueError('path')
            container = record.get('containerSourcePath')
            if container is not None and (not isinstance(container, str) or not container or len(container) > 2048):
                raise ValueError('container')
            paths.add(path)
            if not isinstance(fields, dict) or len(fields) > 64:
                raise ValueError('fields')
            for field, values in fields.items():
                if not isinstance(field, str) or not field or len(field) > 512 or not isinstance(values, list):
                    raise ValueError('field')
                value_count += len(values)
                if value_count > 250_000:
                    raise _Limit()
                for value in values:
                    if not isinstance(value, str) or len(value) > 2048:
                        raise ValueError('scalar')
                    text_count += len(value)
                    if text_count > 2_000_000:
                        raise _Limit()

        basis = sha256(_json(context).encode()).hexdigest()
        def identity(kind, key):
            return kind + '-' + sha256(_json([basis, kind, key]).encode()).hexdigest()[:24]

        result = {
            'artifactType': 'scan.native-accounting', 'schemaVersion': '1',
            'analyzerVersion': 'native-literal-accounting-2', 'status': 'recorded',
            'code': 'LITERAL_ACCOUNTING_RECORDED', 'accountingComplete': True,
            'sourceContext': context, 'readerProfile': PROFILE,
            'interpretation': 'Selected-job CAD rows and native part instances; exact source-string correspondence only. This is not qualified population, teaching, geometry or repair eligibility.',
            'enableLiteralInterpretation': 'Histogram values count raw ENABLE scalar occurrences, including repeated values; they are not counts of enabled inspections.',
            'findings': [], 'componentCoverage': [], 'nativeInstances': [], 'coordinateComparisons': [], 'coordinatePatterns': [],
            'correspondenceGroups': [], 'moduleGroups': [], 'remainingWork': [], 'sharedBlockers': [],
            'changes': [], 'machineExportAllowed': False, 'nativeEditsApplied': False,
        }
        budget = 0
        def append(section, item):
            nonlocal budget
            budget += len(_json(item).encode('ascii')) + 1
            if budget > MAX_OUTPUT_BYTES:
                raise _Limit()
            result[section].append(item)

        by_kind = {kind: [] for kind in _KINDS}
        record_ids = {}
        for record in records:
            by_kind[record['kind']].append(record)
            record_ids[record['sourcePath']] = identity('record', [record['kind'], record['sourcePath']])
        cads, parts = by_kind['cad-record'], by_kind['part-record']
        cad_scopes, part_scopes, modules = defaultdict(list), defaultdict(list), defaultdict(list)
        for record in by_kind['module-record']:
            key = _scalar(record, 'ID')
            if key is not None:
                modules[key].append(record)
        for collection, index in ((cads, cad_scopes), (parts, part_scopes)):
            for record in collection:
                key = _scope(record)
                if key is not None:
                    index[key].append(record)
        for module, module_records in modules.items():
            append('moduleGroups', {'id': identity('module', module), 'moduleLiteral': module,
                                    'sourcePaths': [r['sourcePath'] for r in module_records],
                                    'recordCount': len(module_records)})
        row_ids_by_path, group_rows = {}, defaultdict(list)
        coverage_count = Counter()

        def add_row(record, source_type):
            key = _scope(record)
            row_id = identity('row', [source_type, record['sourcePath']])
            row_ids_by_path[record['sourcePath']] = row_id
            matches = len(part_scopes.get(key, [])) if key is not None else 0
            correspondence = ('unusable-scope' if key is None else
                              'native-only' if source_type == 'native-part-only' else
                              'no-literal-match' if matches == 0 else
                              'unique-literal-match' if matches == 1 else 'multiple-literal-matches')
            group_id = identity('scope', key) if key is not None else None
            if key is not None:
                group_rows[key].append(row_id)
            coverage_count[correspondence] += 1
            append('componentCoverage', {
                'id': row_id, 'sourcePath': record['sourcePath'],
                'recordId': record_ids[record['sourcePath']], 'groupId': group_id,
                'moduleLiteral': key[0] if key is not None else _scalar(record, 'ModuleID' if source_type == 'native-cad-row' else 'ParentId'),
                'referenceLiteral': _scalar(record, 'RefID'),
                'sourceRepresentation': source_type, 'nativeCorrespondence': correspondence,
                'nativePreparation': 'not-prepared', 'existingTeaching': 'unassessed',
                'enabledState': 'unqualified', 'verification': 'not-verified',
                'release': 'not-assessed', 'exclusion': 'not-assessed',
            })

        for record in cads:
            add_row(record, 'native-cad-row')
        for record in parts:
            key = _scope(record)
            if key is None or key not in cad_scopes:
                add_row(record, 'native-part-only')

        enable_counts, enable_literals = Counter(), Counter()
        for record in parts:
            values = record['rawFields'].get('ENABLE', [])
            observation = ('missing' if not values else 'repeated' if len(values) != 1 else
                           'literal-1' if values[0] == '1' else 'literal-0' if values[0] == '0' else 'other-literal')
            enable_counts[observation] += 1
            enable_literals.update(values)
            key = _scope(record)
            append('nativeInstances', {
                'id': record_ids[record['sourcePath']], 'sourcePath': record['sourcePath'],
                'groupId': identity('scope', key) if key is not None else None,
                'coverageRowId': row_ids_by_path.get(record['sourcePath']),
                'nativeIdLiterals': list(record['rawFields'].get('ID', [])),
                'enableLiterals': list(values), 'enableObservation': observation,
                'enabledMeaning': 'unqualified',
            })

        def finding(code, key, paths, message, action, group_id=None):
            finding_id = identity('finding', [code, key])
            append('findings', {'id': finding_id, 'code': code, 'severity': 'observation',
                                'sourcePaths': paths, 'groupId': group_id,
                                'message': message, 'repairEligibility': 'unqualified'})
            append('remainingWork', {'id': identity('work', finding_id), 'findingId': finding_id,
                                     'groupId': group_id, 'nextAction': action})

        scope_keys = list(dict.fromkeys([*cad_scopes.keys(), *part_scopes.keys()]))
        for key in scope_keys:
            cad_records, part_records = cad_scopes.get(key, []), part_scopes.get(key, [])
            module_records = modules.get(key[0], [])
            group_id = identity('scope', key)
            group = {
                'id': group_id, 'moduleLiteral': key[0], 'referenceLiteral': key[1],
                'cadRecordIds': [record_ids[r['sourcePath']] for r in cad_records],
                'nativeInstanceIds': [record_ids[r['sourcePath']] for r in part_records],
                'moduleGroupId': identity('module', key[0]) if module_records else None,
                'moduleRecordCount': len(module_records),
                'moduleMatchState': 'unmatched' if not module_records else 'unique-literal-match' if len(module_records) == 1 else 'multiple-literal-matches',
                'affectedRowIds': group_rows[key],
                'duplicateMeaning': 'unqualified; repeated correspondence does not prove redundancy',
            }
            if len(part_records) > 1:
                equal, different, unusable = [], [], []
                for field in _COMPARE_FIELDS:
                    first = part_records[0]['rawFields'].get(field, [])
                    same = all(r['rawFields'].get(field, []) == first for r in part_records[1:])
                    (equal if same else different).append(field)
                    if any(len(r['rawFields'].get(field, [])) != 1 or r['rawFields'][field][0] == '' for r in part_records):
                        unusable.append(field)
                group['rawFieldComparison'] = {'equalFields': equal, 'differentFields': different,
                                               'unusableFields': unusable, 'comparisonScope': 'selected raw part fields only; not complete native semantics'}
                finding('MULTIPLE_NATIVE_PART_RECORDS', key, [r['sourcePath'] for r in part_records],
                        'Several native part records share this exact module/reference key. No survivor or redundant inspection is identified.',
                        'Establish placement identity and ENABLE/shared-model semantics in Eagle before deciding whether any record is redundant.', group_id)
            if len(cad_records) > 1:
                finding('MULTIPLE_NATIVE_CAD_ROWS', key, [r['sourcePath'] for r in cad_records],
                        'Several selected-job CAD rows share this exact module/reference key; every row remains accounted for.',
                        'Check the intended source population and module/reference identity; do not silently collapse these rows.', group_id)
            if not cad_records or not part_records:
                finding('CAD_PART_KEY_UNMATCHED', key, [r['sourcePath'] for r in cad_records + part_records],
                        'This exact module/reference key occurs on only one side of the selected-job CAD/part comparison.',
                        'Reconcile source population and native placement identity before assigning missing preparation or exclusion.', group_id)
            append('correspondenceGroups', group)

        # Numeric field comparisons are triage observations, not transformations.
        # Never compare to external CAD or declare that the native frames agree.
        coordinate_counts = Counter()
        offset_groups = defaultdict(list)
        for part in parts:
            key = _scope(part)
            candidates = cad_scopes.get(key, []) if key is not None else []
            cad_state = ('unusable-module-reference' if key is None else
                         'unmatched-cad' if not candidates else
                         'ambiguous-cad-part-correspondence' if len(candidates) != 1 or len(part_scopes[key]) != 1 else None)
            pairs = (
                ('roi-minus-placement-center', part, ('Roi/cx', 'Roi/cy'), part, ('CenterPosX', 'CenterPosY'), None),
                ('placement-center-minus-native-cad', part, ('CenterPosX', 'CenterPosY'), candidates[0] if cad_state is None else None, ('X', 'Y'), cad_state),
                ('roi-minus-native-cad', part, ('Roi/cx', 'Roi/cy'), candidates[0] if cad_state is None else None, ('X', 'Y'), cad_state),
            )
            for relation, left, left_fields, right, right_fields, unavailable in pairs:
                left_point = _coordinate_point(left, left_fields)
                right_point = _coordinate_point(right, right_fields) if right is not None else None
                delta = _coordinate_delta(left_point, right_point) if left_point is not None and right_point is not None else None
                state = 'unavailable' if delta is None else 'numerically-equal' if delta == ['0', '0'] else 'numeric-difference'
                coordinate_counts[state] += 1
                comparison_id = identity('coordinate-comparison', [part['sourcePath'], relation])
                append('coordinateComparisons', {
                    'id': comparison_id, 'partSourcePath': part['sourcePath'],
                    'groupId': identity('scope', key) if key is not None else None,
                    'relation': relation, 'state': state, 'deltaXY': delta,
                    'unavailableReason': (unavailable or 'missing-repeated-or-unsupported-coordinate') if delta is None else None,
                    'left': {'sourcePath': left['sourcePath'], 'fields': list(left_fields), 'literals': [left['rawFields'].get(f, []) for f in left_fields]},
                    'right': {'sourcePath': right['sourcePath'] if right is not None else None, 'fields': list(right_fields), 'literals': [right['rawFields'].get(f, []) for f in right_fields] if right is not None else None},
                    'unitsAndCommonFrameQualified': False, 'repairEligibility': 'unqualified',
                })
                if state != 'numeric-difference':
                    continue
                # Without a qualified common frame, do not manufacture a defect
                # or a separate correction task from each numeric difference.
                if key is not None and len(modules.get(key[0], [])) == 1 and _scalar(part, 'ID') is not None:
                    offset_groups[(key[0], relation, *delta)].append((part, key))
        for offset, members in offset_groups.items():
            references = {key[1] for _, key in members}
            if len(references) < 2:
                continue
            module, relation, dx, dy = offset
            affected_rows = list(dict.fromkeys(row for _, key in members for row in group_rows[key]))
            append('coordinatePatterns', {'id': identity('coordinate-pattern', offset),
                'moduleLiteral': module, 'relation': relation, 'deltaXY': [dx, dy],
                'affectedRowIds': affected_rows, 'referenceLiterals': sorted(references),
                'partSourcePaths': [part['sourcePath'] for part, _ in members],
                'interpretation': 'Repeated numeric pattern only; not a proven board/module transform, physical defect or permission for a bulk correction.',
                'repairEligibility': 'unqualified'})

        # ID comparisons retain known structural containment. Flat pad scope
        # fields are compared literally, without declaring native uniqueness.
        id_groups = defaultdict(list)
        for record in records:
            value = _scalar(record, 'ID')
            if value is not None:
                parent = _scalar(record, 'ParentId') if record['kind'] == 'window-record' else None
                scoped = True
                if record['kind'] == 'algorithm-record':
                    parent = record.get('containerSourcePath')
                    scoped = parent is not None
                elif record['kind'] == 'pad-record':
                    parent = (_scalar(record, 'ModelID'), _scalar(record, 'BlockID'))
                    scoped = all(field is not None for field in parent)
                if scoped:
                    id_groups[(record['kind'], parent, value)].append(record)
            fields = record['rawFields']
            missing = [name for name in _IDENTITY_FIELDS.get(record['kind'], ()) if not fields.get(name) or fields[name] == ['']]
            repeated = [name for name, values in fields.items() if len(values) > 1]
            nonnumeric = [name for name in _NUMERIC_FIELDS.get(record['kind'], ())
                          if len(fields.get(name, [])) == 1 and not _NUMBER.fullmatch(fields[name][0].strip())]
            issues = []
            if missing:
                issues.append('Absent/empty literal identity fields: ' + ', '.join(missing))
            if repeated:
                issues.append('Repeated scalar fields: ' + ', '.join(sorted(repeated)))
            if nonnumeric:
                issues.append('Non-numeric coordinate literals: ' + ', '.join(nonnumeric))
            if issues:
                finding('NATIVE_SCALAR_OBSERVATION', record['sourcePath'], [record['sourcePath']],
                        '. '.join(issues) + '. No scalar was selected or corrected.',
                        'Review these exact fields against the selected source and Eagle interpretation before a repair is proposed.',
                        identity('scope', _scope(record)) if record['kind'] in ('cad-record', 'part-record') and _scope(record) is not None else None)
        for key, collision in id_groups.items():
            if len(collision) > 1:
                comparison = ('the same containing-window source path' if key[0] == 'algorithm-record' else
                              'the same literal ModelID/BlockID tuple' if key[0] == 'pad-record' else
                              'the same literal ID comparison scope')
                finding('NATIVE_ID_LITERAL_COLLISION', key, [r['sourcePath'] for r in collision],
                        f'Several records in {comparison} share an ID. The required native uniqueness scope is not yet qualified.',
                        'Confirm the native identity domain and dependency targets in Eagle before changing an ID or placement.')

        for module, scoped_keys in _module_scope_index(scope_keys).items():
            module_records = modules.get(module, [])
            if len(module_records) != 1:
                affected = [row for key in scoped_keys for row in group_rows[key]]
                blocker_id = identity('blocker', ['module-literal', module])
                append('sharedBlockers', {'id': blocker_id, 'code': 'MODULE_LITERAL_REFERENCE_UNRESOLVED',
                                         'scope': 'module-literal', 'moduleLiteral': module,
                                         'affectedRowIds': affected,
                                         'reason': 'The module literal has no unique module record. A common frame or side has not been established.'})
                append('remainingWork', {'id': identity('work', blocker_id), 'blockerId': blocker_id,
                                         'nextAction': 'Resolve this shared module identity before interpreting placement coordinates or side.'})

        all_rows = [row['id'] for row in result['componentCoverage']]
        for code, reason, action in (
            ('NATIVE_SEMANTICS_UNQUALIFIED', 'Units, frames, side codes, enablement, teaching and shared-model effects are unqualified. Numeric coordinate differences are evidence, not individual defects.',
             'Establish the ROI, placement-center and native CAD coordinate frames and legitimate component origins against supported independent evidence before proposing geometry corrections. Keep CAD and teaching unchanged while resolving this shared prerequisite; qualify the exact Eagle build separately.'),
            ('NATIVE_REQUIRED_ASSETS_UNRESOLVED', 'Preserving files and literal references does not establish required model/image dependency completeness.',
             'Verify required job companions and any external dependencies through the supported Eagle workflow.'),
            ('EAGLE_CANDIDATE_UNVERIFIED', 'No changed candidate or Eagle open/save/reopen evidence exists in this structural report.',
             'After a supported reviewed change, verify the exact separate candidate in Eagle; record remaining teaching and machine work.'),
        ):
            blocker_id = identity('blocker', code)
            append('sharedBlockers', {'id': blocker_id, 'code': code, 'scope': 'job',
                                     'affectedRowIds': list(all_rows), 'reason': reason})
            append('remainingWork', {'id': identity('work', blocker_id), 'blockerId': blocker_id, 'nextAction': action})

        result['counts'] = {
            'jobRecords': len(records), 'moduleRecords': len(by_kind['module-record']),
            'cadRows': len(cads), 'nativePartInstances': len(parts),
            'windowRecords': len(by_kind['window-record']), 'coverageRows': len(all_rows),
            'padRecords': len(by_kind['pad-record']), 'algorithmRecords': len(by_kind['algorithm-record']),
            'nativeOnlyRows': sum(row['sourceRepresentation'] == 'native-part-only' for row in result['componentCoverage']),
            'literalCorrespondence': dict(coverage_count), 'enableLiteralObservations': dict(enable_counts),
            'enableLiteralHistogram': dict(enable_literals),
            'coordinateComparisons': dict(coordinate_counts),
            'findings': len(result['findings']), 'sharedBlockers': len(result['sharedBlockers']),
            'intendedComponents': None, 'nativeEditsApplied': 0,
            'qualifiedPreparedComponents': None, 'qualifiedEnabledComponents': None,
            'qualifiedTaughtComponents': None, 'verifiedComponents': None, 'releasedComponents': None,
        }
        if len(_json(result).encode('ascii')) > MAX_OUTPUT_BYTES:
            raise _Limit()
        return result
    except _Limit:
        return _failure('blocked', 'NATIVE_ACCOUNTING_LIMIT', 'Native accounting exceeds its bounded record, scalar or output limit. No partial accounting is reported.')
    except (ValueError, TypeError, KeyError):
        return _failure('blocked', 'NATIVE_ACCOUNTING_INVALID_INPUT', 'The source identity or literal reader record structure is invalid. No source contents were logged.')


def _module_scope_index(scope_keys):
    index = defaultdict(list)
    for key in scope_keys:
        index[key[0]].append(key)
    return index


def _coordinate_point(record, names):
    point = []
    for name in names:
        value = _scalar(record, name)
        if value is None:
            return None
        value = value.strip()
        if len(value) > 128 or not _NUMBER.fullmatch(value):
            return None
        if 'e' in value.lower() and abs(int(value.lower().split('e')[1])) > 128:
            return None
        number = Decimal(value)
        # Bound both exponent and coefficient before arithmetic/formatting.
        # This is a resource limit, not a permissible physical coordinate range.
        if not number.is_finite() or abs(number.as_tuple().exponent) > 128 or len(number.as_tuple().digits) > 128:
            return None
        point.append(number)
    return point


def _coordinate_delta(left, right):
    with localcontext() as context:
        context.prec = 520  # Enough for both bounded coefficients/exponents, exactly.
        values = [a - b for a, b in zip(left, right)]
        return ['0' if value == 0 else format(value.normalize(), 'f') for value in values]
