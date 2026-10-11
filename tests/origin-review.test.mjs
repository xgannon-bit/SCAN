import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyOriginReview, validateOriginReview, centroidRows, originReviewDigest, buildCentroidExport, parseCentroidCsv } from '../lib/scan/origin-review.ts';
function fixture() {
  const source = { id:'primary', label:'authored fixture', sha256:'a'.repeat(64), interpretation:'authored mm CCW', frame:'source-mm', inputUnits:'mm', normalizedUnits:'mm', revisionHint:'4', points:[0,90,180,270,-90,360].map((rotation,i)=>({reference:`X${i+1}`,identity:`row:${i}`,module:'M',side:i%2?'bottom':'top',x:3.123456789+i,y:-7.987654321,rotation,holds:[]})) };
  const bom = { status:'success', sourceSha256:'b'.repeat(64), config:{revision:'4'}, references:source.points.map(p=>({normalizedRefdes:p.reference,quantityMatches:true,populationEvidence:p.reference==='X6'?'engineering-dnp':'populated'})) };
  const settings = {...emptyOriginReview(),sourceRevision:'4',layoutRevision:'4',bomRevision:'4',sourceAnchor:'declared-center',relationshipEvidence:'Authored Center-X/Y columns; body center not inferred.',reviewer:'Synthetic developer'};
  return {source,bom,settings};
}
async function accepted(f) { const rows=centroidRows(f.source,f.bom,f.settings,null), digest=await originReviewDigest(f.source,f.bom,f.settings,rows,null); f.settings.decisions=rows.map(r=>({key:r.key,digest,choice:'accepted',reviewer:'Synthetic developer',reviewerRole:'development-test'})); return {rows,digest}; }
test('reviewed as-supplied centroid round-trips cardinal rotations, precision, DNP and original values',async()=>{
 const f=fixture(), {rows,digest}=await accepted(f), out=await buildCentroidExport(f.source,f.bom,f.settings,null,digest);
 assert.deepEqual(parseCentroidCsv(out.csv).map(p=>p.rotation),[0,90,180,270,270,0]); assert.equal(out.manifest.rowCount,6); assert.equal(out.manifest.containsEngineeringDnp,true); assert.equal(out.manifest.EagleImportQualified,false); assert.equal(out.manifest.nativeEditsApplied,false); assert.equal(out.manifest.beforeAfterRows[0].original.x,f.source.points[0].x); assert.deepEqual(out,await buildCentroidExport(f.source,f.bom,f.settings,null,digest));
 assert.equal(await originReviewDigest(f.source,f.bom,validateOriginReview(JSON.parse(JSON.stringify(f.settings))),rows,null),digest);
});
test('reject/undo and subset exclusions never silently drop a reference',async()=>{
 const f=fixture(), {rows,digest}=await accepted(f); f.settings.decisions[1].choice='rejected'; await assert.rejects(()=>buildCentroidExport(f.source,f.bom,f.settings,null,digest)); const out=await buildCentroidExport(f.source,f.bom,f.settings,null,digest,true); assert.equal(out.manifest.excluded.length,1); assert.deepEqual(out.manifest.excluded[0].reasons,['Review rejected']); f.settings.decisions.splice(1,1); assert.equal((await buildCentroidExport(f.source,f.bom,f.settings,null,digest,true)).manifest.excluded[0].reasons[0],'Current exact row has not been accepted');
});
test('hash, mapping, revision, BOM population, source anchor and coordinate changes stale decisions',async()=>{
 for(const mutate of [f=>f.source.sha256='c'.repeat(64),f=>f.source.interpretation+=' changed',f=>f.settings.sourceRevision='5',f=>f.bom.references[0].populationEvidence='engineering-dnp',f=>f.settings.sourceAnchor='pcb-footprint-origin',f=>f.source.points[0].x+=.02]) {
  const f=fixture(), old=await accepted(f); mutate(f); const rows=centroidRows(f.source,f.bom,f.settings,null), digest=await originReviewDigest(f.source,f.bom,f.settings,rows,null); assert.notEqual(digest,old.digest); await assert.rejects(()=>buildCentroidExport(f.source,f.bom,f.settings,null,digest,true));
 }
});
test('unknown side, missing rotation, wrong revision, duplicated BOM and unsafe identity hold rows',async()=>{
 for(const mutate of [f=>f.source.points[0].side='unknown',f=>f.source.points[0].rotation=null,f=>f.source.revisionHint='3',f=>f.bom.references.push({...f.bom.references[0]}),f=>f.source.points[0].reference='=X1',f=>f.settings.relationshipEvidence='',f=>f.source.normalizedUnits='unqualified-native',f=>f.bom.references[0].scope={module:'WRONG',side:'bottom'}]) {
  const f=fixture(); mutate(f); const {rows,digest}=await accepted(f); assert.ok(rows[0].holds.length); await assert.rejects(()=>buildCentroidExport(f.source,f.bom,f.settings,null,digest));
 }
});
test('normalization cannot borrow known CSV side when PCB side is unknown',async()=>{
 const f=fixture(); f.settings.outputAnchor='pcb-footprint-origin'; const p=f.source.points[0]; const report={sourceSha256:f.source.sha256,bomSha256:f.bom.sourceSha256,rows:[{sourceIdentity:p.identity,reference:p.reference,exportEligible:false,proposed:{x:5,y:8,rotation:0,side:null},holds:[{message:'PCB physical side unestablished'}]}]}; const rows=centroidRows(f.source,f.bom,f.settings,report); assert.equal(rows[0].side,null); assert.ok(rows[0].holds.includes('PCB physical side unestablished'));
});
test('writer refuses malformed values even after caller removes holds; parser refuses trailing separators',async()=>{
 const f=fixture(),{rows,digest}=await accepted(f); for(const patch of [{x:NaN},{x:null},{x:123},{rotation:Infinity},{side:'unknown'},{reference:'=FORMULA()'}]) { const changed=structuredClone(f.source);Object.assign(changed.points[0],patch); await assert.rejects(()=>buildCentroidExport(changed,f.bom,f.settings,null,digest)); }
 const csv=(await buildCentroidExport(f.source,f.bom,f.settings,null,digest)).csv; assert.throws(()=>parseCentroidCsv(csv.replaceAll('\r\n',',\r\n'))); assert.throws(()=>validateOriginReview({...f.settings,transform:[1,0]})); assert.throws(()=>validateOriginReview({...f.settings,decisions:[...f.settings.decisions,f.settings.decisions[0]]}));
});
