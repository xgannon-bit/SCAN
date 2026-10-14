import assert from 'node:assert/strict';
import test from 'node:test';
import { candidateRepairWork } from '../lib/scan/candidate-repair-work.ts';
import { repairProposalGroups, validateRepairSession } from '../lib/scan/repair-session.ts';
import { preservationIdentity, matchesPreservation } from '../lib/scan/candidate-proof.ts';

// Wholly authored schema-shaped observations; no real board identities or geometry.
function fixture() {
  const path = 'JobContainer/PartDataList/PartData[1]', identity = { ID: 'FABLE-7', ParentId: 'M', RefID: 'FICTION-A', MasterKey: 'S' };
  const beforeRoi = { cx: '12.000', cy: '-7', w: '3', h: '2', a: '90' };
  const fields = { ...Object.fromEntries(Object.entries(identity).map(([k,v]) => [k,[v]])), ...Object.fromEntries(Object.entries(beforeRoi).map(([k,v]) => [`Roi/${k}`,[v]])), ENABLE:['True'], CenterPosX:['9'], CenterPosY:['-10'], WND_PAD:['preserve'], 'FovList/Fov0':['4'] };
  const original = { preflight: { source:{sha256:'a'.repeat(64)}, snapshotId:'b'.repeat(64), selection:{root:'fiction',job:{member:'fiction/main.xml',role:'main',sha256:'b'.repeat(64)},master:{member:'master.xml',role:'main',sha256:'c'.repeat(64)}}, preservedDirectories:['fiction/'], preservedFiles:[{originalName:'fiction/main.xml',size:20,sha256:'b'.repeat(64)},{originalName:'master.xml',size:30,sha256:'c'.repeat(64)},{originalName:'fiction/Temp.xml',size:10,sha256:'d'.repeat(64)}],nativeRecords:{job:{status:'recorded',schemaVersionClaim:'10.1',records:[{kind:'part-record',sourcePath:path,rawFields:fields}]},master:{status:'recorded',records:[]}},nativeFovAssignments:{assignments:[{sourcePath:path,assignmentState:'literal-assignment-present',assignedLiterals:[{field:'FovList/Fov0',value:'4'}]}]} } };
  const candidate = structuredClone(original); candidate.preflight.source.sha256='e'.repeat(64); candidate.preflight.selection.job.sha256='f'.repeat(64);candidate.preflight.preservedFiles[0].sha256='f'.repeat(64);
  candidate.preflight.nativeRecords.job.records[0].rawFields['Roi/cx']=['13.125'];candidate.preflight.nativeRecords.job.records[0].rawFields['Roi/cy']=['-5.625'];
  const request={artifactType:'scan.qualification-patch-request',schemaVersion:'1',purpose:'qualification-only',source:{archiveSha256:'a'.repeat(64),jobSha256:'b'.repeat(64),root:'fiction',jobMember:'fiction/main.xml',jobRole:'main'},targetEagleBuild:null,targetMachine:null,reviewer:'Synthetic reviewer',trialPurpose:'Authored replay preservation experiment',evidence:[{id:'archive-change',kind:'historical-replay',independentSupport:false,summary:'Authored historical edit is not physical proof.',references:[{sha256:'1'.repeat(64),label:'Synthetic comparison'}]}],proposals:[{id:'x',path:`${path}/Roi/cx`,identity,before:'12.000',after:'13.125',beforeRoi,evidenceIds:['archive-change'],dependencyProposalIds:['y']},{id:'y',path:`${path}/Roi/cy`,identity,before:'-7',after:'-5.625',beforeRoi,evidenceIds:['archive-change'],dependencyProposalIds:['x']}],acceptances:[{proposalId:'x',proposalSha256:'2'.repeat(64),decision:'accepted',reviewer:'Synthetic reviewer'},{proposalId:'y',proposalSha256:'3'.repeat(64),decision:'accepted',reviewer:'Synthetic reviewer'}]};
  Object.assign(request.source,{masterMember:'master.xml',masterSha256:'c'.repeat(64),masterRole:'main'});
  return {original,candidate,request};
}
test('native-only candidate reanalysis verifies absolute XY edit, Master/assets and separate FOV states', () => {
  const f=fixture(), result=candidateRepairWork(f.original,f.candidate,f.request,'f'.repeat(64));
  assert.equal(result.acceptedScalarCount,2); assert.equal(result.placementEditGroups.length,1);
  assert.equal(result.placementEditGroups[0].basis,'historical-replay');
  assert.equal(result.placementEditGroups[0].literalEnable,'True');
  assert.equal(result.placementEditGroups[0].fov.assignment,'literal-assignment-present');
  assert.equal(result.placementEditGroups[0].fov.coverage,'unverified');
  assert.equal(result.independentlyDiagnosedCorrections,0); assert.equal(result.inspectionRepairEstablished,false);
  assert.equal(repairProposalGroups(f.request).length,1);
  assert.equal(validateRepairSession({request:f.request,history:[],work:[]}).request.evidence[0].independentSupport,false);
});
test('fresh proof is bound to original/candidate members and the complete request, not saved labels', () => {
  const f=fixture(), proof={ identity: preservationIdentity(f.original.preflight,f.candidate.preflight,f.request), work: candidateRepairWork(f.original,f.candidate,f.request,'f'.repeat(64)) };
  assert.equal(matchesPreservation(proof,f.original.preflight,f.candidate.preflight,f.request),true);
  assert.equal(matchesPreservation(null,f.original.preflight,f.candidate.preflight,f.request),false);
  for(const mutate of [x=>x.request.acceptances.pop(),x=>x.request.evidence[0].summary='Changed evidence',x=>x.candidate.preflight.source.sha256='9'.repeat(64),x=>x.original.preflight.selection.job.member='Temp.xml',x=>x.candidate.preflight.selection.job.sha256='8'.repeat(64)]) {
    const x=structuredClone(f);mutate(x);assert.equal(matchesPreservation(proof,x.original.preflight,x.candidate.preflight,x.request),false);
  }
});
test('reanalysis refuses stale source, partial XY decisions, wrong identity, changed teaching, Master and unknown bytes', () => {
  for (const mutate of [
    f=>{f.request.source.archiveSha256='9'.repeat(64)},
    f=>{f.request.acceptances[1].decision='rejected'},
    f=>{f.candidate.preflight.nativeRecords.job.records[0].rawFields.ID=['wrong']},
    f=>{f.candidate.preflight.nativeRecords.job.records[0].rawFields.ENABLE=['False']},
    f=>{f.candidate.preflight.nativeRecords.job.records[0].rawFields.CenterPosX=['13.125']},
    f=>{f.candidate.preflight.selection.master.sha256='9'.repeat(64)},
    f=>{f.candidate.preflight.preservedFiles[2].sha256='9'.repeat(64)},
    f=>{f.candidate.preflight.selection.job.sha256='9'.repeat(64)},
    f=>{f.request.proposals[0].beforeRoi.cy='wrong'},
  ]) { const f=fixture();mutate(f);assert.throws(()=>candidateRepairWork(f.original,f.candidate,f.request,'f'.repeat(64))); }
});
test('unaccepted no-op candidate and historical evidence mislabeled independent are refused', () => {
  const f=fixture();f.request.acceptances.forEach(a=>a.decision='rejected');
  assert.throws(()=>candidateRepairWork(f.original,f.candidate,f.request,'f'.repeat(64)));
  f.request.evidence[0].independentSupport=true;
  assert.throws(()=>validateRepairSession({request:f.request,history:[],work:[]}));
});
test('cross-component dependencies stay one review group but every affected identity gets its own work row', () => {
  const f=fixture(), old=structuredClone(f.original.preflight.nativeRecords.job.records[0]);
  old.sourcePath='JobContainer/PartDataList/PartData[2]';old.rawFields.ID=['FABLE-8'];old.rawFields.RefID=['FICTION-B'];
  f.original.preflight.nativeRecords.job.records.push(old);
  const next=structuredClone(old);next.rawFields['Roi/cx']=['14'];f.candidate.preflight.nativeRecords.job.records.push(next);
  f.request.proposals.push({...structuredClone(f.request.proposals[0]),id:'other',path:`${old.sourcePath}/Roi/cx`,identity:{...f.request.proposals[0].identity,ID:'FABLE-8',RefID:'FICTION-B'},after:'14',dependencyProposalIds:['x']});
  f.request.acceptances.push({proposalId:'other',proposalSha256:'4'.repeat(64),decision:'accepted',reviewer:'Synthetic reviewer'});
  assert.equal(repairProposalGroups(f.request).length,1);
  const work=candidateRepairWork(f.original,f.candidate,f.request,'f'.repeat(64));
  assert.deepEqual(work.placementEditGroups.map(r=>r.identity.RefID),['FICTION-A','FICTION-B']);
  f.request.evidence[0].kind='independent-source-support';f.request.evidence[0].independentSupport=true;
  assert.equal(validateRepairSession({request:f.request,history:[],work:[]}).request.evidence[0].kind,'independent-source-support');
});
