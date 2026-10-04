"""Wholly invented binding strings and records; no manufacturing fixtures."""
import copy
import unittest
from unittest.mock import patch

from workers.scan.native_bindings import report_native_bindings


def rec(kind, path, **fields):
    return {'kind': kind + '-record', 'sourcePath': path,
            'rawFields': {key: [value] if isinstance(value, str) else value for key, value in fields.items()}}


def doc(*records):
    return {'status': 'recorded', 'readerProfile': 'jobcontainer-10.2-observed-readonly-1', 'records': list(records)}


def fixture():
    return {
        'job': doc(
            rec('part', 'part[1]', ID='native-distinct', ParentId='board-fable', RefID='FICTION-Z', MasterKey='master-moon',
                WND_PAD='group-star|pad-comet|unknown-middle|9|1.25|-8.5@'),
            rec('pad', 'pad[1]', ID='pad-comet', ModelID='board-fable', BlockID='block-azure', PartNo='cad-separate', C='1.25,-8.5'),
            rec('cad', 'cad[1]', ID='cad-separate', ModuleID='board-fable', RefID='FICTION-Y'),
        ),
        'master': doc(rec('window', 'window[1]', ID='window-distinct', ParentId='master-moon', GroupID='group-star')),
    }


def field(data, index, key, value, role='job'):
    data[role]['records'][index]['rawFields'][key] = value if isinstance(value, list) else [value]


class NativeBindingsTests(unittest.TestCase):
    def test_exact_chain_identity_domains_and_input_immutability(self):
        data = fixture()
        before = copy.deepcopy(data)
        result = report_native_bindings(data)
        self.assertEqual(data, before)
        self.assertEqual(result['status'], 'recorded')
        self.assertTrue(result['literalObservationsComplete'])
        binding = result['bindings'][0]
        self.assertEqual(binding['tokens'], ['group-star', 'pad-comet', 'unknown-middle', '9', '1.25', '-8.5'])
        self.assertEqual(binding['window']['state'], 'unique-literal-match')
        self.assertEqual(binding['window']['targetSourcePaths'], ['window[1]'])
        self.assertEqual(binding['pad']['state'], 'unique-literal-match')
        self.assertEqual(binding['pad']['selectedScopeLiterals']['BlockID'], 'block-azure')
        self.assertEqual(binding['coordinateComparison']['state'], 'literal-pair-equal')
        self.assertEqual(result['parts'][0]['emptySegmentOrdinals'], [2])
        self.assertEqual(binding['ownership'], 'unknown')
        self.assertFalse(result['ownershipQualified'])
        self.assertFalse(result['nativeSchemaQualified'])
        self.assertFalse(result['machineExportAllowed'])
        self.assertFalse(result['nativeEditsApplied'])
        self.assertEqual(result['findings'], [])

    def test_partno_candidate_join_mismatch_never_becomes_finding(self):
        result = report_native_bindings(fixture())
        experiment = result['padCadRelationExperiment']
        self.assertEqual(experiment['status'], 'relation-experiment-only')
        self.assertFalse(experiment['ownershipEvidence'])
        self.assertEqual(experiment['padJoinCounts'], {'unique-literal-match': 1})
        self.assertEqual(experiment['boundPartReferenceComparisonCounts'], {'different-reference-literals': 1})
        self.assertEqual(experiment['examples'][0]['candidateCadSourcePath'], 'cad[1]')
        self.assertEqual(result['findings'], [])

    def test_id_arithmetic_ordinal_fallback_and_whitespace_are_not_used(self):
        data = fixture()
        field(data, 0, 'WND_PAD', 'group-star|01|x|y|1.25|-8.5')
        field(data, 1, 'ID', '1')
        field(data, 1, 'PartNo', '1')
        field(data, 2, 'ID', '01')
        result = report_native_bindings(data)
        self.assertEqual(result['bindings'][0]['pad']['state'], 'unmatched')
        self.assertEqual(result['padCadRelationExperiment']['padJoinCounts'], {'unmatched': 1})
        field(data, 0, 'WND_PAD', ' group-star|pad-comet|x|y|1.25|-8.5')
        self.assertEqual(report_native_bindings(data)['bindings'][0]['window']['state'], 'unmatched')

    def test_scope_distinguishes_modules_but_does_not_guess_blocks(self):
        data = fixture()
        data['job']['records'].append(rec('pad', 'pad[2]', ID='pad-comet', ModelID='other-board', BlockID='another-block', C='7,8'))
        binding = report_native_bindings(data)['bindings'][0]
        self.assertEqual(binding['pad']['state'], 'unique-literal-match')
        self.assertEqual(binding['pad']['unscopedIdMatchCount'], 2)
        data['job']['records'].append(rec('pad', 'pad[3]', ID='pad-comet', ModelID='board-fable', BlockID='another-block', C='1.25,-8.5'))
        binding = report_native_bindings(data)['bindings'][0]
        self.assertEqual(binding['pad']['state'], 'ambiguous')
        self.assertEqual(binding['pad']['targetCount'], 2)
        self.assertEqual(binding['coordinateComparison']['state'], 'unavailable')

    def test_same_composite_key_collision_is_not_collapsed(self):
        data = fixture()
        duplicate = copy.deepcopy(data['job']['records'][1])
        duplicate['sourcePath'] = 'pad[2]'
        data['job']['records'].append(duplicate)
        self.assertEqual(report_native_bindings(data)['bindings'][0]['pad']['state'], 'ambiguous')

    def test_scope_mismatch_and_missing_or_repeated_scope_stay_unresolved(self):
        for change, expected in [('other-board', 'module-literal-differs'), ([], 'unusable-target-scope'),
                                 (['board-fable', 'board-fable'], 'unusable-target-scope')]:
            with self.subTest(change=change):
                data = fixture()
                field(data, 1, 'ModelID', change)
                binding = report_native_bindings(data)['bindings'][0]
                self.assertEqual(binding['pad']['state'], expected)
                self.assertEqual(binding['ownership'], 'unknown')
        data = fixture()
        data['job']['records'][1]['rawFields'].pop('BlockID')
        self.assertEqual(report_native_bindings(data)['bindings'][0]['pad']['state'], 'unusable-target-scope')
        data = fixture()
        field(data, 0, 'ParentId', [])
        self.assertEqual(report_native_bindings(data)['bindings'][0]['pad']['state'], 'unusable-source-key')

    def test_unscoped_target_cannot_be_silently_ignored(self):
        data = fixture()
        data['job']['records'].append(rec('pad', 'pad[2]', ID='pad-comet', BlockID='another-block', C='1.25,-8.5'))
        self.assertEqual(report_native_bindings(data)['bindings'][0]['pad']['state'], 'unusable-target-scope')

    def test_missing_block_in_known_different_module_does_not_contaminate_scope(self):
        data = fixture()
        data['job']['records'].append(rec('pad', 'pad[2]', ID='pad-comet', ModelID='other-module', C='1.25,-8.5'))
        self.assertEqual(report_native_bindings(data)['bindings'][0]['pad']['state'], 'unique-literal-match')
        field(data, 3, 'ModelID', 'board-fable')
        self.assertEqual(report_native_bindings(data)['bindings'][0]['pad']['state'], 'unusable-target-scope')

    def test_window_groupid_and_masterkey_are_exact_and_can_be_ambiguous(self):
        data = fixture()
        data['master']['records'].append(rec('window', 'window[2]', ID='group-star', ParentId='another-master', GroupID='group-star'))
        self.assertEqual(report_native_bindings(data)['bindings'][0]['window']['state'], 'unique-literal-match')
        field(data, 0, 'GroupID', 'different', 'master')
        self.assertEqual(report_native_bindings(data)['bindings'][0]['window']['state'], 'unmatched')
        field(data, 0, 'GroupID', 'group-star', 'master')
        field(data, 1, 'ParentId', 'master-moon', 'master')
        self.assertEqual(report_native_bindings(data)['bindings'][0]['window']['state'], 'ambiguous')

    def test_missing_master_is_unavailable_and_not_a_dangling_reference(self):
        data = fixture()
        data.pop('master')
        result = report_native_bindings(data)
        self.assertFalse(result['counts']['masterDocumentAvailable'])
        self.assertEqual(result['bindings'][0]['window']['state'], 'unavailable-document')
        self.assertFalse(any(f['code'] == 'WND_PAD_WINDOW_LITERAL_UNRESOLVED' for f in result['findings']))

    def test_tuple_separators_unknown_positions_and_bad_lengths_are_preserved(self):
        data = fixture()
        field(data, 0, 'WND_PAD', '@short|only@@group-star|pad-comet|two|opaque|1.25|-8.5|extra@')
        result = report_native_bindings(data)
        self.assertEqual(result['parts'][0]['emptySegmentOrdinals'], [1, 3, 5])
        self.assertEqual(len(result['bindings']), 2)
        self.assertEqual(result['bindings'][1]['tokens'][-1], 'extra')
        self.assertTrue(all(b['state'] == 'unsupported-token-count' for b in result['bindings']))
        self.assertNotIn('pad', result['bindings'][0])

    def test_sentinel_like_ids_are_recorded_and_never_assigned_special_meaning(self):
        data = fixture()
        field(data, 0, 'WND_PAD', '0|-1||opaque|1.25|-8.5')
        field(data, 1, 'ID', '-1')
        field(data, 0, 'GroupID', '0', 'master')
        binding = report_native_bindings(data)['bindings'][0]
        self.assertEqual(binding['sentinelLikeLiterals'], [{'position': 1, 'literal': '0'}, {'position': 2, 'literal': '-1'}, {'position': 3, 'literal': ''}])
        self.assertEqual(binding['pad']['state'], 'unique-literal-match')
        self.assertEqual(binding['window']['state'], 'unique-literal-match')

    def test_exact_decimal_comparison_without_tolerance_or_float_rounding(self):
        data = fixture()
        field(data, 1, 'C', '1.250,-8.500')
        self.assertEqual(report_native_bindings(data)['bindings'][0]['coordinateComparison']['state'], 'decimal-equal-text-differs')
        field(data, 1, 'C', '1.25000000000000000000000001,-8.5')
        self.assertEqual(report_native_bindings(data)['bindings'][0]['coordinateComparison']['state'], 'different-decimal-values')
        for value in ('NaN,-8.5', '1.25|8.5', '1.25,-8.5,0', '1e99999,-8.5'):
            field(data, 1, 'C', value)
            self.assertEqual(report_native_bindings(data)['bindings'][0]['coordinateComparison']['state'], 'unusable-coordinate-literal')

    def test_repeated_missing_and_empty_binding_scalars_are_distinct(self):
        for values, state in [([], 'missing-scalar'), (['a', 'b'], 'repeated-scalar'), ([''], 'empty-scalar')]:
            with self.subTest(values=values):
                data = fixture()
                field(data, 0, 'WND_PAD', values)
                result = report_native_bindings(data)
                self.assertEqual(result['parts'][0]['state'], state)
                self.assertEqual(result['parts'][0]['wndPadLiterals'], values)
                self.assertEqual(result['bindings'], [])

    def test_unavailable_profile_and_invalid_records_fail_without_partial_results(self):
        data = fixture()
        data['job']['readerProfile'] = 'future-profile'
        self.assertEqual(report_native_bindings(data)['status'], 'unavailable')
        for corrupt in (None, {'job': doc({'kind': 'invented', 'sourcePath': 'x', 'rawFields': {}})},
                        {'job': doc(rec('part', 'same'), rec('part', 'same'))},
                        {'job': doc(rec('part', 'x', WND_PAD=[7]))}):
            with self.subTest(corrupt=corrupt):
                result = report_native_bindings(corrupt)
                self.assertEqual(result['code'], 'NATIVE_BINDINGS_INVALID_INPUT')
                self.assertFalse(result['literalObservationsComplete'])
                self.assertEqual(result['bindings'], [])

    def test_record_tuple_and_output_limits_do_not_return_truncated_success(self):
        for constant, limit in [('MAX_RECORDS', 1), ('MAX_TUPLES', 0), ('MAX_OUTPUT_BYTES', 500)]:
            with self.subTest(constant=constant), patch('workers.scan.native_bindings.' + constant, limit):
                result = report_native_bindings(fixture())
                self.assertEqual(result['status'], 'blocked')
                self.assertEqual(result['code'], 'NATIVE_BINDINGS_LIMIT')
                self.assertEqual(result['bindings'], [])
                self.assertFalse(result['literalObservationsComplete'])

    def test_ambiguity_samples_and_experiment_examples_are_bounded(self):
        data = fixture()
        for i in range(1, 45):
            data['master']['records'].append(rec('window', f'window[{i + 1}]', ID=f'w{i}', ParentId='master-moon', GroupID='group-star'))
        binding = report_native_bindings(data)['bindings'][0]
        self.assertEqual(binding['window']['targetCount'], 45)
        self.assertEqual(len(binding['window']['targetSourcePaths']), 5)
        self.assertEqual(binding['window']['omittedTargetCount'], 40)
        data = fixture()
        for i in range(1, 30):
            part = copy.deepcopy(data['job']['records'][0])
            part['sourcePath'] = f'part[{i + 1}]'
            data['job']['records'].append(part)
        experiment = report_native_bindings(data)['padCadRelationExperiment']
        self.assertEqual(len(experiment['examples']), 25)
        self.assertEqual(experiment['omittedExampleCount'], 5)


if __name__ == '__main__':
    unittest.main()
