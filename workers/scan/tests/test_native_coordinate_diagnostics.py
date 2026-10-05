"""Synthetic coordinate triage; never a native-frame or repair qualification."""
from copy import deepcopy
import unittest

from workers.scan.native_accounting import analyze_native
from workers.scan.tests.test_native_accounting import rec, documents, CONTEXT


def board(module='M', ref='F1', ordinal=1, roi=('12', '20'), center=('10', '20'), cad=('10', '20')):
    return [rec('module', f'module[{module}]', ID=module),
            rec('cad', f'cad[{ordinal}]', ID=f'C{ordinal}', ModuleID=module, RefID=ref, X=cad[0], Y=cad[1]),
            rec('part', f'part[{ordinal}]', ID=f'P{ordinal}', ParentId=module, RefID=ref, MasterKey='fictional-model',
                **{'CenterPosX': center[0], 'CenterPosY': center[1], 'Roi/cx': roi[0], 'Roi/cy': roi[1]})]


class NativeCoordinateDiagnosticsTests(unittest.TestCase):
    def test_roi_offset_and_cad_disagreement_have_distinct_evidence_and_actions(self):
        source = documents(*board()); before = deepcopy(source)
        result = analyze_native(source, CONTEXT)
        self.assertEqual(result['status'], 'recorded')
        self.assertEqual(source, before)
        comparisons = result['coordinateComparisons']
        self.assertEqual(comparisons[0]['deltaXY'], ['2', '0'])
        self.assertEqual(comparisons[1]['state'], 'numerically-equal')
        self.assertEqual(comparisons[0]['left']['sourcePath'], 'part[1]')
        self.assertEqual(comparisons[0]['left']['fields'], ['Roi/cx', 'Roi/cy'])
        self.assertEqual(comparisons[0]['left']['literals'], [['12'], ['20']])
        self.assertFalse(any('NUMERIC_DIFFERENCE' in f['code'] for f in result['findings']))
        hold = next(b for b in result['sharedBlockers'] if b['code'] == 'NATIVE_SEMANTICS_UNQUALIFIED')
        action = next(w['nextAction'] for w in result['remainingWork'] if w.get('blockerId') == hold['id'])
        self.assertIn('Keep CAD and teaching unchanged', action)
        result = analyze_native(documents(*board(roi=('12', '20'), center=('12', '20'))), CONTEXT)
        self.assertEqual(result['coordinateComparisons'][0]['state'], 'numerically-equal')
        self.assertEqual(result['coordinateComparisons'][1]['deltaXY'], ['2', '0'])
        self.assertEqual(result['coordinateComparisons'][2]['deltaXY'], ['2', '0'])
        self.assertFalse(any('NUMERIC_DIFFERENCE' in f['code'] for f in result['findings']))
        self.assertFalse(result['nativeEditsApplied'])
        self.assertTrue(all(c['repairEligibility'] == 'unqualified' and c['unitsAndCommonFrameQualified'] is False for c in comparisons))

    def test_normal_equal_numbers_ignore_formatting_and_negative_zero(self):
        result = analyze_native(documents(*board(roi=('010.000', '-0'), center=('1e1', '0.0'), cad=('10', '0'))), CONTEXT)
        self.assertTrue(all(c['state'] == 'numerically-equal' for c in result['coordinateComparisons']))
        self.assertFalse(any('NUMERIC_DIFFERENCE' in f['code'] for f in result['findings']))
        self.assertIsNone(result['counts']['qualifiedPreparedComponents'])

    def test_shared_numeric_offset_is_factored_by_module_and_relation(self):
        records = board() + board(ref='F2', ordinal=2)[1:] + board(module='other', ref='F3', ordinal=3)
        result = analyze_native(documents(*records), CONTEXT)
        cohorts = result['coordinatePatterns']
        self.assertEqual(len(cohorts), 2)
        self.assertEqual(cohorts[0]['moduleLiteral'], 'M')
        self.assertEqual(len(cohorts[0]['affectedRowIds']), 2)
        self.assertIn('not a proven board/module transform', cohorts[0]['interpretation'])
        self.assertEqual(len(result['coordinateComparisons']), 9)

    def test_duplicate_references_do_not_establish_a_repeated_board_pattern(self):
        records = board() + board(ordinal=2)[1:]
        result = analyze_native(documents(*records), CONTEXT)
        self.assertEqual(result['coordinatePatterns'], [])
        comparisons = [c for c in result['coordinateComparisons'] if c['relation'] == 'placement-center-minus-native-cad']
        self.assertTrue(all(c['state'] == 'unavailable' and c['deltaXY'] is None for c in comparisons))
        self.assertTrue(all(c['unavailableReason'] == 'ambiguous-cad-part-correspondence' for c in comparisons))

    def test_missing_repeated_and_extreme_coordinates_remain_unknown(self):
        for value in ([], ['1', '1'], ['NaN'], ['Infinity'], ['1e999999999999999999999'], ['1e-99999'], ['3' * 129]):
            records = board(); records[-1]['rawFields']['Roi/cx'] = value
            result = analyze_native(documents(*records), CONTEXT)
            self.assertEqual(result['status'], 'recorded')
            self.assertEqual(result['coordinateComparisons'][0]['state'], 'unavailable')
            self.assertIsNone(result['coordinateComparisons'][0]['deltaXY'])

    def test_close_coordinates_are_not_rounded_into_equality(self):
        result = analyze_native(documents(*board(roi=('1.00000000000000000000000000000000000001', '20'), center=('1', '20'), cad=('1', '20'))), CONTEXT)
        self.assertEqual(result['coordinateComparisons'][0]['deltaXY'], ['0.00000000000000000000000000000000000001', '0'])

    def test_unknown_or_duplicate_modules_never_form_shared_transform_evidence(self):
        for records in (board()[1:] + board(ref='F2', ordinal=2)[1:],
                        board() + board(ref='F2', ordinal=2)[1:] + [rec('module', 'second-module', ID='M')]):
            result = analyze_native(documents(*records), CONTEXT)
            self.assertEqual(result['coordinatePatterns'], [])
            self.assertTrue(any(b['code'] == 'MODULE_LITERAL_REFERENCE_UNRESOLVED' for b in result['sharedBlockers']))

    def test_source_binding_and_determinism_do_not_use_master_geometry_as_common_frame(self):
        source = documents(*board())
        source['master'] = documents(*board(roi=('500', '600')))['job']
        result = analyze_native(source, CONTEXT)
        self.assertEqual(result, analyze_native(source, CONTEXT))
        other = analyze_native(source, {**CONTEXT, 'jobSha256': 'f' * 64})
        self.assertNotEqual(result['coordinateComparisons'][0]['id'], other['coordinateComparisons'][0]['id'])
        self.assertTrue(all(c['left']['sourcePath'].startswith('part[') for c in result['coordinateComparisons']))


if __name__ == '__main__':
    unittest.main()
