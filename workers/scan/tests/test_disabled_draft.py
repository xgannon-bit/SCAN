"""Wholly authored minimal records, not an Eagle compatibility fixture."""
from copy import deepcopy
from hashlib import sha256
import json
import unittest
import tempfile
import zipfile
from io import BytesIO
from pathlib import Path
from unittest.mock import patch
from xml.etree import ElementTree as ET

from workers.scan.disabled_draft import DraftSelection, plan_disabled_draft, apply_disabled_draft, recipe_digest
from workers.scan.snapshot_capture import CaptureBlocked
from workers.scan.accel_ascii import read_accel
from workers.scan.tests.test_accel_ascii import pcb, graphics
from workers.scan.disabled_draft_package import create_disabled_draft_package, package_digest
from workers.scan.snapshot_capture import SnapshotSelection


def rectangle(tag, x=0, y=0, w=6, h=3):
    return f'<{tag}><cx>{x}</cx><cy>{y}</cy><w>{w}</w><h>{h}</h><a>0</a></{tag}>'


JOB = (f'''<?xml version="1.0"?><JobContainer><JobXmlVersion>10.2</JobXmlVersion>
<!-- opaque baseline formatting -->
<ModuleDataList><ModuleData><ID>1</ID></ModuleData></ModuleDataList>
<Unknown attr="keep">untouched &amp; exact</Unknown>
<PartDataList><PartData><ID>7</ID><ParentId>1</ParentId><MasterKey>8</MasterKey><RefID>T1</RefID><ENABLE>False</ENABLE>
{rectangle('Roi',10,20)}<CenterPosX>10</CenterPosX><CenterPosY>20</CenterPosY></PartData></PartDataList>
<CadData><CpList><Cp><ID>12</ID><ModuleID>1</ModuleID><RefID>F7</RefID></Cp></CpList></CadData>
</JobContainer>''').encode()
MASTER = (f'''<JobContainer><JobXmlVersion>10.2</JobXmlVersion>
<PartDataList><PartData><MasterKey>8</MasterKey><RefID>T1</RefID>{rectangle('Roi')}<CadOffset><X>0</X><Y>0</Y></CadOffset></PartData></PartDataList>
<WindowDataList>''' + ''.join(f'''<WindowData><ParentId>8</ParentId><ID>{i}</ID><ENABLE>False</ENABLE><ParentWndId>0</ParentWndId><GroupID>{i}</GroupID>{rectangle('RelRoi',x,.5,.8,.4)}<AlgorithmDataList></AlgorithmDataList></WindowData>''' for i,x in [(20,-1),(21,3)]) + '''</WindowDataList><UnknownTeaching>preserve</UnknownTeaching></JobContainer>''').encode()
PCB = pcb(graph=graphics(pads='''(pad(padNum 1)(padStyleRef "invented-pad")(pt -1 .5))
 (pad(padNum 2)(padStyleRef "invented-pad")(pt 3 .5))'''))


class DisabledDraftTests(unittest.TestCase):
    def setUp(self):
        self.selection = DraftSelection(read_accel(PCB)['placements'][0]['sourcePath'], '1', '1', '7', '8', (2, -3))

    def plan(self, job=JOB, master=MASTER, pcb=PCB):
        return plan_disabled_draft(job, master, pcb, self.selection)

    def test_creation_exact_dependency_closure_disabled_and_reopen(self):
        recipe = self.plan()
        self.assertEqual(recipe, self.plan())
        restored = json.loads(json.dumps(recipe))
        result = apply_disabled_draft(JOB, MASTER, PCB, restored, recipe_digest(recipe))
        j, m = ET.fromstring(result['job']), ET.fromstring(result['master'])
        part = j.findall('PartDataList/PartData')[-1]
        model = m.findall('PartDataList/PartData')[-1]
        windows = m.findall('WindowDataList/WindowData')[-2:]
        self.assertEqual(part.findtext('ENABLE'), 'False')
        self.assertEqual(part.findtext('RefID'), 'F7')
        self.assertEqual(part.findtext('MasterKey'), model.findtext('MasterKey'))
        self.assertEqual(part.findtext('Roi/cx'), '13')
        self.assertEqual(part.findtext('Roi/cy'), '-7')
        self.assertEqual(part.findtext('Roi/a'), '90')
        self.assertEqual([w.findtext('ParentId') for w in windows], [model.findtext('MasterKey')]*2)
        self.assertTrue(all(w.findtext('ENABLE') == 'False' for w in windows))
        self.assertTrue(all(len(w.find('AlgorithmDataList')) == 0 for w in windows))
        for role, original in [('job', JOB), ('master', MASTER)]:
            recovered = result[role]
            for change in reversed(recipe['changes']):
                if change['document'] == role:
                    payload = change['afterXml'].encode()
                    self.assertEqual(recovered.count(payload), 1)
                    recovered = recovered.replace(payload, b'', 1)
            self.assertEqual(recovered, original)
        self.assertFalse(recipe['machineExportAllowed'])
        self.assertIn('pad-binding-unresolved', recipe['remaining'])

    def test_repeat_and_existing_ref_refuse_even_with_fresh_plan(self):
        recipe = self.plan()
        result = apply_disabled_draft(JOB, MASTER, PCB, recipe, recipe_digest(recipe))
        with self.assertRaises(CaptureBlocked) as caught:
            self.plan(result['job'], result['master'])
        self.assertEqual(caught.exception.code, 'DRAFT_ALREADY_PRESENT')

    def test_cardinal_pad_rotation_is_preserved_not_confused_with_placement_angle(self):
        source = PCB.replace(b'(pt -1 .5)', b'(pt -1 .5)(rotation 90)').replace(b'(pt 3 .5)', b'(pt 3 .5)(rotation 90)')
        master = MASTER.replace(b'<h>0.4</h><a>0</a>', b'<h>0.4</h><a>90</a>')
        recipe = self.plan(master=master, pcb=source)
        out = apply_disabled_draft(JOB, master, source, recipe, recipe_digest(recipe))
        windows = ET.fromstring(out['master']).findall('WindowDataList/WindowData')[-2:]
        self.assertEqual([window.findtext('RelRoi/a') for window in windows], ['90', '90'])
        with self.assertRaises(CaptureBlocked):
            self.plan(master=MASTER, pcb=source)

    def test_collision_allocation_includes_dangling_references(self):
        job = JOB.replace(b'</Unknown>', b'</Unknown><GroupID>900</GroupID>')
        recipe = self.plan(job)
        self.assertEqual(recipe['dependencies']['partId'], '901')
        self.assertEqual(recipe['dependencies']['groupIds'], ['905', '906'])

    def test_recipe_tampering_or_stale_approval_never_applies(self):
        recipe = self.plan()
        for mutation in ['enable', 'source', 'dependencies']:
            changed = deepcopy(recipe)
            if mutation == 'enable':
                changed['changes'][0]['afterXml'] = changed['changes'][0]['afterXml'].replace('False', 'True')
            elif mutation == 'source':
                changed['source']['layoutSha256'] = '0'*64
            else:
                changed['dependencies']['windowIds'][0] = '8'
            with self.subTest(mutation=mutation), self.assertRaises(CaptureBlocked):
                apply_disabled_draft(JOB, MASTER, PCB, changed, recipe_digest(changed))
        with self.assertRaises(CaptureBlocked):
            apply_disabled_draft(JOB, MASTER, PCB, recipe, '0'*64)

    def test_unknown_template_binding_algorithms_or_origins_refuse(self):
        for job, master in [(JOB.replace(b'<ENABLE>', b'<FovList>opaque</FovList><ENABLE>'), MASTER),
                            (JOB, MASTER.replace(b'<X>0</X>', b'<X>1</X>')),
                            (JOB, MASTER.replace(b'<AlgorithmDataList></AlgorithmDataList>', b'<AlgorithmDataList><AlgorithmData><ID>1</ID></AlgorithmData></AlgorithmDataList>')),
                            (JOB, MASTER.replace(b'<ParentWndId>0', b'<ParentWndId>20')),
                            (JOB.replace(b'<ENABLE>False', b'<ENABLE>True'), MASTER)]:
            with self.subTest(jobHash=sha256(job).hexdigest(), masterHash=sha256(master).hexdigest()), self.assertRaises(CaptureBlocked):
                self.plan(job, master)

    def test_geometry_holes_ambiguity_and_schema_fail_closed(self):
        for source in [PCB.replace(b'(holeDiam 0)', b'(holeDiam .5)'),
                       PCB.replace(b'(pt 3 .5)', b'(pt 4 .5)'),
                       PCB.replace(b'(padNum 2)', b'(padNum 1)'),
                       PCB.replace(b'(padShapeType Rect)', b'(padShapeType Oval)')]:
            with self.subTest(sourceHash=sha256(source).hexdigest()), self.assertRaises(CaptureBlocked):
                self.plan(pcb=source)
        for job in [JOB.replace(b'10.2', b'99.1'), JOB.replace(b'<JobContainer>', b'<!DOCTYPE x><JobContainer>')]:
            with self.assertRaises(CaptureBlocked):
                self.plan(job=job)


class DisabledPackageTests(unittest.TestCase):
    def test_full_archive_preservation_and_atomic_rollback(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            source, destination = folder/'original.zip', folder/'trial.scan-draft-qualification.zip'
            members = {'Fable/Board/Board.xml': JOB, 'Fable/Master/Master.xml': MASTER,
                       'Fable/Board/Board_Temp.xml': JOB, 'Fable/Board/Board.xml.bak': JOB,
                       'Fable/Master/Master_Temp.xml': MASTER,
                       'Fable/Board/Images/': b'', 'Fable/Board/Images/opaque.bin': b'\x00\xffexact'}
            with zipfile.ZipFile(source, 'w', compression=zipfile.ZIP_DEFLATED) as z:
                z.comment = b'preserve original comment'
                for name, raw in members.items():
                    z.writestr(name, raw)
            before = source.read_bytes()
            archive_hash = sha256(before).hexdigest()
            selection = SnapshotSelection('Fable/Board', 'Fable/Board/Board.xml', 'main', 'Fable/Master/Master.xml', 'main')
            draft = DraftSelection(read_accel(PCB)['placements'][0]['sourcePath'], '1', '1', '7', '8', (2, -3))
            recipe = plan_disabled_draft(JOB, MASTER, PCB, draft)
            digest = package_digest(archive_hash, selection, recipe)
            def run(**kwargs):
                return create_disabled_draft_package(source, destination, PCB, selection, archive_hash, recipe, digest, **kwargs)
            with patch('workers.scan.disabled_draft_package._publish_no_overwrite', side_effect=OSError('authored publication failure')):
                self.assertEqual(run()['status'], 'blocked')
            self.assertFalse(destination.exists())
            self.assertEqual(list(folder.glob('.scan-disabled-draft-*')), [])
            self.assertEqual(source.read_bytes(), before)
            self.assertEqual(run(cancelled=lambda: True)['code'], 'CANCELLED')
            result = run()
            self.assertEqual(result['status'], 'success', result)
            with zipfile.ZipFile(destination) as wrapper, zipfile.ZipFile(BytesIO(wrapper.read('CANDIDATE.zip'))) as candidate:
                self.assertEqual(candidate.namelist(), list(members))
                self.assertEqual(candidate.comment, b'preserve original comment')
                changed = [name for name, raw in members.items() if candidate.read(name) != raw]
                self.assertEqual(changed, [selection.job_member, selection.master_member])
                self.assertEqual(len(ET.fromstring(candidate.read(selection.job_member)).findall('PartDataList/PartData')), 2)
                self.assertEqual(len(ET.fromstring(candidate.read(selection.master_member)).findall('WindowDataList/WindowData')), 4)
                self.assertIn('ORIGINAL', result['snapshotWarning'])
            published = destination.read_bytes()
            self.assertEqual(run()['code'], 'DESTINATION_EXISTS')
            self.assertEqual(destination.read_bytes(), published)
            self.assertEqual(source.read_bytes(), before)

    def test_archive_source_and_snapshot_selection_bind_approval(self):
        selection = SnapshotSelection('Fable/Board', 'Fable/Board/Board.xml', 'main', 'Fable/Master/Master.xml', 'main')
        recipe = {'synthetic': 'digest-only test'}
        digest = package_digest('a'*64, selection, recipe)
        self.assertNotEqual(digest, package_digest('b'*64, selection, recipe))
        other = SnapshotSelection('Fable/Board', 'Fable/Board/Board_Temp.xml', 'temp', 'Fable/Master/Master.xml', 'main')
        result = create_disabled_draft_package('unused', 'unused', PCB, other, 'a'*64, recipe, digest)
        self.assertEqual(result['code'], 'DRAFT_MAIN_REQUIRED')


if __name__ == '__main__':
    unittest.main()
