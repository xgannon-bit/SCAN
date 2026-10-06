import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { archiveWorker } from '../lib/scan/archive-worker.ts';
import { makeArchive, syntheticMembers, syntheticSelection } from './synthetic-archive.mjs';
import { readCandidateWork } from '../lib/scan/engineering-candidate-work.ts';
import { validatePackageProfiles } from '../lib/scan/package-profiles.ts';
import { encodeProject, decodeProject } from '../lib/scan/project-session.ts';
import { preparationWork } from '../lib/scan/preparation-work.ts';

const python = path.join(process.cwd(), '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
export function authoredDiode() {
  const r = spawnSync(python, ['-c', 'import json\nfrom workers.scan.tests.test_diode_constructor import fixture\nj,m,b,p=fixture(90,90,True)\nprint(json.dumps(dict(job=j.decode(),master=m.decode(),pcb=b.decode(),profile=p)))'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout);
}

test('asymmetric diode evidence creates actual linked disabled records, exposes cathode work and reopens', async () => {
  const f = authoredDiode(), profiles = [f.profile]; validatePackageProfiles(profiles);
  const archive = makeArchive({ ...syntheticMembers, [syntheticSelection.jobMember]: f.job, [syntheticSelection.masterMember]: f.master });
  const hash = Buffer.from(await crypto.subtle.digest('SHA-256', archive)).toString('hex');
  const preflight = await (await archiveWorker(archive, { action: 'preflight', expectedArchiveSha256: hash, selection: syntheticSelection }, new AbortController().signal)).json();
  const pcb = Buffer.from(f.pcb), layoutSha256 = Buffer.from(await crypto.subtle.digest('SHA-256', pcb)).toString('hex');
  const call = (action, draft) => archiveWorker(archive, { action, draft, selection: syntheticSelection, expectedArchiveSha256: hash, expectedPackageSha256: preflight.capture.packageSha256 }, new AbortController().signal, undefined, pcb);
  const review = await (await call('draft-review', { layoutSha256, packageProfiles: profiles })).json();
  assert.equal(review.status, 'success', review.reason);
  const item = review.plan.items.find(i => i.reference === 'N1'); assert.equal(item.status, 'ready-for-review');
  assert.deepEqual(item.dependencies.windowRoles.slice(1).map(w => w.terminalRole), ['cathode', 'anode']);
  const control = { layoutSha256, packageProfiles: profiles, reviewDigest: review.digest, accepted: [item.digest], reviewer: 'Authored diode qualification', acknowledgement: 'QUALIFICATION ONLY' };
  const wrong = structuredClone(control); wrong.packageProfiles[0].polarity.pinRoles = {1:'anode',2:'cathode'};
  assert.equal((await (await call('draft-export', wrong)).json()).status, 'blocked');
  const exported = await call('draft-export', control), blob = await exported.blob();
  const candidate = await readCandidateWork(blob, exported.headers.get('X-SCAN-Candidate-SHA256'), hash, review.plan.items, control.accepted);
  const work = preparationWork(candidate.accounting, review.plan.items, control.accepted, null, null, candidate.bindingWork, candidate.queue);
  const row = work.rows.find(r => r.reference === 'N1');
  assert.equal(row.nativeCreation, 'prepared-offline'); assert.equal(row.padBinding.newBindingTuples, 0);
  assert.ok(row.atEagle.some(s => s.includes('Teach the cathode mark')));
  assert.equal(row.windows[1].referenceGeometry.terminalRole, 'cathode');
  assert.equal(work.machineExportAllowed, false);
  const identity = { digest: review.digest, sourceContext: 'a'.repeat(64), archiveSha256: hash, layoutSha256, decisions: [{ digest: item.digest, reference: 'N1', decision: 'accepted' }] };
  const nativePreparation = { reviewer: control.reviewer, packageProfiles: profiles, review: identity, history: [{ id: 'invented', recordedAt: '2026-01-02T03:04:05Z', packageSha256: 'b'.repeat(64), candidateSha256: exported.headers.get('X-SCAN-Candidate-SHA256'), review: identity, reviewer: control.reviewer, accepted: control.accepted, packageProfiles: structuredClone(profiles) }] };
  const encoded = await encodeProject({ placement: null, gerber: null, original: { file: new File([archive], 'invented.zip'), selection: syntheticSelection, draft: { root: syntheticSelection.root, job: JSON.stringify({ role: 'main', member: syntheticSelection.jobMember }), master: JSON.stringify({ role: 'main', member: syntheticSelection.masterMember }) } }, returned: null, notes: {}, machineVersion: '', nativePreparation });
  assert.deepEqual((await decodeProject(new File([encoded], 'invented-project.json'))).record.nativePreparation, nativePreparation);
});

test('incomplete diode profiles persist exact holds, never fabricating preparation; malformed evidence refuses', async () => {
  const f = authoredDiode(); f.profile.anchor = f.profile.polarity = f.profile.electrodes = null;
  assert.doesNotThrow(() => validatePackageProfiles([f.profile]));
  for (const mutate of [p => { p.anchor = {}; }, p => { p.polarity = {}; }, p => { p.electrodes = []; }, p => { p.extra = 1; }]) {
    const p = structuredClone(f.profile); mutate(p); assert.throws(() => validatePackageProfiles([p]));
  }
});
