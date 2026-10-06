"""Invented three-lead package; no supplied manufacturing geometry or identities."""
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
from workers.scan.tests.test_paired_terminal_constructor import fixture as pair_fixture


def replace_node(raw, start, replacement):
    i = raw.index(start); depth = 0
    for j in range(i, len(raw)):
        depth += (raw[j:j+1] == b'(') - (raw[j:j+1] == b')')
        if depth == 0:
            return raw[:i]+replacement.encode()+raw[j+1:]
    raise AssertionError('Invented node not closed')


def fixture(angle=0, package_rotation=0, offset=(.37,-.29)):
    j,m,b,p = pair_fixture(angle)
    r=math.radians(package_rotation);c,s=round(math.cos(r)),round(math.sin(r))
    ox,oy=offset
    points=[(-1.2,-1.4),(1.2,-1.4),(0,1.4)]
    pads=''.join(f'(pad (padNum {i+1}) (padStyleRef "coil-pad") (pt {ox+x*c-y*s} {oy+x*s+y*c}) (rotation {package_rotation}))' for i,(x,y) in enumerate(points))
    w,h=(1.8,3.6) if package_rotation%180 else (3.6,1.8)
    vertices=[(ox-w/2,oy-h/2),(ox+w/2,oy-h/2),(ox+w/2,oy+h/2),(ox-w/2,oy+h/2)]
    lines=''.join(f'(line (pt {x} {y}) (pt {a} {z}) (width .1))' for (x,y),(a,z) in zip(vertices,vertices[1:]+vertices[:1]))
    graph=f'(patternDefExtended "invented-coil" (patternGraphicsDef (patternGraphicsNameDef "land") (multiLayer {pads}) (layerContents (layerNumRef 21) {lines})))'
    b=replace_node(b,b'(patternDefExtended "invented-coil"',graph)
    b=replace_node(b,b'(compDef "coil-def"','(compDef "coil-def" (compPin "1") (compPin "2") (compPin "3") (attachedPattern (patternName "reviewed-library-alias") (numPads 3) (padPinMap (padNum 1) (compPinRef 1) (padNum 2) (compPinRef 2) (padNum 3) (compPinRef 3))))')
    ast,_=_parse(b.decode(),AccelLimits(),Counter())
    definition=next(n for n in ast.all('library')[0].all('patternDefExtended') if n.args==['invented-coil'])
    paths=[n.path for n in definition.all('patternGraphicsDef')[0].all('layerContents')[0].all('line')]
    evidence={'documentId':'authored-numbered-package','sha256':'a'*64,'page':1,'locator':'Authored top view and dimensions','statement':'Explicit synthetic top-view pin numbering and body rectangle correspondence.','layoutSha256':sha256(b).hexdigest(),'method':'manufacturer-package-correspondence'}
    p.pop('electrode')
    p.update(kind='polarized-three-terminal-body-v1',body={'widthMm':3.6,'heightMm':1.8,'minWidthMm':3.5,'maxWidthMm':3.7,'minHeightMm':1.7,'maxHeightMm':1.9},
             anchor={'layerNumber':'21','linePaths':paths,'evidence':deepcopy(evidence)},polarity={'pinRoles':{'1':'anode','2':'no-connection','3':'cathode'},'evidence':deepcopy(evidence)},
             padPinMap={'1':'1','2':'2','3':'3'},packageRotationDegrees=package_rotation,
             electrodes=[{'pin':str(i+1),'centerXmm':x,'centerYmm':y,'widthMm':.5,'heightMm':.7,'minimumOverlapFraction':.9} for i,(x,y) in enumerate(points)])
    return j,m,b,p


class ThreeTerminalTests(unittest.TestCase):
    def test_cardinals_numbered_drawing_rotations_nonzero_origins_linked_records_and_rollback(self):
        for angle in (0,90,180,270,360,-90):
            for rotation in (0,90,180,270):
                with self.subTest(angle=angle,packageRotation=rotation):
                    j,m,b,p=fixture(angle,rotation)
                    plan=automatic_plan(j,m,b,[p]);i=next(i for i in plan['items'] if i['reference']=='N1')
                    self.assertEqual(i['status'],'ready-for-review',i.get('reason'))
                    self.assertEqual(i['dependencies']['groupIds'],['1','2','3','4'])
                    self.assertEqual([r.get('terminalRole') for r in i['dependencies']['windowRoles'][1:]],['anode','no-connection','cathode'])
                    recipe={**plan,'accepted':[i['digest']]};out=apply_preparation(j,m,b,recipe,recipe_digest(recipe))
                    part=ET.fromstring(out['job']).findall('PartDataList/PartData')[-1]
                    windows=ET.fromstring(out['master']).findall('WindowDataList/WindowData')[-4:]
                    a=math.radians(angle);c,s=math.cos(a),math.sin(a)
                    self.assertAlmostEqual(float(part.findtext('Roi/cx')),14+.37*c+.29*s)
                    self.assertAlmostEqual(float(part.findtext('Roi/cy')),-11+.37*s-.29*c)
                    self.assertEqual(part.findtext('ENABLE'),'False');self.assertFalse(part.findtext('WND_PAD'))
                    self.assertTrue(all(w.findtext('ENABLE')=='False' and not len(w.find('AlgorithmDataList')) for w in windows))
                    for role,raw in [('job',j),('master',m)]:
                        recovered=out[role]
                        for change in i['changes']:
                            if change['document']==role:recovered=recovered.replace(change['afterXml'].encode(),b'',1)
                        self.assertEqual(recovered,raw)
                    for w,t in zip(windows[1:],i['basis']['terminalGeometry']):
                        self.assertAlmostEqual(float(w.findtext('RelRoi/cx')),t['cx'])
                        self.assertAlmostEqual(float(w.findtext('RelRoi/cy')),t['cy'])
                    r=math.radians(rotation);rc,rs=math.cos(r),math.sin(r)
                    for w,(x,y) in zip(windows[1:],[(-1.2,-1.4),(1.2,-1.4),(0,1.4)]):
                        px,py=.37+x*rc-y*rs,-.29+x*rs+y*rc
                        lx,ly=float(w.findtext('RelRoi/cx')),float(w.findtext('RelRoi/cy'))
                        self.assertAlmostEqual(float(part.findtext('Roi/cx'))+lx*c-ly*s,14+px*c-py*s)
                        self.assertAlmostEqual(float(part.findtext('Roi/cy'))+lx*s+ly*c,-11+px*s+py*c)
                    with self.assertRaises(CaptureBlocked):apply_preparation(out['job'],out['master'],b,recipe,recipe_digest(recipe))

    def test_wrong_body_marks_frames_numbering_missing_nc_and_stale_evidence_refuse(self):
        j,m,b,p=fixture(90,270)
        for mutate,code in [
            (lambda p:p['anchor'].update(layerNumber='22'),'PACKAGE_BODY_DATUM'),
            (lambda p:p['anchor'].update(linePaths=[s.replace('/line[1]','/line[99]') for s in p['anchor']['linePaths']]),'PACKAGE_BODY_DATUM'),
            (lambda p:p.update(packageRotationDegrees=90),'PACKAGE_DRAWING_LAND_MISMATCH'),
            (lambda p:p['anchor']['evidence'].update(layoutSha256='f'*64),'PACKAGE_EVIDENCE_STALE'),
            (lambda p:p.update(padPinMap={'1':'2','2':'1','3':'3'}),'PACKAGE_PIN_MAP'),
            (lambda p:p.update(body={**p['body'],'widthMm':5,'minWidthMm':4.9,'maxWidthMm':5.1}),'PACKAGE_BODY_DRAWING_MISMATCH')]:
            q=deepcopy(p);mutate(q);i=next(i for i in automatic_plan(j,m,b,[q])['items'] if i['reference']=='N1')
            self.assertEqual(i['status'],'held');self.assertEqual(i['code'],code)
        for mutate in [lambda p:p['electrodes'].pop(),lambda p:p['polarity']['pinRoles'].update({'2':'no-physical-lead'}),lambda p:p['anchor']['linePaths'].pop(),lambda p:p.update(extra=True)]:
            q=deepcopy(p);mutate(q)
            with self.assertRaises(CaptureBlocked):validate_profiles([q])

    def test_open_disconnected_duplicate_and_unowned_body_graphics_cannot_supply_an_anchor(self):
        j,m,b,p=fixture()
        for wrong in [b.replace(b'(pt 2.17 -1.19)',b'(pt 2.18 -1.19)',1),
                      b.replace(b'(pt -1.4300000000000002 -1.19)',b'(pt -1.2 -1.19)',1)]:
            self.assertNotEqual(wrong,b,'Invented malformed-edge fixture must actually differ')
            q=deepcopy(p)
            for e in (q['anchor']['evidence'],q['polarity']['evidence']):e['layoutSha256']=sha256(wrong).hexdigest()
            item=next(i for i in automatic_plan(j,m,wrong,[q])['items'] if i['reference']=='N1')
            self.assertEqual(item['code'],'PACKAGE_BODY_DATUM')
        q=deepcopy(p);q['anchor']['linePaths'][0]=q['anchor']['linePaths'][0].replace('patternDefExtended[1]','patternDefExtended[2]')
        self.assertEqual(next(i for i in automatic_plan(j,m,b,[q])['items'] if i['reference']=='N1')['code'],'PACKAGE_BODY_DATUM')


if __name__=='__main__':unittest.main()
