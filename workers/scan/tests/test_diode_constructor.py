"""Authored asymmetric polarized packages, unrelated to private manufacturing."""
from copy import deepcopy
from hashlib import sha256
import math
import unittest
from xml.etree import ElementTree as ET

from workers.scan.tests.test_paired_terminal_constructor import fixture as coil_fixture
from workers.scan.native_preparation import automatic_plan, apply_preparation, recipe_digest
from workers.scan.paired_terminal_constructor import validate_profiles
from workers.scan.snapshot_capture import CaptureBlocked


def fixture(angle=0, axis=0, reverse_roles=False):
    j, m, pcb, old = coil_fixture(angle, pad_axis=axis)
    pcb = pcb.replace(b'(padNum 2) (padStyleRef "coil-pad")', b'(padNum 2) (padStyleRef "unequal-pad")')
    pcb = pcb.replace(b'(library ', b'(library (padStyleDef "unequal-pad" (holeDiam 0) (padShape (layerNumRef 1) (padShapeType Rect) (shapeWidth 1.0) (shapeHeight 1.6))) ')
    common = {k: v for k, v in old.items() if k not in {'body', 'electrode'}}
    evidence = {'documentId': 'authored-numbered-footprint', 'sha256': 'b'*64, 'page': 2,
                'locator': 'Invented numbered pad/body datum table', 'statement': 'Authored geometry and electrical roles, not appearance.',
                'layoutSha256': sha256(pcb).hexdigest(), 'method': 'numbered-footprint'}
    p = {**common, 'kind': 'polarized-two-terminal-body-v1', 'body': {'widthMm': 2.8, 'heightMm': 4.8},
         'anchor': {'padNumber': '1', 'offsetAlongMm': .35, 'offsetAcrossMm': .15, 'evidence': deepcopy(evidence)},
         'polarity': {'pinRoles': {'1': 'anode', '2': 'cathode'}, 'evidence': deepcopy(evidence)},
         'electrodes': [{'role': 'anode', 'widthMm': 1.2, 'heightMm': .8, 'centerAlongMm': -.35, 'centerAcrossMm': -.15, 'minimumOverlapFraction': .95},
                        {'role': 'cathode', 'widthMm': 1.6, 'heightMm': 1.0, 'centerAlongMm': 2.65, 'centerAcrossMm': -.15, 'minimumOverlapFraction': .95}]}
    if reverse_roles:
        p['polarity']['pinRoles'] = {'1': 'cathode', '2': 'anode'}
        p['anchor']['offsetAlongMm'] *= -1
        p['anchor']['offsetAcrossMm'] *= -1
        for e in p['electrodes']:
            e['role'] = 'cathode' if e['role'] == 'anode' else 'anode'
            e['centerAlongMm'] *= -1
            e['centerAcrossMm'] *= -1
    return j, m, pcb, p


class DiodeTests(unittest.TestCase):
    def test_all_cardinals_both_axes_explicit_reversed_polarity_unequal_lands_nonzero_origins(self):
        for angle in (0, 90, 180, 270, 360, -90):
            for axis in (0, 90):
                for reverse in (False, True):
                    with self.subTest(angle=angle, axis=axis, reverse=reverse):
                        j, m, b, p = fixture(angle, axis, reverse)
                        plan = automatic_plan(j, m, b, [p]); item = next(i for i in plan['items'] if i['reference'] == 'N1')
                        self.assertEqual(item['status'], 'ready-for-review', item.get('reason'))
                        r = {**plan, 'accepted': [item['digest']]}
                        output = apply_preparation(j, m, b, r, recipe_digest(r))
                        part = ET.fromstring(output['job']).findall('PartDataList/PartData')[-1]
                        windows = ET.fromstring(output['master']).findall('WindowDataList/WindowData')[-3:]
                        # Authored datum, not computed by the production constructor.
                        ox, oy = (-.85, -.05) if axis == 0 else (.15, -1.35)
                        c, s = math.cos(math.radians(angle)), math.sin(math.radians(angle))
                        self.assertAlmostEqual(float(part.findtext('Roi/cx')), 14+ox*c-oy*s, places=8)
                        self.assertAlmostEqual(float(part.findtext('Roi/cy')), -11+ox*s+oy*c, places=8)
                        pads = [(-1.2, -.2), (1.8, -.2)] if axis == 0 else [(.3, -1.7), (.3, 1.3)]
                        for w, (x, y) in zip(windows[1:], pads):
                            lx, ly = float(w.findtext('RelRoi/cx')), float(w.findtext('RelRoi/cy'))
                            self.assertAlmostEqual(float(part.findtext('Roi/cx'))+lx*c-ly*s, 14+x*c-y*s, places=8)
                            self.assertAlmostEqual(float(part.findtext('Roi/cy'))+lx*s+ly*c, -11+x*s+y*c, places=8)
                        direction = (1, 0) if axis == 0 else (0, 1)
                        if reverse: direction = tuple(-v for v in direction)
                        self.assertEqual(item['basis']['cathodeDirectionPatternAxes'], list(direction))
                        self.assertAlmostEqual(item['basis']['cathodeDirectionNativeBoardAxes'][0], direction[0]*c-direction[1]*s)
                        self.assertAlmostEqual(item['basis']['cathodeDirectionNativeBoardAxes'][1], direction[0]*s+direction[1]*c)
                        self.assertEqual([w['terminalRole'] for w in item['dependencies']['windowRoles'][1:]], ['cathode', 'anode'] if reverse else ['anode', 'cathode'])
                        self.assertEqual(part.findtext('ENABLE'), 'False')
                        self.assertEqual(part.findtext('ptSetPolarPos/X'), '0')
                        self.assertFalse(part.findtext('WND_PAD'))
                        self.assertTrue(all(w.findtext('ENABLE') == 'False' and not len(w.find('AlgorithmDataList')) for w in windows))
                        for role, original in [('job', j), ('master', m)]:
                            recovered = output[role]
                            for change in item['changes']:
                                if change['document'] == role: recovered = recovered.replace(change['afterXml'].encode(), b'', 1)
                            self.assertEqual(recovered, original)

    def test_missing_polarity_or_anchor_refuses_without_allocating_or_counting(self):
        j, m, b, p = fixture()
        for missing in ('anchor', 'polarity', 'electrodes'):
            held = deepcopy(p); held[missing] = None
            plan = automatic_plan(j, m, b, [held]); item = next(i for i in plan['items'] if i['reference'] == 'N1')
            self.assertEqual(item['code'], 'PACKAGE_DIODE_EVIDENCE_MISSING')
            self.assertIn(missing, item['reason']); self.assertNotIn('changes', item)
        profile = deepcopy(p); profile['anchor'] = profile['polarity'] = profile['electrodes'] = None
        item = next(i for i in automatic_plan(j, m, b, [profile])['items'] if i['reference'] == 'N1')
        self.assertIn('anchor, polarity, electrodes', item['reason'])

    def test_stale_evidence_wrong_roles_unsupported_shape_and_changed_datum_refuse(self):
        j, m, b, p = fixture()
        bad = deepcopy(p); bad['polarity']['evidence']['layoutSha256'] = '0'*64
        self.assertEqual(next(i for i in automatic_plan(j, m, b, [bad])['items'] if i['reference'] == 'N1')['code'], 'PACKAGE_DIODE_EVIDENCE_STALE')
        bad = deepcopy(p); bad['anchor']['offsetAlongMm'] = 12
        self.assertEqual(next(i for i in automatic_plan(j, m, b, [bad])['items'] if i['reference'] == 'N1')['code'], 'PACKAGE_DRAWING_LAND_MISMATCH')
        for edit in (lambda q: q['polarity']['pinRoles'].update({'2': 'anode'}),
                     lambda q: q['anchor']['evidence'].update(method='appearance'),
                     lambda q: q['electrodes'][0].update(centerAlongMm=20),
                     lambda q: q.update(extra=True)):
            bad = deepcopy(p); edit(bad)
            with self.assertRaises(CaptureBlocked): validate_profiles([bad])
        plan = automatic_plan(j, m, b, [p]); item = next(i for i in plan['items'] if i['reference'] == 'N1')
        recipe = {**plan, 'accepted': [item['digest']]}
        changed = deepcopy(recipe); changed['packageProfiles'][0]['polarity']['evidence']['statement'] += ' changed'
        with self.assertRaises(CaptureBlocked): apply_preparation(j, m, b, changed, recipe_digest(changed))
        output = apply_preparation(j, m, b, recipe, recipe_digest(recipe))
        with self.assertRaises(CaptureBlocked): apply_preparation(output['job'], output['master'], b, recipe, recipe_digest(recipe))


if __name__ == '__main__': unittest.main()
