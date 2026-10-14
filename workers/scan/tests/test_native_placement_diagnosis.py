"""Independent invented origins, body geometry and native transport tests."""
from copy import deepcopy
from hashlib import sha256
import io
import csv
import json
from pathlib import Path
import tempfile
import unittest
from xml.etree import ElementTree as ET
import zipfile

from workers.scan.native_placement_diagnosis import diagnose, diagnose_files, validate_settings, verify_request
from workers.scan.archive_browser_cli import dispatch
from workers.scan.qualification_candidate import proposal_digest
from workers.scan.snapshot_capture import CaptureBlocked
from workers.scan.accel_ascii import read_accel
from workers.scan.placement_intake import normalize, read_table
from workers.scan.bom_intake import normalize_bom
from workers.scan.tests.test_paired_terminal_constructor import fixture
from workers.scan.tests.test_bom_intake import CONFIG as BOM_CONFIG, HEADER


def csv_bytes(rows):
    stream = io.StringIO(newline=''); csv.writer(stream).writerows(rows)
    return stream.getvalue().encode()


def setup(angle=0, *, aligned=False, source_shift=(0, 0), frame_angle=0, units='mm', y_direction='up'):
    job, master, pcb, profile = fixture(angle)
    j, m = ET.fromstring(job), ET.fromstring(master)
    # A new wholly authored native placement is inserted by the TEST fixture,
    # never by diagnosis. Existing model/window teaching remains unchanged.
    p = deepcopy(j.find('PartDataList/PartData'))
    for field, value in {'ID': '87', 'RefID': 'N1', 'MasterKey': '88', 'Roi/a': str((-angle-frame_angle) % 360)}.items():
        p.find(field).text = value
    scale, sy = (1 if units == 'mm' else .0254), (1 if y_direction == 'up' else -1)
    c, s = __import__('math').cos(__import__('math').radians(frame_angle)), __import__('math').sin(__import__('math').radians(frame_angle))
    # Independently specified transform: rotate source, then (+11,-13).
    for cp in j.findall('CadData/CpList/Cp'):
        x, y = float(cp.findtext('X'))-11, float(cp.findtext('Y'))+13
        cp.find('X').text = str((x*c-y*s+11)/scale)
        cp.find('Y').text = str((x*s+y*c-13)/scale*sy)
        cp.find('Ang').text = str((float(cp.findtext('Ang'))-frame_angle) % 360)
    ca, sa = __import__('math').cos(__import__('math').radians(angle)), __import__('math').sin(__import__('math').radians(angle))
    bx, by = 3+.3*ca+.2*sa, 2+.3*sa-.2*ca
    expected = [(bx*c-by*s+11)/scale, (bx*s+by*c-13)/scale*sy]
    p.find('Roi/cx').text = str(expected[0] if aligned else expected[0]+3/scale)
    p.find('Roi/cy').text = str(expected[1] if aligned else expected[1]-4/scale*sy)
    j.find('PartDataList').append(p)
    model = deepcopy(m.find('PartDataList/PartData'))
    model.find('MasterKey').text = '88'; model.find('RefID').text = 'N1'
    model.find('Roi/cx').text = str(expected[0]); model.find('Roi/cy').text = str(expected[1]); model.find('Roi/a').text = str((-angle-frame_angle) % 360)
    m.find('PartDataList').append(model)
    for window in list(m.findall('WindowDataList/WindowData')):
        w = deepcopy(window); w.find('ParentId').text = '88'; w.find('ID').text = str(int(w.findtext('ID'))+100)
        for field in ('ParentWndId', 'AlignWndID'):
            if w.findtext(field) not in ('', '0', None): w.find(field).text = str(int(w.findtext(field))+100)
        m.find('WindowDataList').append(w)
    job, master = ET.tostring(j), ET.tostring(m)
    layout = read_accel(pcb)
    primary = csv_bytes([[p['refdes'], 'fictional-coil' if p['refdes'] == 'N1' else 'authored-device',
                          p['anchor']['xMm']+source_shift[0], p['anchor']['yMm']+source_shift[1], p['rotation']['degrees']]
                         for p in layout['placements']])
    pc = {'config': {'startRow': 1, 'columns': {'refdes': 1, 'mpn': 2, 'x': 3, 'y': 4, 'rotation': 5}, 'module': 'source-board', 'side': 'Top', 'units': 'mm', 'rotationDirection': 'ccw', 'decimalSeparator': '.', 'pairSeparator': ','}, 'sheet': 0, 'delimiter': ','}
    bc = {'config': {**deepcopy(BOM_CONFIG), 'revision': '1'}, 'sheet': 0, 'delimiter': ','}
    bom_bytes = csv_bytes([HEADER, *[[1, p['refdes'], '', '', '', 'fictional-coil' if p['refdes'] == 'N1' else 'authored-device', ''] for p in layout['placements']]])
    placement = normalize(read_table(primary, 'csv'), primary, pc['config'])
    bom = normalize_bom(read_table(bom_bytes, 'csv'), bom_bytes, bc['config'])
    settings = {'schemaVersion': '1', 'module': '1', 'sourceRevision': '1', 'nativeRevision': '1', 'bomRevision': '1',
                'sourceSide': 'top', 'nativeSide': 'top', 'nativeUnits': units, 'nativeYDirection': y_direction, 'nativeRotation': 'cw',
                'nativeRoiAnchor': 'body-center', 'frameStatement': 'Authored independent physical correspondences: controls identify footprint origins; canonical Y-up angle convention and body-center ROI policy are experimental.',
                'toleranceMm': '0.001', 'toleranceBasis': 'Invented source accuracy, not an inspection limit.', 'fitReferences': ['T1', 'C1', 'C2'], 'checkReferences': ['C3', 'C4'], 'framesConfirmed': True}
    context = {'schemaVersion': '1', 'settings': settings, 'source': {'layoutSha256': sha256(pcb).hexdigest(), 'placementSha256': sha256(primary).hexdigest(), 'bomSha256': sha256(bom_bytes).hexdigest()}, 'placementConfig': pc, 'bomConfig': bc, 'packageProfiles': [profile]}
    native = {'archiveSha256': 'e'*64, 'jobSha256': sha256(job).hexdigest(), 'masterSha256': sha256(master).hexdigest(), 'jobMember': 'Fable/Board/Board.xml', 'root': 'Fable/Board', 'masterMember': 'Fable/Master/Master.xml', 'schemaVersion': '10.2'}
    return {'job': job, 'master': master, 'pcb': pcb, 'placement': placement, 'bom': bom, 'context': context, 'native_source': native}, primary, bom_bytes, expected


def target(report):
    return next(r for r in report['rows'] if r['identity']['RefID'] == 'N1')


def request(report, context):
    row = target(report); evidence_id = 'derived-test-evidence'
    proposals = [{'id': f'derived-{i}', 'path': row['sourcePath']+'/'+p['field'], 'identity': row['identity'], 'before': p['before'], 'after': p['after'], 'beforeRoi': row['beforeRoi'], 'evidenceIds': [evidence_id]} for i, p in enumerate(row['proposals'])]
    for p in proposals:
        p['dependencyProposalIds'] = [q['id'] for q in proposals if q is not p]
    native = report['source']
    r = {'artifactType': 'scan.qualification-patch-request', 'schemaVersion': '1', 'purpose': 'qualification-only',
         'source': {k: native[k] for k in ('archiveSha256', 'jobSha256', 'root', 'jobMember', 'masterMember', 'masterSha256')},
         'targetEagleBuild': None, 'targetMachine': None, 'reviewer': 'Synthetic test decision', 'trialPurpose': 'Isolated synthetic qualification; physical correctness and runtime unverified.',
         'evidence': [{'id': evidence_id, 'kind': 'independent-source-support', 'independentSupport': True, 'summary': 'Fresh independent authored geometry and declared experimental frame contract.', 'references': [{'sha256': report['diagnosisSha256'], 'label': 'Frozen source-derived diagnosis'}]}],
         'proposals': proposals, 'acceptances': [], 'diagnosis': {**context, 'diagnosisSha256': report['diagnosisSha256']}}
    r['source'].update(jobRole='main', masterRole='main')
    r['acceptances'] = [{'proposalId': p['id'], 'proposalSha256': proposal_digest(r, p), 'decision': 'accepted', 'reviewer': r['reviewer']} for p in proposals]
    return r


class NativeDiagnosisTests(unittest.TestCase):
    def test_owned_pad_intentions_and_exact_window_records_remain_unqualified(self):
        data, _, _, _ = setup()
        row = target(diagnose(**data)); dependencies = row['dependencyInventory']
        intentions = dependencies['sourcePadIntentions']
        self.assertEqual([p['padNumber'] for p in intentions], ['1', '2'])
        for actual, wanted in zip([p['sourceBoardPointMm'] for p in intentions], [[1.8, 1.8], [4.8, 1.8]]):
            for value, expected in zip(actual, wanted): self.assertAlmostEqual(value, expected)
        self.assertEqual([p['physicalPin'] for p in intentions], ['1', '2'])
        self.assertTrue(all(p['sourceCenterEstablished'] and not p['bindingPrepared'] and not p['opticalInspectionEstablished'] and p['opticalAccess'] == 'unverified' for p in intentions))
        self.assertEqual([w['ID'] for w in dependencies['existingWindows']], ['120', '121'])
        self.assertEqual([w['ParentId'] for w in dependencies['existingWindows']], ['88', '88'])
        self.assertEqual([w['GroupID'] for w in dependencies['existingWindows']], ['9', '9'])
        self.assertTrue(all(w['algorithmCount'] == 1 and w['ENABLE'] == 'True' for w in dependencies['existingWindows']))
        self.assertFalse(dependencies['nativeWindowFrameQualified'])
        self.assertFalse(dependencies['sourceToNativePadFrameQualified'])
        self.assertFalse(dependencies['bindingTupleMeaningQualified'])
        self.assertEqual(len(dependencies['requiredEvidence']), 4)
        data['context']['packageProfiles'][0]['nativePartNames'] = ['wrong-package']
        held = target(diagnose(**data))['dependencyInventory']['sourcePadIntentions']
        self.assertTrue(all(p['physicalPin'] is None and p['physicalRole'] is None for p in held))

    def test_independent_cardinals_nonzero_origin_and_rotated_native_frames(self):
        for angle in (0, 90, 180, 270):
            for frame_angle in (0, 90, 180, 270):
                data, _, _, expected = setup(angle, source_shift=(23, -7), frame_angle=frame_angle)
                original = deepcopy(data)
                report = diagnose(**data); row = target(report)
                self.assertEqual(row['classification'], 'local-native-roi-offset', (report['frame']['holds'], row['holds']))
                self.assertEqual(len(row['proposals']), 2)
                for got, wanted in zip(row['proposedCenterNative'], expected):
                    self.assertAlmostEqual(got, wanted, places=7)
                self.assertAlmostEqual(report['sourceRegistration']['transform']['matrix'][0][2], -23)
                self.assertAlmostEqual(report['sourceRegistration']['transform']['matrix'][1][2], 7)
                self.assertFalse(report['physicalCorrectnessVerified']); self.assertTrue(row['completeRepairClaimHeld'])
                self.assertEqual(data, original); self.assertEqual(report, diagnose(**data))

    def test_clean_input_is_noop_and_explicit_mil_y_down_roundtrips(self):
        for units in ('mm', 'mil'):
            for direction in ('up', 'down'):
                data, _, _, expected = setup(270, aligned=True, units=units, y_direction=direction)
                report = diagnose(**data); row = target(report)
                self.assertEqual(row['classification'], 'already-aligned', (report['frame']['holds'], row['holds']))
                self.assertEqual(row['proposals'], [])
                for got, wanted in zip(row['proposedCenterNative'], expected): self.assertAlmostEqual(got, wanted)

    def test_unknown_side_revision_units_and_frame_are_scoped_holds(self):
        for key, value in (('sourceSide', 'unknown'), ('nativeSide', 'bottom'), ('nativeUnits', 'unknown'), ('nativeRevision', '2'), ('framesConfirmed', False), ('frameStatement', ''), ('toleranceBasis', '')):
            data, _, _, _ = setup(); data['context']['settings'][key] = value
            result = diagnose(**data)
            self.assertTrue(result['frame']['holds'], key); self.assertEqual(target(result)['proposals'], [])

    def test_unknown_side_is_missing_evidence_not_a_source_contradiction(self):
        data, _, _, _ = setup(); data['context']['settings']['sourceSide'] = 'unknown'
        result = diagnose(**data)
        self.assertIn('DIAGNOSIS_SIDE_UNKNOWN', [h['code'] for h in result['frame']['holds']])
        self.assertNotIn('DIAGNOSIS_CONTROL_SIDE', [h['code'] for h in result['frame']['holds']])
        self.assertNotIn('DIAGNOSIS_SIDE_CONFLICT', [h['code'] for r in result['rows'] for h in r['holds']])
        self.assertEqual(result['counts']['proposedScalars'], 0)
        data['context']['settings']['sourceSide'] = 'bottom'
        result = diagnose(**data)
        self.assertIn('DIAGNOSIS_CONTROL_SIDE', [h['code'] for h in result['frame']['holds']])
        self.assertIn('DIAGNOSIS_SIDE_CONFLICT', [h['code'] for h in target(result)['holds']])

    def test_false_fit_reflection_wrong_units_and_bad_checkpoint_refuse(self):
        for mutation in ('mirror', 'scale', 'checkpoint'):
            data, _, _, _ = setup(); j = ET.fromstring(data['job'])
            for cp in j.findall('CadData/CpList/Cp'):
                if mutation == 'mirror': cp.find('X').text = str(-float(cp.findtext('X')))
                elif mutation == 'scale': cp.find('X').text = str(float(cp.findtext('X'))*25.4)
                elif cp.findtext('RefID') == 'C4': cp.find('Y').text = str(float(cp.findtext('Y'))+1)
            data['job'] = ET.tostring(j); data['native_source']['jobSha256'] = sha256(data['job']).hexdigest()
            result = diagnose(**data)
            self.assertTrue(result['frame']['holds'], mutation); self.assertEqual(target(result)['proposals'], [])

    def test_local_cad_outlier_and_duplicate_causes_are_distinct(self):
        for mutation, code in (('outlier', 'DIAGNOSIS_CAD_OUTLIER'), ('cad', 'DIAGNOSIS_CAD_IDENTITY'), ('part', 'DIAGNOSIS_NATIVE_DUPLICATE')):
            data, _, _, _ = setup(); j = ET.fromstring(data['job'])
            cp = next(c for c in j.findall('CadData/CpList/Cp') if c.findtext('RefID') == 'N1')
            if mutation == 'outlier': cp.find('X').text = '999'
            elif mutation == 'cad': j.find('CadData/CpList').append(deepcopy(cp))
            else: j.find('PartDataList').append(deepcopy(j.findall('PartDataList/PartData')[-1]))
            data['job'] = ET.tostring(j); data['native_source']['jobSha256'] = sha256(data['job']).hexdigest()
            result = diagnose(**data)
            self.assertEqual(result['frame']['holds'], []); self.assertIn(code, [h['code'] for h in target(result)['holds']]); self.assertEqual(target(result)['proposals'], [])

    def test_reused_native_ids_cannot_be_disambiguated_by_reference_text(self):
        for domain, code in (('part', 'DIAGNOSIS_NATIVE_IDENTITY'), ('cad', 'DIAGNOSIS_CAD_IDENTITY')):
            data, _, _, _ = setup(); j = ET.fromstring(data['job'])
            if domain == 'part':
                j.findall('PartDataList/PartData')[-1].find('ID').text = '7'
            else:
                next(c for c in j.findall('CadData/CpList/Cp') if c.findtext('RefID') == 'N1').find('ID').text = '100'
            data['job'] = ET.tostring(j); data['native_source']['jobSha256'] = sha256(data['job']).hexdigest()
            row = target(diagnose(**data))
            self.assertIn(code, [h['code'] for h in row['holds']]); self.assertEqual(row['proposals'], [])

    def test_missing_body_dnp_population_and_mpn_do_not_create_repairs(self):
        for mutation in ('profile', 'dnp', 'mpn'):
            data, _, _, _ = setup()
            if mutation == 'profile': data['context']['packageProfiles'] = []
            else:
                row = next(r for r in data['bom']['references'] if r['normalizedRefdes'] == 'N1')
                if mutation == 'dnp': row['populationEvidence'] = 'engineering-dnp'
                else: row['mpn'] = 'another-author-created-package'
            row = target(diagnose(**data)); self.assertTrue(row['holds']); self.assertEqual(row['proposals'], [])

    def test_derived_scalar_provenance_and_atomicity_are_not_prose(self):
        data, _, _, _ = setup(); report = diagnose(**data); r = request(report, data['context'])
        self.assertEqual(verify_request(r, report)['derivedScalars'], 2)
        for mutation in ('after', 'before', 'identity', 'hash', 'partial', 'replay'):
            changed = deepcopy(r)
            if mutation in ('after', 'before'): changed['proposals'][0][mutation] = '123'
            elif mutation == 'identity': changed['proposals'][0]['identity']['ID'] = 'wrong'
            elif mutation == 'hash': changed['diagnosis']['diagnosisSha256'] = '0'*64
            elif mutation == 'partial': changed['proposals'].pop()
            else: changed['evidence'][0].update(kind='historical-replay', independentSupport=False)
            with self.assertRaises(CaptureBlocked, msg=mutation): verify_request(changed, report)

    def test_request_digest_binds_all_interpretation_inputs(self):
        data, _, _, _ = setup(); report = diagnose(**data); r = request(report, data['context'])
        before = proposal_digest(r, r['proposals'][0])
        r['diagnosis']['settings']['frameStatement'] += ' altered'
        self.assertNotEqual(before, proposal_digest(r, r['proposals'][0]))

    def test_possible_local_teaching_and_shared_master_cannot_be_normalized(self):
        for mutation in ('teaching', 'shared'):
            data, _, _, _ = setup(); j, m = ET.fromstring(data['job']), ET.fromstring(data['master'])
            p = j.findall('PartDataList/PartData')[-1]; model = m.findall('PartDataList/PartData')[-1]
            if mutation == 'teaching':
                for key in ('cx', 'cy'):
                    value = float(model.findtext('Roi/'+key))+.025
                    p.find('Roi/'+key).text = str(value); model.find('Roi/'+key).text = str(value)
            else:
                j.find('PartDataList/PartData/MasterKey').text = '88'
            data['job'], data['master'] = ET.tostring(j), ET.tostring(m)
            data['native_source'].update(jobSha256=sha256(data['job']).hexdigest(), masterSha256=sha256(data['master']).hexdigest())
            row = target(diagnose(**data))
            self.assertIn('DIAGNOSIS_TAUGHT_ADJUSTMENT', [h['code'] for h in row['holds']]); self.assertEqual(row['proposals'], [])

    def test_small_taught_offsets_inside_asymmetric_rotated_body_are_preserved(self):
        import math
        for angle in (0, 90, 180, 270):
            data, _, _, expected = setup(angle); j = ET.fromstring(data['job']); p = j.findall('PartDataList/PartData')[-1]
            c, s = math.cos(math.radians(angle)), math.sin(math.radians(angle))
            p.find('Roi/cx').text = str(expected[0]+.06*c-.14*s)
            p.find('Roi/cy').text = str(expected[1]+.06*s+.14*c)
            data['job'] = ET.tostring(j); data['native_source']['jobSha256'] = sha256(data['job']).hexdigest()
            row = target(diagnose(**data))
            self.assertTrue(row['masterSupportsSourceDatum']); self.assertTrue(row['withinBodyEnvelope'])
            self.assertAlmostEqual(row['bodyLocalOffsetMm'][0], .06); self.assertAlmostEqual(row['bodyLocalOffsetMm'][1], .14)
            self.assertEqual(row['proposals'], []); self.assertIn('DIAGNOSIS_TAUGHT_ADJUSTMENT', [h['code'] for h in row['holds']])

    def test_bounds_and_same_column_mapping_fail_before_writing(self):
        data, primary, _, _ = setup()
        settings = data['context']['settings']; settings['fitReferences'].append(settings['fitReferences'][0])
        with self.assertRaises(CaptureBlocked): validate_settings(settings)
        config = data['context']['placementConfig']['config']; config['columns']['y'] = config['columns']['x']
        with self.assertRaises(Exception): normalize(read_table(primary, 'csv'), primary, config)

    def test_actual_browser_protocol_rederives_exports_and_preserves_native_payloads(self):
        data, primary, bom_bytes, expected = setup(90, source_shift=(23, -7))
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); source = root/'original.zip'
            members = {'Fable/Board/Board.xml': data['job'], 'Fable/Master/Master.xml': data['master'],
                       'Fable/Board/Board_Temp.xml': data['job'], 'Fable/Board/Board.xml.bak': data['job'], 'Fable/Board/Images/opaque.bin': b'preserve synthetic asset\x00\xff'}
            with zipfile.ZipFile(source, 'w') as z:
                for name, content in members.items(): z.writestr(name, content)
            original = source.read_bytes(); archive_hash = sha256(original).hexdigest()
            paths = [root/'layout.pcb', root/'placement.csv', root/'bom.csv']
            for p, content in zip(paths, (data['pcb'], primary, bom_bytes)): p.write_bytes(content)
            host = dict(zip(('layoutSource', 'placementSource', 'bomSource'), map(str, paths)))
            host.update(layoutName='Invented.pcb', placementName='Invented.csv', bomName='Invented-BOM.csv')
            selection = {'root': 'Fable/Board', 'jobMember': 'Fable/Board/Board.xml', 'jobRole': 'main', 'masterMember': 'Fable/Master/Master.xml', 'masterRole': 'main'}
            control = {'protocolVersion': '1', 'action': 'preflight', 'source': str(source), 'selection': selection, 'expectedArchiveSha256': archive_hash}
            reviewed = dispatch(control); self.assertEqual(reviewed['status'], 'success', reviewed)
            control['expectedPackageSha256'] = reviewed['capture']['packageSha256']; (root/'result.scan-snapshot').unlink()
            report = dispatch({**control, 'action': 'placement-diagnosis', 'diagnosis': data['context'], 'diagnosisInput': host})
            self.assertEqual(report['status'], 'success', report); self.assertEqual(len(target(report)['proposals']), 2, target(report))
            (root/'result.scan-snapshot').unlink()
            stale_context = {**data['context'], 'diagnosisSha256': '0'*64}
            blocked = dispatch({**control, 'action': 'placement-diagnosis', 'diagnosis': stale_context, 'diagnosisInput': host})
            self.assertEqual(blocked['status'], 'blocked'); self.assertEqual(blocked['code'], 'DIAGNOSIS_STALE_FINDING')
            self.assertFalse(blocked['machineExportAllowed']); self.assertFalse((root/'result.engineering.zip').exists())
            (root/'result.scan-snapshot').unlink()
            r = request(report, data['context'])
            result = dispatch({**control, 'action': 'repair-review', 'repair': {'request': r}, 'diagnosisInput': host})
            self.assertEqual(result['status'], 'success', result); self.assertEqual(result['diagnosisReceipt']['basis'], 'source-derived-diagnosis')
            (root/'result.scan-snapshot').unlink()
            result = dispatch({**control, 'action': 'repair-export', 'repair': {'request': r, 'acknowledgement': 'QUALIFICATION ONLY'}, 'diagnosisInput': host})
            self.assertEqual(result['status'], 'success', result)
            with zipfile.ZipFile(root/'result.engineering.zip') as z:
                receipt = json.loads(z.read('independent-diagnosis-receipt.json')); self.assertEqual(receipt['acceptedScalars'], 2)
                self.assertTrue(receipt['completeRepairClaimHeld'])
                with zipfile.ZipFile(io.BytesIO(z.read('CANDIDATE.zip'))) as candidate:
                    for name, content in members.items():
                        if name != selection['jobMember']: self.assertEqual(candidate.read(name), content)
                    changed = ET.fromstring(candidate.read(selection['jobMember'])).findall('PartDataList/PartData')[-1]
                    self.assertAlmostEqual(float(changed.findtext('Roi/cx')), expected[0]); self.assertAlmostEqual(float(changed.findtext('Roi/cy')), expected[1])
                    self.assertEqual(changed.findtext('ENABLE'), 'True'); self.assertEqual(changed.findtext('WND_PAD'), 'old-private-binding')
            self.assertEqual(source.read_bytes(), original)
            # Freshly parsed same input reproduces the frozen report exactly.
            self.assertEqual(diagnose_files(source, reviewed, r['diagnosis'], host)['diagnosisSha256'], report['diagnosisSha256'])
            wrong = deepcopy(r['diagnosis']); wrong['settings']['nativeSide'] = 'bottom'
            with self.assertRaises(CaptureBlocked): diagnose_files(source, reviewed, wrong, host)
            paths[1].write_bytes(primary+b'\nchanged')
            with self.assertRaises(CaptureBlocked): diagnose_files(source, reviewed, r['diagnosis'], host)

    def test_derived_edit_and_preparations_compose_with_exact_rollback(self):
        from workers.scan.native_preparation import automatic_plan
        from workers.scan.disabled_draft_package import package_digest
        from workers.scan.snapshot_capture import SnapshotSelection
        data, primary, bom_bytes, _ = setup()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); source = root/'original.zip'
            members = {'Fable/Board/Board.xml': data['job'], 'Fable/Master/Master.xml': data['master'],
                       'Fable/Board/Board_Temp.xml': b'<untouched-temp/>', 'Fable/Board/Board.xml.bak': b'<untouched-backup/>', 'Fable/Board/Images/asset.bin': b'untouched synthetic teaching\x00'}
            with zipfile.ZipFile(source, 'w') as z:
                for name, content in members.items(): z.writestr(name, content)
            original = source.read_bytes(); archive_hash = sha256(original).hexdigest()
            paths = [root/'layout.pcb', root/'placement.csv', root/'bom.csv']
            for path, content in zip(paths, (data['pcb'], primary, bom_bytes)): path.write_bytes(content)
            host = dict(zip(('layoutSource', 'placementSource', 'bomSource'), map(str, paths))); host.update(layoutName='Authored.pcb', placementName='Authored.csv', bomName='Authored-BOM.csv')
            selection = {'root': 'Fable/Board', 'jobMember': 'Fable/Board/Board.xml', 'jobRole': 'main', 'masterMember': 'Fable/Master/Master.xml', 'masterRole': 'main'}
            control = {'protocolVersion': '1', 'action': 'preflight', 'source': str(source), 'selection': selection, 'expectedArchiveSha256': archive_hash}
            baseline = dispatch(control); self.assertEqual(baseline['status'], 'success', baseline)
            control['expectedPackageSha256'] = baseline['capture']['packageSha256']; (root/'result.scan-snapshot').unlink()
            report = diagnose_files(source, baseline, data['context'], host); r = request(report, data['context'])
            plan = automatic_plan(data['job'], data['master'], data['pcb'], data['context']['packageProfiles'])
            accepted = [i['digest'] for i in plan['items'] if i['status'] == 'ready-for-review']
            self.assertEqual(len(accepted), 4)
            preparation = {'layoutSha256': data['context']['source']['layoutSha256'], 'reviewDigest': package_digest(archive_hash, SnapshotSelection(selection['root'], selection['jobMember'], 'main', selection['masterMember'], 'main'), plan),
                           'accepted': accepted, 'reviewer': 'Synthetic preparation decision', 'packageProfiles': data['context']['packageProfiles']}
            result = dispatch({**control, 'action': 'repair-export', 'diagnosisInput': host, 'layoutSource': str(paths[0]),
                               'repair': {'request': r, 'acknowledgement': 'QUALIFICATION ONLY', 'preparation': preparation}})
            self.assertEqual(result['status'], 'success', result)
            with zipfile.ZipFile(root/'result.engineering.zip') as bundle:
                receipt = json.loads(bundle.read('independent-diagnosis-receipt.json'))
                self.assertEqual(receipt['acceptedScalars'], 2); self.assertEqual(len(receipt['acceptedPreparationDigests']), 4)
                self.assertTrue(receipt['completeRepairClaimHeld'])
                with zipfile.ZipFile(io.BytesIO(bundle.read('CANDIDATE.zip'))) as candidate:
                    actual_job, actual_master = candidate.read(selection['jobMember']), candidate.read(selection['masterMember'])
                    self.assertEqual(len(ET.fromstring(actual_job).findall('PartDataList/PartData')), 6)
                    for added in ET.fromstring(actual_job).findall('PartDataList/PartData')[2:]: self.assertEqual(added.findtext('ENABLE'), 'False')
                    # Strip EXACT reviewed insertions, then reverse the two
                    # reviewed scalar leaf replacements: all original teaching
                    # and formatting must be recovered byte-for-byte.
                    for item in plan['items']:
                        for change in item['changes']:
                            if change['document'] == 'job': actual_job = actual_job.replace(change['afterXml'].encode(), b'', 1)
                            else: actual_master = actual_master.replace(change['afterXml'].encode(), b'', 1)
                    from workers.scan.qualification_candidate import _patch_xml, reverse_proposals
                    self.assertEqual(_patch_xml(actual_job, reverse_proposals(r['proposals'])), data['job'])
                    self.assertEqual(actual_master, data['master'])
                    for name, content in members.items():
                        if name not in (selection['jobMember'], selection['masterMember']): self.assertEqual(candidate.read(name), content)
            self.assertEqual(source.read_bytes(), original)


if __name__ == '__main__':
    unittest.main()
