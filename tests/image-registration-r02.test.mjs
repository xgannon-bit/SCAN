import test from 'node:test';
import assert from 'node:assert/strict';
import { authoredMapping, sha } from './synthetic-image-registration.mjs';
import { editImagePixel, pickImagePixel, imagePixelDraft, acceptImageReview, imageReviewHolds, imageRequestFingerprint, validateImageRegistrationState } from '../lib/scan/image-registration.ts';
import { validateVisualWorkspace, emptyVisualWorkspace } from '../lib/scan/visual-workspace.ts';
import { VerifiedRasterCache, rasterSourceIdentity } from '../lib/scan/raster-cache.ts';
const fixture=await authoredMapping();
test('IR-01 independent manual axes, clearing one, literal zero, picking and saved partial drafts',()=>{
  const initial=structuredClone(fixture.state);initial.request.points[0].pixel=null;const id=initial.request.points[0].id;
  for(const axis of [0,1]){const one=editImagePixel(initial,id,axis,'100');assert.equal(one.request.points[0].pixel,null);assert.equal(imagePixelDraft(one,id)[1-axis],'');assert.equal(validateImageRegistrationState(one).request.points[0].pixel,null);}
  let s=editImagePixel(initial,id,0,'0');s=editImagePixel(s,id,1,'100');assert.deepEqual(s.request.points[0].pixel,[0,100]);
  s=editImagePixel(s,id,1,'');assert.equal(s.request.points[0].pixel,null);assert.deepEqual(imagePixelDraft(s,id),['0','']);
  const restored=validateVisualWorkspace({...emptyVisualWorkspace(),imageRegistration:s}).imageRegistration;assert.deepEqual(imagePixelDraft(restored,id),['0','']);
  s=pickImagePixel(s,id,[100,200]);assert.deepEqual(s.request.points[0].pixel,[100,200]);assert.deepEqual(imagePixelDraft(s,id),['100','200']);
  s=editImagePixel(s,id,0,'-');assert.equal(s.request.points[0].pixel,null);
  const corrupt=structuredClone(s);corrupt.request.points[0].pixel=[0,200];assert.throws(()=>validateImageRegistrationState(corrupt),/draft/);
});
test('IR-02 exact review fingerprint/source/image binding; edited evidence and legacy/tampered decisions require re-review',async()=>{
  const fingerprint=await imageRequestFingerprint(fixture.state.request),s=acceptImageReview(fixture.state,fingerprint);assert.deepEqual(imageReviewHolds(s,fingerprint),[]);
  assert.deepEqual(imageReviewHolds(validateImageRegistrationState(JSON.parse(JSON.stringify(s))),fingerprint),[]);
  for(const mutate of [v=>v.request.points[0].evidence+=' changed',v=>v.request.toleranceEvidence+=' changed',v=>v.request.scope.instance='Other',v=>v.request.points[0].pixel[0]++,v=>v.review.requestSha256='0'.repeat(64)]){
    const changed=structuredClone(s);mutate(changed);assert.ok(imageReviewHolds(changed,await imageRequestFingerprint(changed.request)).length);
  }
  for(const mutate of [v=>v.review.source.packageSha256='a'.repeat(64),v=>v.review.image.sha256='b'.repeat(64),v=>v.request.reviewer='Someone else']){const x=structuredClone(s);mutate(x);assert.equal(validateImageRegistrationState(x).decision,'unreviewed');}
  const legacy={version:1,decision:'reviewed',request:fixture.state.request};const restored=validateImageRegistrationState(legacy);assert.equal(restored.decision,'unreviewed');assert.equal(restored.reviewHold,'legacy-unbound');assert.equal(legacy.decision,'reviewed');
  const edited=editImagePixel(s,s.request.points[0].id,0,'100');assert.equal(edited.decision,'unreviewed');assert.equal(edited.reviewHold,'changed-request');
  const forged=structuredClone(s);forged.review.machineVerified=true;assert.throws(()=>validateImageRegistrationState(forged));
});
test('IR-04 encoded cache is bounded, epoch-bound, rehashed, expiring and rejects stale/corrupt assets',async()=>{
  const cache=new VerifiedRasterCache(30,2,10000),source='AUTHORED-source',member='authored.png';cache.bind(source);
  const raster=(text,id=member)=>({member:id,blob:new Blob([text],{type:'image/png'}),sha256:sha(Buffer.from(text)),width:1,height:1});
  assert.equal(await cache.put(source,raster('invented')),true);assert.ok(await cache.get(source,member,sha(Buffer.from('invented')),8));
  assert.equal(await cache.get(source,member,'0'.repeat(64),8),null);assert.equal(cache.stats().entries,0);
  assert.equal(await cache.put(source,{...raster('bad'),sha256:'1'.repeat(64)}),false);assert.equal(await cache.put('stale',raster('good')),false);
  await cache.put(source,raster('one','a'));await cache.put(source,raster('two','b'));await cache.put(source,raster('three','c'));assert.equal(cache.stats().entries,2);assert.equal(await cache.get(source,'a',sha(Buffer.from('one')),3),null);
  cache.bind('new-source');assert.equal(cache.stats().encodedBytes,0);assert.equal(await cache.get(source,'b',sha(Buffer.from('two')),3),null);
  const expires=new VerifiedRasterCache(30,2,-1);expires.bind(source);await expires.put(source,raster('x'));assert.equal(await expires.get(source,member,sha(Buffer.from('x')),1),null);
  assert.notEqual(rasterSourceIdentity(fixture.review),'');const p=structuredClone(fixture.review);p.preflight.integrity.allArchivedFilesVerified=false;assert.equal(rasterSourceIdentity(p),'');
});
