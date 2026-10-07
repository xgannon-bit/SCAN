"""Invented body anchors and controlled serialization; no private board oracle."""
from collections import Counter
from copy import deepcopy
from hashlib import sha256
from pathlib import Path
import tempfile
import unittest
from xml.etree import ElementTree as ET
import zipfile

from workers.scan.accel_ascii import _parse, AccelLimits, read_accel
from workers.scan.native_preparation import automatic_plan, apply_preparation, recipe_digest
from workers.scan.preparation_intents import preparation_intents
from workers.scan.eagle_trial_compare import compare_trial
from workers.scan.snapshot_capture import CaptureBlocked
from workers.scan.paired_terminal_constructor import validate_profiles
from workers.scan.tests.test_paired_terminal_constructor import fixture


def anchored(angle=0, offset=(.3,-.2)):
    j,m,b,p=fixture(angle,offset)
    x,y=offset;w,h=4.2,2.4
    points=[(x-w/2,y-h/2),(x+w/2,y-h/2),(x+w/2,y+h/2),(x-w/2,y+h/2)]
    lines=''.join(f'(line (pt {a} {c}) (pt {d} {e}))' for (a,c),(d,e) in zip(points,points[1:]+points[:1]))
    b=b.replace(b'(patternGraphicsNameDef "land")',('(patternGraphicsNameDef "land") (layerContents (layerNumRef 21) '+lines+')').encode())
    ast,_=_parse(b.decode(),AccelLimits(),Counter());paths=[]
    def visit(n):
        if n.tag=='line':paths.append(n.path)
        for c in n.children:visit(c)
    visit(ast)
    p['bodyAnchor']={'layoutSha256':sha256(b).hexdigest(),'layerNumber':'21','linePaths':paths,'minWidthMm':4.1,'maxWidthMm':4.3,'minHeightMm':2.3,'maxHeightMm':2.5,'statement':'Wholly authored synthetic rectangle and symmetric electrode datum.'}
    return j,m,b,p


def ready(j,m,b,p):
    plan=automatic_plan(j,m,b,[p]);item=next(i for i in plan['items'] if i['reference']=='N1')
    return plan,item


class AnchoredConstructorTests(unittest.TestCase):
    def test_cardinals_nonzero_source_origins_and_exact_owned_datum(self):
        for a in (0,90,180,270):
            j,m,b,p=anchored(a);plan,i=ready(j,m,b,p)
            self.assertEqual(i['status'],'ready-for-review')
            self.assertEqual(i['basis']['bodyAnchorEvidence'],p['bodyAnchor'])
            for x,y in zip(i['basis']['sourceBodyOriginMm'],[.3,-.2]):self.assertAlmostEqual(x,y)
    def test_wrong_datum_bounds_center_paths_layer_and_source_refuse(self):
        j,m,b,p=anchored()
        for field,value,code in [('layoutSha256','b'*64,'PACKAGE_EVIDENCE_STALE'),('layerNumber','22','PACKAGE_BODY_DATUM'),('minWidthMm',4.25,'PACKAGE_BODY_DRAWING_MISMATCH')]:
            q=deepcopy(p);q['bodyAnchor'][field]=value
            self.assertEqual(ready(j,m,b,q)[1]['code'],code)
        q=deepcopy(p);q['body']['offsetAlongMm']=.03
        self.assertEqual(ready(j,m,b,q)[1]['code'],'PACKAGE_BODY_ANCHOR_MISMATCH')
        for change in [[],['/missing']*4,[{},'/2','/3','/4']]:
            q=deepcopy(p);q['bodyAnchor']['linePaths']=change
            with self.assertRaises(CaptureBlocked):validate_profiles([q])
    def test_quantized_import_within_one_quantum_holds_larger_errors(self):
        j,m,b,p=anchored();root=ET.fromstring(j)
        cp=next(c for c in root.findall('CadData/CpList/Cp') if c.findtext('RefID')=='N1')
        cp.find('Y').text='-10.9999'
        self.assertEqual(ready(ET.tostring(root),m,b,p)[1]['code'],'PACKAGE_NATIVE_FRAME')
        p['nativeCadQuantizationMm']=.0001
        plan,i=ready(ET.tostring(root),m,b,p);self.assertEqual(i['status'],'ready-for-review')
        self.assertFalse(i['basis']['nativeCadQuantization']['cadOrSourceCoordinatesChanged'])
        cp.find('Y').text='-10.9997';self.assertEqual(ready(ET.tostring(root),m,b,p)[1]['code'],'PACKAGE_NATIVE_FRAME')
        cp.find('Y').text='-10.99991';self.assertEqual(ready(ET.tostring(root),m,b,p)[1]['code'],'PACKAGE_NATIVE_FRAME')
    def test_explicit_scoped_fresh_route_does_not_capture_another_same_footprint(self):
        j,m,b,p=anchored();target=next(x for x in read_accel(b)['placements'] if x['refdes']=='N1')
        p['targetSourcePaths']=[target['sourcePath']]
        self.assertEqual(ready(j,m,b,p)[1]['status'],'ready-for-review')
        p['targetSourcePaths']=['/not-owned'];self.assertFalse(any(i.get('selection',{}).get('packageProfileId') for i in automatic_plan(j,m,b,[p])['items']))
        for value in [[],['/a','/a'],[None],['relative']]:
            p['targetSourcePaths']=value
            with self.assertRaises(CaptureBlocked):validate_profiles([p])
    def test_explicit_override_replaces_competing_template_only_for_selected_scope(self):
        j,m,b,p=anchored()
        b=b.replace(b'(patternRef "offset-test") (patternGraphicsNameRef "fictional") (refDesRef "T1")',b'(patternRef "invented-coil") (patternGraphicsNameRef "land") (refDesRef "T1")')
        b=b.replace(b'(compInst "T1" (compRef "invented"))',b'(compInst "T1" (compRef "coil-def"))')
        p['bodyAnchor']['layoutSha256']=sha256(b).hexdigest()
        with self.assertRaises(CaptureBlocked):automatic_plan(j,m,b,[p])
        p['targetSourcePaths']=[next(t['sourcePath'] for t in read_accel(b)['placements'] if t['refdes']=='N1')]
        plan,i=ready(j,m,b,p)
        self.assertEqual(i['status'],'ready-for-review')
        self.assertEqual(len([x for x in plan['items'] if x['reference']=='N1']),1)
        self.assertEqual(i['basis']['geometryRoute'],p['kind'])


class IntentsTests(unittest.TestCase):
    def test_fov_literal_inventory_never_becomes_coverage_or_membership(self):
        j,m,b,p=anchored();plan,i=ready(j,m,b,p);root=ET.fromstring(j)
        info=ET.SubElement(ET.SubElement(ET.SubElement(root,'FovSetInfo'),'Fov'),'FovInfo')
        ET.SubElement(info,'Id').text='44';ET.SubElement(info,'PathId').text='9';ET.SubElement(info,'C').text='23,17'
        r=preparation_intents(ET.tostring(root),m,b,[i]);f=r['nativeFovInventory']
        self.assertEqual(f['fovInfoRecords'],1);self.assertEqual(f['observedFovIdentities'][0]['idLiterals'],['44'])
        self.assertFalse(f['coordinateAndImageSemanticsQualified']);self.assertEqual(f['coverageAssignmentsProven'],0)
    def test_exact_owned_pin_window_intents_and_prospective_vs_actual_state(self):
        j,m,b,p=anchored(90);plan,i=ready(j,m,b,p)
        r=preparation_intents(j,m,b,[i])
        self.assertEqual(r['counts']['ownedTerminalBindingIntents'],2);self.assertFalse(r['recordsApplied'])
        self.assertEqual([x['pin'] for x in r['components'][0]['ownedTerminalBindingIntents']],['1','2'])
        recipe={**plan,'accepted':[i['digest']]};out=apply_preparation(j,m,b,recipe,recipe_digest(recipe))
        r=preparation_intents(out['job'],out['master'],b,[i],True)
        self.assertTrue(r['components'][0]['recordsApplied']);self.assertEqual(r['counts']['newNativeBindings'],0)
        self.assertFalse(r['components'][0]['fovPreparation']['nativeAssignmentWritten'])
        self.assertEqual(len(r['components'][0]['fovPreparation']['extents']),3)
        with self.assertRaises(CaptureBlocked):preparation_intents(j,m,b,[i],True)
    def test_tampered_owned_pin_window_and_applied_geometry_refuse(self):
        j,m,b,p=anchored();plan,i=ready(j,m,b,p)
        q=deepcopy(i);q['dependencies']['windowRoles'][1]['padNumber']='99'
        with self.assertRaises(CaptureBlocked):preparation_intents(j,m,b,[q])
        recipe={**plan,'accepted':[i['digest']]};out=apply_preparation(j,m,b,recipe,recipe_digest(recipe))
        root=ET.fromstring(out['job']);root.findall('PartDataList/PartData')[-1].find('Roi/cx').text='99'
        with self.assertRaises(CaptureBlocked):preparation_intents(ET.tostring(root),out['master'],b,[i],True)
    def test_absent_lead_and_hidden_thermal_are_not_binding_intents(self):
        from workers.scan.tests.test_physical_terminal_constructor import fixture as physical
        from workers.scan.tests.test_thermal_terminal_constructor import fixture as thermal
        for factory in (physical,thermal):
            j,m,b,p=factory();plan=automatic_plan(j,m,b,[p]);items=[i for i in plan['items'] if i['status']=='ready-for-review']
            r=preparation_intents(j,m,b,items);row=next(r for r in r['components'] if r['windowPreparation']=='constructed-body-terminal-geometry')
            self.assertTrue(row['unrepresentedSourceLands'] or row['thermalPads'])
            unrepresented={str(t.get('padNumber',t.get('pin'))) for t in row['unrepresentedSourceLands']+row['thermalPads']}
            self.assertFalse(unrepresented & {t['padNumber'] for t in row['ownedTerminalBindingIntents']})


class TrialComparisonTests(unittest.TestCase):
    def fixture(self,folder):
        j,m,b,p=anchored();plan,i=ready(j,m,b,p);recipe={**plan,'accepted':[i['digest']]};out=apply_preparation(j,m,b,recipe,recipe_digest(recipe))
        selection={'jobMember':'Fiction/main.xml','masterMember':'Fiction/Master/Master.xml'}
        target={k:i['dependencies'][k] for k in ('moduleId','partId','masterKey')};target['reference']='N1'
        def write(name,jraw=out['job'],mraw=out['master'],asset=b'unchanged'):
            path=folder/name
            with zipfile.ZipFile(path,'w') as z:
                z.writestr(selection['jobMember'],jraw);z.writestr(selection['masterMember'],mraw);z.writestr('Fiction/Temp/old.xml',j);z.writestr('Fiction/image.bin',asset)
            return path
        return out,selection,[target],write
    def test_identical_read_only_comparison_never_grants_qualification(self):
        with tempfile.TemporaryDirectory() as td:
            out,s,t,w=self.fixture(Path(td));before=w('before.zip');original=before.read_bytes()
            r=compare_trial(before,w('after.zip'),s,t,'open-save','invented-build')
            self.assertTrue(r['geometryRetainedForAllSelected']);self.assertFalse(r['qualificationGranted'])
            self.assertFalse(r['bindingSemanticsQualified']);self.assertEqual(before.read_bytes(),original)
    def test_one_binding_stage_captures_exact_fields_without_position_change(self):
        with tempfile.TemporaryDirectory() as td:
            out,s,t,w=self.fixture(Path(td));root=ET.fromstring(out['job']);root.findall('PartDataList/PartData')[-1].find('WND_PAD').text='2|919|0|0|1|2'
            r=compare_trial(w('before.zip'),w('after.zip',ET.tostring(root)),s,t,'one-binding','invented-build')
            self.assertTrue(r['parts'][0]['bindingChanged']);self.assertTrue(r['geometryRetainedForAllSelected']);self.assertFalse(r['bindingSemanticsQualified'])
    def test_moved_part_changed_asset_and_unrelated_native_work_are_visible(self):
        with tempfile.TemporaryDirectory() as td:
            out,s,t,w=self.fixture(Path(td));root=ET.fromstring(out['job']);root.findall('PartDataList/PartData')[-1].find('Roi/cx').text='999';root.findall('PartDataList/PartData')[0].find('Roi/w').text='999'
            r=compare_trial(w('before.zip'),w('after.zip',ET.tostring(root),asset=b'changed'),s,t,'one-teaching','invented-build')
            self.assertFalse(r['geometryRetainedForAllSelected']);self.assertGreaterEqual(len(r['nativeRecordChanges']['job']),2)
            self.assertTrue(any(a['member']=='Fiction/image.bin' for a in r['archiveMemberChanges']))
    def test_reference_master_identity_and_stage_must_match(self):
        with tempfile.TemporaryDirectory() as td:
            out,s,t,w=self.fixture(Path(td));path=w('before.zip');bad=deepcopy(t);bad[0]['reference']='wrong'
            for targets,stage,build in [(bad,'open-save','v'),(t,'uncontrolled','v'),(t,'open-save','')]:
                with self.assertRaises(CaptureBlocked):compare_trial(path,path,s,targets,stage,build)


if __name__=='__main__':unittest.main()
