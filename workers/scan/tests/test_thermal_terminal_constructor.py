"""Invented ten-terminal package; no customer part or board geometry."""
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


def fixture(angle=0, package_rotation=0, offset=(.43,-.31), edges=3):
    j,m,b,p=three_fixture(angle,package_rotation,offset)
    r=math.radians(package_rotation);c,s=round(math.cos(r)),round(math.sin(r));ox,oy=offset
    points=[(-3.1,y) for y in (2.8,1.4,0,-1.4,-2.8)]+[(3.1,y) for y in (-2.8,-1.4,0,1.4,2.8)]+[(0,0)]
    pads=''.join(f'(pad (padNum {i+1}) (padStyleRef "'+('thermal-pad' if i==10 else 'coil-pad')+f'") (pt {ox+x*c-y*s} {oy+x*s+y*c}) (rotation {package_rotation}))' for i,(x,y) in enumerate(points))
    w,h=(7.4,6.8) if package_rotation%180 else (6.8,7.4)
    vs=[(ox-w/2,oy-h/2),(ox-w/2,oy+h/2),(ox+w/2,oy+h/2),(ox+w/2,oy-h/2)]
    lines=''.join(f'(line (pt {x} {y}) (pt {a} {z}) (width .1))' for (x,y),(a,z) in list(zip(vs,vs[1:]+vs[:1]))[:edges])
    b=replace_node(b,b'(patternDefExtended "invented-coil"',f'(patternDefExtended "invented-coil" (patternGraphicsDef (patternGraphicsNameDef "land") (multiLayer {pads}) (layerContents (layerNumRef 21) {lines})))')
    pos=b.index(b'(padStyleDef');b=b[:pos]+b'(padStyleDef "thermal-pad" (holeDiam 0) (padShape (layerNumRef 1) (padShapeType Rect) (shapeWidth 2.0) (shapeHeight 2.4)))'+b[pos:]
    pinmap=''.join(f'(padNum {i}) (compPinRef {i})' for i in range(1,12));pins=''.join(f'(compPin "{i}")' for i in range(1,12))
    b=replace_node(b,b'(compDef "coil-def"',f'(compDef "coil-def" {pins} (attachedPattern (patternName "reviewed-library-alias") (numPads 11) (padPinMap {pinmap})))')
    ast,_=_parse(b.decode(),AccelLimits(),Counter());definition=next(n for n in ast.all('library')[0].all('patternDefExtended') if n.args==['invented-coil'])
    paths=[n.path for n in definition.all('patternGraphicsDef')[0].all('layerContents')[0].all('line')]
    e={**p['polarity']['evidence'],'layoutSha256':sha256(b).hexdigest(),'statement':'Authored numbered top view: ten external terminals and one distinct hidden underside thermal pad.'}
    p.update(kind='numbered-external-terminal-thermal-body-v1',body={'widthMm':6.8,'heightMm':7.4,'minWidthMm':6.7,'maxWidthMm':6.9,'minHeightMm':7.3,'maxHeightMm':7.5},
             padPinMap={str(i):str(i) for i in range(1,12)},anchor={'layerNumber':'21','linePaths':paths,'edgeCount':edges,'evidence':deepcopy(e)},
             polarity={'pinRoles':{str(i):'external-terminal' if i<11 else 'underside-thermal-pad' for i in range(1,12)},'evidence':deepcopy(e)},pin1={'pin':'1','evidence':deepcopy(e)},
             electrodes=[{'pin':str(i+1),'centerXmm':x,'centerYmm':y,'widthMm':.5,'heightMm':.7,'minimumOverlapFraction':.9} for i,(x,y) in enumerate(points[:10])],
             thermalPads=[{'pin':'11','centerXmm':0,'centerYmm':0,'widthMm':1.8,'heightMm':2.2,'minimumOverlapFraction':.9,'evidence':deepcopy(e)}])
    return j,m,b,p


class ThermalTerminalTests(unittest.TestCase):
    def test_cardinal_frames_nonzero_offsets_open_and_closed_body_hidden_pad_and_rollback(self):
        for a in (0,90,180,270,360,-90):
            for rot in (0,90,180,270):
                with self.subTest(angle=a,packageRotation=rot):
                    j,m,b,p=fixture(a,rot);plan=automatic_plan(j,m,b,[p]);i=next(i for i in plan['items'] if i['reference']=='N1')
                    self.assertEqual(i['status'],'ready-for-review',i.get('reason'));dep=i['dependencies']
                    self.assertEqual([r['pin'] for r in dep['windowRoles'][1:]],[str(n) for n in range(1,11)])
                    self.assertTrue(all(r['opticallyInspectable'] is None for r in dep['windowRoles'][1:]))
                    thermal=dep['thermalPads'][0];self.assertEqual(thermal['pin'],'11');self.assertFalse(thermal['nativeWindowCreated']);self.assertFalse(thermal['opticallyInspectable']);self.assertFalse(thermal['componentExcluded'])
                    self.assertIn('hidden-joint-coverage-requires-separate-inspection-method-or-approved-coverage-decision',i['remaining'])
                    recipe={**plan,'accepted':[i['digest']]};out=apply_preparation(j,m,b,recipe,recipe_digest(recipe));part=ET.fromstring(out['job']).findall('PartDataList/PartData')[-1];ws=ET.fromstring(out['master']).findall('WindowDataList/WindowData')[-11:]
                    self.assertEqual(part.findtext('ENABLE'),'False');self.assertFalse(part.findtext('WND_PAD'));self.assertTrue(all(w.findtext('ENABLE')=='False' and not len(w.find('AlgorithmDataList')) for w in ws));self.assertEqual(len(i['changes']),13)
                    c,s=math.cos(math.radians(a)),math.sin(math.radians(a));rc,rs=math.cos(math.radians(rot)),math.sin(math.radians(rot))
                    points=[(-3.1,y) for y in (2.8,1.4,0,-1.4,-2.8)]+[(3.1,y) for y in (-2.8,-1.4,0,1.4,2.8)]
                    for w,(x,y) in zip(ws[1:],points):
                        px,py=.43+x*rc-y*rs,-.31+x*rs+y*rc;lx,ly=float(w.findtext('RelRoi/cx')),float(w.findtext('RelRoi/cy'))
                        self.assertAlmostEqual(float(part.findtext('Roi/cx'))+lx*c-ly*s,14+px*c-py*s);self.assertAlmostEqual(float(part.findtext('Roi/cy'))+lx*s+ly*c,-11+px*s+py*c)
                    for role,original in [('job',j),('master',m)]:
                        recovered=out[role]
                        for ch in i['changes']:
                            if ch['document']==role:recovered=recovered.replace(ch['afterXml'].encode(),b'',1)
                        self.assertEqual(recovered,original)
                    with self.assertRaises(CaptureBlocked):apply_preparation(out['job'],out['master'],b,recipe,recipe_digest(recipe))
        j,m,b,p=fixture(edges=4);self.assertEqual(next(i for i in automatic_plan(j,m,b,[p])['items'] if i['reference']=='N1')['status'],'ready-for-review')

    def test_malformed_source_body_frames_refuse_even_with_fresh_evidence(self):
        for line in ('(line (pt 0 0) (pt 1 1) (width .1))', '(line (pt 0 0) (pt 0 1) (width .1))'):
            j,m,b,p=fixture();b=replace_node(b,b'(line ',line)
            for e in [p['anchor']['evidence'],p['polarity']['evidence'],p['pin1']['evidence'],p['thermalPads'][0]['evidence']]:e['layoutSha256']=sha256(b).hexdigest()
            i=next(i for i in automatic_plan(j,m,b,[p])['items'] if i['reference']=='N1')
            self.assertEqual(i['code'],'PACKAGE_BODY_DATUM');self.assertNotIn('changes',i)

    def test_unsafe_thermal_roles_pin1_stale_evidence_and_body_geometry_refuse(self):
        j,m,b,p=fixture(90,270)
        for mutate in [lambda p:p.update(thermalPads=[]),lambda p:p['thermalPads'][0].update(opticallyInspectable=True),lambda p:p['electrodes'].append({k:v for k,v in p['thermalPads'][0].items() if k!='evidence'}),lambda p:p['pin1'].update(pin='11'),lambda p:p['anchor'].update(edgeCount=2),lambda p:p['anchor']['linePaths'].pop(),lambda p:p['thermalPads'][0].update(widthMm=float('nan'))]:
            q=deepcopy(p);mutate(q)
            with self.assertRaises(CaptureBlocked):validate_profiles([q])
        for mutate,code in [(lambda p:p['thermalPads'][0]['evidence'].update(layoutSha256='f'*64),'PACKAGE_EVIDENCE_STALE'),(lambda p:p['pin1']['evidence'].update(sha256='f'*64),'PACKAGE_EVIDENCE_STALE'),(lambda p:p.update(packageRotationDegrees=90),'PACKAGE_DRAWING_LAND_MISMATCH'),(lambda p:p['thermalPads'][0].update(centerXmm=3),'PACKAGE_DRAWING_LAND_MISMATCH'),(lambda p:p['body'].update(widthMm=8,minWidthMm=7.9,maxWidthMm=8.1),'PACKAGE_BODY_DRAWING_MISMATCH')]:
            q=deepcopy(p);mutate(q);i=next(i for i in automatic_plan(j,m,b,[q])['items'] if i['reference']=='N1');self.assertEqual(i['code'],code);self.assertNotIn('changes',i)


if __name__=='__main__':unittest.main()
