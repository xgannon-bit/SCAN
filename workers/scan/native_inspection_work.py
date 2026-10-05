"""Read-only inspection review queue; literal scopes are not qualified ownership."""
from collections import defaultdict
from hashlib import sha256
import json
import re

from .native_bindings import _available, _scalar, _validate, _Limit

MAX_OUTPUT_BYTES = 1_500_000
ACTIONS = [
    {'id': 'resolve-master', 'owner': 'offline', 'nextAction': 'Resolve the exact selected Master relation before interpreting shared windows. A shared Master change may affect every linked placement.'},
    {'id': 'check-window', 'owner': 'offline', 'nextAction': 'Establish window coordinate frame, pad ownership and placement dependencies from supported source evidence. A literal link or placement edit does not complete this check.'},
    {'id': 'verify-teaching', 'owner': 'Eagle/Athena', 'nextAction': 'After offline review, verify image-dependent teaching and inspection behavior for this window on the identified machine. Existing algorithm records do not prove correct teaching.'},
]


def _json(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=True, separators=(',', ':'), allow_nan=False).encode()


def _empty(status, reason):
    return {'artifactType': 'scan.native-inspection-work', 'schemaVersion': '1',
            'analyzerVersion': 'native-inspection-work-1', 'status': status, 'reason': reason,
            'inventoryComplete': False, 'scopes': [], 'parts': [], 'windows': [], 'algorithms': [],
            'actions': [], 'counts': None, 'inspectionRepairEstablished': False,
            'nativeEditsApplied': False, 'machineExportAllowed': False}


def inspection_work(documents, source_context):
    """Factor shared Master/window review once, retaining every observed record.

    Source context comes from verified snapshot preflight. No approval/candidate
    status enters this reader; completing a scalar trial cannot complete teaching.
    Unsupported or over-budget input returns no partial inventory.
    """
    try:
        _validate(documents)
        if not _available(documents.get('job')):
            return _empty('unavailable', 'Selected job records are unavailable; inspection work cannot be enumerated.')
        if not isinstance(source_context, dict):
            raise ValueError('context')
        for key in ('archiveSha256', 'packageSha256', 'snapshotId'):
            if not isinstance(source_context.get(key), str) or not re.fullmatch('[0-9a-f]{64}', source_context[key]):
                raise ValueError('context hash')
        selection = source_context.get('selection')
        if not isinstance(selection, dict) or not isinstance(selection.get('root'), str):
            raise ValueError('selection')
        for role in ('job', 'master'):
            selected = selection.get(role)
            if selected is None and role == 'master':
                continue
            if not isinstance(selected, dict) or selected.get('role') not in ('main', 'temp', 'backup') or not isinstance(selected.get('member'), str) or not selected['member'] or not isinstance(selected.get('sha256'), str) or not re.fullmatch('[0-9a-f]{64}', selected['sha256']):
                raise ValueError('selection identity')
        context_bytes = _json(source_context)
        if len(context_bytes) > 16_000:
            raise _Limit()
        context = json.loads(context_bytes)
        basis = sha256(context_bytes).hexdigest()
        def ident(kind, key):
            return kind + '-' + sha256(_json([basis, kind, key])).hexdigest()[:24]
        master_available = selection.get('master') is not None and _available(documents.get('master'))
        job = documents['job']['records']
        master = documents['master']['records'] if master_available else []
        parts = [r for r in job if r['kind'] == 'part-record']
        models = [r for r in master if r['kind'] == 'part-record']
        windows = [r for r in master if r['kind'] == 'window-record']
        algorithms = [r for r in master if r['kind'] == 'algorithm-record']
        scope_parts, scope_models, scope_windows = (defaultdict(list) for _ in range(3))
        for records, index, field in ((parts, scope_parts, 'MasterKey'), (models, scope_models, 'MasterKey'), (windows, scope_windows, 'ParentId')):
            for record in records:
                key = _scalar(record, field)
                if key is not None:
                    index[key].append(record)
        result = _empty('recorded', 'Review inventory only; required inspections, native semantics and teaching remain unqualified.')
        result.update(sourceContext=context, inventoryComplete=master_available, actions=ACTIONS,
                      interpretation='Exact selected-document literal MasterKey/ParentId correspondence, not qualified shared-model ownership or a completed teaching plan.')
        budget = len(_json(result))
        def append(section, value):
            nonlocal budget
            budget += len(_json(value)) + 1
            if budget > MAX_OUTPUT_BYTES:
                raise _Limit()
            result[section].append(value)
        for key in dict.fromkeys([*scope_parts, *scope_models, *scope_windows]):
            matching = scope_models[key]
            state = 'unavailable' if not master_available else 'unmatched' if not matching else 'unique-literal-match' if len(matching) == 1 else 'ambiguous'
            append('scopes', {'id': ident('master-scope', key), 'masterKeyLiteral': key,
                'masterMatchState': state, 'masterPartSourcePaths': [r['sourcePath'] for r in matching],
                'partIds': [ident('part', r['sourcePath']) for r in scope_parts[key]],
                'windowIds': [ident('window', r['sourcePath']) for r in scope_windows[key]],
                'reviewState': 'unresolved', 'actionIds': ['resolve-master']})
        for part in parts:
            key = _scalar(part, 'MasterKey')
            append('parts', {'id': ident('part', part['sourcePath']), 'sourcePath': part['sourcePath'],
                'identityLiterals': {k: part['rawFields'].get(k, []) for k in ('ID', 'ParentId', 'RefID', 'MasterKey')},
                'scopeId': ident('master-scope', key) if key is not None else None,
                'bindingReview': 'unresolved', 'inspectionReview': 'unverified'})
        window_paths = {r['sourcePath'] for r in windows}
        by_window = defaultdict(list)
        for algorithm in algorithms:
            container = algorithm.get('containerSourcePath')
            if container is not None and (not isinstance(container, str) or not container or len(container) > 2048):
                raise ValueError('algorithm container')
            window_path = container if container in window_paths else None
            if window_path is not None:
                by_window[window_path].append(ident('algorithm', algorithm['sourcePath']))
            append('algorithms', {'id': ident('algorithm', algorithm['sourcePath']), 'sourcePath': algorithm['sourcePath'],
                'containerSourcePath': container, 'windowId': ident('window', window_path) if window_path is not None else None,
                'rawFields': algorithm['rawFields'], 'teachingReview': 'unverified'})
        for window in windows:
            key = _scalar(window, 'ParentId')
            append('windows', {'id': ident('window', window['sourcePath']), 'sourcePath': window['sourcePath'],
                'scopeId': ident('master-scope', key) if key is not None else None,
                'rawFields': window['rawFields'], 'algorithmIds': by_window[window['sourcePath']],
                'geometryReview': 'unresolved', 'bindingReview': 'unresolved', 'teachingReview': 'unverified',
                'actionIds': ['check-window', 'verify-teaching']})
        result['counts'] = {'nativeParts': len(parts), 'masterScopes': len(result['scopes']),
            'masterDocumentAvailable': master_available,
            'masterWindows': len(windows) if master_available else None,
            'masterAlgorithms': len(algorithms) if master_available else None,
            'unscopedParts': sum(p['scopeId'] is None for p in result['parts']),
            'unscopedWindows': sum(w['scopeId'] is None for w in result['windows']),
            'unscopedAlgorithms': sum(a['windowId'] is None for a in result['algorithms']),
            'qualifiedInspections': None, 'completedOfflineInspections': None}
        if len(_json(result)) > MAX_OUTPUT_BYTES:
            raise _Limit()
        return result
    except _Limit:
        return _empty('blocked', 'Inspection review inventory exceeds its bounded input/output limit; no partial queue was returned.')
    except (ValueError, TypeError, KeyError):
        return _empty('blocked', 'Inspection review requires valid literal records and exact verified snapshot identity; no partial queue was returned.')
