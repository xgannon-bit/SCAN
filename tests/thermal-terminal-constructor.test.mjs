import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { archiveWorker } from '../lib/scan/archive-worker.ts';
import { makeArchive, syntheticMembers, syntheticSelection } from './synthetic-archive.mjs';
import { readCandidateWork } from '../lib/scan/engineering-candidate-work.ts';
import { validatePackageProfiles } from '../lib/scan/package-profiles.ts';
import { preparationWork } from '../lib/scan/preparation-work.ts';

test('external terminals and hidden thermal pad stay separate through reviewed export', async () => {
  const python = path.join(process.cwd(), '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const result = spawnSync(python, ['-c', 'import json\nfrom workers.scan.tests.test_thermal_terminal_constructor import fixture\nj,m,b,p=fixture(90,270)\nprint(json.dumps(dict(job=j.decode(),master=m.decode(),pcb=b.decode(),profile=p)))'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr); const f = JSON.parse(result.stdout);
  validatePackageProfiles([f.profile]);
  for (const mutate of [p => p.electrodes.pop(), p => p.polarity.pinRoles['2']='no-connection', p => p.anchor.linePaths.pop(), p => p.packageRotationDegrees=45]) {
    const bad=structuredClone(f.profile); mutate(bad); assert.throws(() => validatePackageProfiles([bad]));
  }
  const archive=makeArchive({...syntheticMembers,[syntheticSelection.jobMember]:f.job,[syntheticSelection.masterMember]:f.master});
  const hash=Buffer.from(await crypto.subtle.digest('SHA-256',archive)).toString('hex');
  const preflight=await (await archiveWorker(archive,{action:'preflight',expectedArchiveSha256:hash,selection:syntheticSelection},new AbortController().signal)).json();
  const pcb=Buffer.from(f.pcb), layoutSha256=Buffer.from(await crypto.subtle.digest('SHA-256',pcb)).toString('hex');
  const call=(action,draft)=>archiveWorker(archive,{action,draft,selection:syntheticSelection,expectedArchiveSha256:hash,expectedPackageSha256:preflight.capture.packageSha256},new AbortController().signal,undefined,pcb);
  const review=await (await call('draft-review',{layoutSha256,packageProfiles:[f.profile]})).json();
  assert.equal(review.status,'success',review.reason); const item=review.plan.items.find(i=>i.reference==='N1');
  assert.equal(item.status,'ready-for-review'); assert.equal(item.dependencies.windowIds.length,11);
  const control={layoutSha256,packageProfiles:[f.profile],reviewDigest:review.digest,accepted:[item.digest],reviewer:'Authored three-terminal qualification',acknowledgement:'QUALIFICATION ONLY'};
  const stale=structuredClone(control); stale.packageProfiles[0].thermalPads[0].evidence.layoutSha256='f'.repeat(64);
  assert.equal((await (await call('draft-export',stale)).json()).status,'blocked');
  const exported=await call('draft-export',control);
  const candidate=await readCandidateWork(await exported.blob(),exported.headers.get('X-SCAN-Candidate-SHA256'),hash,review.plan.items,control.accepted);
  const work=preparationWork(candidate.accounting,review.plan.items,control.accepted,null,null,candidate.bindingWork,candidate.queue);
  const row=work.rows.find(r=>r.reference==='N1'); assert.equal(row.nativeCreation,'prepared-offline');
  assert.deepEqual(row.windows.slice(1).map(w=>w.referenceGeometry.terminalRole),Array(10).fill('external-terminal'));
  assert.deepEqual(row.windows.slice(1).map(w=>w.referenceGeometry.pin),Array.from({length:10},(_,i)=>String(i+1))); assert.equal(row.thermalPads[0].pin,'11'); assert.equal(row.thermalPads[0].nativeWindowCreated,false); assert.equal(row.padBinding.sourceOwnedPadCount,11); assert.equal(row.padBinding.newBindingTuples,0);assert.equal(row.machineValidated,false); assert.equal(row.thermalPads[0].opticallyInspectable,false); assert.ok(row.windows.slice(1).every(w=>w.referenceGeometry.opticallyInspectable===null));
  assert.ok(row.atEagle.some(s=>s.includes('hidden-joint coverage')));assert.equal(work.machineExportAllowed,false);
});
