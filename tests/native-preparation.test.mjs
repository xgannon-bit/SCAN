import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { archiveWorker } from '../lib/scan/archive-worker.ts';
import { encodeProject, decodeProject } from '../lib/scan/project-session.ts';
import { validateNativePreparationSession } from '../lib/scan/native-preparation-session.ts';
import { makeArchive, syntheticMembers, syntheticSelection } from './synthetic-archive.mjs';

import { authoredPreparation } from './native-preparation-fixture.mjs';
import { candidatePreparationWork } from '../lib/scan/candidate-work.ts';
import { readCandidateWork, readGeneratedCandidate } from '../lib/scan/engineering-candidate-work.ts';

test('browser worker rechecks full proposals and exports only accepted disabled source-derived parts', async () => {
  const fixture = authoredPreparation();
  const archive = makeArchive({ ...syntheticMembers, [syntheticSelection.jobMember]: fixture.job, [syntheticSelection.masterMember]: fixture.master });
  const hash = Buffer.from(await crypto.subtle.digest('SHA-256', archive)).toString('hex');
  const preflight = await (await archiveWorker(archive, { action: 'preflight', expectedArchiveSha256: hash, selection: syntheticSelection }, new AbortController().signal)).json();
  assert.equal(preflight.status, 'success');
  const pcb = Buffer.from(fixture.pcb), layoutSha256 = Buffer.from(await crypto.subtle.digest('SHA-256', pcb)).toString('hex');
  const base = { expectedArchiveSha256: hash, expectedPackageSha256: preflight.capture.packageSha256, selection: syntheticSelection };
  const call = (action, draft) => archiveWorker(archive, { ...base, action, draft }, new AbortController().signal, undefined, pcb);
  const checked = await (await call('draft-review', { layoutSha256 })).json();
  assert.equal(checked.status, 'success'); assert.equal(checked.plan.items.filter(i => i.status === 'ready-for-review').length, 2);
  assert.equal(checked.accounting.filter(i => i.status === 'prepared-disabled').length, 0);
  const proposal = { layoutSha256, reviewDigest: checked.digest, accepted: [checked.plan.items[0].digest], reviewer: 'Authored integration reviewer', acknowledgement: 'QUALIFICATION ONLY' };
  for (const draft of [{ ...proposal, reviewDigest: '0'.repeat(64) }, { ...proposal, accepted: ['0'.repeat(64)] }, { ...proposal, acknowledgement: '' }]) {
    const response = await call('draft-export', draft); assert.equal((await response.json()).status, 'blocked');
  }
  const response = await call('draft-export', proposal);
  assert.equal(response.headers.get('X-SCAN-Native-Edits'), 'qualification-only');
  const output = Buffer.from(await response.arrayBuffer());
  assert.equal(Buffer.from(await crypto.subtle.digest('SHA-256', output)).toString('hex'), response.headers.get('X-SCAN-SHA256'));
  const candidateWork=await readCandidateWork(new Blob([output]), response.headers.get('X-SCAN-Candidate-SHA256'),hash,checked.plan.items,proposal.accepted);
  assert.equal(candidateWork.accounting.filter(r=>r.status==='prepared-disabled').length,1);
  assert.equal(candidateWork.bindingWork.components.find(r=>r.reference==='N1').nativePlacementCount,1);
  assert.ok(!candidateWork.bindingWork.components.find(r=>r.reference==='N1').holdCodes.includes('BINDING_NATIVE_PART_MISSING'));
  assert.equal(candidateWork.bindingWork.components.find(r=>r.reference==='N2').nativePlacementCount,0);
  await assert.rejects(readCandidateWork(new Blob([output]), '0'.repeat(64),hash,checked.plan.items,proposal.accepted));
  await assert.rejects(readCandidateWork(new Blob([output]), response.headers.get('X-SCAN-Candidate-SHA256'),hash,checked.plan.items,[]));
  const generated = await readGeneratedCandidate(new Blob([output]), response.headers.get('X-SCAN-Candidate-SHA256'), syntheticSelection);
  assert.equal(generated.record.selection.jobRole, 'main');
  const nativeBytes = Buffer.from(await generated.file.arrayBuffer());
  const fresh = await (await archiveWorker(nativeBytes, { action: 'preflight', expectedArchiveSha256: generated.record.source.sha256, selection: syntheticSelection }, new AbortController().signal)).json();
  const rebuilt = candidatePreparationWork(preflight, fresh, null, checked, proposal.accepted);
  assert.equal(rebuilt.counts.preparedReferences, 1);
  assert.equal(rebuilt.rows.find(r => r.reference === 'N1').windows.length, checked.plan.items[0].dependencies.windowIds.length);
  assert.equal(rebuilt.rows.find(r => r.reference === 'N2').nativeCreation, 'proposal-awaiting-review');
  assert.equal(rebuilt.machineExportAllowed, false);
  assert.ok(!rebuilt.rows.find(r => r.reference === 'N1').padBinding.holdCodes.includes('BINDING_NATIVE_PART_MISSING'));
  assert.equal(rebuilt.rows.find(r => r.reference === 'N1').padBinding.actualObservedPlacements.length, 1);
  await assert.rejects(readGeneratedCandidate(new Blob([output]), '0'.repeat(64), syntheticSelection), /differs/);
  const broken = Buffer.from(output), localName = broken.indexOf(Buffer.from('CANDIDATE.zip')), start = localName - 30;
  assert.equal(broken.readUInt32LE(start), 0x04034b50);
  const dataStart = localName + broken.readUInt16LE(start + 26) + broken.readUInt16LE(start + 28);
  broken[dataStart + 3] ^= 1;
  await assert.rejects(readGeneratedCandidate(new Blob([broken]), generated.record.source.sha256, syntheticSelection));
  assert.throws(() => candidatePreparationWork(preflight, fresh, null, checked, []), /unexpected added/);
  const altered = structuredClone(fresh), addedPart = altered.preflight.nativeRecords.job.records.find(p => p.rawFields.RefID?.[0] === 'N1' && p.kind === 'part-record');
  addedPart.rawFields.ENABLE = ['True'];
  assert.throws(() => candidatePreparationWork(preflight, altered, null, checked, proposal.accepted), /disabled windows/);
  const python = path.join(process.cwd(), '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const verify = spawnSync(python, ['-c', `import zipfile,io,json,sys
with zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())) as z:
 rows=json.loads(z.read('component_accounting.json'))
 assert sum(r['status']=='prepared-disabled' for r in rows)==1
 assert all(r['machineValidated'] is False for r in rows)
 changes=json.loads(z.read('applied_changes.json'));assert len(changes)==1
 qualification=json.loads(z.read('qualification.json'));assert qualification['EagleOpenSaveReopen']=='not-performed'
 with zipfile.ZipFile(io.BytesIO(z.read('CANDIDATE.zip'))) as c:
  assert c.testzip() is None
`], { input: output, encoding: 'utf8' });
  assert.equal(verify.status, 0, verify.stderr);
});

test('preparation decisions and candidate history round-trip; malformed authority and history refuse', async () => {
  const identity = { digest: 'a'.repeat(64), sourceContext: 'b'.repeat(64), archiveSha256: 'c'.repeat(64), layoutSha256: 'd'.repeat(64), decisions: [{ digest: 'e'.repeat(64), reference: 'INVENTED', decision: 'accepted' }] };
  const nativePreparation = { reviewer: 'Authored reviewer', review: identity, history: [{ id: 'authored-history', recordedAt: '2026-01-02T03:04:05Z', packageSha256: 'f'.repeat(64), candidateSha256: '0'.repeat(64), review: identity, reviewer: 'Authored reviewer', accepted: ['e'.repeat(64)] }] };
  const project = await encodeProject({ placement: null, gerber: null, original: { file: new File([makeArchive()], 'authored.zip'), selection: syntheticSelection, draft: { root: syntheticSelection.root, job: JSON.stringify({ role: 'main', member: syntheticSelection.jobMember }), master: JSON.stringify({ role: 'main', member: syntheticSelection.masterMember }) } }, returned: null, notes: {}, machineVersion: '', nativePreparation });
  const restored = await decodeProject(new File([project], 'authored.scan-project.json'));
  assert.deepEqual(restored.record.nativePreparation, nativePreparation);
  for (const mutate of [v => { v.machineValidated = true; }, v => { v.review.decisions.push(v.review.decisions[0]); }, v => { v.history[0].accepted = ['a'.repeat(64)]; }, v => { v.history[0].recordedAt = 'not-a-date'; }]) {
    const changed = structuredClone(nativePreparation); mutate(changed); assert.throws(() => validateNativePreparationSession(changed));
  }
});
