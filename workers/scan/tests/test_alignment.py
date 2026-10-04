import copy
import unittest
from workers.scan.alignment import align


def request():
    return {'basis': 'synthetic-source-interpretations', 'scope': {'module': 'Fictional-A', 'side': 'Top', 'boardInstance': 'one'}, 'toleranceMm': .1,
            'points': [{'id': str(i), 'role': 'fit' if i < 3 else 'check', 'cad': a, 'gerber': b, 'evidence': 'independent authored oracle'}
                       for i, (a, b) in enumerate([([0, 0], [100, 50]), ([10, 0], [100, 60]), ([0, 20], [80, 50]), ([7, 11], [89, 57])])]}


class AlignmentTests(unittest.TestCase):
    def test_rigid_oracle_and_no_mutation(self):
        data = request(); before = copy.deepcopy(data); result = align(data)
        self.assertEqual(result['status'], 'success'); self.assertEqual(before, data)
        self.assertAlmostEqual(result['transform']['angleDegrees'], 90)
        self.assertEqual(result['transform']['scale'], 1); self.assertFalse(result['machineExportAllowed'])
        for row, expected in zip(result['transform']['matrix'], [[0, -1, 100], [1, 0, 50]]):
            for value, target in zip(row, expected): self.assertAlmostEqual(value, target)
    def test_independent_check_is_not_fit(self):
        data = request(); data['points'][3]['gerber'][0] = 89.2
        result = align(data); self.assertEqual(result['status'], 'blocked')
        self.assertTrue(all(r['withinTolerance'] for r in result['residuals'][:3])); self.assertFalse(result['residuals'][3]['withinTolerance'])
        data['points'][3]['gerber'][0] = 89.1000000001
        self.assertEqual(align(data)['status'], 'blocked')
    def test_untrusted_controls(self):
        for mutation in [lambda d: d['points'][3].update(cad=[0, 0]), lambda d: d['points'][3].update(id='0'), lambda d: d['points'][3].update(role='fit'), lambda d: d['points'][0].update(cad=[float('nan'), 0]), lambda d: d['points'][2].update(cad=[20, 0]), lambda d: d['points'][1].update(evidence=''), lambda d: d.update(toleranceMm=True)]:
            data=request(); mutation(data)
            with self.assertRaises(ValueError): align(data)
    def test_mirror_scaled_swapped_and_sheared(self):
        data=request()
        for point in data['points']: point['gerber']=[-point['cad'][0], point['cad'][1]]
        with self.assertRaises(ValueError): align(data)
        for kind in ('scaled', 'sheared', 'swapped'):
            data=request()
            for p in data['points']:
                x,y=p['cad']; p['gerber']=[x * 1.2, y * 1.2] if kind == 'scaled' else [x + .3*y, y]
            if kind == 'swapped': data['points'][1]['gerber'],data['points'][2]['gerber']=data['points'][2]['gerber'],data['points'][1]['gerber']
            try: self.assertEqual(align(data)['status'], 'blocked')
            except ValueError: pass
    def test_fingerprint_binds_scope_tolerance_and_evidence(self):
        baseline=align(request())['fingerprint']
        for key,value in [('basis','different'),('toleranceMm',.2),('scope',{'module':'Other','side':'Top','boardInstance':'one'})]:
            data=request(); data[key]=value; self.assertNotEqual(align(data)['fingerprint'],baseline)


if __name__ == '__main__': unittest.main()
