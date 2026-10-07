import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { validatePackageProfiles } from '../lib/scan/package-profiles.ts';
import { archiveWorker } from '../lib/scan/archive-worker.ts';
import { makeArchive, syntheticMembers, syntheticSelection } from './synthetic-archive.mjs';
import { encodeProject, decodeProject } from '../lib/scan/project-session.ts';

const python=path.join(process.cwd(),'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
export function authoredAnchoredConstructor() {
  const r=spawnSync(python,['-c',`import json
from workers.scan.tests.test_preparation_usability import anchored
from workers.scan.accel_ascii import read_accel
j,m,b,p=anchored(270)
p['targetSourcePaths']=[next(t['sourcePath'] for t in read_accel(b)['placements'] if t['refdes']=='N1')]
p['nativeCadQuantizationMm']=.0001
print(json.dumps(dict(job=j.decode(),master=m.decode(),pcb=b.decode(),profile=p)))`],{encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);
}

test('owned body datum, scoped fresh route and bounded rounding evidence round-trip; unsafe declarations refuse',async()=>{
  const f=authoredAnchoredConstructor();assert.deepEqual(validatePackageProfiles([f.profile]),[f.profile]);
  for(const mutate of [p=>p.bodyAnchor.linePaths[0]={},p=>p.bodyAnchor.layerNumber='guess',p=>p.bodyAnchor.minWidthMm=Infinity,p=>p.targetSourcePaths=['relative'],p=>p.targetSourcePaths=[],p=>p.nativeCadQuantizationMm=.1,p=>delete p.bodyAnchor]) {
    const p=structuredClone(f.profile);mutate(p);assert.throws(()=>validatePackageProfiles([p]));
  }
  const file=await encodeProject({placement:null,gerber:null,original:{file:new File([makeArchive()],'authored.zip'),selection:syntheticSelection,draft:{root:syntheticSelection.root,job:JSON.stringify({role:'main',member:syntheticSelection.jobMember}),master:JSON.stringify({role:'main',member:syntheticSelection.masterMember})}},returned:null,notes:{},machineVersion:'',nativePreparation:{reviewer:'Invented',review:null,history:[],packageProfiles:[f.profile]}});
  const reopened=await decodeProject(new File([file],'authored.scan-project.json'));
  assert.deepEqual(reopened.record.nativePreparation.packageProfiles,[f.profile]);
});

test('real worker review and export produce exact owned-pad intents with unwritten FOV and binding fields',async()=>{
  const f=authoredAnchoredConstructor();
  const bytes=makeArchive({...syntheticMembers,[syntheticSelection.jobMember]:f.job,[syntheticSelection.masterMember]:f.master});
  const hash=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');
  const pcb=Buffer.from(f.pcb),layoutSha256=Buffer.from(await crypto.subtle.digest('SHA-256',pcb)).toString('hex');
  const preflight=await(await archiveWorker(bytes,{action:'preflight',expectedArchiveSha256:hash,selection:syntheticSelection},new AbortController().signal)).json();
  assert.equal(preflight.status,'success');
  const call=(action,draft)=>archiveWorker(bytes,{action,draft,selection:syntheticSelection,expectedArchiveSha256:hash,expectedPackageSha256:preflight.capture.packageSha256},new AbortController().signal,undefined,pcb);
  const r=await(await call('draft-review',{layoutSha256,packageProfiles:[f.profile]})).json();
  assert.equal(r.status,'success',r.reason);assert.equal(r.preparationIntents.counts.ownedTerminalBindingIntents,2);
  const item=r.plan.items.find(i=>i.reference==='N1');
  const out=await call('draft-export',{layoutSha256,packageProfiles:[f.profile],reviewDigest:r.digest,accepted:[item.digest],reviewer:'Authored development reviewer',acknowledgement:'QUALIFICATION ONLY'});
  const verified=spawnSync(python,['-c',`import sys,json,zipfile,io
with zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())) as z:
 r=json.loads(z.read('offline-binding-fov-intents.json'))
 assert r['recordsApplied'] and len(r['components'])==1
 assert r['counts']['ownedTerminalBindingIntents']==2
 assert r['counts']['newNativeBindings']==r['counts']['newNativeFovAssignments']==0
 assert all(t['nativeArtworkId'] is None and not t['bindingQualified'] for t in r['components'][0]['ownedTerminalBindingIntents'])
 assert not r['machineExportAllowed']
`],{input:Buffer.from(await out.arrayBuffer()),encoding:'utf8'});
  assert.equal(verified.status,0,verified.stderr);
});
