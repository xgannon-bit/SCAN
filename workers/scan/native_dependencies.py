"""Exact literal reference evidence, separate from unqualified native semantics."""
import json

RELATIONS = (
    ('job-part-module', 'job', 'part-record', ('ParentId',), 'job', 'module-record', ('ID',)),
    ('job-part-master', 'job', 'part-record', ('MasterKey',), 'master', 'part-record', ('MasterKey',)),
    ('master-window-part', 'master', 'window-record', ('ParentId',), 'master', 'part-record', ('MasterKey',)),
    ('master-window-parent-window', 'master', 'window-record', ('ParentId', 'ParentWndId'), 'master', 'window-record', ('ParentId', 'ID')),
    ('job-cad-module', 'job', 'cad-record', ('ModuleID',), 'job', 'module-record', ('ID',)),
    ('job-cad-part-reference', 'job', 'cad-record', ('ModuleID', 'RefID'), 'job', 'part-record', ('ParentId', 'RefID')),
    ('job-part-cad-reference', 'job', 'part-record', ('ParentId', 'RefID'), 'job', 'cad-record', ('ModuleID', 'RefID')),
)


def report_literal_dependencies(documents):
    relations = []
    def key(record, fields):
        values = [record['rawFields'].get(field, []) for field in fields]
        if any(len(value) != 1 or not isinstance(value[0], str) or value[0] == '' for value in values): return None
        return tuple(value[0] for value in values)
    for name, sd, sk, sf, td, tk, tf in RELATIONS:
        relation = {'id': name, 'source': {'document': sd, 'kind': sk, 'fields': list(sf)}, 'target': {'document': td, 'kind': tk, 'fields': list(tf)}, 'status': 'unavailable', 'counts': None, 'examples': [], 'omittedExampleCount': 0}
        relations.append(relation)
        if any(documents.get(d, {}).get('status') != 'recorded' or documents.get(d, {}).get('readerProfile') != 'jobcontainer-10.2-observed-readonly-1' for d in (sd, td)):
            relation['reason'] = 'Required selected document has no supported literal record inventory'
            continue
        index = {}; unusable_targets = 0
        for record in documents[td]['records']:
            if record['kind'] != tk: continue
            value = key(record, tf)
            if value is None: unusable_targets += 1; continue
            # Store a bounded sample alongside the exact count; no quadratic lists.
            count, paths = index.setdefault(value, [0, []]); index[value][0] = count + 1
            if len(paths) < 5: paths.append(record['sourcePath'])
        counts = {'checked': 0, 'unique': 0, 'unmatched': 0, 'ambiguous': 0, 'unusableSourceKey': 0, 'unusableTargetKeys': unusable_targets}
        relation.update(status='checked', counts=counts)
        for record in documents[sd]['records']:
            if record['kind'] != sk: continue
            counts['checked'] += 1; value = key(record, sf)
            count, paths = index.get(value, (0, [])) if value is not None else (0, [])
            state = 'unusableSourceKey' if value is None else 'unmatched' if count == 0 else 'unique' if count == 1 else 'ambiguous'
            counts[state] += 1
            if state == 'unique': continue
            if len(relation['examples']) >= 25: relation['omittedExampleCount'] += 1; continue
            relation['examples'].append({'sourcePath': record['sourcePath'], 'sourceValues': list(value) if value is not None else [], 'state': state,
                                         'targetCount': count, 'targetSourcePaths': paths.copy(), 'targetsTruncated': count > len(paths)})
    report = {'artifactType': 'scan.native-literal-dependencies', 'schemaVersion': '1', 'interpretation': 'exact-source-string-correspondence-only', 'relations': relations,
              'requiredAssetsResolved': False, 'nativeSchemaQualified': False, 'machineExportAllowed': False,
              'limitations': ['Literal ParentWndId values with no match may have unverified sentinel meanings.', 'No explicit model-image asset references are qualified. Preserved files do not prove dependency completeness.', 'CAD IDs, part IDs and Master keys remain separate identity domains.']}
    if len(json.dumps(report, ensure_ascii=True)) > 500_000:
        for relation in relations:
            relation['omittedExampleCount'] += len(relation['examples']); relation['examples'] = []
        report['detailLimit'] = 'Examples omitted because their serialized source strings exceed the report limit'
    return report
