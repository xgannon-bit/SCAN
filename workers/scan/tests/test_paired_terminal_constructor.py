"""Independently invented geometry and identities, never private board fixtures."""
from copy import deepcopy
import math
import unittest
from xml.etree import ElementTree as ET

from workers.scan.native_preparation import automatic_plan, apply_preparation, recipe_digest
from workers.scan.paired_terminal_constructor import validate_profiles
from workers.scan.snapshot_capture import CaptureBlocked
from workers.scan.tests.test_native_preparation import fixtures
from workers.scan.tests.test_accel_ascii import pcb, graphics


def fixture(angle=0, offset=(.3, -.2), pad_axis=0):
    jraw, mraw, _ = fixtures()
    j, m = ET.fromstring(jraw), ET.fromstring(mraw)
    cps = j.find('CadData/CpList')
    cps.clear()
    points = [('T1', 0, 0), ('N1', 3, 2), ('C1', 7, 0), ('C2', 0, 5), ('C3', 7, 5), ('C4', 2, 8)]
    placements, components = [], []
    for i, (ref, x, y) in enumerate(points):
        cp = ET.SubElement(cps, 'Cp')
        a = angle if ref == 'N1' else 0
        for k, v in {'ID': str(100+i), 'RefID': ref, 'ModuleID': '1', 'X': str(x+11), 'Y': str(y-13), 'Ang': str((-a)%360), 'PrntPartName': 'fictional-coil' if ref == 'N1' else 'authored-device'}.items():
            ET.SubElement(cp, k).text = v
        if ref == 'N1':
            placements.append(f'(pattern (patternRef "invented-coil") (patternGraphicsNameRef "land") (refDesRef "{ref}") (pt {x} {y}) (rotation {a}))')
        else:
            placements.append(f'(pattern (patternRef "offset-test") (patternGraphicsNameRef "fictional") (refDesRef "{ref}") (pt {x} {y}) (rotation 0))')
        components.append(f'(compInst "{ref}" (compRef "coil-def"))' if ref == 'N1' else f'(compInst "{ref}" (compRef "invented"))')
    # Fictional body/electrode dimensions deliberately differ from actual packages.
    ox, oy = offset
    pts = [(ox-1.5, oy), (ox+1.5, oy)] if pad_axis == 0 else [(ox, oy-1.5), (ox, oy+1.5)]
    pads = ''.join(f'(pad (padNum {i+1}) (padStyleRef "coil-pad") (pt {x} {y}) (rotation {90 if pad_axis else 0}))' for i, (x,y) in enumerate(pts))
    raw = pcb(placements=''.join(placements), components=''.join(components))
    library = f'''(padStyleDef "coil-pad" (holeDiam 0) (padShape (layerNumRef 1) (padShapeType Rect) (shapeWidth .8) (shapeHeight 1.2)))
      (patternDefExtended "invented-coil" {graphics('land', pads)})
      (compDef "coil-def" (compPin "1") (compPin "2") (attachedPattern (patternName "reviewed-library-alias") (numPads 2)
        (padPinMap (padNum 1) (compPinRef 1) (padNum 2) (compPinRef 2))))'''
    raw = raw.replace(b'(library ', ('(library '+library).encode())
    seed = m.findall('WindowDataList/WindowData')[0]
    seed.find('Shape').text = '1'; seed.find('ALIGNWND').text = 'False'; seed.find('PropertyType').text = 'Mount'
    terminal = m.findall('WindowDataList/WindowData')[1]
    for k,v in {'Shape':'1','ALIGNWND':'False','PropertyType':'Solder','ParentWndId':'0','AlignWndID':''}.items(): terminal.find(k).text=v
    profile = {'id': 'fictional-profile', 'kind': 'symmetric-two-terminal-body-v1', 'patternRef': 'invented-coil',
               'graphicsRef': 'land', 'compRef': 'coil-def', 'attachedPatternName': 'reviewed-library-alias', 'nativePartNames': ['fictional-coil'],
               'drawing': {'url': 'https://example.invalid/invented.pdf', 'sha256': 'a'*64, 'page': 1, 'matchEvidence': 'Authored synthetic drawing declaration.'},
               'body': {'widthMm': 2.4, 'heightMm': 4.2, 'offsetAlongMm': 0, 'offsetAcrossMm': 0},
               'electrode': {'widthMm': 1.2, 'heightMm': .8, 'centerSeparationMm': 3, 'minimumOverlapFraction': .9},
               'padPinMap': {'1': '1', '2': '2'}, 'seedPartId': '7', 'seedMasterKey': '8', 'bodyWindowId': '20', 'terminalWindowId': '21'}
    return ET.tostring(j), ET.tostring(m), raw, profile


class ConstructorTests(unittest.TestCase):
    def test_cardinals_both_pattern_axes_nonzero_body_origins_and_independent_world_reconstruction(self):
        for angle in (0, 90, 180, 270, 360, -90):
            for axis in (0, 90):
                with self.subTest(angle=angle, axis=axis):
                    job, master, pcb, profile = fixture(angle, pad_axis=axis)
                    plan = automatic_plan(job, master, pcb, [profile])
                    item = next(i for i in plan['items'] if i['reference'] == 'N1')
                    self.assertEqual(item['status'], 'ready-for-review', item.get('reason'))
                    self.assertEqual(item['dependencies']['windowPreparation'], 'constructed-body-terminal-geometry')
                    recipe = {**plan, 'accepted': [item['digest']]}
                    output = apply_preparation(job, master, pcb, recipe, recipe_digest(recipe))
                    p = ET.fromstring(output['job']).findall('PartDataList/PartData')[-1]
                    model = ET.fromstring(output['master']).findall('PartDataList/PartData')[-1]
                    windows = ET.fromstring(output['master']).findall('WindowDataList/WindowData')[-3:]
                    c, s = math.cos(math.radians(angle)), math.sin(math.radians(angle))
                    self.assertAlmostEqual(float(p.findtext('Roi/cx')), 14+.3*c+.2*s, places=8)
                    self.assertAlmostEqual(float(p.findtext('Roi/cy')), -11+.3*s-.2*c, places=8)
                    for w, (x,y) in zip(windows[1:], [(-1.2,-.2),(1.8,-.2)] if axis == 0 else [(.3,-1.7),(.3,1.3)]):
                        lx, ly = float(w.findtext('RelRoi/cx')), float(w.findtext('RelRoi/cy'))
                        self.assertAlmostEqual(float(p.findtext('Roi/cx'))+lx*c-ly*s,14+x*c-y*s,places=8)
                        self.assertAlmostEqual(float(p.findtext('Roi/cy'))+lx*s+ly*c,-11+x*s+y*c,places=8)
                    self.assertEqual(model.findtext('DRun'), '0')
                    self.assertEqual(model.findtext('ModelNo'), '0')
                    self.assertEqual(model.findtext('Roi/cx'), p.findtext('Roi/cx'))
                    self.assertFalse(p.findtext('WND_PAD'))
                    self.assertEqual(p.findtext('ENABLE'), 'False')
                    self.assertTrue(all(w.findtext('ENABLE') == 'False' and not len(w.find('AlgorithmDataList')) for w in windows))
                    self.assertEqual(len(windows), 3)
                    for role, original in [('job',job),('master',master)]:
                        recovered = output[role]
                        for change in item['changes']:
                            if change['document'] == role:
                                recovered = recovered.replace(change['afterXml'].encode(),b'',1)
                        self.assertEqual(recovered,original)

    def test_drawing_body_offset_rotates_and_terminal_lands_remain_fixed(self):
        for angle in (0,90,180,270):
            job, master, pcb, profile = fixture(angle)
            profile['body']['offsetAlongMm'] = .04
            profile['body']['offsetAcrossMm'] = -.03
            plan = automatic_plan(job, master, pcb, [profile])
            item = next(i for i in plan['items'] if i['reference']=='N1')
            self.assertEqual(item['status'],'ready-for-review')
            self.assertAlmostEqual(item['basis']['sourceBodyOriginMm'][0],.34)
            self.assertAlmostEqual(item['basis']['sourceBodyOriginMm'][1],-.23)
            self.assertAlmostEqual(item['basis']['terminalGeometry'][0]['cx'],-1.54)
            self.assertAlmostEqual(item['basis']['terminalGeometry'][0]['cy'],.03)

    def test_stale_profiles_unknown_fields_bad_pins_drawings_angles_and_controls_refuse(self):
        job, master, pcb, profile = fixture()
        for field, value in [('attachedPatternName','wrong'),('nativePartNames',['wrong']),('padPinMap',{'1':'2','2':'1'})]:
            p = deepcopy(profile); p[field] = value
            item = next(i for i in automatic_plan(job, master, pcb, [p])['items'] if i['reference']=='N1')
            self.assertEqual(item['status'],'held')
        p=deepcopy(profile);p['electrode']['centerSeparationMm']=30
        self.assertEqual(next(i for i in automatic_plan(job,master,pcb,[p])['items'] if i['reference']=='N1')['code'],'PACKAGE_DRAWING_LAND_MISMATCH')
        for p in [{**profile,'extra':0},{**profile,'body':{**profile['body'],'widthMm':float('nan')}}, {**profile,'drawing':{**profile['drawing'],'sha256':'wrong'}}]:
            with self.assertRaises(CaptureBlocked):validate_profiles([p])
        for angle in (45,91):
            j,m,b,p=fixture(angle)
            self.assertEqual(next(i for i in automatic_plan(j,m,b,[p])['items'] if i['reference']=='N1')['code'],'PACKAGE_ORIENTATION')
        plan=automatic_plan(job,master,pcb,[profile]);item=next(i for i in plan['items'] if i['reference']=='N1')
        recipe={**plan,'accepted':[item['digest']]}
        altered=deepcopy(recipe);altered['packageProfiles'][0]['body']['widthMm']+=.1
        with self.assertRaises(CaptureBlocked):apply_preparation(job,master,pcb,altered,recipe_digest(altered))
        out=apply_preparation(job,master,pcb,recipe,recipe_digest(recipe))
        with self.assertRaises(CaptureBlocked):apply_preparation(out['job'],out['master'],pcb,recipe,recipe_digest(recipe))
        j=ET.fromstring(job)
        for cp in j.findall('CadData/CpList/Cp'):
            if cp.findtext('RefID') in {'C3','C4'}:cp.find('X').text='999'
        self.assertEqual(next(i for i in automatic_plan(ET.tostring(j),master,pcb,[profile])['items'] if i['reference']=='N1')['code'],'PACKAGE_NATIVE_FRAME')

    def test_ambiguous_profile_and_unknown_native_dependencies_refuse(self):
        j,m,b,p=fixture()
        with self.assertRaises(CaptureBlocked):automatic_plan(j,m,b,[p,{**p,'id':'other'}])
        root=ET.fromstring(m);ET.SubElement(root.find('PartDataList/PartData'),'UnknownAsset').text='opaque'
        item=next(i for i in automatic_plan(j,ET.tostring(root),b,[p])['items'] if i['reference']=='N1')
        self.assertEqual(item['code'],'PREPARATION_SCHEMA')


if __name__ == '__main__':
    unittest.main()
