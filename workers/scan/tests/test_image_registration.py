"""Wholly authored similarity geometry; no real board control coordinates."""
import copy
import math
import unittest
from workers.scan.image_registration import fit_image_registration


def authored(angle=0, y='down', scale=20, offset=(100,100), origin=(0,0)):
    coordinates=[(0,0),(40,0),(0,30),(40,30)]
    a=math.radians(angle); c,s=math.cos(a),math.sin(a)
    points=[]
    for i,(x,n) in enumerate(coordinates):
        x+=origin[0]; n+=origin[1]; v=n*(-1 if y=='up' else 1)
        pixel=[scale*(x*c-v*s)+offset[0],scale*(x*s+v*c)+offset[1]]
        points.append({'id':str(i),'role':'check' if i==3 else 'fit','identity':{'module':'1'},'native':[x,n],'pixel':pixel,'beforeRoi':{'cx':str(x),'cy':str(n)},'evidence':'AUTHORED same physical center'})
    return {'scope':{'module':'1','physicalSide':'top','instance':'AUTHORED-A','nativeRevision':'AUTHORED-1','imageRevision':'AUTHORED-1'},'conventions':{'module':'1','physicalSide':'top','instance':'AUTHORED-A','unit':'mm','yDirection':y,'roiAngle':'clockwise','anchor':'native-roi-center','distortion':'uniform-similarity','evidence':'AUTHORED native/pixel conventions'},'image':{'width':6400,'height':4000},'nativeBounds':[origin[0],origin[1],origin[0]+40,origin[1]+30],'points':points,'tolerancePx':.1,'toleranceEvidence':'AUTHORED subpixel exact controls','scopeEvidence':'AUTHORED revision/side/instance','reviewer':'Synthetic fixture'}


class ImageRegistrationTest(unittest.TestCase):
    def test_cardinal_arbitrary_orientation_handedness_scale_nonzero_origin(self):
        for angle in (0,90,180,270,33):
            for y in ('up','down'):
                r=authored(angle,y,offset=(3000,2000),origin=(12.75,-6.5));before=copy.deepcopy(r)
                fit=fit_image_registration(r,'a'*64)
                self.assertEqual(fit['status'],'success');self.assertLess(fit['maxResidualPx'],1e-9)
                self.assertAlmostEqual(fit['pixelsPerMm'],20);self.assertEqual(r,before)
                self.assertFalse(fit['machineExportAllowed'])
        r=authored();r['conventions']['unit']='in'
        r['nativeBounds']=[v/25.4 for v in r['nativeBounds']]
        for point in r['points']:point['native']=[v/25.4 for v in point['native']]
        self.assertAlmostEqual(fit_image_registration(r,'a'*64)['pixelsPerMm'],20)

    def test_check_failure_never_changes_fit_or_becomes_registered(self):
        r=authored();expected=fit_image_registration(r,'b'*64)['matrix'];r['points'][3]['pixel'][0]+=12
        failed=fit_image_registration(r,'c'*64);self.assertEqual(failed['status'],'blocked')
        self.assertEqual(failed['matrix'],expected);self.assertFalse(failed['residuals'][3]['withinTolerance'])

    def test_unknown_wrong_side_instance_revision_distortion_and_unsanctioned_mirror(self):
        for field,value in [('unit','unknown'),('physicalSide','bottom'),('instance','OTHER'),('distortion','affine')]:
            r=authored();r['conventions'][field]=value
            with self.assertRaises(ValueError):fit_image_registration(r,'a'*64)
        r=authored(y='up',offset=(2000,2000));r['conventions']['yDirection']='down'
        with self.assertRaisesRegex(ValueError,'mirror'):fit_image_registration(r,'a'*64)
        r=authored();r['scope']['imageRevision']='OTHER'
        with self.assertRaises(ValueError):fit_image_registration(r,'a'*64)

    def test_collinear_reused_outside_controls_and_shear(self):
        r=authored();r['points'][2]['native']=[20,0];r['points'][2]['pixel']=[500,100]
        with self.assertRaisesRegex(ValueError,'collinear'):fit_image_registration(r,'a'*64)
        r=authored();r['points'][3]=copy.deepcopy(r['points'][0]);r['points'][3]['id']='independent';r['points'][3]['role']='check'
        with self.assertRaisesRegex(ValueError,'disjoint'):fit_image_registration(r,'a'*64)
        r=authored();r['points'][3]['pixel']=[-1,0]
        with self.assertRaises(ValueError):fit_image_registration(r,'a'*64)
        r=authored()
        for p in r['points']:p['pixel'][0]+=p['native'][1]*2
        self.assertEqual(fit_image_registration(r,'a'*64)['status'],'blocked')


if __name__=='__main__':unittest.main()
