"""Independently fictional XML/ZIP fixtures; no vendor/native qualification claim."""
from copy import deepcopy
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

from workers.scan import qualification_candidate as writer


JOB = 'Fable/Board/Board.xml'
XML = b'''<?xml version="1.0" encoding="UTF-8"?>\r
<JobContainer><JobXmlVersion>10.2</JobXmlVersion>
  <!-- preserve opaque formatting and unknown teaching exactly -->
  <Opaque Setting="authored">untouched &amp; exact</Opaque>
  <PartDataList>
    <PartData><ID>part-fiction-17</ID><ParentId>module-fiction</ParentId><MasterKey>model-fiction</MasterKey>
      <ENABLE>True</ENABLE><CenterPosX>12.500</CenterPosX><Roi><cx>12.500</cx><cy>4.000</cy><w>1.25</w><a>090</a></Roi>
      <WND_PAD>old-binding</WND_PAD><ListGerPadId1>11;12</ListGerPadId1><ListGerbPadId_Common1>11;12</ListGerbPadId_Common1>
      <Threshold>DO-NOT-CHANGE</Threshold>
    </PartData>
    <PartData><ID>second-fiction</ID><ParentId>module-fiction</ParentId><MasterKey>other-fiction</MasterKey>
      <ENABLE>True</ENABLE><CenterPosX>9.25</CenterPosX><Roi><cx>9.25</cx></Roi></PartData>
  </PartDataList>
</JobContainer>'''


def digest(data):
    return sha256(data).hexdigest()


def proposal(field='Roi/cx', before='12.500', after='13.750', identifier='fictional-proposal'):
    return {'id': identifier, 'path': f'JobContainer/PartDataList/PartData[1]/{field}',
            'identity': {'ID': 'part-fiction-17', 'ParentId': 'module-fiction', 'MasterKey': 'model-fiction'},
            'before': before, 'after': after, 'evidenceIds': ['fictional-evidence']}


class QualificationCandidateTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.source = self.root / 'original.zip'
        self.destination = self.root / 'trial.scan-qualification.zip'
        self.members = {
            JOB: XML, 'Fable/Board/Board_Temp.xml': b'<untouched-temp/>',
            'Fable/Board/Board.xml.bak': b'<untouched-backup/>',
            'Fable/Master/Master.xml': b'<unqualified-master>keep</unqualified-master>',
            'Fable/Board/Images/': b'', 'Fable/Board/Images/opaque.bin': b'\x00\xff\x01unchanged-image',
        }
        self.write_source()

    def tearDown(self):
        self.temporary.cleanup()

    def write_source(self):
        with zipfile.ZipFile(self.source, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
            archive.comment = b'preserve-authored-archive-comment'
            for name, data in self.members.items():
                archive.writestr(name, data)
        self.original = self.source.read_bytes()

    def request(self, patches=None):
        request = {
            'artifactType': 'scan.qualification-patch-request', 'schemaVersion': '1', 'purpose': 'qualification-only',
            'source': {'archiveSha256': digest(self.original), 'jobSha256': digest(self.members[JOB]),
                       'root': 'Fable/Board', 'jobMember': JOB, 'jobRole': 'main'},
            'targetEagleBuild': None, 'targetMachine': None, 'reviewer': 'Fictional test reviewer',
            'trialPurpose': 'Isolated synthetic byte-preservation qualification test.',
            'evidence': [{'id': 'fictional-evidence', 'summary': 'Wholly authored test evidence; not a real engineering finding.',
                          'independentSupport': True, 'references': [{'sha256': digest(b'authored-independent-evidence'), 'label': 'Fictional test reference'}]}],
            'proposals': patches if patches is not None else [proposal()], 'acceptances': [],
        }
        return self.accept(request)

    def accept(self, request):
        request['acceptances'] = [{'proposalId': item['id'], 'proposalSha256': writer.proposal_digest(request, item),
                                   'decision': 'accepted', 'reviewer': request['reviewer']} for item in request['proposals']]
        return request

    def create(self, request=None, **kwargs):
        return writer.create_qualification_candidate(self.source, self.destination, request or self.request(), **kwargs)

    def assert_no_output(self):
        self.assertFalse(self.destination.exists())
        self.assertEqual(list(self.root.glob('.scan-qualification-*')), [])
        self.assertEqual(self.source.read_bytes(), self.original)

    def candidate(self):
        with zipfile.ZipFile(self.destination) as wrapper:
            self.assertEqual(set(wrapper.namelist()), {'CANDIDATE.zip', 'qualification-receipt.json', 'README.txt'})
            receipt = json.loads(wrapper.read('qualification-receipt.json'))
            candidate = wrapper.read('CANDIDATE.zip')
        with zipfile.ZipFile(BytesIO(candidate)) as archive:
            contents = {info.filename: archive.read(info) for info in archive.infolist()}
            self.assertEqual(archive.comment, b'preserve-authored-archive-comment')
        return candidate, contents, receipt

    def test_exact_accepted_roi_and_dependent_binding_bytes_only(self):
        patches = [proposal(), proposal('WND_PAD', 'old-binding', 'reviewed-binding', 'binding'),
                   proposal('ListGerPadId1', '11;12', '21;22', 'pad-list'),
                   proposal('ListGerbPadId_Common1', '11;12', '21;22', 'common-pad-list')]
        request = self.request(patches)
        result = self.create(request)
        self.assertEqual(result['status'], 'success', result)
        candidate, contents, receipt = self.candidate()
        expected = XML.replace(b'<cx>12.500</cx>', b'<cx>13.750</cx>').replace(b'>old-binding<', b'>reviewed-binding<').replace(b'>11;12<', b'>21;22<')
        self.assertEqual(contents[JOB], expected)
        self.assertEqual(list(contents), list(self.members))
        for name, data in self.members.items():
            if name != JOB:
                self.assertEqual(contents[name], data)
        self.assertEqual(self.source.read_bytes(), self.original)
        self.assertEqual(receipt['candidate']['sha256'], digest(candidate))
        self.assertEqual(receipt['changes'], patches)
        self.assertEqual(receipt['acceptances'], request['acceptances'])
        self.assertIsNone(receipt['targetEagleBuild'])
        self.assertIsNone(receipt['targetMachine'])
        self.assertIsNone(receipt['machineCompatibility'])
        self.assertFalse(receipt['machineExportAllowed'])
        self.assertFalse(receipt['nativeSemanticsQualified'])
        self.assertTrue(receipt['qualificationOnly'])
        self.assertTrue(receipt['nativeEditsApplied'])
        self.assertEqual(result['packageSha256'], digest(self.destination.read_bytes()))

    def test_center_and_exact_true_to_false_supported_only_as_trial_bytes(self):
        result = self.create(self.request([proposal('CenterPosX', '12.500', '-3.125'), proposal('ENABLE', 'True', 'False', 'disable')]))
        self.assertEqual(result['status'], 'success', result)
        _, contents, _ = self.candidate()
        self.assertEqual(contents[JOB], XML.replace(b'<CenterPosX>12.500</CenterPosX>', b'<CenterPosX>-3.125</CenterPosX>').replace(b'<ENABLE>True</ENABLE>', b'<ENABLE>False</ENABLE>', 1))

    def test_unsupported_fields_versions_enable_directions_and_empty_or_noop_sets(self):
        cases = [self.request([proposal('Roi/cy')]), self.request([proposal('Threshold')]),
                 self.request([proposal('ENABLE', 'False', 'True')]), self.request([proposal('ENABLE', '1', '0')]),
                 self.request([proposal(after='12.500')]), self.request([])]
        for request in cases:
            with self.subTest(request=request['proposals']):
                self.assertEqual(self.create(request)['status'], 'blocked')
                self.assert_no_output()
        self.members[JOB] = XML.replace(b'>10.2<', b'>10.3<'); self.write_source()
        self.assertEqual(self.create()['code'], 'UNSUPPORTED_SCHEMA'); self.assert_no_output()

    def test_identity_mismatch_and_duplicate_identity_never_choose_survivor(self):
        request = self.request(); request['proposals'][0]['identity']['MasterKey'] = 'incorrect'
        self.assertEqual(self.create(self.accept(request))['code'], 'IDENTITY_MISMATCH'); self.assert_no_output()
        self.members[JOB] = XML.replace(b'<ID>second-fiction</ID>', b'<ID>part-fiction-17</ID>').replace(b'<MasterKey>other-fiction</MasterKey>', b'<MasterKey>model-fiction</MasterKey>')
        self.write_source()
        self.assertEqual(self.create()['code'], 'IDENTITY_MISMATCH'); self.assert_no_output()

    def test_repeated_identity_literals_cannot_hide_a_second_possible_target(self):
        self.members[JOB] = XML.replace(b'<ID>second-fiction</ID>', b'<ID>second-fiction</ID><ID>part-fiction-17</ID>').replace(b'<MasterKey>other-fiction</MasterKey>', b'<MasterKey>model-fiction</MasterKey>')
        self.write_source()
        self.assertEqual(self.create()['code'], 'IDENTITY_MISMATCH'); self.assert_no_output()

    def test_missing_pending_stale_evidence_and_stale_approval_are_rejected(self):
        mutations = [lambda v: v['acceptances'].clear(), lambda v: v['acceptances'][0].update(decision='pending'),
                     lambda v: v['evidence'][0].update(independentSupport=False),
                     lambda v: v['evidence'][0]['references'][0].update(sha256='not-a-hash'),
                     lambda v: v['proposals'][0].update(after='999.25'),
                     lambda v: v.update(targetEagleBuild='changed-known-build'),
                     lambda v: v['evidence'][0].update(summary='changed evidence after review')]
        for mutate in mutations:
            request = self.request(); mutate(request)
            self.assertEqual(self.create(request)['status'], 'blocked'); self.assert_no_output()

    def test_stale_archive_job_and_before_hashes_are_rejected(self):
        for key in ('archiveSha256', 'jobSha256'):
            request = self.request(); request['source'][key] = '0' * 64
            self.assertEqual(self.create(self.accept(request))['code'], 'STALE_SOURCE' if key == 'archiveSha256' else 'STALE_JOB')
            self.assert_no_output()
        request = self.request(); request['proposals'][0]['before'] = 'stale-before'
        self.assertEqual(self.create(self.accept(request))['code'], 'STALE_BEFORE'); self.assert_no_output()

    def test_repeated_targets_repeated_scalars_nested_values_and_entities_block(self):
        request = self.request([proposal(identifier='one'), proposal(identifier='two')])
        self.assertEqual(self.create(request)['code'], 'UNSUPPORTED_TARGET'); self.assert_no_output()
        for raw in [XML.replace(b'<cx>12.500</cx>', b'<cx>12.500</cx><cx>12.500</cx>'),
                    XML.replace(b'<Roi><cx>12.500</cx>', b'<Roi><cx>12.500</cx></Roi><Roi>'),
                    XML.replace(b'<cx>12.500</cx>', b'<cx><nested>12.500</nested></cx>'),
                    XML.replace(b'<JobContainer>', b'<!DOCTYPE JobContainer [<!ENTITY bad "12.500">]><JobContainer>', 1).replace(b'<cx>12.500</cx>', b'<cx>&bad;</cx>')]:
            self.members[JOB] = raw; self.write_source()
            self.assertEqual(self.create()['status'], 'blocked'); self.assert_no_output()

    def test_only_exact_accepted_subset_is_applied_and_other_decisions_are_retained(self):
        patches = [proposal(), proposal('WND_PAD', 'old-binding', 'unused-binding', 'pending'),
                   proposal('ENABLE', 'True', 'False', 'rejected'),
                   proposal('CenterPosX', '12.500', '20', 'unreviewed')]
        request = self.request(patches)
        request['acceptances'][1]['decision'] = 'pending'
        request['acceptances'][2]['decision'] = 'rejected'
        request['acceptances'].pop()
        result = self.create(request)
        self.assertEqual(result['status'], 'success', result)
        _, contents, receipt = self.candidate()
        self.assertEqual(contents[JOB], XML.replace(b'<cx>12.500</cx>', b'<cx>13.750</cx>'))
        self.assertEqual(receipt['changes'], [patches[0]])
        self.assertEqual({item['id']: item['decision'] for item in receipt['unappliedProposals']},
                         {'pending': 'pending', 'rejected': 'rejected', 'unreviewed': 'unreviewed'})

    def test_dependent_patch_family_is_all_accepted_or_blocked_including_cycles(self):
        patches = [proposal(identifier='geometry'), proposal('WND_PAD', 'old-binding', 'bound-new', 'binding')]
        patches[0]['dependencyProposalIds'] = ['binding']
        patches[1]['dependencyProposalIds'] = ['geometry']
        request = self.request(patches)
        request['acceptances'][1]['decision'] = 'pending'
        self.assertEqual(self.create(request)['code'], 'DEPENDENCY_NOT_ACCEPTED'); self.assert_no_output()
        request['acceptances'][1]['decision'] = 'accepted'
        self.assertEqual(self.create(request)['status'], 'success')
        _, contents, receipt = self.candidate()
        self.assertEqual(len(receipt['changes']), 2)
        self.assertEqual(contents[JOB], XML.replace(b'<cx>12.500</cx>', b'<cx>13.750</cx>').replace(b'>old-binding<', b'>bound-new<'))

    def test_main_only_and_non_public_destination_policy(self):
        request = self.request(); request['source']['jobRole'] = 'temp'; request['source']['jobMember'] = 'Fable/Board/Board_Temp.xml'
        self.assertEqual(self.create(self.accept(request))['status'], 'blocked'); self.assert_no_output()
        self.destination = self.root / 'job.zip'
        self.assertEqual(self.create()['code'], 'DESTINATION_POLICY'); self.assert_no_output()
        repository = Path(writer.__file__).resolve().parents[2]
        result = writer.create_qualification_candidate(self.source, repository / 'never-created.scan-qualification.zip', self.request())
        self.assertEqual(result['code'], 'DESTINATION_POLICY')
        self.assertFalse((repository / 'never-created.scan-qualification.zip').exists())

    def test_reapplying_same_exact_proposal_is_rejected_after_fresh_hash_review(self):
        request = self.request()
        self.assertEqual(self.create(request)['status'], 'success')
        candidate, _, _ = self.candidate()
        self.source = self.root / 'candidate-source.zip'; self.source.write_bytes(candidate)
        self.destination = self.root / 'second.scan-qualification.zip'
        self.assertEqual(self.create(request)['code'], 'STALE_SOURCE')
        request['source']['archiveSha256'] = digest(candidate)
        with zipfile.ZipFile(BytesIO(candidate)) as archive:
            request['source']['jobSha256'] = digest(archive.read(JOB))
        self.assertEqual(self.create(self.accept(request))['code'], 'STALE_BEFORE')
        self.assertFalse(self.destination.exists())

    def test_existing_output_and_racing_publish_never_overwrite(self):
        self.destination.write_bytes(b'KEEP-EXISTING')
        self.assertEqual(self.create()['code'], 'DESTINATION_EXISTS')
        self.assertEqual(self.destination.read_bytes(), b'KEEP-EXISTING')
        self.destination.unlink()
        def race(staged, destination):
            destination.write_bytes(b'OTHER-WRITER')
            raise FileExistsError()
        with patch.object(writer, '_publish_no_overwrite', side_effect=race):
            self.assertEqual(self.create()['status'], 'blocked')
        self.assertEqual(self.destination.read_bytes(), b'OTHER-WRITER')
        self.assertEqual(list(self.root.glob('.scan-qualification-*')), [])

    def test_cancellation_and_atomic_write_failure_remove_owned_staging_only(self):
        calls = 0
        def cancel():
            nonlocal calls
            calls += 1
            return calls >= 5
        self.assertEqual(self.create(cancelled=cancel)['code'], 'CANCELLED'); self.assert_no_output()
        with patch.object(writer, '_publish_no_overwrite', side_effect=OSError('fictional failure')):
            self.assertEqual(self.create()['status'], 'blocked')
        self.assert_no_output()

    def test_unknown_xml_fields_attributes_and_unselected_native_bytes_are_exact(self):
        self.assertEqual(self.create()['status'], 'success')
        _, contents, _ = self.candidate()
        altered = contents[JOB]
        self.assertEqual(altered.replace(b'<cx>13.750</cx>', b'<cx>12.500</cx>'), XML)
        self.assertIn(b'<Opaque Setting="authored">untouched &amp; exact</Opaque>', altered)
        self.assertEqual(contents['Fable/Board/Board_Temp.xml'], self.members['Fable/Board/Board_Temp.xml'])

    def test_unused_prefixed_namespace_declarations_are_preserved_not_treated_as_native_namespace(self):
        raw = XML.replace(b'<JobContainer>', b'<JobContainer xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">')
        self.members[JOB] = raw; self.write_source()
        pending = self.request(); pending['acceptances'][0]['decision'] = 'pending'
        self.assertEqual(self.create(pending)['code'], 'APPROVAL_REQUIRED'); self.assert_no_output()
        self.assertEqual(self.create()['status'], 'success')
        _, contents, _ = self.candidate()
        self.assertEqual(contents[JOB], raw.replace(b'<cx>12.500</cx>', b'<cx>13.750</cx>'))

    def test_actual_default_namespace_or_prefixed_native_elements_remain_unsupported(self):
        for raw in [XML.replace(b'<JobContainer>', b'<JobContainer xmlns="urn:fictional-native">'),
                    XML.replace(b'<JobContainer>', b'<n:JobContainer xmlns:n="urn:fictional-native">').replace(b'</JobContainer>', b'</n:JobContainer>')]:
            self.members[JOB] = raw; self.write_source()
            self.assertEqual(self.create()['code'], 'UNSUPPORTED_SCHEMA'); self.assert_no_output()

    def test_cleanup_error_after_atomic_publication_reports_existing_complete_trial(self):
        actual_directory = tempfile.TemporaryDirectory
        class CleanupFailure:
            def __init__(self, *args, **kwargs):
                self.directory = actual_directory(*args, **kwargs)
            def __enter__(self):
                return self.directory.__enter__()
            def __exit__(self, *args):
                self.directory.__exit__(*args)
                raise OSError('authored cleanup failure after publication')
        with patch.object(writer.tempfile, 'TemporaryDirectory', CleanupFailure):
            result = self.create()
        self.assertEqual(result['status'], 'success', result)
        self.assertTrue(result['nativeEditsApplied'])
        self.assertIn('cleanupWarning', result)
        self.assertFalse(result['machineExportAllowed'])
        _, contents, receipt = self.candidate()
        self.assertEqual(contents[JOB], XML.replace(b'<cx>12.500</cx>', b'<cx>13.750</cx>'))
        self.assertTrue(receipt['qualificationOnly'])


if __name__ == '__main__':
    unittest.main()
