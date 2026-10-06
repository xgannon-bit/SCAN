import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { archiveWorker } from '../lib/scan/archive-worker.ts';
import { makeArchive, syntheticMembers, syntheticSelection } from './synthetic-archive.mjs';
import { readCandidateWork } from '../lib/scan/engineering-candidate-work.ts';
import { validatePackageProfiles } from '../lib/scan/package-profiles.ts';
import { preparationWork } from '../lib/scan/preparation-work.ts';

test('three physical lead constructor exports linked body/anode/NC/cathode references and explicit Eagle work', async () => {
  const python = path.join(process.cwd(), '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const result = spawnSync(python, ['-c', 'import json\nfrom workers.scan.tests.test_three_terminal_constructor import fixture\nj,m,b,p=fixture(90,270)\nprint(json.dumps(dict(job=j.decode(),master=m.decode(),pcb=b.decode(),profile=p)))'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr); const f = JSON.parse(result.stdout);
  validatePackageProfiles([f.profile]);
  for (const mutate of [p => p.electrodes.pop(), p => p.polarity.pinRoles['2']='no-physical-lead', p => p.anchor.linePaths.pop(), p => p.packageRotationDegrees=45]) {
    const bad=structuredClone(f.profile); mutate(bad); assert.throws(() => validatePackageProfiles([bad]));
  }
  const archive=makeArchive({...syntheticMembers,[syntheticSelection.jobMember]:f.job,[syntheticSelection.masterMember]:f.master});
  const hash=Buffer.from(await crypto.subtle.digest('SHA-256',archive)).toString('hex');
  const preflight=await (await archiveWorker(archive,{action:'preflight',expectedArchiveSha256:hash,selection:syntheticSelection},new AbortController().signal)).json();
  const pcb=Buffer.from(f.pcb), layoutSha256=Buffer.from(await crypto.subtle.digest('SHA-256',pcb)).toString('hex');
  const call=(action,draft)=>archiveWorker(archive,{action,draft,selection:syntheticSelection,expectedArchiveSha256:hash,expectedPackageSha256:preflight.capture.packageSha256},new AbortController().signal,undefined,pcb);
  const review=await (await call('draft-review',{layoutSha256,packageProfiles:[f.profile]})).json();
  assert.equal(review.status,'success',review.reason); const item=review.plan.items.find(i=>i.reference==='N1');
  assert.equal(item.status,'ready-for-review'); assert.equal(item.dependencies.windowIds.length,4);
  const control={layoutSha256,packageProfiles:[f.profile],reviewDigest:review.digest,accepted:[item.digest],reviewer:'Authored three-terminal qualification',acknowledgement:'QUALIFICATION ONLY'};
  const stale=structuredClone(control); stale.packageProfiles[0].anchor.evidence.layoutSha256='f'.repeat(64);
  assert.equal((await (await call('draft-export',stale)).json()).status,'blocked');
  const exported=await call('draft-export',control);
  const candidate=await readCandidateWork(await exported.blob(),exported.headers.get('X-SCAN-Candidate-SHA256'),hash,review.plan.items,control.accepted);
  const work=preparationWork(candidate.accounting,review.plan.items,control.accepted,null,null,candidate.bindingWork,candidate.queue);
  const row=work.rows.find(r=>r.reference==='N1'); assert.equal(row.nativeCreation,'prepared-offline');
  assert.deepEqual(row.windows.slice(1).map(w=>w.referenceGeometry.terminalRole),['anode','no-connection','cathode']);
  assert.equal(row.padBinding.newBindingTuples,0);assert.equal(row.machineValidated,false);
  assert.ok(row.atEagle.some(s=>s.includes('NC does not authorize')));assert.equal(work.machineExportAllowed,false);
});
