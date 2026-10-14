"""Authored binding relationships and geometry; no private job expectations."""
from copy import deepcopy
from hashlib import sha256
import json
from unittest.mock import patch
import unittest
from xml.etree import ElementTree as ET

from workers.scan.native_pad_binding import diagnose_pad_bindings
from workers.scan.qualification_candidate import _xml
from workers.scan.snapshot_capture import CaptureBlocked
from workers.scan.tests.test_native_preparation import fixtures


def binding_fixture():
    job, master, pcb = fixtures()
    j, m = ET.fromstring(job), ET.fromstring(master)
    part = j.find('PartDataList/PartData')
    part.find('WND_PAD').text = '11|201|0.3|0.5|100.00|200@12|202|0.3|0.5|101|201.0'
    ET.SubElement(part, 'ListGerPadId1').text = '201'
    ET.SubElement(part, 'ListGerPadId2').text = '202'
    # Common-list suffixes and tuple groups are deliberately different domains.
    ET.SubElement(part, 'ListGerbPadId_Common1').text = '202'
    for window, group in zip(m.findall('WindowDataList/WindowData'), ('11', '12')):
        window.find('GroupID').text = group
    container = ET.SubElement(j, 'GerberList')
    for pid, point in (('201', '100,200'), ('202', '101,201')):
        pad = ET.SubElement(container, 'GerberPad')
        for key, value in {'ID': pid, 'ModelID': '1', 'BlockID': 'authored-block',
                           'PartNo': '101', 'PartNoOld': '-1', 'C': point,
                           'WH': '0.8,0.4', 'PadFormat': 'invented-shape', 'PinNumber': ''}.items():
            ET.SubElement(pad, key).text = value
    return ET.tostring(j), ET.tostring(m), pcb


class NativePadBindingWorkTests(unittest.TestCase):
    def setUp(self):
        self.job, self.master, self.pcb = binding_fixture()

    def report(self, job=None, master=None, pcb=None):
        return diagnose_pad_bindings(self.job if job is None else job,
            self.master if master is None else master, self.pcb if pcb is None else pcb)

    def test_literal_closure_and_exact_dimensions_never_prove_owned_binding_or_inspection(self):
        before = tuple(sha256(x).hexdigest() for x in (self.job, self.master, self.pcb))
        result = self.report()
        self.assertEqual(result['status'], 'recorded')
        self.assertEqual(result['counts']['cadRecords'], 3)
        self.assertEqual(result['counts']['componentsWithObservedClosedBindingSyntax'], 1)
        row = result['components'][0]
        placement = row['placements'][0]
        self.assertEqual(placement['literalState'], 'closed-observed-syntax')
        self.assertEqual(placement['literalClosedTupleCount'], 2)
        self.assertTrue(placement['sourcePadCountEqualsTupleCount'])
        self.assertFalse(placement['countEqualityProvesBindingCompleteness'])
        self.assertEqual(row['sourceLayers'][0]['exactNativeSizeOnlyMatchCount'], 2)
        self.assertFalse(row['sourceLayers'][0]['sizeOnlyComparisonEstablishesOwnership'])
        self.assertIn('BINDING_SOURCE_NATIVE_FRAME_UNQUALIFIED', row['holdCodes'])
        self.assertIn('BINDING_TUPLE_FIELDS_UNQUALIFIED', row['holdCodes'])
        self.assertIn('BINDING_DEPENDENT_WINDOWS_UNVERIFIED', row['holdCodes'])
        self.assertFalse(result['bindingPreparationQualified'])
        self.assertFalse(result['nativeEditsApplied'])
        self.assertFalse(result['machineExportAllowed'])
        self.assertFalse(result['inspectionRepairEstablished'])
        self.assertEqual(before, tuple(sha256(x).hexdigest() for x in (self.job, self.master, self.pcb)))
        self.assertEqual(result, self.report())
        self.assertEqual(result['source']['jobSha256'], before[0])

    def test_read_only_schema_opt_in_preserves_each_observed_version(self):
        for version in ('10.1', '10.2'):
            job = self.job.replace(b'<JobXmlVersion>10.2', ('<JobXmlVersion>'+version).encode())
            master = self.master.replace(b'<JobXmlVersion>10.2', ('<JobXmlVersion>'+version).encode())
            before = tuple(sha256(raw).hexdigest() for raw in (job, master, self.pcb))
            result = self.report(job=job, master=master)
            self.assertEqual(result['status'], 'recorded')
            self.assertTrue(result['inventoryComplete'])
            self.assertEqual(result['components'][0]['placements'][0]['literalClosedTupleCount'], 2)
            self.assertFalse(result['bindingPreparationQualified'])
            self.assertFalse(result['inspectionRepairEstablished'])
            self.assertEqual(before, tuple(sha256(raw).hexdigest() for raw in (job, master, self.pcb)))
            self.assertEqual(result['source']['jobSha256'], before[0])
            self.assertEqual(result['source']['masterSha256'], before[1])
        # The default used by existing preparation writers remains 10.2.
        with self.assertRaises(CaptureBlocked):
            _xml(self.job.replace(b'<JobXmlVersion>10.2', b'<JobXmlVersion>10.1'))
        _xml(self.job)

    def test_axis_swapped_size_observations_do_not_qualify_pad_or_window_frame(self):
        for wh in ('0.8,0.4', '0.4,0.8'):
            j = ET.fromstring(self.job)
            for pad in j.findall('GerberList/GerberPad'):
                pad.find('WH').text = wh
            row = self.report(job=ET.tostring(j))['components'][0]
            self.assertEqual(row['sourceLayers'][0]['exactNativeSizeOnlyMatchCount'], 2)
            self.assertNotIn('BINDING_ARTWORK_EQUIVALENCE_UNQUALIFIED', row['holdCodes'])
            self.assertIn('BINDING_SOURCE_NATIVE_FRAME_UNQUALIFIED', row['holdCodes'])
            self.assertIn('BINDING_DEPENDENT_WINDOWS_UNVERIFIED', row['holdCodes'])
            self.assertFalse(row['sourceLayers'][0]['sizeOnlyComparisonEstablishesOwnership'])
            self.assertFalse(row['bindingPreparationQualified'])

    def test_partno_cad_join_and_reference_difference_are_only_an_experiment(self):
        result = self.report()
        relation = result['partNoCadJoin']
        self.assertFalse(relation['ownershipEvidence'])
        self.assertEqual(relation['padJoinCounts'], {'unique-literal-match': 2})
        self.assertEqual(relation['boundReferenceComparisons'], {'different-reference-literals': 2})
        self.assertNotIn('BINDING_LITERAL_CLOSURE', result['components'][0]['holdCodes'])

    def test_group_ids_do_not_select_individual_or_common_list_suffixes(self):
        part = self.report()['components'][0]['placements'][0]
        self.assertEqual(part['individualListOrdinalComparison']['matches'], 2)
        self.assertFalse(part['individualListOrdinalComparison']['semanticsQualified'])
        self.assertFalse(part['commonListSemanticsQualified'])
        self.assertTrue(part['nonzeroGroupsUnique'])

    def test_one_closed_tuple_is_not_full_two_pad_binding(self):
        j = ET.fromstring(self.job)
        j.find('PartDataList/PartData/WND_PAD').text = '11|201|0.3|0.5|100|200'
        result = self.report(job=ET.tostring(j))
        row = result['components'][0]
        self.assertEqual(row['sourceOwnedPadCount'], 2)
        self.assertEqual(row['placements'][0]['bindingTupleCount'], 1)
        self.assertEqual(row['placements'][0]['literalClosedTupleCount'], 1)
        self.assertFalse(row['placements'][0]['sourcePadCountEqualsTupleCount'])
        self.assertFalse(row['bindingPreparationQualified'])

    def test_missing_parts_remain_exact_module_reference_work(self):
        report = self.report()
        self.assertEqual([r['reference'] for r in report['components']], ['T1', 'N1', 'N2'])
        missing = report['components'][1:]
        self.assertTrue(all('BINDING_NATIVE_PART_MISSING' in r['holdCodes'] for r in missing))
        self.assertTrue(all(r['nativePlacementCount'] == 0 and r['sourceOwnership'] == 'explicit-pattern-pad-number' for r in missing))

    def test_duplicates_do_not_choose_a_survivor(self):
        j = ET.fromstring(self.job)
        copied = deepcopy(j.find('PartDataList/PartData'))
        copied.find('ID').text = '400'
        j.find('PartDataList').append(copied)
        row = self.report(job=ET.tostring(j))['components'][0]
        self.assertEqual(row['nativePlacementCount'], 2)
        self.assertIn('BINDING_NATIVE_PART_DUPLICATE', row['holdCodes'])
        self.assertEqual(len(row['placements']), 2)

    def test_exact_native_coordinate_or_scope_mismatch_blocks_literal_closure(self):
        for field, value in [('C', '100,200.01'), ('ModelID', 'another-module')]:
            j = ET.fromstring(self.job)
            j.find('GerberList/GerberPad/' + field).text = value
            row = self.report(job=ET.tostring(j))['components'][0]
            self.assertIn('BINDING_LITERAL_CLOSURE', row['holdCodes'])
            self.assertEqual(row['placements'][0]['literalClosedTupleCount'], 1)

    def test_missing_binding_and_unsupported_token_count_are_distinct(self):
        for value, code in [('', 'BINDING_SCALAR_MISSING'), ('11|201|prefix-only', 'BINDING_TUPLE_SYNTAX')]:
            j = ET.fromstring(self.job)
            j.find('PartDataList/PartData/WND_PAD').text = value
            row = self.report(job=ET.tostring(j))['components'][0]
            self.assertIn(code, row['holdCodes'])
            self.assertEqual(row['placements'][0]['literalState'], 'incomplete-or-unresolved')

    def test_dependent_window_link_outside_local_master_remains_held(self):
        m = ET.fromstring(self.master)
        m.find('WindowDataList/WindowData/AlignWndID').text = 'outside-this-model'
        row = self.report(master=ET.tostring(m))['components'][0]
        self.assertIn('BINDING_WINDOW_SCOPE', row['holdCodes'])
        self.assertFalse(row['placements'][0]['windowLocalLinksClosed'])

    def test_hole_bearing_parts_are_distinct_from_missing_smt_parts(self):
        source = self.pcb.replace(b'(holeDiam 0)', b'(holeDiam 1.2)')
        report = self.report(pcb=source)
        self.assertTrue(all(r['mountingEvidence'] == 'hole-bearing' for r in report['components']))
        self.assertTrue(all('BINDING_HOLE_BEARING' in r['holdCodes'] for r in report['components']))

    def test_artwork_dimensions_do_not_qualify_native_shape_codes_or_layers(self):
        j = ET.fromstring(self.job)
        for pad in j.findall('GerberList/GerberPad'):
            pad.find('WH').text = '0.7,0.35'
        row = self.report(job=ET.tostring(j))['components'][0]
        self.assertIn('BINDING_ARTWORK_EQUIVALENCE_UNQUALIFIED', row['holdCodes'])
        self.assertFalse(row['sourceLayers'][0]['pasteOrInspectionLayerQualified'])

    def test_malformed_or_over_limit_inputs_produce_no_partial_completed_inventory(self):
        for raw in [b'<broken', self.job.replace(b'<JobXmlVersion>10.2', b'<JobXmlVersion>99.0'),
                    b'<!DOCTYPE x [<!ENTITY secret "opaque">]>' + self.job]:
            result = self.report(job=raw)
            self.assertEqual(result['status'], 'blocked')
            self.assertFalse(result['inventoryComplete'])
            self.assertEqual(result['components'], [])
        with patch('workers.scan.native_pad_binding.MAX_ROWS', 1):
            result = self.report()
            self.assertEqual(result['code'], 'BINDING_LIMIT')
            self.assertEqual(result['components'], [])

    def test_ambiguous_native_pad_id_and_block_do_not_select_one_record(self):
        j = ET.fromstring(self.job)
        duplicate = deepcopy(j.find('GerberList/GerberPad'))
        duplicate.find('BlockID').text = 'another-authored-block'
        j.find('GerberList').append(duplicate)
        result = self.report(job=ET.tostring(j))
        row = result['components'][0]
        self.assertIn('BINDING_LITERAL_CLOSURE', row['holdCodes'])
        self.assertEqual(row['placements'][0]['literalClosedTupleCount'], 1)
        self.assertFalse(row['bindingPreparationQualified'])

    def test_repeated_binding_scalar_is_distinct_from_missing_and_not_combined(self):
        j = ET.fromstring(self.job)
        ET.SubElement(j.find('PartDataList/PartData'), 'WND_PAD').text = '11|201|9|9|100|200'
        row = self.report(job=ET.tostring(j))['components'][0]
        self.assertIn('BINDING_SCALAR_AMBIGUOUS', row['holdCodes'])
        self.assertNotIn('BINDING_SCALAR_MISSING', row['holdCodes'])
        self.assertEqual(row['placements'][0]['bindingTupleCount'], 0)

    def test_out_of_budget_report_does_not_return_partial_rows(self):
        with patch('workers.scan.native_pad_binding.MAX_OUTPUT_BYTES', 100):
            result = self.report()
        self.assertEqual(result['status'], 'blocked')
        self.assertEqual(result['components'], [])
        self.assertFalse(result['inventoryComplete'])

    def test_output_does_not_disclose_coordinates_mpn_or_raw_tuple_values(self):
        j = ET.fromstring(self.job)
        j.find('PartDataList/PartData/Name').text = 'invented-private-part-marker'
        result = self.report(job=ET.tostring(j))
        serialized = json.dumps(result)
        self.assertNotIn('invented-private-part-marker', serialized)
        self.assertNotIn('11|201|0.3|0.5', serialized)
        self.assertNotIn('100.00', serialized)
        self.assertNotIn('rawFields', serialized)
        blocked = self.report(job=b'<invented-private-failure-marker')
        self.assertNotIn('invented-private-failure-marker', json.dumps(blocked))

    def test_unbounded_numeric_dimensions_and_unsupported_master_reader_fail_safely(self):
        j = ET.fromstring(self.job)
        j.find('GerberList/GerberPad/WH').text = '1e9999999,NaN'
        result = self.report(job=ET.tostring(j))
        self.assertEqual(result['status'], 'recorded')
        self.assertFalse(result['bindingPreparationQualified'])
        m = ET.fromstring(self.master)
        field = m.find('WindowDataList/WindowData/ID')
        ET.SubElement(field, 'nested-unqualified-id').text = 'opaque-private-marker'
        blocked = self.report(master=ET.tostring(m))
        self.assertEqual(blocked['code'], 'BINDING_NATIVE_INVENTORY_UNAVAILABLE')
        self.assertFalse(blocked['inventoryComplete'])
        self.assertNotIn('opaque-private-marker', json.dumps(blocked))


if __name__ == '__main__':
    unittest.main()
