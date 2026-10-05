"""Fictional records only; no real job or machine compatibility fixture."""
from copy import deepcopy
import json
import unittest
from unittest.mock import patch

from workers.scan.native_inspection_work import inspection_work


CONTEXT = {'archiveSha256': 'a' * 64, 'packageSha256': 'b' * 64, 'snapshotId': 'c' * 64,
           'selection': {'root': 'fictional/Board',
                         'job': {'member': 'fictional/Board/Board.xml', 'role': 'main', 'sha256': 'd' * 64},
                         'master': {'member': 'fictional/Master/Master.xml', 'role': 'main', 'sha256': 'e' * 64}}}


def rec(kind, path, **fields):
    return {'kind': kind + '-record', 'sourcePath': path,
            'rawFields': {k: v if isinstance(v, list) else [v] for k, v in fields.items()}}


def doc(records):
    return {'status': 'recorded', 'readerProfile': 'jobcontainer-10.2-observed-readonly-1', 'records': records}


def normal():
    algorithm = rec('algorithm', 'windows[1]/algorithms[1]', ID='local', Type='fictional-type')
    algorithm['containerSourcePath'] = 'windows[1]'
    return {'job': doc([rec('part', 'parts[1]', ID='P-A', ParentId='module-A', RefID='F-A', MasterKey='shared'),
                        rec('part', 'parts[2]', ID='P-B', ParentId='module-B', RefID='F-A', MasterKey='shared')]),
            'master': doc([rec('part', 'models[1]', ID='model', MasterKey='shared'),
                           rec('window', 'windows[1]', ID='window', ParentId='shared', GroupID='literal-group'),
                           algorithm])}


class NativeInspectionWorkTests(unittest.TestCase):
    def test_shared_windows_listed_once_with_every_affected_placement(self):
        documents = normal(); before = deepcopy(documents)
        result = inspection_work(documents, CONTEXT)
        self.assertEqual(documents, before)
        self.assertEqual(result['status'], 'recorded')
        self.assertTrue(result['inventoryComplete'])
        self.assertEqual(len(result['scopes']), 1)
        self.assertEqual(len(result['windows']), 1)
        self.assertEqual(result['scopes'][0]['partIds'], [p['id'] for p in result['parts']])
        self.assertEqual(result['scopes'][0]['windowIds'], [result['windows'][0]['id']])
        self.assertEqual(result['windows'][0]['algorithmIds'], [result['algorithms'][0]['id']])
        self.assertEqual(result['algorithms'][0]['windowId'], result['windows'][0]['id'])
        self.assertEqual(result['sourceContext'], CONTEXT)
        self.assertFalse(result['inspectionRepairEstablished'])
        self.assertFalse(result['machineExportAllowed'])
        self.assertFalse(result['nativeEditsApplied'])
        self.assertIsNone(result['counts']['qualifiedInspections'])
        self.assertIsNone(result['counts']['completedOfflineInspections'])

    def test_ambiguous_master_and_duplicate_window_ids_do_not_choose_survivor(self):
        documents = normal()
        documents['master']['records'] += [rec('part', 'models[2]', ID='another', MasterKey='shared'),
                                           rec('window', 'windows[2]', ID='window', ParentId='shared')]
        result = inspection_work(documents, CONTEXT)
        self.assertEqual(result['scopes'][0]['masterMatchState'], 'ambiguous')
        self.assertEqual(len(result['scopes'][0]['masterPartSourcePaths']), 2)
        self.assertEqual(len(result['windows']), 2)
        self.assertNotEqual(result['windows'][0]['id'], result['windows'][1]['id'])
        self.assertTrue(all(w['geometryReview'] == 'unresolved' for w in result['windows']))

    def test_missing_master_means_unknown_window_count_not_zero_work(self):
        for missing_selection in (False, True):
            documents = normal(); context = deepcopy(CONTEXT)
            if missing_selection:
                context['selection']['master'] = None
            else:
                del documents['master']
            result = inspection_work(documents, context)
            self.assertFalse(result['inventoryComplete'])
            self.assertIsNone(result['counts']['masterWindows'])
            self.assertIsNone(result['counts']['masterAlgorithms'])
            self.assertEqual(result['scopes'][0]['masterMatchState'], 'unavailable')
            self.assertEqual(len(result['parts']), 2)

    def test_unusable_scope_and_orphan_algorithms_are_retained_without_guessing(self):
        documents = normal()
        documents['job']['records'][0]['rawFields']['MasterKey'] = ['shared', 'shared']
        documents['master']['records'][1]['rawFields']['ParentId'] = []
        documents['master']['records'][2]['containerSourcePath'] = 'missing-window'
        result = inspection_work(documents, CONTEXT)
        self.assertIsNone(result['parts'][0]['scopeId'])
        self.assertIsNone(result['windows'][0]['scopeId'])
        self.assertIsNone(result['algorithms'][0]['windowId'])
        self.assertEqual(result['counts']['unscopedParts'], 1)
        self.assertEqual(result['counts']['unscopedWindows'], 1)
        self.assertEqual(result['counts']['unscopedAlgorithms'], 1)

    def test_literal_identity_keeps_similar_keys_distinct_and_ids_bind_snapshot(self):
        documents = normal()
        documents['job']['records'][0]['rawFields']['MasterKey'] = ['01']
        documents['job']['records'][1]['rawFields']['MasterKey'] = ['1']
        result = inspection_work(documents, CONTEXT)
        self.assertEqual(len(result['scopes']), 3)
        self.assertEqual(result, inspection_work(documents, CONTEXT))
        changed = deepcopy(CONTEXT); changed['selection']['job']['role'] = 'temp'
        other = inspection_work(documents, changed)
        self.assertNotEqual(result['parts'][0]['id'], other['parts'][0]['id'])

    def test_malformed_input_and_limits_return_no_partial_queue(self):
        cases = [(normal(), {}), (normal(), {**CONTEXT, 'snapshotId': 'not-a-hash'})]
        malformed = normal(); malformed['master']['records'][2]['containerSourcePath'] = ['invalid']
        cases.append((malformed, CONTEXT))
        for docs, context in cases:
            result = inspection_work(docs, context)
            self.assertEqual(result['status'], 'blocked')
            self.assertEqual(result['parts'], [])
            self.assertEqual(result['windows'], [])
        with patch('workers.scan.native_inspection_work.MAX_OUTPUT_BYTES', 500):
            result = inspection_work(normal(), CONTEXT)
        self.assertEqual(result['status'], 'blocked')
        self.assertFalse(result['inventoryComplete'])
        self.assertEqual(result['scopes'], [])

    def test_many_placements_do_not_multiply_shared_inspection_tasks(self):
        documents = normal()
        documents['job']['records'] = [rec('part', f'parts[{i}]', ID=str(i), ParentId='M', RefID=f'F{i}', MasterKey='shared') for i in range(500)]
        result = inspection_work(documents, CONTEXT)
        self.assertEqual(result['status'], 'recorded')
        self.assertEqual(len(result['scopes']), 1)
        self.assertEqual(len(result['windows']), 1)
        self.assertEqual(len(result['scopes'][0]['partIds']), 500)
        self.assertLess(len(json.dumps(result)), 250_000)

    def test_trial_or_verification_notes_cannot_complete_inspection_work(self):
        documents = normal()
        documents['candidateStatus'] = {'accepted': True, 'nativeEditsApplied': True, 'eagleOpened': True}
        result = inspection_work(documents, CONTEXT)
        self.assertTrue(all(p['bindingReview'] == 'unresolved' for p in result['parts']))
        self.assertTrue(all(w['teachingReview'] == 'unverified' for w in result['windows']))
        self.assertFalse(result['inspectionRepairEstablished'])


if __name__ == '__main__':
    unittest.main()
