"""Separate wholly fictional 10.1 branch; no private archived values or oracle."""
from copy import deepcopy
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
import unittest
import zipfile

from workers.scan import qualification_candidate as writer
from workers.scan.archive_browser_cli import dispatch
from workers.scan.native_records import read_native_records
from workers.scan.native_accounting import analyze_native
from workers.scan.native_bindings import report_native_bindings
from workers.scan.native_dependencies import report_literal_dependencies
from workers.scan.native_fov import fov_assignments
from workers.scan.snapshot_capture import CaptureBlocked
from workers.scan.tests import test_qualification_candidate as fixture_module
from workers.scan.tests.test_qualification_candidate import XML, JOB, proposal, digest


GUARD = {'cx': '12.500', 'cy': '4.000', 'w': '1.25', 'h': '0.75', 'a': '090'}


class ReviewedPlacementTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixture_module.QualificationCandidateTests()
        self.fixture.setUp()
        self.raw = XML.replace(b'>10.2<', b'>10.1<').replace(b'<w>1.25</w>', b'<w>1.25</w><h>0.75</h>')
        self.raw = self.raw.replace(b'<PartDataList>', b'<ModuleDataList><ModuleData><ID>module-fiction</ID><Unknown>exact</Unknown></ModuleData></ModuleDataList><PartDataList>', 1)
        self.fixture.members[JOB] = self.raw
        self.master_member = 'Fable/Master/Master.xml'
        self.fixture.members[self.master_member] = b'<JobContainer><JobXmlVersion>10.1</JobXmlVersion><PartDataList><PartData><MasterKey>model-fiction</MasterKey><Untouched>teaching-one</Untouched></PartData><PartData><MasterKey>other-fiction</MasterKey><Untouched>teaching-two</Untouched></PartData></PartDataList><WindowDataList><WindowData><ID>fixture-window</ID><ParentId>model-fiction</ParentId><ENABLE>True</ENABLE><RelRoi><cx>0.75</cx><cy>-0.25</cy><w>1.25</w><h>2</h><a>15</a></RelRoi><AlgorithmDataList><AlgorithmData><ID>fixture-algorithm</ID><Threshold>preserve-unknown</Threshold></AlgorithmData></AlgorithmDataList></WindowData></WindowDataList></JobContainer>'
        self.fixture.write_source()

    def tearDown(self):
        self.fixture.tearDown()

    def request(self, xy=False):
        patches = [{**proposal(), 'beforeRoi': deepcopy(GUARD)}]
        if xy:
            patches.append({**proposal('Roi/cy', '4.000', '7.875', 'second-axis'), 'beforeRoi': deepcopy(GUARD)})
            patches[0]['dependencyProposalIds'] = [patches[1]['id']]
            patches[1]['dependencyProposalIds'] = [patches[0]['id']]
        request = self.fixture.request(patches)
        request['source'].update(masterMember=self.master_member, masterSha256=digest(self.fixture.members[self.master_member]), masterRole='main')
        request['evidence'][0].update(kind='historical-replay', independentSupport=False,
            summary='Fictional archived transition replay; physical correctness and automatic diagnosis are not established.')
        return self.fixture.accept(request)

    def control(self):
        source = self.request()['source']
        control = {'protocolVersion': '1', 'action': 'preflight', 'source': str(self.fixture.source),
                   'expectedArchiveSha256': source['archiveSha256'],
                   'selection': {'root': source['root'], 'jobMember': source['jobMember'], 'jobRole': 'main', 'masterMember': self.master_member, 'masterRole': 'main'}}
        report = dispatch(control)
        self.assertEqual(report['status'], 'success', report)
        control['expectedPackageSha256'] = report['capture']['packageSha256']
        (self.fixture.root / 'result.scan-snapshot').unlink()
        return control

    def test_guarded_10_1_xy_changes_five_original_identities_and_only_two_leaves(self):
        request = self.request(xy=True)
        result = self.fixture.create(request)
        self.assertEqual(result['status'], 'success', result)
        _, members, receipt = self.fixture.candidate()
        expected = self.raw.replace(b'<cx>12.500</cx>', b'<cx>13.750</cx>').replace(b'<cy>4.000</cy>', b'<cy>7.875</cy>')
        self.assertEqual(members, {**self.fixture.members, JOB: expected})
        self.assertEqual(receipt['nativeSchemaClaim'], 'JobContainer/10.1')
        self.assertTrue(receipt['scalarRollbackRecoversOriginalXml'])
        self.assertEqual(writer._patch_xml(expected, writer.reverse_proposals(request['proposals'])), self.raw)
        self.assertEqual({p['basis'] for p in receipt['proposalCapabilities']}, {'historical-replay'})
        self.assertTrue(all(p['automaticRecommendationEstablished'] is False and p['physicalCorrectnessEstablished'] is False for p in receipt['proposalCapabilities']))
        self.assertFalse(receipt['inspectionRepairEstablished'])
        self.assertEqual(self.fixture.source.read_bytes(), self.fixture.original)

    def test_single_axis_replay_preserves_peer_axis_and_all_other_bytes(self):
        result = self.fixture.create(self.request())
        self.assertEqual(result['status'], 'success', result)
        _, members, _ = self.fixture.candidate()
        self.assertEqual(members[JOB], self.raw.replace(b'<cx>12.500</cx>', b'<cx>13.750</cx>'))

    def test_absolute_xy_replay_is_orientation_independent_with_exact_rollback(self):
        baseline = self.raw
        for angle in ('0', '90', '180', '270', '37.125'):
            with self.subTest(angle=angle):
                self.raw = baseline.replace(b'<a>090</a>', f'<a>{angle}</a>'.encode())
                self.fixture.members[JOB] = self.raw; self.fixture.write_source()
                self.fixture.destination = self.fixture.root / f'angle-{angle}.scan-qualification.zip'
                request = self.request(xy=True)
                for item in request['proposals']:
                    item['beforeRoi']['a'] = angle
                self.assertEqual(self.fixture.create(self.fixture.accept(request))['status'], 'success')
                _, members, receipt = self.fixture.candidate()
                expected = self.raw.replace(b'<cx>12.500</cx>', b'<cx>13.750</cx>').replace(b'<cy>4.000</cy>', b'<cy>7.875</cy>')
                self.assertEqual(members, {**self.fixture.members, JOB: expected})
                self.assertEqual(writer._patch_xml(expected, writer.reverse_proposals(request['proposals'])), self.raw)
                self.assertTrue(receipt['scalarRollbackRecoversOriginalXml'])
                self.assertIn(b'<CenterPosX>12.500</CenterPosX>', members[JOB])

    def test_source_and_accepted_after_are_absolute_non_cumulative(self):
        request = self.request(xy=True)
        self.assertEqual(self.fixture.create(request)['status'], 'success')
        candidate, members, _ = self.fixture.candidate()
        self.fixture.destination = self.fixture.root / 'repeated.scan-qualification.zip'
        self.assertEqual(self.fixture.create(request)['status'], 'success')
        repeated, _, _ = self.fixture.candidate()
        self.assertEqual(repeated, candidate)
        self.fixture.destination = self.fixture.root / 'no-second-move.scan-qualification.zip'
        self.fixture.source = self.fixture.root / 'already-candidate.zip'
        self.fixture.source.write_bytes(candidate)
        self.assertEqual(self.fixture.create(request)['code'], 'STALE_SOURCE')
        request['source'].update(archiveSha256=digest(candidate), jobSha256=digest(members[JOB]))
        self.assertEqual(self.fixture.create(self.fixture.accept(request))['code'], 'STALE_GEOMETRY_GUARD')
        self.assertFalse(self.fixture.destination.exists())

    def test_reciprocal_xy_dependencies_enforce_atomic_decision_and_undo(self):
        request = self.request(xy=True)
        request['proposals'][0].pop('dependencyProposalIds')
        self.assertEqual(self.fixture.create(self.fixture.accept(request))['code'], 'COUPLED_ROI_REQUIRED')
        request = self.request(xy=True)
        for decision in ('pending', 'rejected'):
            request['acceptances'][1]['decision'] = decision
            self.assertEqual(self.fixture.create(request)['code'], 'DEPENDENCY_NOT_ACCEPTED')
            self.fixture.assert_no_output()
        request['acceptances'][0]['decision'] = 'pending'
        self.assertEqual(self.fixture.create(request)['code'], 'APPROVAL_REQUIRED')
        self.assertEqual(self.fixture.create(self.fixture.accept(request))['status'], 'success')

    def test_roi_guard_is_mandatory_for_10_1_and_includes_unchanged_shape(self):
        request = self.request()
        request['proposals'][0].pop('beforeRoi')
        self.assertEqual(self.fixture.create(self.fixture.accept(request))['code'], 'UNSUPPORTED_SCHEMA_OPERATION')
        for field in ('cy', 'w', 'h', 'a'):
            request = self.request()
            request['proposals'][0]['beforeRoi'][field] = '0.125'
            self.assertEqual(self.fixture.create(self.fixture.accept(request))['code'], 'STALE_GEOMETRY_GUARD')
            self.fixture.assert_no_output()
        request = self.request(); request['proposals'][0]['beforeRoi']['h'] = '0'
        self.assertEqual(self.fixture.create(self.fixture.accept(request))['code'], 'INVALID_GEOMETRY_GUARD')

    def test_changed_provenance_cannot_reuse_acceptance_or_claim_independent_replay(self):
        request = self.request(); request['evidence'][0]['summary'] += ' changed'
        self.assertEqual(self.fixture.create(request)['code'], 'STALE_APPROVAL')
        request = self.request(); request['evidence'][0]['independentSupport'] = True
        self.assertEqual(self.fixture.create(self.fixture.accept(request))['code'], 'EVIDENCE_REQUIRED')
        request = self.request(); request['evidence'][0].update(kind='independent-source-support', independentSupport=True)
        self.assertEqual(self.fixture.create(self.fixture.accept(request))['status'], 'success')

    def test_other_10_1_fields_and_default_constructor_parser_remain_held(self):
        with self.assertRaises(CaptureBlocked) as caught:
            writer._xml(self.raw)
        self.assertEqual(caught.exception.code, 'UNSUPPORTED_SCHEMA')
        for field, before, after in [('CenterPosX', '12.500', '13.750'), ('ENABLE', 'True', 'False'), ('WND_PAD', 'old-binding', 'new-binding')]:
            request = self.fixture.request([{**proposal(field, before, after), 'beforeRoi': deepcopy(GUARD)}])
            request['source'].update(masterMember=self.master_member, masterSha256=digest(self.fixture.members[self.master_member]), masterRole='main')
            self.assertEqual(self.fixture.create(self.fixture.accept(request))['code'], 'UNSUPPORTED_SCHEMA_OPERATION')
            self.fixture.assert_no_output()

    def test_unknown_version_and_stale_identity_refuse_without_output(self):
        for field in ('ID', 'ParentId', 'MasterKey', 'RefID'):
            request = self.request(); request['proposals'][0]['identity'][field] = 'incorrect'
            self.assertEqual(self.fixture.create(self.fixture.accept(request))['status'], 'blocked')
            self.fixture.assert_no_output()
        self.fixture.members[JOB] = self.raw.replace(b'>10.1<', b'>10.9<'); self.fixture.write_source()
        self.assertEqual(self.fixture.create(self.request())['code'], 'UNSUPPORTED_SCHEMA')
        self.fixture.assert_no_output()

    def test_guarded_edit_requires_unique_plain_module_identity(self):
        self.fixture.members[JOB] = self.raw.replace(b'<ID>module-fiction</ID>', b'<ID>module-fiction</ID><ID>module-fiction</ID>')
        self.fixture.write_source()
        self.assertEqual(self.fixture.create(self.request())['code'], 'MODULE_IDENTITY_MISMATCH')
        self.fixture.assert_no_output()

    def test_non_plain_competing_master_module_and_part_identities_cannot_hide_ambiguity(self):
        master = self.fixture.members[self.master_member]
        for identity in (b'<MasterKey unknown="same">model-fiction</MasterKey>',
                         b'<MasterKey><Unknown>model-fiction</Unknown></MasterKey>'):
            with self.subTest(kind='master', identity=identity):
                self.fixture.members[self.master_member] = master.replace(b'<MasterKey>other-fiction</MasterKey>', identity)
                self.fixture.write_source()
                self.assertEqual(self.fixture.create(self.request())['code'], 'MASTER_IDENTITY_MISMATCH')
                self.fixture.assert_no_output()
        self.fixture.members[self.master_member] = master
        for identity in (b'<ID unknown="same">module-fiction</ID>', b'<ID><Unknown>module-fiction</Unknown></ID>'):
            with self.subTest(kind='module', identity=identity):
                self.fixture.members[JOB] = self.raw.replace(b'</ModuleDataList>', b'<ModuleData>' + identity + b'</ModuleData></ModuleDataList>')
                self.fixture.write_source()
                self.assertEqual(self.fixture.create(self.request())['code'], 'MODULE_IDENTITY_MISMATCH')
                self.fixture.assert_no_output()
        for identity in (b'<ID unknown="same">part-fiction-17</ID>', b'<ID><Unknown>part-fiction-17</Unknown></ID>'):
            with self.subTest(kind='part', identity=identity):
                self.fixture.members[JOB] = self.raw.replace(b'<ID>second-fiction</ID>', identity)
                self.fixture.write_source()
                self.assertEqual(self.fixture.create(self.request())['code'], 'IDENTITY_MISMATCH')
                self.fixture.assert_no_output()

    def test_review_preview_is_exact_accepted_subset_hash_and_never_all_proposals(self):
        self.raw = self.raw.replace(b'<Roi><cx>9.25</cx></Roi>', b'<Roi><cx>9.25</cx><cy>2.25</cy><w>1</w><h>2</h><a>0</a></Roi>')
        self.fixture.members[JOB] = self.raw; self.fixture.write_source()
        control = self.control()
        request = self.request()
        extra = proposal('Roi/cx', '9.25', '8.125', 'unapplied')
        extra.update(path='JobContainer/PartDataList/PartData[2]/Roi/cx',
                     identity={'ID': 'second-fiction', 'ParentId': 'module-fiction', 'MasterKey': 'other-fiction', 'RefID': 'FICT18'},
                     beforeRoi={'cx': '9.25', 'cy': '2.25', 'w': '1', 'h': '2', 'a': '0'})
        request['proposals'].append(extra)
        self.fixture.accept(request); request['acceptances'][1]['decision'] = 'rejected'
        result = dispatch({**control, 'action': 'repair-review', 'repair': {'request': request}})
        self.assertEqual(result['expectedAcceptedJobSha256'], digest(self.raw.replace(b'<cx>12.500</cx>', b'<cx>13.750</cx>')))
        self.assertEqual(result['request']['acceptances'][0]['decision'], 'pending')
        (self.fixture.root / 'result.scan-snapshot').unlink()
        request['acceptances'][0]['decision'] = 'pending'
        self.assertIsNone(dispatch({**control, 'action': 'repair-review', 'repair': {'request': request}})['expectedAcceptedJobSha256'])

    def test_guarded_master_selection_identity_hash_and_schema_are_required(self):
        request = self.request()
        for key in ('masterMember', 'masterSha256', 'masterRole'):
            request['source'].pop(key)
        self.assertEqual(self.fixture.create(self.fixture.accept(request))['code'], 'MASTER_SELECTION_REQUIRED')
        request = self.request(); request['source']['masterSha256'] = '0' * 64
        self.assertEqual(self.fixture.create(self.fixture.accept(request))['code'], 'STALE_MASTER')
        master = self.fixture.members[self.master_member]
        for altered, code in [
            (master.replace(b'>10.1<', b'>10.2<'), 'MASTER_SCHEMA_MISMATCH'),
            (master.replace(b'<MasterKey>other-fiction</MasterKey>', b'<MasterKey>model-fiction</MasterKey>'), 'MASTER_IDENTITY_MISMATCH'),
            (master.replace(b'<MasterKey>model-fiction</MasterKey>', b'<MasterKey>different-fiction</MasterKey>'), 'MASTER_IDENTITY_MISMATCH')]:
            self.fixture.members[self.master_member] = altered; self.fixture.write_source()
            self.assertEqual(self.fixture.create(self.request())['code'], code)
            self.fixture.assert_no_output()

    def test_new_guarded_10_2_route_does_not_bypass_module_or_master_scope(self):
        self.raw = self.raw.replace(b'>10.1<', b'>10.2<')
        self.fixture.members[JOB] = self.raw
        self.fixture.members[self.master_member] = self.fixture.members[self.master_member].replace(b'>10.1<', b'>10.2<')
        self.fixture.write_source()
        self.assertEqual(self.fixture.create(self.request())['status'], 'success')
        self.fixture.destination = self.fixture.root / 'module-must-resolve.scan-qualification.zip'
        self.raw = self.raw.replace(b'<ID>module-fiction</ID>', b'<ID>missing-module-fiction</ID>')
        self.fixture.members[JOB] = self.raw; self.fixture.write_source()
        self.assertEqual(self.fixture.create(self.request())['code'], 'MODULE_IDENTITY_MISMATCH')
        self.assertFalse(self.fixture.destination.exists())

    def test_browser_export_reanalyzes_candidate_and_names_baseline_separately(self):
        request = self.request(xy=True)
        result = dispatch({**self.control(), 'action': 'repair-export', 'repair': {'request': request, 'acknowledgement': 'QUALIFICATION ONLY'}})
        self.assertEqual(result['status'], 'success', result)
        with zipfile.ZipFile(self.fixture.root / 'result.engineering.zip') as bundle:
            current = json.loads(bundle.read('candidate-analysis.json'))
            self.assertEqual(current['source']['sha256'], result['candidateSha256'])
            self.assertNotEqual(current['source']['sha256'], result['sourceSha256'])
            self.assertEqual(current['selection']['job']['sha256'], digest(self.raw.replace(b'<cx>12.500</cx>', b'<cx>13.750</cx>').replace(b'<cy>4.000</cy>', b'<cy>7.875</cy>')))
            self.assertIn('baseline/native-inspection-work.json', bundle.namelist())
            self.assertIn('native-fov-assignments.json', bundle.namelist())
            self.assertEqual(len(json.loads(bundle.read('applied_changes.json'))), 2)


class ObservedBranchReadTests(unittest.TestCase):
    def test_10_1_read_only_support_does_not_enable_any_preparation_constructor(self):
        from workers.scan.native_preparation import automatic_plan
        from workers.scan.native_seed_requirements import seed_requirements
        from workers.scan.native_record_insertion import append_records
        from workers.scan.tests.test_native_preparation import fixtures
        job, master, pcb = fixtures()
        job = job.replace(b'>10.2<', b'>10.1<'); master = master.replace(b'>10.2<', b'>10.1<')
        for operation in (lambda: automatic_plan(job, master, pcb),
                          lambda: append_records(job, {'JobContainer/PartDataList': [b'<PartData><ID>new-fiction</ID></PartData>']})):
            with self.subTest(operation=operation), self.assertRaises(CaptureBlocked) as error:
                operation()
            self.assertEqual(error.exception.code, 'UNSUPPORTED_SCHEMA')
        requirements = seed_requirements(job, master)
        self.assertNotEqual(requirements.get('status'), 'usable-template-seeds-present')

    def test_10_1_profile_stays_distinct_through_accounting_dependencies_and_bindings(self):
        raw = b'<JobContainer><JobXmlVersion>10.1</JobXmlVersion><ModuleDataList><ModuleData><ID>module-F</ID></ModuleData></ModuleDataList><PartDataList><PartData><ID>part-F</ID><ParentId>module-F</ParentId><RefID>fiction-A</RefID><MasterKey>master-F</MasterKey></PartData></PartDataList><WindowDataList/></JobContainer>'
        record = read_native_records(BytesIO(raw), len(raw))
        self.assertEqual(record['readerProfile'], 'jobcontainer-10.1-observed-readonly-1')
        documents = {'job': record, 'master': record}
        context = {'archiveSha256': 'a'*64, 'snapshotId': 'b'*64, 'jobMember': 'Fable/Board.xml', 'jobSha256': digest(raw)}
        accounting = analyze_native(documents, context)
        self.assertTrue(accounting['accountingComplete'])
        self.assertEqual(accounting['readerProfile'], record['readerProfile'])
        self.assertTrue(all(r['status'] == 'checked' for r in report_literal_dependencies(documents)['relations']))
        binding = report_native_bindings(documents)
        self.assertEqual(binding['readerProfiles']['job'], record['readerProfile'])
        self.assertTrue(binding['literalObservationsComplete'])
        self.assertFalse(binding['ownershipQualified'])
        spoof = deepcopy(record); spoof['schemaVersionClaim'] = '10.2'
        self.assertFalse(analyze_native({'job': spoof}, context)['accountingComplete'])

    def test_fov_assignment_literally_present_does_not_mean_area_or_binding_qualified(self):
        part = '<PartData><ID>{0}</ID><ParentId>m</ParentId><RefID>fiction-{0}</RefID><MasterKey>master-{0}</MasterKey>{1}</PartData>'
        raw = ('<JobContainer><JobXmlVersion>10.1</JobXmlVersion><PartDataList>'
               + part.format('1', '<FovList/>') + part.format('2', '<FovList><Fov0>7</Fov0></FovList>')
               + part.format('3', '') + part.format('4', '<FovList><Unknown>7</Unknown></FovList>')
               + part.format('5', '<FovList><Fov0>7</Fov0><Fov0>9</Fov0></FovList>')
               + '</PartDataList><FovSetInfo><Fov><FovInfo><Id>7</Id><PathId>99</PathId><C>101|102</C></FovInfo></Fov></FovSetInfo></JobContainer>').encode()
        result = fov_assignments(raw, {'selection': {'job': {'sha256': digest(raw)}}})
        self.assertEqual(result['status'], 'recorded')
        self.assertEqual(result['counts'], {'placements': 5, 'empty': 1, 'assigned': 1, 'unresolved': 3, 'cameraRecords': 1, 'coverageVerified': 0})
        self.assertEqual(result['cameraRecords'][0]['rawFields']['Id'], ['7'])
        self.assertEqual(result['cameraRecords'][0]['rawFields']['PathId'], ['99'])
        self.assertTrue(all(r['coverage'] == 'unverified' and r['enabledExecution'] == 'unverified' for r in result['assignments']))
        self.assertFalse(result['nativeAssignmentWritten'])
        self.assertFalse(result['coverageQualified'])
        self.assertEqual(fov_assignments(raw, {'selection': {'job': {'sha256': '0'*64}}})['status'], 'unavailable')


if __name__ == '__main__':
    unittest.main()
