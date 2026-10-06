"""Wholly authored identities and geometry; no private input or expected output."""
from copy import deepcopy
from decimal import Decimal
import unittest
from xml.etree import ElementTree as ET

from workers.scan.accel_ascii import read_accel
from workers.scan.native_model_geometry import derive_model_geometry, equivalent_source_geometry
from workers.scan.snapshot_capture import CaptureBlocked
from workers.scan.tests.test_accel_ascii import pcb, pattern
from workers.scan.tests.test_native_preparation import fixtures


class NativeModelGeometryTests(unittest.TestCase):
    def setUp(self):
        job, master, source = fixtures()
        self.j, self.m = ET.fromstring(job), ET.fromstring(master)
        self.part = self.j.find('PartDataList/PartData')
        self.model = self.m.find('PartDataList/PartData')
        self.cads = self.j.findall('CadData/CpList/Cp')
        self.sources = read_accel(source)['placements']

    def derive(self, target=None, origin=None):
        return derive_model_geometry(target or self.sources[1], origin or self.sources[0], self.part, self.model, self.cads[1], self.cads[0])

    def centered(self):
        for path, value in {'Roi/cx': '10', 'Roi/cy': '20', 'Roi/a': '90', 'CenterPosX': '-0.000', 'CenterPosY': '0.00'}.items():
            self.part.find(path).text = value
        for path, value in {'Roi/a': '90', 'CadOffset/X': '0', 'CadOffset/Y': '0'}.items():
            self.model.find(path).text = value

    def test_translation_preserves_nonzero_roi_and_stored_center_offsets(self):
        original_part, original_model = ET.tostring(self.part), ET.tostring(self.model)
        result = self.derive()
        self.assertEqual(result['partUpdates'], {'Roi/cx': '32', 'Roi/cy': '47', 'CenterPosX': '31.5', 'CenterPosY': '47.7'})
        self.assertTrue(result['basis']['originOffsetPreserved'])
        self.assertEqual(result['basis']['translationNativeUnits'], [20, 30])
        self.assertEqual(result['basis']['nativeLengthUnit'], 'unqualified')
        self.assertNotIn('translationNativeMm', result['basis'])
        self.assertEqual(ET.tostring(self.part), original_part)
        self.assertEqual(ET.tostring(self.model), original_model)
        self.assertFalse(result['machineExportAllowed'])

    def test_zero_center_pair_is_preserved_verbatim_not_translated(self):
        self.part.find('CenterPosX').text = '-0.000'
        self.part.find('CenterPosY').text = '0.00'
        result = self.derive()
        self.assertEqual(result['partUpdates']['CenterPosX'], '-0.000')
        self.assertEqual(result['partUpdates']['CenterPosY'], '0.00')
        self.assertEqual(result['partUpdates']['Roi/cx'], '32')

    def test_one_zero_is_a_nonzero_pair_and_retains_existing_translation_behavior(self):
        self.part.find('CenterPosX').text = '0'
        self.assertEqual(self.derive()['partUpdates']['CenterPosX'], '20')

    def test_plain_decimal_fields_are_not_rounded_through_float_or_decimal_default_precision(self):
        fractional = '123456789012345678901234567890123456789'
        self.part.find('Roi/cx').text = '12.' + fractional
        self.assertEqual(self.derive()['partUpdates']['Roi/cx'], '32.' + fractional)
        self.cads[1].find('X').text = '1000000'
        with self.assertRaises(CaptureBlocked): self.derive()

    def test_cardinal_angles_exact_source_covariance_and_actual_new_record_fields(self):
        self.centered()
        original_part, original_model, original_windows = ET.tostring(self.part), ET.tostring(self.model), ET.tostring(self.m.find('WindowDataList'))
        for source_angle, native_angle, expected in [('0', '180', '180'), ('180', '0', '0'), ('270', '-90', '270')]:
            with self.subTest(source_angle=source_angle, native_angle=native_angle):
                source = read_accel(pcb(placements=pattern(ref='InventedK', angle=source_angle), components='(compInst "InventedK")'))['placements'][0]
                self.cads[1].find('Ang').text = native_angle
                result = self.derive(target=source)
                prepared = deepcopy(self.part)
                for path, value in result['partUpdates'].items():
                    prepared.find(path).text = value
                self.assertEqual(prepared.findtext('Roi/cx'), '30')
                self.assertEqual(prepared.findtext('Roi/cy'), '50')
                self.assertEqual(prepared.findtext('Roi/a'), expected)
                self.assertEqual(prepared.findtext('CenterPosX'), '-0.000')
                self.assertEqual(prepared.findtext('Roi/w'), self.model.findtext('Roi/w'))
                self.assertIn('native-rotation-model-window-frame-unverified', result['remaining'])
                self.assertEqual(result, self.derive(target=source))
        self.assertEqual(ET.tostring(self.part), original_part)
        self.assertEqual(ET.tostring(self.model), original_model)
        self.assertEqual(ET.tostring(self.m.find('WindowDataList')), original_windows)

    def test_instance_paths_formatting_and_board_rotation_do_not_change_local_signature(self):
        target = deepcopy(self.sources[1])
        target['sourcePath'] = '/new/instance'
        for layer in target['explicitLayerGeometry']:
            layer['pads'].reverse()
            for pad in layer['pads']:
                pad.update(sourceBoardPoint={'xMm': 543, 'yMm': -98}, sourceBoardRotationDegrees=270, padSourcePath='/renamed/pad', shapeSourcePath='/renamed/shape')
                pad['local']['raw'] = ['uninterpreted', 'formatting']
        self.assertTrue(equivalent_source_geometry(target, self.sources[0]))

    def test_alternate_pattern_names_need_exact_geometry_and_keep_body_review_hold(self):
        target = deepcopy(self.sources[1]); target['patternRef'] = 'different-authored-name'
        target['patternGraphicsNameRef'] = 'different-graphic-label'
        result = self.derive(target=target)
        self.assertFalse(result['basis']['samePatternAndGraphics'])
        self.assertIn('alternate-pattern-body-and-template-settings-unverified', result['remaining'])
        for key in ('widthMm', 'heightMm', 'localRotationDegrees', 'padNumber'):
            other = deepcopy(target)
            pad = other['explicitLayerGeometry'][0]['pads'][0]
            pad[key] = 'unmatched' if key == 'padNumber' else pad[key] + 1
            with self.subTest(key=key), self.assertRaises(CaptureBlocked): self.derive(target=other)

    def test_new_origin_and_resize_are_not_inferred_from_same_family_name(self):
        for delta in (Decimal('0.000000001'), Decimal('3')):
            target = deepcopy(self.sources[1])
            local = target['explicitLayerGeometry'][0]['pads'][0]['local']
            local['xMm'] += float(delta)
            with self.assertRaises(CaptureBlocked): self.derive(target=target)

    def test_rotation_requires_cad_origin_matching_sizes_zero_offset_and_template_angles(self):
        changes = [('part', 'Roi/cx', '10.01'), ('part', 'Roi/a', '89'), ('part', 'CenterPosX', '1'),
                   ('model', 'Roi/a', '0'), ('model', 'CadOffset/Y', '0.001'), ('model', 'Roi/h', '9')]
        target = read_accel(pcb(placements=pattern(ref='Z23', angle='0'), components='(compInst "Z23")'))['placements'][0]
        for node, path, value in changes:
            with self.subTest(node=node, path=path):
                self.setUp(); self.centered(); self.cads[1].find('Ang').text = '180'
                getattr(self, node).find(path).text = value
                with self.assertRaises(CaptureBlocked): self.derive(target=target)

    def test_ambiguous_native_geometry_and_incoherent_angles_remain_held(self):
        self.centered()
        for source_angle, native_angle in [('0', '90'), ('45', '135'), ('180', '180')]:
            target = read_accel(pcb(placements=pattern(ref='J8', angle=source_angle), components='(compInst "J8")'))['placements'][0]
            self.cads[1].find('Ang').text = native_angle
            with self.subTest(source=source_angle, native=native_angle), self.assertRaises(CaptureBlocked): self.derive(target=target)
        ET.SubElement(self.part.find('Roi'), 'cx').text = '10'
        with self.assertRaises(CaptureBlocked): self.derive()

    def test_angle_wraps_preserve_equivalence_without_assuming_source_length_frame(self):
        self.cads[1].find('Ang').text = '-270'
        target = deepcopy(self.sources[1]); target['rotation']['degrees'] = 450
        result = self.derive(target=target)
        self.assertNotIn('Roi/a', result['partUpdates'])
        self.assertEqual(result['basis']['nativeCadAngleDeltaDegrees'], 0)
        self.assertEqual(result['basis']['sourceAngleDeltaDegrees'], 0)

    def test_invalid_or_ambiguous_source_geometry_never_counts_as_equivalent(self):
        cases = []
        for field, value in [('identityHolds', [{'code': 'invented-hold'}]), ('mountingEvidence', 'hole-bearing'),
                             ('isFlippedRaw', 'True'), ('ownedPadCentersAvailable', False), ('explicitLayerGeometry', [])]:
            target = deepcopy(self.sources[1]); target[field] = value; cases.append(target)
        duplicate = deepcopy(self.sources[1]); duplicate['explicitLayerGeometry'][0]['pads'].append(deepcopy(duplicate['explicitLayerGeometry'][0]['pads'][0])); cases.append(duplicate)
        invalid = deepcopy(self.sources[1]); invalid['explicitLayerGeometry'][0]['pads'][0]['widthMm'] = float('nan'); cases.append(invalid)
        for target in cases:
            with self.assertRaises(CaptureBlocked): self.derive(target=target)


if __name__ == '__main__':
    unittest.main()
