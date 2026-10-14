import test from 'node:test';
import assert from 'node:assert/strict';
import { authoredMapping, sha } from './synthetic-image-registration.mjs';
import { photoRoi, canonicalImageRequest, checkedImageFit, imageRegistrationHolds, isPixelSimilarityMatrix, validateImageRegistrationRequest } from '../lib/scan/image-registration.ts';
import { validateVisualWorkspace, emptyVisualWorkspace } from '../lib/scan/visual-workspace.ts';
import { POST } from '../app/api/image-registration/route.ts';
const fixture=await authoredMapping(),r=fixture.state.request,p=fixture.review.preflight;
const request=value=>new Request('http://127.0.0.1:3226/api/image-registration',{method:'POST',headers:{origin:'http://127.0.0.1:3226',host:'127.0.0.1:3226','content-type':'application/json'},body:canonicalImageRequest(value)});
test('pixel similarity is separate from rigid native geometry and refuses shear, scale mismatch and unapproved mirror',()=>{
  for(const angle of [0,90,180,270,33])for(const sign of [1,-1]){const a=angle*Math.PI/180,c=Math.cos(a),s=Math.sin(a);assert.equal(isPixelSimilarityMatrix([[20*c,-20*s*sign,100],[20*s,20*c*sign,200]],sign),true);}
  for(const matrix of [[[20,1,100],[0,20,100]],[[20,0,100],[0,21,100]],[[20,0,100],[0,-20,100]],[[0,0,0],[0,0,0]],[[NaN,0,0],[0,20,0]]])assert.equal(isPixelSimilarityMatrix(matrix,1),false);
});
test('fresh source, exact image dimensions, stable identities and original literals bind controls; candidates are held',()=>{
  assert.deepEqual(imageRegistrationHolds(r,p,fixture.fixture.image),[]);
  for(const mutate of [x=>x.source.archiveSha256='a'.repeat(64),x=>x.source.masterSha256='b'.repeat(64),x=>x.source.nativeVersion='10.2',x=>x.image.width++,x=>x.image.sha256='c'.repeat(64),x=>x.points[0].identity.id='2',x=>x.points[0].identity.module='2',x=>x.points[0].identity.path='wrong',x=>x.points[0].beforeRoi.cx='9',x=>x.points[0].native[0]=8]){const next=structuredClone(r);mutate(next);assert.ok(imageRegistrationHolds(next,p,fixture.fixture.image).length);}
  assert.ok(imageRegistrationHolds(r,p,fixture.fixture.image,true).some(h=>h.includes('frame-equivalence')));
  const duplicate=structuredClone(p);duplicate.nativeRecords.job.records.push(structuredClone(p.nativeRecords.job.records.find(x=>x.kind==='part-record')));assert.ok(imageRegistrationHolds(r,duplicate,fixture.fixture.image).length);
});
test('saved evidence stores controls and review only; unknown fields, authority claims and malformed layers are refused',()=>{
  const view={...emptyVisualWorkspace(),imageRegistration:fixture.state};assert.equal(validateVisualWorkspace(view).imageRegistration.decision,'unreviewed');
  for(const mutate of [x=>x.imageRegistration.matrix=[[1,0,0],[0,1,0]],x=>x.imageRegistration.decision='machine-verified',x=>x.imageRegistration.request.image.width=50000,x=>x.imageRegistration.request.points[0].role='approved',x=>x.imageRegistration.request.conventions.distortion='affine']){const next=structuredClone(view);mutate(next);assert.throws(()=>validateVisualWorkspace(next));}
  assert.throws(()=>validateImageRegistrationRequest({...r,verified:true}));
});
test('real bounded image-fit API and independently reproduced receipt bind exact request; no native files modified',async()=>{
  const before=canonicalImageRequest(fixture),response=await POST(request(r));assert.equal(response.status,200);const fit=await response.json(),fingerprint=sha(Buffer.from(canonicalImageRequest(r)));
  assert.equal(checkedImageFit(fit,r,fingerprint).status,'success');assert.equal(fit.machineExportAllowed,false);assert.ok(fit.maxResidualPx<1e-9);assert.equal(canonicalImageRequest(fixture),before);
  for(const mutate of [x=>x.fingerprint='0'.repeat(64),x=>x.matrix[0][2]++,x=>x.residuals[3].residualPx=1,x=>x.residuals[3].role='fit',x=>x.pixelsPerMm=21,x=>x.machineExportAllowed=true,x=>x.maxResidualPx=9]){const next=structuredClone(fit);mutate(next);assert.throws(()=>checkedImageFit(next,r,fingerprint));}
  const bad=structuredClone(r);bad.points[3].pixel[0]+=10;const failed=await(await POST(request(bad))).json();assert.equal(checkedImageFit(failed,bad,sha(Buffer.from(canonicalImageRequest(bad)))).status,'blocked');assert.deepEqual(failed.matrix,fit.matrix);
  failed.status='success';failed.holds=[];assert.throws(()=>checkedImageFit(failed,bad,failed.fingerprint));
});
test('image-fit origin, request bounds, unknown conventions and missing independent feature remain held',async()=>{
  const foreign=request(r);foreign.headers.set('origin','https://example.com');assert.equal((await POST(foreign)).status,403);
  assert.equal((await POST(request({...r,extra:'unexpected'}))).status,400);
  for(const mutate of [x=>x.conventions.unit='unknown',x=>x.scope.imageRevision='different',x=>x.points[3].pixel=x.points[0].pixel,x=>x.points[2].native=[20,0]]){const next=structuredClone(r);mutate(next);assert.notEqual((await(await POST(request(next))).json()).status,'success');}
});

test('photo ROI handles arbitrary angles, explicit axes and nonzero origins without changing native geometry',()=>{
  for(const y of ['up','down'])for(const rotation of ['clockwise','counterclockwise'])for(const angle of [0,90,180,270,33]){
    const q=structuredClone(r);q.conventions.yDirection=y;q.conventions.roiAngle=rotation;
    const sign=y==='up'?-1:1,m=[[20,0,100],[0,20*sign,100]],e={x:12.75,y:-6.5,width:2,height:3,angle},before=structuredClone(e);
    const points=photoRoi(e,q,m).split(' ').map(s=>s.split(',').map(Number));
    assert.ok(Math.abs(points.reduce((n,p)=>n+p[0],0)/4-355)<1e-8);
    assert.ok(Math.abs(points.reduce((n,p)=>n+p[1],0)/4-(100-130*sign))<1e-8);
    assert.ok(Math.abs(Math.hypot(points[1][0]-points[0][0],points[1][1]-points[0][1])-40)<1e-8);
    assert.deepEqual(e,before);
  }
  assert.equal(photoRoi({x:0,y:0,width:2,height:3},r,[[20,0,100],[0,20,100]]),null);
});
