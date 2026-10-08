"""Invented duplicate records only; no customer geometry or native job fixture."""
from copy import deepcopy
from hashlib import sha256
import unittest
from xml.etree import ElementTree as ET

from workers.scan.native_duplicate_review import duplicate_review


def fixtures():
    job = b'''<JobContainer><JobXmlVersion>10.2</JobXmlVersion><PartDataList>
      <PartData><ID>1</ID><ParentId>M</ParentId><RefID>F1</RefID><MasterKey>A</MasterKey><ENABLE>True</ENABLE><Roi><cx>1</cx><cy>2</cy></Roi><WND_PAD>original-a</WND_PAD></PartData>
      <PartData><ID>2</ID><ParentId>M</ParentId><RefID>F1</RefID><MasterKey>B</MasterKey><ENABLE>True</ENABLE><Roi><cx>4</cx><cy>2</cy></Roi><WND_PAD>original-b</WND_PAD></PartData>
      <PartData><ID>3</ID><ParentId>other</ParentId><RefID>F1</RefID><MasterKey>A</MasterKey><ENABLE>True</ENABLE></PartData>
    </PartDataList></JobContainer>'''
    master = b'''<JobContainer><JobXmlVersion>10.2</JobXmlVersion><PartDataList>
      <PartData><MasterKey>A</MasterKey><RefID>F1</RefID><CadOffset><X>3</X></CadOffset></PartData>
      <PartData><MasterKey>B</MasterKey><RefID>F1</RefID><CadOffset><X>7</X></CadOffset></PartData>
    </PartDataList><WindowDataList>
      <WindowData><ID>10</ID><ParentId>A</ParentId><GroupID>1</GroupID><Name>Body</Name><RelRoi><cx>2</cx></RelRoi><AlgorithmDataList><AlgorithmData><ID>8</ID><Type>invented</Type><UnknownThreshold unit="synthetic">3</UnknownThreshold></AlgorithmData></AlgorithmDataList></WindowData>
      <WindowData><ID>20</ID><ParentId>B</ParentId><GroupID>1</GroupID><Name>Body</Name><RelRoi><cx>5</cx></RelRoi><AlgorithmDataList><AlgorithmData><ID>9</ID><Type>invented</Type><UnknownThreshold unit="synthetic">6</UnknownThreshold></AlgorithmData></AlgorithmDataList></WindowData>
    </WindowDataList></JobContainer>'''
    return job, master


def context(job, master):
    return {'archiveSha256': 'a' * 64, 'packageSha256': 'b' * 64, 'snapshotId': 'c' * 64,
            'selection': {'root': 'fictional', 'job': {'role': 'main', 'member': 'fictional/job.xml', 'sha256': sha256(job).hexdigest()},
                          'master': {'role': 'main', 'member': 'fictional/Master.xml', 'sha256': sha256(master).hexdigest()} if master is not None else None}}


class DuplicateReviewTests(unittest.TestCase):
    def setUp(self):
        self.job, self.master = fixtures()

    def report(self, job=None, master=None):
        j, m = job or self.job, master or self.master
        return duplicate_review(j, m, context(j, m))

    def test_exact_scope_full_unknown_algorithm_fields_and_shared_usage(self):
        before = (self.job, self.master)
        report = self.report()
        self.assertEqual(report['status'], 'recorded')
        self.assertEqual(report['counts']['duplicateScopes'], 1)
        group = report['groups'][0]
        self.assertEqual(group['module'], 'M')
        self.assertEqual(len(group['candidates'][0]['master']['sharedUsage']), 2)
        pair = group['pairs'][0]
        self.assertEqual(pair['comparisons']['placementGeometry']['changedFieldCount'], 1)
        self.assertEqual(pair['comparisons']['bindings']['changedFieldCount'], 1)
        fields = [item['field'] for item in pair['windowComparisons'][0]['comparison']['examples']]
        self.assertIn('AlgorithmDataList/AlgorithmData/UnknownThreshold', fields)
        self.assertFalse(pair['suppressionSupported'])
        self.assertFalse(report['nativeEditsApplied'])
        self.assertEqual(before, (self.job, self.master))

    def test_unknown_parameter_and_snapshot_role_invalidate_pair_digest(self):
        baseline = self.report()['groups'][0]['pairs'][0]['digest']
        changed = self.master.replace(b'>3</UnknownThreshold>', b'>99</UnknownThreshold>')
        self.assertNotEqual(baseline, self.report(master=changed)['groups'][0]['pairs'][0]['digest'])
        selection = context(self.job, self.master)
        selection['selection']['master']['role'] = 'backup'
        self.assertNotEqual(baseline, duplicate_review(self.job, self.master, selection)['groups'][0]['pairs'][0]['digest'])

    def test_stale_hash_blocks_whole_report(self):
        report = duplicate_review(self.job + b' ', self.master, context(self.job, self.master))
        self.assertEqual(report['status'], 'blocked')
        self.assertEqual(report['groups'], [])

    def test_missing_master_is_unknown_never_zero_teaching(self):
        report = duplicate_review(self.job, None, context(self.job, None))
        self.assertEqual(report['status'], 'recorded')
        c = report['groups'][0]['candidates'][0]
        self.assertEqual(c['master']['state'], 'unavailable')
        self.assertIsNone(c['master']['windows'])
        self.assertIsNone(c['master']['algorithms'])
        self.assertIsNone(report['groups'][0]['pairs'][0]['comparisons']['masterFields'])

    def test_repeated_identity_is_retained_not_silently_selected(self):
        job = self.job.replace(b'<ID>1</ID>', b'<ID>1</ID><ID>1</ID>')
        report = self.report(job=job)
        candidate = report['groups'][0]['candidates'][0]
        self.assertFalse(candidate['identityUnambiguous'])
        self.assertEqual(candidate['identityLiterals']['ID'], ['1', '1'])
        self.assertIn('PLACEMENT_IDENTITY_AMBIGUOUS', report['groups'][0]['pairs'][0]['holds'])
        job = self.job.replace(b'<RefID>F1</RefID>', b'<RefID>F1</RefID><RefID>F1</RefID>', 1)
        report = self.report(job=job)
        self.assertEqual(report['counts']['unscopedPlacements'], 1)
        self.assertEqual(report['counts']['duplicateScopes'], 0)

    def test_same_id_elsewhere_is_ambiguous(self):
        report = self.report(job=self.job.replace(b'<ID>3</ID>', b'<ID>1</ID>'))
        self.assertFalse(report['groups'][0]['candidates'][0]['identityUnambiguous'])

    def test_ambiguous_models_and_window_roles_never_choose(self):
        root = ET.fromstring(self.master)
        root.find('PartDataList').append(deepcopy(root.find('PartDataList/PartData')))
        root.find('WindowDataList').append(deepcopy(root.find('WindowDataList/WindowData')))
        report = self.report(master=ET.tostring(root))
        group = report['groups'][0]
        self.assertEqual(group['candidates'][0]['master']['state'], 'ambiguous')
        self.assertEqual(group['pairs'][0]['windowComparisons'], [])
        self.assertIn('WINDOW_ROLE_CORRESPONDENCE_UNRESOLVED', group['pairs'][0]['holds'])

    def test_same_master_is_shared_not_a_survivor_claim(self):
        report = self.report(job=self.job.replace(b'<MasterKey>B</MasterKey>', b'<MasterKey>A</MasterKey>'))
        pair = report['groups'][0]['pairs'][0]
        self.assertTrue(pair['sameMasterLiteral'])
        self.assertEqual(pair['comparisons']['masterFields']['changedFieldCount'], 0)
        self.assertFalse(pair['suppressionSupported'])
        self.assertIn('SURVIVOR_TEACHING_UNVERIFIED', pair['holds'])

    def test_missing_reference_and_three_way_scopes_are_explicit(self):
        job = self.job.replace(b'<ParentId>other</ParentId>', b'<ParentId>M</ParentId>')
        report = self.report(job=job)
        self.assertEqual(report['counts']['pairComparisons'], 3)
        missing = self.job.replace(b'<RefID>F1</RefID>', b'<RefID/>', 1)
        self.assertEqual(self.report(job=missing)['counts']['unscopedPlacements'], 1)

    def test_attributes_empty_repeated_unknown_fields_and_order_affect_digest(self):
        base = self.report()['groups'][0]['pairs'][0]['digest']
        for extra in (b'<Mystery/>', b'<Mystery a="1"/>', b'<Mystery>v</Mystery><Mystery>v</Mystery>'):
            job = self.job.replace(b'<ID>1</ID>', b'<ID>1</ID>' + extra)
            self.assertNotEqual(base, self.report(job=job)['groups'][0]['pairs'][0]['digest'])

    def test_unknown_mixed_content_is_not_silently_ignored(self):
        job = self.job.replace(b'<ID>1</ID>', b'<ID>1</ID><Mystery><Inner/>meaningful tail</Mystery>')
        report = self.report(job=job)
        fields = report['groups'][0]['pairs'][0]['comparisons']['placementFields']['examples']
        self.assertTrue(any(field['field'] == 'Mystery/Inner/#tail' for field in fields))

    def test_unknown_schema_entities_and_repeated_collections_fail_closed(self):
        for job in (self.job.replace(b'10.2', b'99.0'), b'<!DOCTYPE JobContainer [<!ENTITY x "bad">]>' + self.job,
                    self.job.replace(b'</JobContainer>', b'<PartDataList/></JobContainer>')):
            report = self.report(job=job)
            self.assertEqual(report['status'], 'blocked')
            self.assertEqual(report['groups'], [])

    def test_budget_failures_return_no_partial_inventory(self):
        from unittest.mock import patch
        for limit in ('MAX_OUTPUT_BYTES', 'MAX_PAIRS'):
            with patch('workers.scan.native_duplicate_review.' + limit, 0):
                report = self.report()
                self.assertEqual(report['status'], 'blocked')
                self.assertEqual(report['groups'], [])


if __name__ == '__main__':
    unittest.main()
