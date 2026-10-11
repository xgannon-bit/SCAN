"""Independent invented source/body evidence: no private board geometry."""
from copy import deepcopy
import math
import unittest

from workers.scan.origin_evidence import body_evidence
from workers.scan.tests.test_bom_intake import parse
from workers.scan.tests.test_paired_terminal_constructor import fixture


class OriginEvidenceTests(unittest.TestCase):
    def test_cardinals_and_nonzero_body_origin_are_independent_of_centroid_and_native(self):
        for angle in (0, 90, 180, 270):
            _, _, pcb, profile = fixture(angle)
            bom = parse([[1, 'N1', '', '', '', 'fictional-coil', '']])
            saved = (pcb, deepcopy(profile), deepcopy(bom))
            result = body_evidence(pcb, [profile], bom)
            self.assertEqual(len(result['records']), 1)
            row = result['records'][0]
            self.assertEqual(row['status'], 'supported', row['holds'])
            c, s = math.cos(math.radians(angle)), math.sin(math.radians(angle))
            self.assertAlmostEqual(row['bodyLocalMm'][0], .3)
            self.assertAlmostEqual(row['bodyLocalMm'][1], -.2)
            self.assertAlmostEqual(row['bodyBoardMm'][0], 3+.3*c+.2*s)
            self.assertAlmostEqual(row['bodyBoardMm'][1], 2+.3*s-.2*c)
            self.assertIsNone(row['sourceSide'])
            self.assertTrue(row['mpnMatched'])
            self.assertFalse(result['machineQualified'])
            self.assertFalse(result['nativeEditsApplied'])
            self.assertEqual((pcb, profile, bom), saved)
            self.assertEqual(result, body_evidence(pcb, [profile], bom))

    def test_wrong_bom_package_duplicate_identity_and_conflicting_profile_are_held(self):
        _, _, pcb, profile = fixture()
        for rows in ([[1, 'N1', '', '', '', 'other-device', '']], [[1, 'N1', '', '', '', 'fictional-coil', ''], [1, 'N1', '', '', '', 'fictional-coil', '']]):
            row = body_evidence(pcb, [profile], parse(rows))['records'][0]
            self.assertEqual(row['status'], 'held')
            self.assertIsNone(row['bodyBoardMm'])
        other = deepcopy(profile); other['id'] = 'another-profile'
        rows = body_evidence(pcb, [profile, other], parse([[1, 'N1', '', '', '', 'fictional-coil', '']]))['records']
        self.assertEqual(len(rows), 2)
        self.assertTrue(all(r['holds'][0]['code'] == 'ORIGIN_BODY_AMBIGUOUS' for r in rows))

    def test_pin_mapping_and_manufacturer_overlap_remain_independent_checks(self):
        _, _, pcb, profile = fixture()
        bom = parse([[1, 'N1', '', '', '', 'fictional-coil', '']])
        for mutate in (lambda p: p.update(padPinMap={'1': '2', '2': '1'}), lambda p: p['electrode'].update(centerSeparationMm=30)):
            p = deepcopy(profile); mutate(p)
            row = body_evidence(pcb, [p], bom)['records'][0]
            self.assertEqual(row['status'], 'held')
            self.assertIsNone(row['bodyLocalMm'])
            self.assertTrue(row['holds'])

    def test_no_profile_does_not_promote_pad_centroid_to_body(self):
        _, _, pcb, _ = fixture()
        result = body_evidence(pcb, [], parse([[1, 'N1', '', '', '', 'fictional-coil', '']]))
        self.assertEqual(result['records'], [])


if __name__ == '__main__':
    unittest.main()
