import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { archiveWorker } from '../lib/scan/archive-worker.ts';
import { makeArchive, syntheticMembers, syntheticSelection } from './synthetic-archive.mjs';
import { readCandidateWork } from '../lib/scan/engineering-candidate-work.ts';
import { validateNativePreparationSession } from '../lib/scan/native-preparation-session.ts';
import { validatePackageProfiles } from '../lib/scan/package-profiles.ts';
import { encodeProject, decodeProject } from '../lib/scan/project-session.ts';
import { preparationWork } from '../lib/scan/preparation-work.ts';

const python = path.join(process.cwd(), '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
export function authoredConstructor() {
  const result = spawnSync(python, ['-c', 'import json\nfrom workers.scan.tests.test_paired_terminal_constructor import fixture\nj,m,b,p=fixture(270)\nprint(json.dumps(dict(job=j.decode(),master=m.decode(),pcb=b.decode(),profile=p)))'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('constructor evidence flows through actual archive review/apply and fresh component/window accounting', async () => {
  const f = authoredConstructor(), profiles = [f.profile];
  const archive = makeArchive({ ...syntheticMembers, [syntheticSelection.jobMember]: f.job, [syntheticSelection.masterMember]: f.master });
  const hash = Buffer.from(await crypto.subtle.digest('SHA-256', archive)).toString('hex');
  const preflight = await (await archiveWorker(archive, { action: 'preflight', expectedArchiveSha256: hash, selection: syntheticSelection }, new AbortController().signal)).json();
  assert.equal(preflight.status, 'success');
  const pcb = Buffer.from(f.pcb), layoutSha256 = Buffer.from(await crypto.subtle.digest('SHA-256', pcb)).toString('hex');
  const call = (action, draft) => archiveWorker(archive, { action, draft, selection: syntheticSelection, expectedArchiveSha256: hash, expectedPackageSha256: preflight.capture.packageSha256 }, new AbortController().signal, undefined, pcb);
  const reviewed = await (await call('draft-review', { layoutSha256, packageProfiles: profiles })).json();
  assert.equal(reviewed.status, 'success', reviewed.reason);
  const item = reviewed.plan.items.find(i => i.reference === 'N1');
  assert.equal(item.status, 'ready-for-review');
  assert.equal(item.dependencies.windowPreparation, 'constructed-body-terminal-geometry');
  const control = { layoutSha256, packageProfiles: profiles, reviewDigest: reviewed.digest, accepted: [item.digest], reviewer: 'Authored offline reviewer', acknowledgement: 'QUALIFICATION ONLY' };
  const changed = structuredClone(control); changed.packageProfiles[0].body.widthMm += .1;
  assert.equal((await (await call('draft-export', changed)).json()).status, 'blocked');
  const exported = await call('draft-export', control);
  assert.equal(exported.headers.get('X-SCAN-Native-Edits'), 'qualification-only');
  const blob = await exported.blob();
  const candidate = await readCandidateWork(blob, exported.headers.get('X-SCAN-Candidate-SHA256'), hash, reviewed.plan.items, [item.digest]);
  const work = preparationWork(candidate.accounting, reviewed.plan.items, [item.digest], null, null, candidate.bindingWork, candidate.queue);
  assert.equal(work.counts.preparedReferences, 1);
  assert.equal(work.counts.preparedWithConstructedGeometry, 1);
  assert.equal(work.counts.preparedWithCompleteTemplateWindowCopy, 0);
  assert.equal(work.rows.find(r => r.reference === 'N1').windows.length, 3);
  assert.equal(work.rows.find(r => r.reference === 'N1').padBinding.newBindingTuples, 0);
  assert.equal(work.inspectionRepairEstablished, false);
});

test('package evidence and historical profile snapshots survive project serialization; malformed profiles refuse', async () => {
  const profiles = [authoredConstructor().profile];
  const identity = { digest: 'a'.repeat(64), sourceContext: 'b'.repeat(64), archiveSha256: 'c'.repeat(64), layoutSha256: 'd'.repeat(64), decisions: [{ digest: 'e'.repeat(64), reference: 'N1', decision: 'accepted' }] };
  const nativePreparation = { reviewer: 'Authored', packageProfiles: profiles, review: identity, history: [{ id: 'authored', recordedAt: '2026-01-02T03:04:05Z', packageSha256: 'f'.repeat(64), candidateSha256: '0'.repeat(64), review: identity, reviewer: 'Authored', accepted: ['e'.repeat(64)], packageProfiles: structuredClone(profiles) }] };
  const project = await encodeProject({ placement: null, gerber: null, original: { file: new File([makeArchive()], "authored.zip"), selection: syntheticSelection, draft: { root: syntheticSelection.root, job: JSON.stringify({ role: "main", member: syntheticSelection.jobMember }), master: JSON.stringify({ role: "main", member: syntheticSelection.masterMember }) } }, returned: null, notes: {}, machineVersion: '', nativePreparation });
  const reopened = await decodeProject(new File([project], 'authored-project.json'));
  assert.deepEqual(reopened.record.nativePreparation, nativePreparation);
  const edited = structuredClone(nativePreparation); edited.packageProfiles[0].body.widthMm += .1;
  assert.equal(edited.history[0].packageProfiles[0].body.widthMm, profiles[0].body.widthMm);
  for (const mutate of [p => { p.extra = true; }, p => { p.drawing.sha256 = 'wrong'; }, p => { p.body.widthMm = NaN; }, p => { p.padPinMap = {1:'1',2:'1'}; }]) {
    const bad = structuredClone(profiles); mutate(bad[0]); assert.throws(() => validatePackageProfiles(bad));
    const session = structuredClone(nativePreparation); session.packageProfiles = bad; assert.throws(() => validateNativePreparationSession(session));
  }
});
