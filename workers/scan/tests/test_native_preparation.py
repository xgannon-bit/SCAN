"""Authored schema fields and invented geometry; never a private acceptance oracle."""
from copy import deepcopy
from hashlib import sha256
from io import BytesIO
from pathlib import Path
import tempfile
import unittest
from xml.etree import ElementTree as ET
import zipfile

from workers.scan.native_preparation import PART, MODEL, WINDOW, automatic_plan, apply_preparation, component_accounting, recipe_digest, _coverage
from workers.scan.disabled_draft_package import package_digest, create_disabled_draft_package
from workers.scan.snapshot_capture import SnapshotSelection, CaptureBlocked
from workers.scan.tests.test_accel_ascii import pcb, pattern


def record(tag, fields, overrides):
    node = ET.Element(tag)
    for key in sorted(fields):
        child = ET.SubElement(node, key)
        if key in ('Roi', 'RelRoi'):
            for k, v in {'cx': '0.2', 'cy': '-0.1', 'w': '4', 'h': '3', 'a': '0'}.items():
                ET.SubElement(child, k).text = v
        elif key in ('CadOffset', 'ptSetPolarPos'):
            ET.SubElement(child, 'X').text = '0'; ET.SubElement(child, 'Y').text = '0'
        elif key in ('AlgorithmDataList', 'FovList'):
            pass
        else:
            child.text = '0'
    for path, value in overrides.items():
        node.find(path).text = value
    return node


def fixtures():
    neutral = {'RefPartNo': '-1', 'RefPartNo2': '-1', 'PatternFiduID': '-1', 'FiducialID': '', 'LinkagePart': 'False',
               'SeparatedPart': 'False', 'IsFidu': 'False', 'UsePatternFidu': 'False', 'ZMapROIData': '0',
               'Name': 'authored-device', 'PartCode': 'authored-device', 'RefID': 'T1', 'MasterKey': '8', 'No': '3'}
    part = record('PartData', PART, {**neutral, 'ID': '7', 'ParentId': '1', 'ENABLE': 'True', 'SubFovNum': '-1',
                                   'FovOPT': '0', 'Roi/cx': '12', 'Roi/cy': '17', 'CenterPosX': '11.5', 'CenterPosY': '17.7', 'WND_PAD': 'old-private-binding'})
    ET.SubElement(part.find('FovList'), 'Fov0').text = '5'
    model = record('PartData', MODEL, {**neutral, 'CadOffset/X': '2', 'CadOffset/Y': '-3'})
    windows = [record('WindowData', WINDOW, {'ID': str(i), 'ParentId': '8', 'ENABLE': 'True', 'ParentWndId': str(parent),
               'AlignWndID': str(align), 'GroupID': '9', 'UseWndPoly': '0'}) for i, parent, align in [(20, 0, ''), (21, 20, 20)]]
    for w in windows:
        algo = ET.SubElement(w.find('AlgorithmDataList'), 'AlgorithmData')
        ET.SubElement(algo, 'ID').text = '50'
        ET.SubElement(algo, 'PathModelInsp').text = 'fictional-template-only-image'
    j, m = (ET.Element('JobContainer') for _ in range(2))
    for root in (j, m):
        ET.SubElement(root, 'JobXmlVersion').text = '10.2'
        ET.SubElement(root, 'UnrelatedTeaching', {'keep': 'exact'}).text = 'opaque & safe'
    ET.SubElement(ET.SubElement(j, 'ModuleDataList'), 'ModuleData').append(ET.fromstring('<ID>1</ID>'))
    ET.SubElement(j, 'PartDataList').append(part)
    cps = ET.SubElement(ET.SubElement(j, 'CadData'), 'CpList')
    for i, (ref, x, y, name) in enumerate([('T1', 10, 20, 'authored-device'), ('N1', 30, 50, 'fictional-next'), ('N2', 60, 90, 'another-fiction')]):
        cp = ET.SubElement(cps, 'Cp')
        for key, value in {'ID': str(100+i), 'RefID': ref, 'ModuleID': '1', 'X': str(x), 'Y': str(y), 'Ang': '90', 'PrntPartName': name}.items():
            ET.SubElement(cp, key).text = value
    ET.SubElement(m, 'PartDataList').append(model)
    ET.SubElement(m, 'WindowDataList').extend(windows)
    source = pcb(placements=''.join(pattern(ref=r) for r in ['T1', 'N1', 'N2']),
                 components=''.join(f'(compInst "{r}" (compRef "invented") (originalName "{r}"))' for r in ['T1', 'N1', 'N2']))
    return ET.tostring(j), ET.tostring(m), source


class NativePreparationTests(unittest.TestCase):
    def setUp(self):
        self.job, self.master, self.pcb = fixtures()

    def review(self, job=None, master=None, pcb=None):
        return automatic_plan(job or self.job, master or self.master, pcb or self.pcb)

    def test_source_geometry_blocker_keeps_exact_parser_cause_and_explains_empty_holds(self):
        layout = {'placements': [{'refdes': 'N1', 'sourcePath': 'invented/placement',
            'mountingEvidence': 'hole-bearing', 'identityHolds': [],
            'ownedPadCentersAvailable': False, 'explicitLayerGeometry': [],
            'holds': [{'code': 'PATTERN_VIA_GEOMETRY_UNSUPPORTED'}]}]}
        rows = _coverage(ET.fromstring(self.job), layout, [])
        held = next(r for r in rows if r['reference'] == 'N1')
        self.assertEqual(held['holdCode'], 'PREPARATION_SOURCE_GEOMETRY')
        self.assertIn('PATTERN_VIA_GEOMETRY_UNSUPPORTED', held['holdReason'])
        layout['placements'][0]['holds'] = []
        held = next(r for r in _coverage(ET.fromstring(self.job), layout, []) if r['reference'] == 'N1')
        self.assertIn('Complete source-owned pad centers are unavailable', held['holdReason'])

    def test_complete_source_models_individual_apply_links_offsets_and_exact_rollback(self):
        plan = self.review()
        self.assertEqual(len(plan['items']), 2)
        self.assertTrue(all(p['status'] == 'ready-for-review' for p in plan['items']))
        self.assertEqual(plan, self.review())
        first = plan['items'][0]
        recipe = {**plan, 'accepted': [first['digest']]}
        output = apply_preparation(self.job, self.master, self.pcb, recipe, recipe_digest(recipe))
        part = ET.fromstring(output['job']).findall('PartDataList/PartData')[-1]
        model = ET.fromstring(output['master']).findall('PartDataList/PartData')[-1]
        windows = ET.fromstring(output['master']).findall('WindowDataList/WindowData')[-2:]
        self.assertEqual(part.findtext('Roi/cx'), '32'); self.assertEqual(part.findtext('Roi/cy'), '47')
        self.assertEqual(part.findtext('CenterPosX'), '31.5'); self.assertEqual(part.findtext('CenterPosY'), '47.7')
        self.assertEqual(model.findtext('CadOffset/X'), '2'); self.assertEqual(model.findtext('CadOffset/Y'), '-3')
        self.assertEqual(part.findtext('Name'), 'fictional-next'); self.assertEqual(model.findtext('PartCode'), 'fictional-next')
        self.assertEqual(part.findtext('MasterKey'), model.findtext('MasterKey'))
        self.assertEqual(windows[1].findtext('ParentWndId'), windows[0].findtext('ID'))
        self.assertEqual(windows[1].findtext('AlignWndID'), windows[0].findtext('ID'))
        self.assertEqual(windows[0].findtext('GroupID'), windows[1].findtext('GroupID'))
        self.assertEqual(part.findtext('ENABLE'), 'False')
        self.assertTrue(all(w.findtext('ENABLE') == 'False' and len(w.find('AlgorithmDataList')) == 0 for w in windows))
        self.assertFalse(part.findtext('WND_PAD')); self.assertEqual(len(part.find('FovList')), 0)
        for role, original in [('job', self.job), ('master', self.master)]:
            recovered = output[role]
            for change in first['changes']:
                if change['document'] == role:
                    self.assertEqual(recovered.count(change['afterXml'].encode()), 1)
                    recovered = recovered.replace(change['afterXml'].encode(), b'', 1)
            self.assertEqual(recovered, original)
        rows = component_accounting(output['job'], plan, recipe['accepted'])
        self.assertEqual([r['status'] for r in rows], ['existing-structure-preserved', 'prepared-disabled', 'proposal-awaiting-review'])
        self.assertTrue(all(not r['machineValidated'] for r in rows))
        self.assertNotEqual(plan['items'][0]['dependencies']['partId'], plan['items'][1]['dependencies']['partId'])

    def test_exact_approval_stale_tampering_repeat_and_unknown_acceptance_refuse(self):
        plan = self.review(); recipe = {**plan, 'accepted': [plan['items'][0]['digest']]}
        changed = deepcopy(recipe); changed['items'][0]['changes'][0]['afterXml'] += '<injected/>'
        for payload in [changed, {**recipe, 'accepted': ['0'*64]}, {**recipe, 'accepted': []}]:
            with self.assertRaises(CaptureBlocked):
                apply_preparation(self.job, self.master, self.pcb, payload, recipe_digest(payload))
        with self.assertRaises(CaptureBlocked):
            apply_preparation(self.job + b' ', self.master, self.pcb, recipe, recipe_digest(recipe))
        out = apply_preparation(self.job, self.master, self.pcb, recipe, recipe_digest(recipe))
        with self.assertRaises(CaptureBlocked):
            apply_preparation(out['job'], out['master'], self.pcb, recipe, recipe_digest(recipe))
        self.assertEqual(len(self.review(out['job'], out['master'])['items']), 1)

    def test_unknown_special_and_external_window_dependencies_are_held(self):
        for tag, value in [('ZMapROIData', '5'), ('LinkagePart', 'True'), ('RefPartNo', '8')]:
            model = ET.fromstring(self.master); model.find('PartDataList/PartData/' + tag).text = value
            self.assertTrue(all(i['status'] == 'held' for i in self.review(master=ET.tostring(model))['items']))
        for path, value in [('ParentWndId', '700'), ('AlignWndID', '700'), ('UseWndPoly', '1')]:
            m = ET.fromstring(self.master); m.find('WindowDataList/WindowData/' + path).text = value
            self.assertTrue(all(i['status'] == 'held' for i in self.review(master=ET.tostring(m))['items']))
        j = ET.fromstring(self.job); ET.SubElement(j.find('PartDataList/PartData'), 'UnknownDependency').text = '8'
        self.assertTrue(all(i['code'] == 'PREPARATION_SCHEMA' for i in self.review(job=ET.tostring(j))['items']))
        self.assertTrue(all(i['status'] == 'held' for i in self.review(pcb=self.pcb.replace(b'(holeDiam 0)', b'(holeDiam .8)'))['items']))
        for value in ['0', '020']:
            m = ET.fromstring(self.master); m.find('WindowDataList/WindowData/ID').text = value
            self.assertTrue(all(i['code'] == 'PREPARATION_WINDOW_ID' for i in self.review(master=ET.tostring(m))['items']))

    def test_empty_unmodified_job_window_container_and_scoped_window_ids(self):
        job = self.job.replace(b'</JobContainer>', b'<WindowDataList /></JobContainer>')
        master = ET.fromstring(self.master)
        other = deepcopy(master.find('WindowDataList/WindowData'))
        other.find('ParentId').text = '777'
        master.find('WindowDataList').append(other)  # Same window ID, different Master scope.
        plan = self.review(job=job, master=ET.tostring(master))
        self.assertTrue(all(i['status'] == 'ready-for-review' for i in plan['items']))
        recipe = {**plan, 'accepted': [plan['items'][0]['digest']]}
        out = apply_preparation(job, ET.tostring(master), self.pcb, recipe, recipe_digest(recipe))
        self.assertIn(b'<WindowDataList />', out['job'])
        self.assertEqual(len(ET.fromstring(out['master']).findall('WindowDataList/WindowData')), 5)

    def test_native_alphabetic_window_keys_and_groups_preserve_format_and_local_links(self):
        m = ET.fromstring(self.master)
        windows = m.findall('WindowDataList/WindowData')
        for w, name in zip(windows, ['InventedWindow0', 'InventedWindow1']):
            w.find('ID').text = name
        windows[1].find('ParentWndId').text = 'InventedWindow0'
        windows[1].find('AlignWndID').text = 'InventedWindow0'
        raw = ET.tostring(m); plan = self.review(master=raw)
        self.assertTrue(all(i['status'] == 'ready-for-review' for i in plan['items']))
        recipe = {**plan, 'accepted': [i['digest'] for i in plan['items']]}
        out = apply_preparation(self.job, raw, self.pcb, recipe, recipe_digest(recipe))
        result = ET.fromstring(out['master'])
        for item in plan['items']:
            new = [w for w in result.findall('WindowDataList/WindowData') if w.findtext('ParentId') == item['dependencies']['masterKey']]
            self.assertEqual([w.findtext('ID') for w in new], ['InventedWindow0', 'InventedWindow1'])
            self.assertEqual(new[1].findtext('ParentWndId'), 'InventedWindow0')
            self.assertEqual(new[1].findtext('AlignWndID'), 'InventedWindow0')
            self.assertEqual([w.findtext('GroupID') for w in new], ['9', '9'])

    def test_polar_setting_is_preserved_unqualified_without_inventing_a_transform(self):
        job = ET.fromstring(self.job)
        job.find('PartDataList/PartData/ptSetPolarPos/X').text = '0.02'
        raw = ET.tostring(job); plan = self.review(job=raw)
        item = plan['items'][0]
        self.assertEqual(item['basis']['polarPositionPolicy'], 'copied-template-unqualified-not-translated')
        self.assertIn('polarity-position-frame-unqualified', item['remaining'])
        recipe = {**plan, 'accepted': [item['digest']]}
        out = apply_preparation(raw, self.master, self.pcb, recipe, recipe_digest(recipe))
        self.assertEqual(ET.fromstring(out['job']).findall('PartDataList/PartData')[-1].findtext('ptSetPolarPos/X'), '0.02')

    def test_complete_cad_accounting_reports_scopes_with_no_template_and_drill_separately(self):
        source = self.pcb.replace(b'(refDesRef "N2")', b'(refDesRef "ABSENT")')
        plan = self.review(pcb=source)
        rows = component_accounting(self.job, plan)
        missing = next(r for r in rows if r['reference'] == 'N2')
        self.assertEqual(missing['holdCode'], 'PREPARATION_SOURCE_IDENTITY')
        drilled = self.review(pcb=self.pcb.replace(b'(holeDiam 0)', b'(holeDiam .8)'))
        rows = component_accounting(self.job, drilled)
        self.assertEqual(next(r for r in rows if r['reference'] == 'N1')['holdCode'], 'PREPARATION_THROUGH_HOLE')
        self.assertFalse(any(r['intentionallyExcluded'] for r in rows))

    def test_review_apply_cardinal_trial_keeps_master_windows_and_zero_center_literals(self):
        job, master = ET.fromstring(self.job), ET.fromstring(self.master)
        part, model = job.find('PartDataList/PartData'), master.find('PartDataList/PartData')
        for path, value in {'Roi/cx': '10', 'Roi/cy': '20', 'Roi/a': '90', 'CenterPosX': '-0.000', 'CenterPosY': '0.00'}.items():
            part.find(path).text = value
        for path, value in {'Roi/a': '90', 'CadOffset/X': '0', 'CadOffset/Y': '0'}.items():
            model.find(path).text = value
        job.findall('CadData/CpList/Cp')[1].find('Ang').text = '180'
        source = self.pcb.replace(pattern(ref='N1').encode(), pattern(ref='N1', angle='0').encode())
        jraw, mraw = ET.tostring(job), ET.tostring(master)
        plan = self.review(job=jraw, master=mraw, pcb=source)
        item = next(i for i in plan['items'] if i['reference'] == 'N1')
        self.assertEqual(item['status'], 'ready-for-review')
        recipe = {**plan, 'accepted': [item['digest']]}
        output = apply_preparation(jraw, mraw, source, recipe, recipe_digest(recipe))
        newpart = ET.fromstring(output['job']).findall('PartDataList/PartData')[-1]
        newmodel = ET.fromstring(output['master']).findall('PartDataList/PartData')[-1]
        self.assertEqual(newpart.findtext('Roi/a'), '180')
        self.assertEqual(newpart.findtext('Roi/cx'), '30')
        self.assertEqual(newpart.findtext('CenterPosX'), '-0.000')
        self.assertEqual(newpart.findtext('CenterPosY'), '0.00')
        self.assertEqual(ET.tostring(newmodel.find('Roi')), ET.tostring(model.find('Roi')))
        self.assertEqual(item['basis']['nativeLengthUnit'], 'unqualified')
        self.assertIn('native-rotation-model-window-frame-unverified', item['remaining'])

    def test_partial_window_creation_preserves_original_bad_link_and_reports_exact_omission(self):
        master = ET.fromstring(self.master)
        oldwindows = master.findall('WindowDataList/WindowData')
        oldwindows[1].find('ParentWndId').text = '700'
        oldwindows[1].find('GroupID').text = '10'
        raw = ET.tostring(master); plan = self.review(master=raw)
        item = plan['items'][0]
        self.assertEqual(item['status'], 'ready-for-review')
        self.assertEqual(item['dependencies']['windowIds'], ['20'])
        self.assertEqual(item['dependencies']['windowPreparation'], 'partial-closed-window-subset')
        self.assertEqual(item['dependencies']['omittedWindows'][0]['windowId'], '21')
        self.assertEqual(item['dependencies']['omittedWindows'][0]['templateAlgorithmsNotTransferred'], 1)
        recipe = {**plan, 'accepted': [item['digest']]}
        output = apply_preparation(self.job, raw, self.pcb, recipe, recipe_digest(recipe))
        result = ET.fromstring(output['master'])
        self.assertEqual(result.findall('WindowDataList/WindowData')[1].findtext('ParentWndId'), '700')
        newwindows = [w for w in result.findall('WindowDataList/WindowData') if w.findtext('ParentId') == item['dependencies']['masterKey']]
        self.assertEqual(len(newwindows), 1)
        self.assertEqual(newwindows[0].findtext('ID'), '20')
        self.assertEqual(len(newwindows[0].find('AlgorithmDataList')), 0)
        row = next(r for r in component_accounting(output['job'], plan, recipe['accepted']) if r['reference'] == 'N1')
        self.assertEqual(row['status'], 'prepared-partial-disabled')
        self.assertEqual(row['omittedWindows'][0]['windowId'], '21')
        self.assertIn('omitted-window-creation-and-teaching-required', row['remaining'])

    def test_full_alternative_is_preferred_over_first_partial_template(self):
        job, master = ET.fromstring(self.job), ET.fromstring(self.master)
        part = deepcopy(job.find('PartDataList/PartData'))
        for field, value in {'ID': '700', 'MasterKey': '701', 'RefID': 'T2', 'No': '702'}.items(): part.find(field).text = value
        job.find('PartDataList').append(part)
        cad = deepcopy(job.find('CadData/CpList/Cp')); cad.find('ID').text = '710'; cad.find('RefID').text = 'T2'
        job.find('CadData/CpList').append(cad)
        model = deepcopy(master.find('PartDataList/PartData'))
        for field, value in {'MasterKey': '701', 'RefID': 'T2', 'No': '702'}.items(): model.find(field).text = value
        master.find('PartDataList').append(model)
        for old in list(master.findall('WindowDataList/WindowData')):
            new = deepcopy(old); new.find('ParentId').text = '701'; master.find('WindowDataList').append(new)
        bad = master.findall('WindowDataList/WindowData')[1]
        bad.find('ParentWndId').text = '900'; bad.find('GroupID').text = '10'
        source = pcb(placements=''.join(pattern(ref=r) for r in ['T1', 'T2', 'N1', 'N2']),
                     components=''.join(f'(compInst "{r}" (compRef "invented") (originalName "{r}"))' for r in ['T1', 'T2', 'N1', 'N2']))
        plan = self.review(job=ET.tostring(job), master=ET.tostring(master), pcb=source)
        self.assertTrue(all(i['templateReference'] == 'T2' for i in plan['items']))
        self.assertTrue(all(i['dependencies']['windowPreparation'] == 'complete-template-window-copy' for i in plan['items']))

    def test_shared_master_existing_teaching_and_archive_payloads_preserved(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp); source = folder/'original.zip'; dest = folder/'parts.scan-draft-qualification.zip'
            selected = SnapshotSelection('Fiction/Board', 'Fiction/Board/Board.xml', 'main', 'Fiction/Master/Master.xml', 'main')
            members = {selected.job_member: self.job, selected.master_member: self.master,
                       'Fiction/Board/Board_Temp.xml': self.job, 'Fiction/Master/Master.xml.bak': self.master,
                       'Fiction/Board/images/opaque.bin': b'\xff\x00original'}
            with zipfile.ZipFile(source, 'w') as z:
                z.comment = b'original comment'
                for name, raw in members.items(): z.writestr(name, raw)
            original = source.read_bytes(); plan = self.review(); recipe = {**plan, 'accepted': [i['digest'] for i in plan['items']]}
            digest = package_digest(sha256(original).hexdigest(), selected, recipe)
            result = create_disabled_draft_package(source, dest, self.pcb, selected, sha256(original).hexdigest(), recipe, digest)
            self.assertEqual(result['status'], 'success', result)
            with zipfile.ZipFile(dest) as wrapper, zipfile.ZipFile(BytesIO(wrapper.read('CANDIDATE.zip'))) as candidate:
                self.assertEqual(candidate.namelist(), list(members)); self.assertEqual(candidate.comment, b'original comment')
                self.assertEqual([name for name, raw in members.items() if candidate.read(name) != raw], [selected.job_member, selected.master_member])
                rows = component_accounting(candidate.read(selected.job_member), plan, recipe['accepted'])
                self.assertEqual(sum(r['status'] == 'prepared-disabled' for r in rows), 2)
                m = ET.fromstring(candidate.read(selected.master_member))
                self.assertEqual(len(m.findall('PartDataList/PartData')), 3)
                self.assertEqual(len(m.findall('WindowDataList/WindowData')), 6)
                self.assertEqual(len(m.find('WindowDataList/WindowData/AlgorithmDataList')), 1)
            self.assertEqual(source.read_bytes(), original)
            self.assertEqual(create_disabled_draft_package(source, dest, self.pcb, selected, sha256(original).hexdigest(), recipe, digest)['code'], 'DESTINATION_EXISTS')


if __name__ == '__main__':
    unittest.main()
