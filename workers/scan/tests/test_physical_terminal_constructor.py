"""Invented six-land, five-lead optocoupler; no manufacturing fixture data."""
from collections import Counter
from copy import deepcopy
from hashlib import sha256
import math
import unittest
from xml.etree import ElementTree as ET

from workers.scan.accel_ascii import _parse, AccelLimits
from workers.scan.native_preparation import automatic_plan, apply_preparation, recipe_digest
from workers.scan.paired_terminal_constructor import validate_profiles
from workers.scan.snapshot_capture import CaptureBlocked
from workers.scan.tests.test_three_terminal_constructor import fixture as three_fixture, replace_node


def fixture(angle=0, package_rotation=0, offset=(.41,-.23)):
    j,m,b,p=three_fixture(angle,package_rotation,offset)
    r=math.radians(package_rotation);c,s=round(math.cos(r)),round(math.sin(r));ox,oy=offset
    points=[(-1.6,-2.6),(0,-2.6),(1.6,-2.6),(1.6,2.6),(0,2.6),(-1.6,2.6)]
    pads=''.join(f'(pad (padNum {i+1}) (padStyleRef "coil-pad") (pt {ox+x*c-y*s} {oy+x*s+y*c}) (rotation {package_rotation}))' for i,(x,y) in enumerate(points))
    w,h=(3.2,4.4) if package_rotation%180 else (4.4,3.2)
    vs=[(ox-w/2,oy-h/2),(ox+w/2,oy-h/2),(ox+w/2,oy+h/2),(ox-w/2,oy+h/2)]
    lines=''.join(f'(line (pt {x} {y}) (pt {a} {z}) (width .1))' for (x,y),(a,z) in zip(vs,vs[1:]+vs[:1]))
    b=replace_node(b,b'(patternDefExtended "invented-coil"',f'(patternDefExtended "invented-coil" (patternGraphicsDef (patternGraphicsNameDef "land") (multiLayer {pads}) (layerContents (layerNumRef 21) {lines})))')
    pinmap=''.join(f'(padNum {i}) (compPinRef {i})' for i in range(1,7));pins=''.join(f'(compPin "{i}")' for i in range(1,7))
    b=replace_node(b,b'(compDef "coil-def"',f'(compDef "coil-def" {pins} (attachedPattern (patternName "reviewed-library-alias") (numPads 6) (padPinMap {pinmap})))')
    ast,_=_parse(b.decode(),AccelLimits(),Counter());definition=next(n for n in ast.all('library')[0].all('patternDefExtended') if n.args==['invented-coil'])
    paths=[n.path for n in definition.all('patternGraphicsDef')[0].all('layerContents')[0].all('line')]
    e={**p['polarity']['evidence'],'layoutSha256':sha256(b).hexdigest(),'statement':'Invented numbered drawing has physical leads 1,3,4,5,6 and no physical lead 2.'}
    p.update(kind='numbered-physical-terminal-body-v1',body={'widthMm':4.4,'heightMm':3.2,'minWidthMm':4.3,'maxWidthMm':4.5,'minHeightMm':3.1,'maxHeightMm':3.3},
             padPinMap={str(i):str(i) for i in range(1,7)},anchor={'layerNumber':'21','linePaths':paths,'evidence':deepcopy(e)},
             polarity={'pinRoles':{'1':'anode','2':'no-physical-lead','3':'cathode','4':'ground','5':'output','6':'supply'},'evidence':deepcopy(e)},
             absenceEvidence={'2':deepcopy(e)},pin1={'pin':'1','evidence':deepcopy(e)},
             electrodes=[{'pin':str(i+1),'centerXmm':x,'centerYmm':y,'widthMm':.5,'heightMm':.7,'minimumOverlapFraction':.9} for i,(x,y) in enumerate(points) if i!=1])
    return j,m,b,p


class PhysicalTerminalTests(unittest.TestCase):
    def test_cardinal_frames_nonzero_origins_absent_land_and_exact_rollback(self):
        for a in (0,90,180,270,360,-90):
            for rotation in (0,90,180,270):
                with self.subTest(angle=a,packageRotation=rotation):
                    j,m,b,p=fixture(a,rotation);plan=automatic_plan(j,m,b,[p]);i=next(i for i in plan['items'] if i['reference']=='N1')
                    self.assertEqual(i['status'],'ready-for-review',i.get('reason'));self.assertEqual(len(i['changes']),8)
                    self.assertEqual([r['pin'] for r in i['dependencies']['windowRoles'][1:]],['1','3','4','5','6'])
                    self.assertEqual(i['dependencies']['groupIds'],['1','2','3','4','5','6'])
                    absent=i['dependencies']['unrepresentedSourceLands'];self.assertEqual(len(absent),1);self.assertEqual(absent[0]['padNumber'],'2')
                    self.assertFalse(absent[0]['nativeWindowCreated']);self.assertTrue(absent[0]['sourceGeometryPreserved']);self.assertFalse(absent[0]['componentExcluded'])
                    recipe={**plan,'accepted':[i['digest']]};out=apply_preparation(j,m,b,recipe,recipe_digest(recipe))
                    part=ET.fromstring(out['job']).findall('PartDataList/PartData')[-1];ws=ET.fromstring(out['master']).findall('WindowDataList/WindowData')[-6:]
                    self.assertEqual(part.findtext('ENABLE'),'False');self.assertFalse(part.findtext('WND_PAD'));self.assertTrue(all(w.findtext('ENABLE')=='False' and not len(w.find('AlgorithmDataList')) for w in ws))
                    c,s=math.cos(math.radians(a)),math.sin(math.radians(a));rc,rs=math.cos(math.radians(rotation)),math.sin(math.radians(rotation))
                    for w,(x,y) in zip(ws[1:],[(-1.6,-2.6),(1.6,-2.6),(1.6,2.6),(0,2.6),(-1.6,2.6)]):
                        px,py=.41+x*rc-y*rs,-.23+x*rs+y*rc;lx,ly=float(w.findtext('RelRoi/cx')),float(w.findtext('RelRoi/cy'))
                        self.assertAlmostEqual(float(part.findtext('Roi/cx'))+lx*c-ly*s,14+px*c-py*s)
                        self.assertAlmostEqual(float(part.findtext('Roi/cy'))+lx*s+ly*c,-11+px*s+py*c)
                    for role,original in [('job',j),('master',m)]:
                        recovered=out[role]
                        for ch in i['changes']:
                            if ch['document']==role:recovered=recovered.replace(ch['afterXml'].encode(),b'',1)
                        self.assertEqual(recovered,original)
                    with self.assertRaises(CaptureBlocked):apply_preparation(out['job'],out['master'],b,recipe,recipe_digest(recipe))

    def test_missing_absence_pin1_wrong_numbering_geometry_and_stale_evidence_refuse(self):
        j,m,b,p=fixture(90,270)
        for mutate in [lambda p:p.update(absenceEvidence={}),lambda p:p.update(pin1={'pin':'2','evidence':p['pin1']['evidence']}),lambda p:p['electrodes'].append({**p['electrodes'][0],'pin':'2'}),lambda p:p['polarity']['pinRoles'].update({'2':'no-connection'}),lambda p:p['electrodes'][-1].update(widthMm=float('nan')),lambda p:p.update(extra=True)]:
            q=deepcopy(p);mutate(q)
            with self.assertRaises(CaptureBlocked):validate_profiles([q])
        for mutate,code in [
            (lambda p:p['absenceEvidence']['2'].update(layoutSha256='f'*64),'PACKAGE_EVIDENCE_STALE'),
            (lambda p:p['pin1']['evidence'].update(sha256='f'*64),'PACKAGE_EVIDENCE_STALE'),
            (lambda p:p.update(packageRotationDegrees=90),'PACKAGE_DRAWING_LAND_MISMATCH'),
            (lambda p:p.update(padPinMap={'1':'3','2':'2','3':'1','4':'4','5':'5','6':'6'}),'PACKAGE_PIN_MAP')]:
            q=deepcopy(p);mutate(q);i=next(i for i in automatic_plan(j,m,b,[q])['items'] if i['reference']=='N1')
            self.assertEqual(i['code'],code);self.assertNotIn('changes',i)


if __name__=='__main__':unittest.main()
