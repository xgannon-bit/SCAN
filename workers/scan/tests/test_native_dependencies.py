import copy
import unittest
from workers.scan.native_dependencies import report_literal_dependencies


def rec(kind, path, **fields): return {'kind':kind+'-record','sourcePath':path,'rawFields':{k:[v] if isinstance(v,str) else v for k,v in fields.items()}}
def doc(*records): return {'status':'recorded','readerProfile':'jobcontainer-10.2-observed-readonly-1','records':list(records)}
def fixture():
    return {'job':doc(rec('module','module',ID='m'),rec('part','part',ID='wrong-cad-id',ParentId='m',MasterKey='master-key',RefID='R1'),rec('cad','cad',ID='different',ModuleID='m',RefID='R1')),
            'master':doc(rec('part','model',MasterKey='master-key'),rec('window','window',ID='window1',ParentId='master-key',ParentWndId='0'))}


class DependencyTests(unittest.TestCase):
    def test_identity_domains_and_no_mutation(self):
        data=fixture(); before=copy.deepcopy(data); result=report_literal_dependencies(data)
        self.assertEqual(before,data); self.assertFalse(result['machineExportAllowed']); self.assertFalse(result['requiredAssetsResolved'])
        for r in result['relations']:
            self.assertEqual(r['counts']['unique'],0 if r['id']=='master-window-parent-window' else 1)
        self.assertEqual(result['relations'][3]['counts']['unmatched'],1)
    def test_exact_composite_keys_and_repeated_scalars(self):
        data=fixture(); data['job']['records'] += [rec('part','different-module',ParentId='other',RefID='R1',MasterKey='01'),rec('cad','zero',ModuleID='m',RefID=' R1')]
        data['master']['records'] += [rec('part','numeric-neighbor',MasterKey='1')]
        result=report_literal_dependencies(data); self.assertEqual(result['relations'][5]['counts']['unique'],1); self.assertEqual(result['relations'][1]['counts']['unmatched'],1)
        data['job']['records'][1]['rawFields']['ParentId']=['m','m']
        self.assertEqual(report_literal_dependencies(data)['relations'][0]['counts']['unusableSourceKey'],1)
    def test_ambiguity_and_bounded_examples(self):
        data=fixture(); data['master']['records'] += [rec('part',f'dup{i}',MasterKey='master-key') for i in range(40)]
        data['job']['records'] += [rec('part',f'p{i}',ParentId='m',MasterKey='master-key',RefID='R1') for i in range(40)]
        relation=report_literal_dependencies(data)['relations'][1]
        self.assertEqual(relation['counts']['ambiguous'],41); self.assertEqual(len(relation['examples']),25); self.assertEqual(relation['omittedExampleCount'],16)
        self.assertEqual(len(relation['examples'][0]['targetSourcePaths']),5); self.assertTrue(relation['examples'][0]['targetsTruncated'])
    def test_unavailable_not_missing(self):
        data=fixture(); data.pop('master'); relation=report_literal_dependencies(data)['relations'][1]
        self.assertEqual(relation['status'],'unavailable'); self.assertIsNone(relation['counts'])


if __name__ == '__main__': unittest.main()
