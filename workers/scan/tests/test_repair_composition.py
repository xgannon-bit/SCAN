"""Fictional end-to-end composition, exact byte preservation and refusal tests."""
from copy import deepcopy
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

from workers.scan.archive_browser_cli import dispatch
from workers.scan.native_preparation import automatic_plan
from workers.scan.disabled_draft_package import package_digest
from workers.scan.qualification_candidate import proposal_digest
from workers.scan.snapshot_capture import SnapshotSelection
from workers.scan.repair_composition import scalar_trial_accounting
from workers.scan.snapshot_capture import CaptureBlocked
from workers.scan.tests.test_native_preparation import fixtures


class RepairCompositionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.job, self.master, self.pcb = fixtures()
        self.selection = {'root': 'Fable/Board', 'jobMember': 'Fable/Board/Board.xml', 'jobRole': 'main',
                          'masterMember': 'Fable/Master/Master.xml', 'masterRole': 'main'}
        stream = BytesIO()
        with zipfile.ZipFile(stream, 'w', compression=zipfile.ZIP_DEFLATED) as z:
            z.comment = b'fictional archive comment'
            for name, raw in [(self.selection['jobMember'], self.job), (self.selection['masterMember'], self.master),
                              ('Fable/Board/Board_Temp.xml', b'<temp>distinct original</temp>'),
                              ('Fable/Board/Board.xml.bak', b'<backup>distinct original</backup>'),
                              ('Fable/Board/Images/', b''), ('Fable/Board/Images/original.bin', b'\x00teaching\xff')]:
                z.writestr(name, raw)
        self.original = stream.getvalue()
        self.hash = sha256(self.original).hexdigest()
        self.plan = automatic_plan(self.job, self.master, self.pcb)
        self.accepted = [i['digest'] for i in self.plan['items']]
        s = self.selection
        self.preparation = {'layoutSha256': sha256(self.pcb).hexdigest(),
            'reviewDigest': package_digest(self.hash, SnapshotSelection(s['root'], s['jobMember'], 'main', s['masterMember'], 'main'), self.plan),
            'accepted': self.accepted, 'reviewer': 'Fictional development test'}
        self.request = {'artifactType': 'scan.qualification-patch-request', 'schemaVersion': '1', 'purpose': 'qualification-only',
            'source': {'archiveSha256': self.hash, 'jobSha256': sha256(self.job).hexdigest(), 'root': s['root'], 'jobMember': s['jobMember'], 'jobRole': 'main'},
            'targetEagleBuild': None, 'targetMachine': None, 'reviewer': 'Fictional development test',
            'trialPurpose': 'Fictional scalar preservation test, no engineering or operator approval.',
            'evidence': [{'id': 'fiction', 'summary': 'Invented evidence for software testing only.', 'independentSupport': True,
                          'references': [{'sha256': sha256(b'fiction').hexdigest(), 'label': 'fictional test'}]}],
            'proposals': [{'id': 'move', 'path': 'JobContainer/PartDataList/PartData[1]/Roi/cx',
                'identity': {'ID': '7', 'ParentId': '1', 'MasterKey': '8', 'RefID': 'T1'}, 'before': '12', 'after': '13.125', 'evidenceIds': ['fiction']},
                {'id': 'rejected', 'path': 'JobContainer/PartDataList/PartData[1]/CenterPosX',
                'identity': {'ID': '7', 'ParentId': '1', 'MasterKey': '8', 'RefID': 'T1'}, 'before': '11.5', 'after': '900', 'evidenceIds': ['fiction']}], 'acceptances': []}
        self.request['acceptances'] = [{'proposalId': p['id'], 'proposalSha256': proposal_digest(self.request, p),
            'decision': 'accepted' if p['id'] == 'move' else 'rejected', 'reviewer': self.request['reviewer']} for p in self.request['proposals']]

    def tearDown(self):
        self.temp.cleanup()

    def export(self, name='run', mutate=None):
        root = self.root / name; root.mkdir()
        source = root / 'source.zip'; source.write_bytes(self.original)
        layout = root / 'layout.pcb'; layout.write_bytes(self.pcb)
        control = {'protocolVersion': '1', 'action': 'preflight', 'source': str(source), 'selection': self.selection, 'expectedArchiveSha256': self.hash}
        review = dispatch(control)
        self.assertEqual(review['status'], 'success', review)
        (root / 'result.scan-snapshot').unlink()
        control.update(action='repair-export', expectedPackageSha256=review['capture']['packageSha256'], layoutSource=str(layout),
            repair={'request': deepcopy(self.request), 'preparation': deepcopy(self.preparation), 'acknowledgement': 'QUALIFICATION ONLY'})
        if mutate: mutate(control)
        result = dispatch(control)
        self.assertEqual(source.read_bytes(), self.original)
        return root, result

    def test_both_accepted_routes_export_rejected_absent_and_exact_rollback(self):
        root, result = self.export()
        self.assertEqual(result['status'], 'success', result)
        with zipfile.ZipFile(root / 'result.engineering.zip') as bundle:
            receipt = json.loads(bundle.read('composed-qualification-receipt.json'))
            self.assertEqual(len(receipt['appliedScalarChanges']), 1)
            self.assertEqual(len(receipt['acceptedPreparationDigests']), 2)
            self.assertEqual(receipt['unappliedScalarProposals'][0]['id'], 'rejected')
            self.assertFalse(receipt['inspectionRepairEstablished'])
            with zipfile.ZipFile(BytesIO(bundle.read('CANDIDATE.zip'))) as z, zipfile.ZipFile(BytesIO(self.original)) as old:
                self.assertEqual(z.namelist(), old.namelist())
                self.assertEqual(z.comment, old.comment)
                changed = z.read(self.selection['jobMember'])
                self.assertIn(b'<cx>13.125</cx>', changed)
                self.assertIn(b'<CenterPosX>11.5</CenterPosX>', changed)
                for role, member, expected in [('job', self.selection['jobMember'], self.job), ('master', self.selection['masterMember'], self.master)]:
                    recovered = z.read(member)
                    for item in self.plan['items']:
                        for insertion in item['changes']:
                            if insertion['document'] == role:
                                self.assertEqual(recovered.count(insertion['afterXml'].encode()), 1)
                                recovered = recovered.replace(insertion['afterXml'].encode(), b'', 1)
                    if role == 'job': recovered = recovered.replace(b'<cx>13.125</cx>', b'<cx>12</cx>', 1)
                    self.assertEqual(recovered, expected)
                for name in old.namelist():
                    if name not in (self.selection['jobMember'], self.selection['masterMember']): self.assertEqual(z.read(name), old.read(name))
            self.assertEqual(json.loads(bundle.read('native-inspection-work.json'))['counts']['nativeParts'], 3)
            rows = json.loads(bundle.read('component_accounting.json'))
            trial = next(r for r in rows if r['reference'] == 'T1')
            self.assertEqual(trial['status'], 'existing-scalar-trial-applied')
            self.assertEqual(trial['existingTeaching'], 'preserved-unverified')
            self.assertEqual([r['proposalId'] for r in trial['appliedScalarTrials']], ['move'])
            self.assertEqual(trial['appliedScalarTrials'][0]['after'], '13.125')
            self.assertIn('position retention', ' '.join(trial['scalarTrialChecks']))
            before_rows = json.loads(bundle.read('preparation-baseline/component_accounting.json'))
            self.assertEqual([r for r in rows if r['reference'] != 'T1'], [r for r in before_rows if r['reference'] != 'T1'])
            self.assertIn('appliedScalarTrials', bundle.read('component_coverage.csv').decode())
            self.assertIn('position retention', bundle.read('remaining_work.csv').decode())

    def test_repeat_export_has_same_native_bytes_without_duplicate_records(self):
        first, a = self.export('first'); second, b = self.export('second')
        self.assertEqual(a['status'], 'success', a); self.assertEqual(b['status'], 'success', b)
        with zipfile.ZipFile(first / 'result.engineering.zip') as x, zipfile.ZipFile(second / 'result.engineering.zip') as y:
            self.assertEqual(x.read('CANDIDATE.zip'), y.read('CANDIDATE.zip'))

    def test_stale_preparation_stale_scalar_and_changed_evidence_publish_nothing(self):
        mutations = [lambda c: c['repair']['preparation'].update(reviewDigest='0' * 64),
                     lambda c: c['repair']['request']['proposals'][0].update(before='stale'),
                     lambda c: c['repair']['request']['evidence'][0].update(summary='changed evidence')]
        for i, mutate in enumerate(mutations):
            with self.subTest(i=i):
                root, result = self.export(str(i), mutate)
                self.assertEqual(result['status'], 'blocked', result)
                self.assertFalse((root / 'result.engineering.zip').exists())

    def test_unknown_accepted_preparation_digest_refuses_whole_output(self):
        root, result = self.export(mutate=lambda c: c['repair']['preparation']['accepted'].append('0' * 64))
        self.assertEqual(result['status'], 'blocked', result)
        self.assertFalse((root / 'result.engineering.zip').exists())

    def test_native_geometry_scalar_does_not_recalculate_new_template_offsets(self):
        root, result = self.export()
        self.assertEqual(result['status'], 'success', result)
        with zipfile.ZipFile(root / 'result.engineering.zip') as bundle, zipfile.ZipFile(BytesIO(bundle.read('CANDIDATE.zip'))) as z:
            for item in self.plan['items']:
                for change in item['changes']:
                    self.assertIn(change['afterXml'].encode(), z.read(self.selection['jobMember'] if change['document'] == 'job' else self.selection['masterMember']))

    def test_scalar_accounting_refuses_wrong_actual_after_identity_or_ambiguous_component(self):
        rows = [{'reference': 'T1', 'module': '1', 'status': 'existing-structure-preserved', 'placementIds': ['7'], 'masterKeys': ['8']}]
        patch = deepcopy(self.request['proposals'][0])
        with self.assertRaises(CaptureBlocked): scalar_trial_accounting(rows, self.job, [patch])
        actual = self.job.replace(b'<cx>12</cx>', b'<cx>13.125</cx>', 1)
        changed = scalar_trial_accounting(rows, actual, [patch])
        self.assertNotIn('appliedScalarTrials', rows[0])
        self.assertEqual(changed[0]['appliedScalarTrials'][0]['identity']['ID'], '7')
        with self.assertRaises(CaptureBlocked): scalar_trial_accounting(rows + deepcopy(rows), actual, [patch])
        patch['identity']['MasterKey'] = 'wrong'
        with self.assertRaises(CaptureBlocked): scalar_trial_accounting(rows, actual, [patch])
