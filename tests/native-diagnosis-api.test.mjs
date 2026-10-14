import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { POST } from '../app/api/archive/route.ts';
import { archiveWorker } from '../lib/scan/archive-worker.ts';
import { authoredDiagnosis, requestFromDiagnosis } from './native-diagnosis-fixture.mjs';
const hash = b => createHash('sha256').update(b).digest('hex');

async function scenario(options) {
  const f = authoredDiagnosis(options);
  const control = { action: 'preflight', expectedArchiveSha256: hash(f.archive), selection: f.selection };
  const review = await (await archiveWorker(f.archive, control, new AbortController().signal)).json();
  assert.equal(review.status, 'success');
  return { f, review, control: { ...control, expectedPackageSha256: review.capture.packageSha256 } };
}
function formFor(s, action, request) {
  const form = new FormData(); form.set('file', new File([s.f.archive], 'authored-native.zip'));
  for (const [key, value] of Object.entries({ action, expectedArchiveSha256: s.control.expectedArchiveSha256, expectedPackageSha256: s.control.expectedPackageSha256, selection: JSON.stringify(s.f.selection) })) form.set(key, value);
  form.set('layout', new File([s.f.pcb], 'authored-REV1.pcb')); form.set('diagnosisPlacement', new File([s.f.placement], 'authored-REV1.csv')); form.set('diagnosisBom', new File([s.f.bom], 'authored-BOM-REV1.csv'));
  if (action === 'placement-diagnosis') form.set('diagnosis', JSON.stringify(s.f.context));
  else form.set('repair', JSON.stringify({ request, ...(action === 'repair-export' ? { acknowledgeQualificationOnly: true } : {}) }));
  return form;
}
const post = form => POST(new Request('http://127.0.0.1:3210/api/archive', { method: 'POST', headers: { origin: 'http://127.0.0.1:3210', host: '127.0.0.1:3210' }, body: form }));

test('loopback diagnosis derives fresh body proposals independently of CSV datum and source/native CAD controls, then validates the exact review', async () => {
  const s = await scenario(), response = await post(formFor(s, 'placement-diagnosis'));
  assert.equal(response.status, 200); const report = await response.json();
  assert.equal(report.artifactType, 'scan.native-placement-diagnosis', JSON.stringify(report)); assert.equal(report.status, 'success');
  assert.equal(report.physicalCorrectnessVerified, false); assert.equal(report.counts.completeRepairs, 0);
  const row = report.rows.find(r => r.identity.RefID === 'N1');
  assert.equal(row.classification, 'local-native-roi-offset'); assert.equal(row.proposals.length, 2); assert.equal(row.completeRepairClaimHeld, true);
  for (let axis = 0; axis < 2; axis++) assert.ok(Math.abs(row.proposedCenterNative[axis] - s.f.expected[axis]) < 1e-7);
  assert.equal(report.sourceRegistration.transform.matrix[0][2], -23); assert.equal(report.sourceRegistration.transform.matrix[1][2], 7);
  const pending = requestFromDiagnosis(report, s.f.context), checked = await (await post(formFor(s, 'repair-review', pending))).json();
  assert.equal(checked.status, 'success'); assert.equal(checked.diagnosis.diagnosisSha256, report.diagnosisSha256);
  assert.equal(checked.diagnosisReceipt.derivedScalars, 2); assert.ok(checked.request.acceptances.every(a => a.decision === 'pending'));
  assert.deepEqual(s.f.context.source, { layoutSha256: hash(Buffer.from(s.f.pcb)), placementSha256: hash(Buffer.from(s.f.placement)), bomSha256: hash(Buffer.from(s.f.bom)) });
});

test('fresh worker refuses stale finding hashes, altered values/identity, incomplete dependencies and changed source bytes', async () => {
  const s = await scenario(); const report = await (await post(formFor(s, 'placement-diagnosis'))).json();
  const pending = requestFromDiagnosis(report, s.f.context);
  for (const mutate of [
    r => { r.diagnosis.diagnosisSha256 = '0'.repeat(64); }, r => { r.diagnosis.settings.frameStatement += ' edited'; },
    r => { r.proposals[0].after = '999'; }, r => { r.proposals[0].before = '999'; }, r => { r.proposals[0].identity.ID = 'unknown'; },
    r => { r.proposals.pop(); }, r => { r.evidence[0].kind = 'historical-replay'; r.evidence[0].independentSupport = false; },
  ]) { const changed = structuredClone(pending); mutate(changed); const result = await (await post(formFor(s, 'repair-review', changed))).json(); assert.equal(result.status, 'blocked'); }
  for (const field of ['layout', 'diagnosisPlacement', 'diagnosisBom']) {
    const form = formFor(s, 'repair-review', pending), file = form.get(field); form.set(field, new File([await file.text(), '\nAUTHORED ALTERATION'], file.name));
    assert.equal((await (await post(form)).json()).status, 'blocked');
  }
});

test('multipart diagnosis rejects duplicated/missing files, unsupported sources and attempts to attach source authority to an unrelated repair', async () => {
  const s = await scenario();
  for (const mutate of [
    f => { f.delete('diagnosisBom'); }, f => { f.append('diagnosisPlacement', new File(['duplicate'], 'another.csv')); },
    f => { f.set('layout', new File(['invented'], 'unsupported.txt')); }, f => { f.set('diagnosisPlacement', new File(['invented'], '../outside.csv')); },
    f => { f.set('diagnosisBom', new File([], 'empty.csv')); }, f => { f.set('approved', 'true'); },
  ]) { const form = formFor(s, 'placement-diagnosis'); mutate(form); assert.equal((await post(form)).status, 400); }
  const unrelated = formFor(s, 'repair-review', { proposals: [] });
  const response = await post(unrelated); assert.equal(response.status, 400); assert.match((await response.json()).message, /bound diagnosis request/);
});

test('clean target and ambiguous duplicate are distinct scoped states with no target proposal', async () => {
  for (const [options, classification, hold] of [[{ aligned: true }, 'already-aligned', null], [{ duplicate: true }, 'held', 'DIAGNOSIS_NATIVE_DUPLICATE']]) {
    const s = await scenario(options), report = await (await post(formFor(s, 'placement-diagnosis'))).json();
    assert.equal(report.status, 'success'); assert.deepEqual(report.frame.holds, []);
    const targets = report.rows.filter(r => r.identity.RefID === 'N1');
    assert.ok(targets.length); for (const row of targets) { assert.equal(row.classification, classification); assert.deepEqual(row.proposals, []); if (hold) assert.ok(row.holds.some(h => h.code === hold)); }
    assert.equal(report.counts.completeRepairs, 0);
  }
});
