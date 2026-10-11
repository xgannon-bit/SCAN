"""Exact duplicate-placement comparisons, never automatic suppression.

This reader consumes the explicitly selected XML, including unknown algorithm
parameters. Matching reference/module strings group a review; they do not prove
physical redundancy. Digests cover every semantic XML field (including unknown
attributes, repeated fields and child order), while bounded examples help review.
"""
from collections import Counter, defaultdict
from hashlib import sha256
import json
import re
from xml.etree import ElementTree as ET

from .qualification_candidate import _xml
from .snapshot_capture import CaptureBlocked

PROFILE = 'native-duplicate-comparison-1'
MAX_OUTPUT_BYTES = 2_000_000
MAX_PAIRS = 1000
MAX_EXAMPLES = 30
IDENTITY = ('ID', 'ParentId', 'RefID', 'MasterKey')


def _json(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=True, separators=(',', ':'), allow_nan=False).encode()


def _digest(value):
    return sha256(_json(value)).hexdigest()


def _values(node, name):
    return [n.text or '' for n in node.findall(name)]


def _one(node, name):
    values = _values(node, name)
    return values[0] if len(values) == 1 and values[0] else None


def _tree(node, omit=()):
    # Indentation is excluded, but leaf whitespace, child order, repeated fields,
    # unknown fields and attributes are retained. No geometry normalization.
    return [node.tag, sorted(node.attrib.items()), node.text if not len(node) else (node.text or '').strip(),
            [_tree(child) for child in node if child.tag not in omit], (node.tail or '').strip()]


def _leaves(node, omit=()):
    result = {}
    def visit(current, prefix):
        if current.attrib:
            result[prefix + '/@attributes'] = json.dumps(sorted(current.attrib.items()), ensure_ascii=True)
        if not len(current):
            result[prefix] = current.text or ''
        elif (current.text or '').strip():
            result[prefix + '/#text'] = current.text
        counts = Counter(c.tag for c in current)
        seen = Counter()
        for child in current:
            if not prefix and child.tag in omit:
                continue
            seen[child.tag] += 1
            path = child.tag + (f'[{seen[child.tag]}]' if counts[child.tag] > 1 else '')
            child_path = f'{prefix}/{path}' if prefix else path
            visit(child, child_path)
            if (child.tail or '').strip():
                result[child_path + '/#tail'] = child.tail
    visit(node, '')
    return result


def _comparison(left, right, limit=MAX_EXAMPLES):
    keys = sorted(set(left) | set(right))
    changed = [key for key in keys if left.get(key) != right.get(key) or (key in left) != (key in right)]
    return {'state': 'same-observed-fields' if not changed else 'different-observed-fields',
            'changedFieldCount': len(changed),
            'examples': [{'field': k, 'left': left.get(k), 'right': right.get(k)} for k in changed[:limit]],
            'omittedExampleCount': max(0, len(changed) - limit)}


def _empty(status, reason):
    return {'artifactType': 'scan.native-duplicate-review', 'schemaVersion': '1', 'analyzerVersion': PROFILE,
            'status': status, 'reason': reason, 'groups': [], 'unscopedPlacements': [], 'counts': None,
            'suppressionSupported': False, 'nativeEditsApplied': False, 'machineQualified': False}


def duplicate_review(job, master, source_context):
    """Compare all same-module/ref scopes; missing selection is not an empty Master.

    Selected-document hashes must match source_context. Archive/capture provenance
    is provided by preflight; this function never reads an unselected snapshot.
    """
    try:
        context = json.loads(_json(source_context))
        for key in ('archiveSha256', 'packageSha256', 'snapshotId'):
            if not re.fullmatch('[a-f0-9]{64}', context[key]):
                raise ValueError('context')
        selection = context['selection']
        if not isinstance(selection['root'], str) or len(_json(context)) > 16000:
            raise ValueError('selection')
        parsed = {}
        for role, raw in (('job', job), ('master', master)):
            selected = selection.get(role)
            if role == 'master' and selected is None and raw is None:
                parsed[role] = None
                continue
            if not isinstance(raw, bytes) or selected['role'] not in ('main', 'temp', 'backup') or not isinstance(selected['member'], str) or sha256(raw).hexdigest() != selected['sha256']:
                raise ValueError('selection hash')
            _xml(raw, supported_versions=('10.1', '10.2'))
            root = ET.fromstring(raw)
            if root.tag != 'JobContainer' or _values(root, 'JobXmlVersion') not in (['10.1'], ['10.2']):
                raise ValueError('schema')
            parsed[role] = root
        j, m = parsed['job'], parsed['master']
        def records(root, collection, tag):
            if root is None:
                return []
            if len(root.findall(collection)) != 1:
                raise ValueError('repeated or missing collection')
            return [(f'JobContainer/{collection}/{tag}[{i + 1}]', node)
                    for i, node in enumerate(root.findall(f'{collection}/{tag}'))]
        parts = records(j, 'PartDataList', 'PartData')
        module_nodes = j.findall('ModuleDataList/ModuleData')
        models = records(m, 'PartDataList', 'PartData')
        windows = records(m, 'WindowDataList', 'WindowData')
        scopes, model_scopes, window_scopes, usage = (defaultdict(list) for _ in range(4))
        result = _empty('recorded', 'Literal comparisons support review. Different coordinates or teaching do not establish which placement is correct.')
        result['sourceContext'] = context
        result['interpretation'] = 'Native placement, Master-local and window-local values remain separate unqualified frames. Exact field comparison is not a redundancy or teaching-quality decision.'
        for path, part in parts:
            ref, module, key = (_one(part, name) for name in ('RefID', 'ParentId', 'MasterKey'))
            if ref is None or module is None:
                result['unscopedPlacements'].append({'sourcePath': path, 'identityLiterals': {n: _values(part, n) for n in IDENTITY}, 'hold': 'REFERENCE_OR_MODULE_AMBIGUOUS'})
            else:
                scopes[(module, ref)].append((path, part))
            if key is not None:
                usage[key].append({'sourcePath': path, 'identityLiterals': {n: _values(part, n) for n in IDENTITY}})
        for path, node in models:
            if _one(node, 'MasterKey') is not None:
                model_scopes[_one(node, 'MasterKey')].append((path, node))
        for path, node in windows:
            if _one(node, 'ParentId') is not None:
                window_scopes[_one(node, 'ParentId')].append((path, node))
        pair_total = 0
        for (module, ref), members in scopes.items():
            if len(members) < 2:
                continue
            pair_total += len(members) * (len(members) - 1) // 2
            if pair_total > MAX_PAIRS:
                raise ValueError('pair budget')
            candidates, private = [], {}
            matching_modules = [node for node in module_nodes if _one(node, 'ID') == module]
            for path, part in members:
                key = _one(part, 'MasterKey')
                matching = model_scopes.get(key, [])
                linked = window_scopes.get(key, [])
                master_state = 'unavailable' if m is None else 'identity-ambiguous' if key is None else 'unique-literal-match' if len(matching) == 1 else 'unmatched' if not matching else 'ambiguous'
                pid = _one(part, 'ID')
                identity_unambiguous = pid is not None and sum(_one(other, 'ID') == pid for _, other in parts) == 1 and all(_one(part, n) is not None for n in IDENTITY)
                placement = _leaves(part)
                geometry = {k: v for k, v in placement.items() if k.startswith(('Roi/', 'CenterPos', 'ptSetPolarPos/'))}
                bindings = {k: v for k, v in placement.items() if k.startswith(('WND_PAD', 'ListGer'))}
                fov = {k: v for k, v in placement.items() if k.startswith(('Fov', 'SubFov'))}
                shared = usage.get(key, [])
                model = matching[0][1] if master_state == 'unique-literal-match' else None
                candidate = {'sourcePath': path, 'identityLiterals': {n: _values(part, n) for n in IDENTITY},
                             'moduleState': 'unique-literal-match' if len(matching_modules) == 1 else 'unmatched' if not matching_modules else 'ambiguous',
                             'moduleLiterals': [{n: _values(node, n) for n in ('ID', 'TB', 'Angle', 'Shift/X', 'Shift/Y', 'RotCenter/X', 'RotCenter/Y')} for node in matching_modules],
                             'identityUnambiguous': identity_unambiguous, 'enabledLiterals': _values(part, 'ENABLE'),
                             'placementSha256': _digest(_tree(part)), 'geometry': geometry, 'bindings': bindings, 'fov': fov,
                             'master': {'state': master_state, 'sourcePaths': [p for p, _ in matching],
                                        'sha256': _digest(_tree(model)) if model is not None else None,
                                        'sharedUsage': shared, 'windows': len(linked) if m is not None and key is not None else None,
                                        'algorithms': sum(len(w.findall('AlgorithmDataList/AlgorithmData')) for _, w in linked) if m is not None and key is not None else None},
                             'windows': [{'sourcePath': p, 'identityLiterals': {n: _values(w, n) for n in ('ID', 'ParentId', 'GroupID', 'Name', 'ParentWndId', 'AlignWndID')},
                                          'sha256': _digest(_tree(w)), 'geometry': {k: v for k, v in _leaves(w).items() if k.startswith('RelRoi/')},
                                          'algorithmCount': len(w.findall('AlgorithmDataList/AlgorithmData')),
                                          'algorithmSha256': _digest([_tree(a) for a in w.findall('AlgorithmDataList')])} for p, w in linked]}
                candidates.append(candidate)
                private[path] = (part, model, linked)
            group = {'reference': ref, 'module': module, 'candidates': candidates, 'pairs': []}
            for i, left in enumerate(candidates):
                for right in candidates[i + 1:]:
                    lp, lm, lw = private[left['sourcePath']]
                    rp, rm, rw = private[right['sourcePath']]
                    # Only unique literal Name+GroupID pairs may be shown side by
                    # side. That remains a comparison aid, not qualified role equivalence.
                    wi = []
                    for ws in (lw, rw):
                        index = defaultdict(list)
                        for path, w in ws:
                            name, gid = _one(w, 'Name'), _one(w, 'GroupID')
                            if name is not None and gid is not None:
                                index[(name, gid)].append((path, w))
                        wi.append(index)
                    matched, ambiguous = [], []
                    for wk in sorted(set(wi[0]) | set(wi[1])):
                        a, b = wi[0].get(wk, []), wi[1].get(wk, [])
                        if len(a) == len(b) == 1:
                            af, bf = (_leaves(record[0][1], ('ID', 'ParentId')) for record in (a, b))
                            matched.append({'nameLiteral': wk[0], 'groupIdLiteral': wk[1],
                                            'leftPath': a[0][0], 'rightPath': b[0][0],
                                            'comparison': _comparison(af, bf),
                                            'geometry': _comparison({k: v for k, v in af.items() if k.startswith('RelRoi/')}, {k: v for k, v in bf.items() if k.startswith('RelRoi/')}),
                                            'algorithmParameters': _comparison({k: v for k, v in af.items() if k.startswith('AlgorithmDataList/') and not k.endswith('/ID')}, {k: v for k, v in bf.items() if k.startswith('AlgorithmDataList/') and not k.endswith('/ID')}),
                                            'dependencies': _comparison({k: v for k, v in af.items() if k in ('GroupID', 'ParentWndId', 'AlignWndID')}, {k: v for k, v in bf.items() if k in ('GroupID', 'ParentWndId', 'AlignWndID')})})
                        else:
                            ambiguous.append({'nameLiteral': wk[0], 'groupIdLiteral': wk[1], 'leftCount': len(a), 'rightCount': len(b)})
                    pair = {'leftPath': left['sourcePath'], 'rightPath': right['sourcePath'],
                            'comparisons': {'placementGeometry': _comparison(left['geometry'], right['geometry']),
                                            'placementFields': _comparison(_leaves(lp, IDENTITY), _leaves(rp, IDENTITY)),
                                            'bindings': _comparison(left['bindings'], right['bindings']),
                                            'fov': _comparison(left['fov'], right['fov']),
                                            'masterFields': _comparison(_leaves(lm, ('MasterKey', 'RefID')), _leaves(rm, ('MasterKey', 'RefID'))) if lm is not None and rm is not None else None},
                            'windowComparisons': matched, 'unpairedWindowRoles': ambiguous,
                            'unmappedWindowCount': [len(lw) - len(matched), len(rw) - len(matched)],
                            'sameMasterLiteral': _one(lp, 'MasterKey') is not None and _one(lp, 'MasterKey') == _one(rp, 'MasterKey'),
                            'suppressionSupported': False,
                            'holds': ['PHYSICAL_REDUNDANCY_UNPROVEN', 'SURVIVOR_TEACHING_UNVERIFIED', 'SUPPRESSION_SIDE_EFFECTS_UNQUALIFIED'],
                            'nextAction': 'Compare the two exact placements against independent board evidence; record a preferred survivor or retain-both reason. Before any suppression, prove physical redundancy and dependency/teaching preservation on a separate qualification copy.'}
                    if not left['identityUnambiguous'] or not right['identityUnambiguous']:
                        pair['holds'].append('PLACEMENT_IDENTITY_AMBIGUOUS')
                    if len(matching_modules) != 1:
                        pair['holds'].append('MODULE_IDENTITY_UNRESOLVED')
                    if lm is None or rm is None:
                        pair['holds'].append('MASTER_RELATION_UNRESOLVED')
                    if any(pair['unmappedWindowCount']):
                        pair['holds'].append('WINDOW_ROLE_CORRESPONDENCE_UNRESOLVED')
                    pair['digest'] = _digest({'context': context, 'module': module, 'reference': ref, 'left': left, 'right': right, 'comparison': pair})
                    group['pairs'].append(pair)
            group['digest'] = _digest({'context': context, 'group': group})
            result['groups'].append(group)
        result['counts'] = {'placements': len(parts), 'duplicateScopes': len(result['groups']), 'pairComparisons': pair_total,
                            'unscopedPlacements': len(result['unscopedPlacements']), 'masterSelected': m is not None}
        if len(_json(result)) > MAX_OUTPUT_BYTES:
            raise ValueError('output budget')
        return result
    except (ValueError, TypeError, KeyError, CaptureBlocked, ET.ParseError, RecursionError):
        return _empty('blocked', 'Exact selected XML, supported bounded structure and matching source hashes are required. No partial duplicate review was returned.')
