"""Independently authored fictional records, not an Eagle qualification fixture."""
import copy
import json
import unittest
from unittest.mock import patch

from workers.scan.native_accounting import analyze_native


CONTEXT = {'archiveSha256': 'a' * 64, 'snapshotId': 'fictional-snapshot',
           'jobMember': 'FICTIONAL/board.xml', 'jobSha256': 'b' * 64}


def rec(kind, path, **fields):
    return {'kind': kind + '-record', 'sourcePath': path,
            'rawFields': {key: [value] if isinstance(value, str) else value for key, value in fields.items()}}


def documents(*records):
    return {'job': {'status': 'recorded', 'readerProfile': 'jobcontainer-10.2-observed-readonly-1',
                    'records': list(records)}}


def normal():
    return documents(rec('module', 'modules[1]', ID='M-FICTION', TB='unmapped'),
                     rec('cad', 'cad[1]', ID='CAD-different', ModuleID='M-FICTION', RefID='Z-17', X='8.25', Y='-5', Ang='90'),
                     rec('part', 'parts[1]', ID='PART-independent', ParentId='M-FICTION', RefID='Z-17',
                         MasterKey='model-fiction', ENABLE='1', CenterPosX='7.5', CenterPosY='-4.125'))


class NativeAccountingTests(unittest.TestCase):
    def test_normal_board_counts_are_observations_and_do_not_complete_preparation(self):
        source = normal()
        before = copy.deepcopy(source)
        result = analyze_native(source, CONTEXT)
        self.assertEqual(source, before)
        self.assertEqual(result['status'], 'recorded')
        self.assertTrue(result['accountingComplete'])
        self.assertEqual(result['findings'], [])
        self.assertEqual(result['counts']['cadRows'], 1)
        self.assertEqual(result['counts']['nativePartInstances'], 1)
        self.assertIsNone(result['counts']['intendedComponents'])
        self.assertIsNone(result['counts']['qualifiedEnabledComponents'])
        row = result['componentCoverage'][0]
        self.assertEqual(row['nativeCorrespondence'], 'unique-literal-match')
        self.assertEqual(row['nativePreparation'], 'not-prepared')
        self.assertEqual(row['existingTeaching'], 'unassessed')
        self.assertEqual(row['enabledState'], 'unqualified')
        self.assertEqual(row['verification'], 'not-verified')
        self.assertEqual(row['release'], 'not-assessed')
        self.assertFalse(result['machineExportAllowed'])
        self.assertFalse(result['nativeEditsApplied'])
        self.assertEqual(result['changes'], [])
        self.assertEqual(result['nativeInstances'][0]['enableObservation'], 'literal-1')
        self.assertEqual(result['nativeInstances'][0]['enabledMeaning'], 'unqualified')
        self.assertTrue(all(blocker['affectedRowIds'] == [row['id']] for blocker in result['sharedBlockers']))

    def test_same_reference_in_other_modules_and_similar_numeric_keys_stay_distinct(self):
        source = normal()
        source['job']['records'] += [
            rec('module', 'modules[2]', ID='01'), rec('module', 'modules[3]', ID='1'),
            rec('cad', 'cad[2]', ID='cad2', ModuleID='01', RefID='Z-17'),
            rec('part', 'parts[2]', ID='part2', ParentId='1', RefID='Z-17', MasterKey='m2', ENABLE='0'),
        ]
        result = analyze_native(source, CONTEXT)
        self.assertEqual(len(result['correspondenceGroups']), 3)
        self.assertEqual(len(result['componentCoverage']), 3)
        self.assertEqual(result['counts']['literalCorrespondence'], {'unique-literal-match': 1, 'no-literal-match': 1, 'native-only': 1})
        self.assertEqual(result['counts']['enableLiteralObservations'], {'literal-1': 1, 'literal-0': 1})

    def test_duplicate_group_reports_exact_raw_comparison_without_survivor(self):
        source = normal()
        other = copy.deepcopy(source['job']['records'][-1])
        other['sourcePath'] = 'parts[2]'
        other['rawFields']['ID'] = ['SECOND']
        other['rawFields']['CenterPosX'] = ['007.5']
        other['rawFields']['ENABLE'] = ['0']
        source['job']['records'].append(other)
        result = analyze_native(source, CONTEXT)
        group = result['correspondenceGroups'][0]
        self.assertEqual(len(result['componentCoverage']), 1)
        self.assertEqual(len(group['nativeInstanceIds']), 2)
        self.assertEqual(result['componentCoverage'][0]['nativeCorrespondence'], 'multiple-literal-matches')
        self.assertIn('CenterPosX', group['rawFieldComparison']['differentFields'])
        self.assertIn('ENABLE', group['rawFieldComparison']['differentFields'])
        self.assertIn('CenterPosY', group['rawFieldComparison']['equalFields'])
        self.assertIn('Roi/cx', group['rawFieldComparison']['unusableFields'])
        self.assertEqual(result['changes'], [])
        self.assertNotIn('survivorId', group)
        self.assertTrue(all(finding['repairEligibility'] == 'unqualified' for finding in result['findings']))

    def test_repeated_missing_and_nonnumeric_fields_remain_accounted_for(self):
        source = normal()
        source['job']['records'] += [
            rec('cad', 'cad[2]', ID=['C2', 'C2'], ModuleID=['M-FICTION', 'M-FICTION'], RefID='?', X='NaN'),
            rec('cad', 'cad[3]', ID='C3', ModuleID='M-FICTION', RefID='', Y='eight'),
            rec('part', 'parts[2]', ID='P2', ParentId=[], RefID='OTHER', ENABLE=['1', '0']),
        ]
        result = analyze_native(source, CONTEXT)
        self.assertEqual(result['status'], 'recorded')
        self.assertEqual(result['counts']['cadRows'], 3)
        self.assertEqual(result['counts']['coverageRows'], 4)
        self.assertEqual(result['counts']['literalCorrespondence']['unusable-scope'], 3)
        self.assertEqual(len([f for f in result['findings'] if f['code'] == 'NATIVE_SCALAR_OBSERVATION']), 3)
        repeated = result['nativeInstances'][1]
        self.assertEqual(repeated['enableLiterals'], ['1', '0'])
        self.assertEqual(repeated['enableObservation'], 'repeated')

    def test_id_collision_is_not_a_cross_domain_join_or_automatic_duplicate(self):
        source = normal()
        source['job']['records'][1]['rawFields']['ID'] = ['SAME']
        source['job']['records'][2]['rawFields']['ID'] = ['SAME']
        self.assertEqual(analyze_native(source, CONTEXT)['findings'], [])
        source['job']['records'].append(rec('part', 'parts[2]', ID='SAME', ParentId='different-module', RefID='different-ref', MasterKey='other'))
        result = analyze_native(source, CONTEXT)
        collisions = [f for f in result['findings'] if f['code'] == 'NATIVE_ID_LITERAL_COLLISION']
        self.assertEqual(len(collisions), 1)
        self.assertEqual(collisions[0]['sourcePaths'], ['parts[1]', 'parts[2]'])
        self.assertNotIn('MULTIPLE_NATIVE_PART_RECORDS', [f['code'] for f in result['findings']])

    def test_missing_module_is_one_shared_blocker_for_many_rows(self):
        source = documents(*[rec('cad', f'cad[{i}]', ID=f'C{i}', ModuleID='unknown-module', RefID=f'FICTION-{i}') for i in range(20)])
        result = analyze_native(source, CONTEXT)
        blocks = [b for b in result['sharedBlockers'] if b['code'] == 'MODULE_LITERAL_REFERENCE_UNRESOLVED']
        self.assertEqual(len(blocks), 1)
        self.assertEqual(len(blocks[0]['affectedRowIds']), 20)
        self.assertEqual(set(blocks[0]['affectedRowIds']), {r['id'] for r in result['componentCoverage']})

    def test_true_false_and_other_enable_literals_do_not_become_enabled_claims(self):
        source = documents(*[rec('part', f'part[{i}]', ID=f'P{i}', ParentId='M', RefID=f'R{i}',
                                MasterKey='MODEL', ENABLE=value)
                             for i, value in enumerate(('True', 'False', 'TRUE', '1', '0', 'unknown'))],
                           rec('pad', 'pad[1]', ID='unqualified-pad'),
                           rec('algorithm', 'algorithm[1]', ID='unqualified-algorithm'))
        result = analyze_native(source, CONTEXT)
        self.assertEqual(result['status'], 'recorded')
        self.assertEqual(result['counts']['enableLiteralHistogram'],
                         {'True': 1, 'False': 1, 'TRUE': 1, '1': 1, '0': 1, 'unknown': 1})
        self.assertIsNone(result['counts']['qualifiedEnabledComponents'])
        self.assertEqual(result['counts']['padRecords'], 1)
        self.assertEqual(result['counts']['algorithmRecords'], 1)
        self.assertEqual(len(result['componentCoverage']), 6)

    def test_repeated_module_ids_are_factored_once_not_repeated_for_each_reference(self):
        source = documents(*[rec('module', f'module[{i}]', ID='REPEATED') for i in range(100)],
                           *[rec('cad', f'cad[{i}]', ID=f'C{i}', ModuleID='REPEATED', RefID=f'F{i}') for i in range(100)])
        result = analyze_native(source, CONTEXT)
        self.assertEqual(result['status'], 'recorded')
        self.assertEqual(len(result['moduleGroups']), 1)
        self.assertEqual(len(result['moduleGroups'][0]['sourcePaths']), 100)
        self.assertTrue(all('moduleSourcePaths' not in group for group in result['correspondenceGroups']))

    def test_algorithm_id_comparison_retains_containing_window_scope(self):
        first = rec('algorithm', 'windows[1]/algorithms[1]', ID='local-id')
        first['containerSourcePath'] = 'windows[1]'
        other_window = rec('algorithm', 'windows[2]/algorithms[1]', ID='local-id')
        other_window['containerSourcePath'] = 'windows[2]'
        unscoped = rec('algorithm', 'unknown/algorithm', ID='local-id')
        result = analyze_native(documents(first, other_window, unscoped), CONTEXT)
        self.assertEqual(result['findings'], [])
        same_window = rec('algorithm', 'windows[1]/algorithms[2]', ID='local-id')
        same_window['containerSourcePath'] = 'windows[1]'
        result = analyze_native(documents(first, other_window, unscoped, same_window), CONTEXT)
        collisions = [f for f in result['findings'] if f['code'] == 'NATIVE_ID_LITERAL_COLLISION']
        self.assertEqual(len(collisions), 1)
        self.assertEqual(collisions[0]['sourcePaths'], [first['sourcePath'], same_window['sourcePath']])
        self.assertIn('same containing-window source path', collisions[0]['message'])
        self.assertEqual(collisions[0]['repairEligibility'], 'unqualified')

    def test_pad_id_comparison_needs_exact_usable_model_and_block_literals(self):
        pads = [rec('pad', 'pad[1]', ID='local-pad', ModelID='M-1', BlockID='01'),
                rec('pad', 'pad[2]', ID='local-pad', ModelID='M-1', BlockID='1'),
                rec('pad', 'pad[3]', ID='local-pad', ModelID='M-2', BlockID='01'),
                rec('pad', 'pad[4]', ID='local-pad', ModelID='M-1'),
                rec('pad', 'pad[5]', ID='local-pad', ModelID=['M-1', 'M-1'], BlockID='01')]
        result = analyze_native(documents(*pads), CONTEXT)
        self.assertFalse(any(f['code'] == 'NATIVE_ID_LITERAL_COLLISION' for f in result['findings']))
        pads.append(rec('pad', 'pad[6]', ID='local-pad', ModelID='M-1', BlockID='01'))
        result = analyze_native(documents(*pads), CONTEXT)
        collisions = [f for f in result['findings'] if f['code'] == 'NATIVE_ID_LITERAL_COLLISION']
        self.assertEqual(len(collisions), 1)
        self.assertEqual(collisions[0]['sourcePaths'], ['pad[1]', 'pad[6]'])
        self.assertIn('literal ModelID/BlockID', collisions[0]['message'])
        self.assertEqual(result['changes'], [])

    def test_many_to_many_correspondence_is_linear_and_retains_every_cad_row_and_part(self):
        source = documents(rec('module', 'module', ID='M'),
                           *[rec('cad', f'cad[{i}]', ID=f'C{i}', ModuleID='M', RefID='fictional-shared') for i in range(250)],
                           *[rec('part', f'part[{i}]', ID=f'P{i}', ParentId='M', RefID='fictional-shared', MasterKey='F', ENABLE='1') for i in range(250)])
        result = analyze_native(source, CONTEXT)
        self.assertEqual(result['status'], 'recorded')
        self.assertEqual(len(result['componentCoverage']), 250)
        self.assertEqual(len(result['nativeInstances']), 250)
        self.assertEqual(len(result['correspondenceGroups']), 1)
        self.assertLess(len(json.dumps(result)), 350_000)

    def test_ids_bind_source_hashes_snapshot_member_and_exact_paths(self):
        first = analyze_native(normal(), CONTEXT)
        self.assertEqual(first, analyze_native(normal(), CONTEXT))
        old = first['componentCoverage'][0]['id']
        for name, replacement in [('archiveSha256', 'c' * 64), ('jobSha256', 'd' * 64), ('snapshotId', 'next'), ('jobMember', 'OTHER.xml')]:
            context = {**CONTEXT, name: replacement}
            self.assertNotEqual(old, analyze_native(normal(), context)['componentCoverage'][0]['id'])
        source = normal()
        source['job']['records'][1]['sourcePath'] = 'cad[999]'
        self.assertNotEqual(old, analyze_native(source, CONTEXT)['componentCoverage'][0]['id'])

    def test_missing_unsupported_empty_inventory_does_not_mean_zero_population(self):
        for source in ({}, {'job': {'status': 'unsupported'}}, {'job': {'status': 'recorded', 'readerProfile': 'other', 'records': []}}):
            result = analyze_native(source, CONTEXT)
            self.assertEqual(result['status'], 'unavailable')
            self.assertIsNone(result['counts'])
            self.assertFalse(result['accountingComplete'])
        result = analyze_native(documents(), CONTEXT)
        self.assertEqual(result['status'], 'recorded')
        self.assertEqual(result['counts']['cadRows'], 0)
        self.assertIsNone(result['counts']['intendedComponents'])

    def test_record_and_output_limits_return_no_partial_report(self):
        over = documents(*[rec('cad', f'cad[{i}]', ID=f'C{i}') for i in range(10001)])
        result = analyze_native(over, CONTEXT)
        self.assertEqual(result['code'], 'NATIVE_ACCOUNTING_LIMIT')
        self.assertEqual(result['componentCoverage'], [])
        with patch('workers.scan.native_accounting.MAX_OUTPUT_BYTES', 800):
            result = analyze_native(normal(), CONTEXT)
        self.assertEqual(result['code'], 'NATIVE_ACCOUNTING_LIMIT')
        self.assertEqual(result['findings'], [])
        self.assertIsNone(result['counts'])

    def test_ascii_escaped_unicode_output_obeys_real_byte_budget(self):
        source = documents(rec('module', 'module', ID='M'),
                           *[rec('cad', f'cad[{i}]', ID=f'C{i}', ModuleID='M', RefID=f'fiction-{i}-' + '\u754c' * 1000)
                             for i in range(300)])
        result = analyze_native(source, CONTEXT)
        self.assertEqual(result['code'], 'NATIVE_ACCOUNTING_LIMIT')
        self.assertEqual(result['componentCoverage'], [])
        self.assertLess(len(json.dumps(result, ensure_ascii=True).encode()), 3_000_000)

    def test_master_records_never_expand_selected_job_coverage(self):
        source = normal()
        source['master'] = documents(rec('part', 'master-part', ID='UNRELATED', ParentId='M', RefID='UNRELATED'))['job']
        result = analyze_native(source, CONTEXT)
        self.assertEqual(result['counts']['nativePartInstances'], 1)
        self.assertEqual(result['counts']['coverageRows'], 1)

    def test_corrupt_context_or_reader_structure_is_blocked_without_payload_echo(self):
        corrupt = normal()
        corrupt['job']['records'][1]['rawFields']['RefID'] = 'DO-NOT-ECHO'
        duplicate_path = normal()
        duplicate_path['job']['records'][1]['sourcePath'] = 'modules[1]'
        for source, context in [(corrupt, CONTEXT), (duplicate_path, CONTEXT), (normal(), {}), (normal(), {**CONTEXT, 'jobSha256': 'DO-NOT-ECHO'})]:
            result = analyze_native(source, context)
            self.assertEqual(result['code'], 'NATIVE_ACCOUNTING_INVALID_INPUT')
            self.assertNotIn('DO-NOT-ECHO', json.dumps(result))


if __name__ == '__main__':
    unittest.main()
