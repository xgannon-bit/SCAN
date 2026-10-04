import assert from 'node:assert/strict';
import test from 'node:test';
import { ARCHIVE_MAX_BYTES, PROJECT_MAX_BYTES, decodeProject, encodeProject, retainProjectEvidence, reviewMatchesSelection, selectionInInventory, validateProjectSession } from '../lib/scan/project-session.ts';
import { encodeReview } from '../lib/scan/review-session.ts';
import { archiveWorker } from '../lib/scan/archive-worker.ts';
import { makeArchive, syntheticSelection } from './synthetic-archive.mjs';
import { retainSessionNote } from '../components/scan/ScanSession.tsx';

const config = { startRow: 1, columns: { refdes: 1, x: 2, y: 3 }, module: 'FICTIONAL', side: 'Top', units: 'mm', rotationDirection: 'ccw', decimalSeparator: '.', pairSeparator: ',' };
const notes = { session: 'Authored project annotation, not approval.', 'row:1': 'Retain the selected row.' };
const settings = { config, sheetIndex: 0, delimiter: ',', validated: true, selectedRow: 1, notes };
const placement = { file: new File(['R1,1,2\n'], 'authored.csv'), settings };
const draft = selection => ({ root: selection.root, job: JSON.stringify({ role: selection.jobRole, member: selection.jobMember }), master: selection.masterMember ? JSON.stringify({ role: selection.masterRole, member: selection.masterMember }) : 'none' });
const asFile = value => new File([value instanceof Blob ? value : JSON.stringify(value)], 'project.json');
const archiveBytes = makeArchive();
const original = { file: new File([archiveBytes], 'fictional-original.zip'), selection: { ...syntheticSelection, jobMember: 'Fictional/Board/Board_Temp.xml', jobRole: 'temp' } };
original.draft = draft(original.selection);
const returned = { file: new File([makeArchive({ 'Fictional/Board/Board.xml': '<FictionalReturned />' })], 'fictional-returned.zip'), selection: { ...syntheticSelection, masterMember: null, masterRole: null } };
returned.draft = draft(returned.selection);
const gerber = { file: new File(['%MOMM*%\n%FSLAX24Y24*%\nM02*'], 'authored.gbr'), settings: { config: { formatOverride: null, assumeLinear: false }, points: Array.from({ length: 4 }, (_, i) => ({ id: String(i), role: i === 3 ? 'check' : 'fit', cad: ['', ''], gerber: ['', ''], evidence: '' })), scope: { module: 'FICTIONAL', side: 'Top', boardInstance: 'one' }, tolerance: '.1', basis: '', checked: false } };
const input = { placement, gerber, original, returned, notes, machineVersion: 'Fictional version; no compatibility claim' };

test('whole project preserves all original bytes, role distinctions, mappings, notes and machine version', async () => {
  const saved = await encodeProject(input);
  const restored = await decodeProject(asFile(saved));
  assert.deepEqual(Buffer.from(await restored.original.file.arrayBuffer()), archiveBytes);
  assert.deepEqual(Buffer.from(await restored.returned.file.arrayBuffer()), Buffer.from(await returned.file.arrayBuffer()));
  assert.equal(await restored.placement.source.text(), await placement.file.text());
  assert.equal(await restored.gerber.file.text(), await gerber.file.text());
  assert.deepEqual(restored.placement.record.config, config);
  assert.deepEqual(restored.gerber.draft.scope, gerber.settings.scope);
  assert.equal(restored.original.record.selection.jobRole, 'temp');
  assert.equal(restored.returned.record.selection.jobRole, 'main');
  assert.equal(restored.returned.record.selection.masterMember, null);
  assert.deepEqual(restored.record.notes, notes);
  assert.equal(restored.record.machineVersion, input.machineVersion);
  assert.equal(restored.record.machineExportAllowed, false);
  assert.equal(Object.hasOwn(restored.record, 'evidence'), false);
});

test('archive-only and incomplete selection projects reopen without invented placement or snapshot choices', async () => {
  const saved = await encodeProject({ ...input, placement: null, gerber: null, returned: null, original: { ...original, selection: null, draft: { root: original.selection.root, job: original.draft.job, master: '' } } });
  const restored = await decodeProject(asFile(saved));
  assert.equal(restored.placement, null);
  assert.equal(restored.gerber, undefined);
  assert.equal(restored.original.record.selection, null);
  assert.equal(restored.original.record.draft.master, '');
  assert.equal(restored.original.record.draft.job, original.draft.job);
});

test('all embedded bytes are checked before a restored project is returned', async () => {
  const record = JSON.parse(await (await encodeProject(input)).text());
  for (const locate of [value => value.placement.source, value => value.gerber.source, value => value.archives.original.source, value => value.archives.returned.source]) {
    const changed = structuredClone(record); locate(changed).sha256 = '0'.repeat(64);
    await assert.rejects(decodeProject(asFile(changed)), /do not match their hash/);
  }
  const changed = structuredClone(record);
  changed.archives.original.source.base64 = '!' + changed.archives.original.source.base64.slice(1);
  await assert.rejects(decodeProject(asFile(changed)), /base64/);
});

test('saved derived results, authority flags, changed roles and unbound evidence are rejected', async () => {
  const record = JSON.parse(await (await encodeProject(input)).text());
  for (const mutate of [value => { value.archiveReview = { status: 'success' }; }, value => { value.machineExportAllowed = true; }, value => { value.archives.returned.preflight = {}; }, value => { value.archives.original.selection.jobRole = 'main'; }, value => { value.archives.original.source.size = ARCHIVE_MAX_BYTES + 1; }, value => { value.archives.original.source.name = '../source.zip'; }, value => { value.archives.original.selection.masterRole = null; }, value => { value.gerber.alignment = { status: 'success' }; }]) {
    const changed = structuredClone(record); mutate(changed);
    assert.throws(() => validateProjectSession(changed));
  }
  const annotation = { id: 'authored-note', sourceSha256: record.archives.original.source.sha256, recordedAt: '2026-01-02T03:04:05Z', summary: 'Explicit human annotation only.' };
  const withEvidence = { ...record, evidence: { authority: 'annotations-only', decisions: [annotation], candidateHistory: [{ ...annotation, candidateSha256: 'b'.repeat(64) }], machineObservations: [{ ...annotation, machineVersion: 'fictional-version' }] } };
  const restored = await decodeProject(asFile(withEvidence));
  assert.deepEqual(restored.record.evidence, withEvidence.evidence);
  for (const mutate of [value => { value.evidence.authority = 'approved'; }, value => { value.evidence.decisions[0].sourceSha256 = 'a'.repeat(64); }, value => { value.evidence.decisions[0].approved = true; }]) {
    const changed = structuredClone(withEvidence); mutate(changed); assert.throws(() => validateProjectSession(changed));
  }
});

test('project limits reject before reading oversized files; chunk boundaries preserve every byte', async () => {
  const oversized = new File(['x'], 'too-large.zip'); Object.defineProperty(oversized, 'size', { value: ARCHIVE_MAX_BYTES + 1 });
  oversized.arrayBuffer = () => { throw new Error('Must not allocate source bytes'); };
  await assert.rejects(encodeProject({ ...input, placement: null, gerber: null, returned: null, original: { ...original, file: oversized } }), /100 MB/);
  const oversizedProject = new File(['{}'], 'too-large.json'); Object.defineProperty(oversizedProject, 'size', { value: PROJECT_MAX_BYTES + 1 });
  oversizedProject.text = () => { throw new Error('Must not read the project'); };
  await assert.rejects(decodeProject(oversizedProject), /300 MB/);
  // Authored byte data exercises the base64 transport boundary, not ZIP parsing.
  const bytes = new Uint8Array(3 * 32768 + 1); for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
  const saved = await encodeProject({ ...input, placement: null, gerber: null, returned: null, original: { ...original, file: new File([bytes], 'authored-transport.zip') } });
  const restored = await decodeProject(asFile(saved));
  assert.deepEqual(new Uint8Array(await restored.original.file.arrayBuffer()), bytes);
  await assert.rejects(encodeProject({ ...input, original: null }), /original archive/);
});

test('legacy source-only reviews still reopen through project intake', async () => {
  const saved = await encodeReview(placement.file, settings);
  const restored = await decodeProject(asFile(saved));
  assert.equal(await restored.placement.source.text(), await placement.file.text());
  assert.equal(restored.original, null); assert.equal(restored.returned, null);
  assert.equal(restored.record.machineVersion, '');
});

test('fresh inventory and preflight must match every explicit role, source hash and master choice', () => {
  const selected = original.selection;
  const inventory = { job_roots: [{ root: selected.root, main_candidates: [syntheticSelection.jobMember], temp_candidates: [selected.jobMember], backup_candidates: [], master_candidates: [selected.masterMember] }], entries: [{ path: selected.masterMember, snapshot_role: 'unknown' }] };
  assert.equal(selectionInInventory(selected, inventory), true);
  assert.equal(selectionInInventory({ ...selected, jobRole: 'main' }, inventory), false);
  assert.equal(selectionInInventory({ ...selected, masterRole: 'temp' }, inventory), false);
  const source = { sha256: 'a'.repeat(64), size: 23 };
  const review = { artifactType: 'scan.archive-review', status: 'success', machineExportAllowed: false, preflight: { source, selection: { root: selected.root, job: { member: selected.jobMember, role: selected.jobRole }, master: { member: selected.masterMember, role: selected.masterRole } } } };
  assert.equal(reviewMatchesSelection(review, selected, source), true);
  for (const mutate of [value => { value.preflight.selection.job.role = 'main'; }, value => { value.preflight.selection.master = null; }, value => { value.preflight.source = { ...source, size: 24 }; }, value => { value.preflight.source = { ...source, sha256: 'b'.repeat(64) }; }, value => { value.machineExportAllowed = true; }]) {
    const changed = structuredClone(review); mutate(changed); assert.equal(reviewMatchesSelection(changed, selected, source), false);
  }
});

test('reopened authored archives support fresh worker inventory and selected preflight', async () => {
  const restored = await decodeProject(asFile(await encodeProject(input)));
  for (const saved of [restored.original, restored.returned]) {
    const bytes = Buffer.from(await saved.file.arrayBuffer());
    const response = await archiveWorker(bytes, { action: 'inventory' }, new AbortController().signal);
    const { inventory } = await response.json();
    assert.equal(inventory.archive_sha256, saved.record.source.sha256);
    assert.equal(selectionInInventory(saved.record.selection, inventory), true);
    const preflight = await archiveWorker(bytes, { action: 'preflight', expectedArchiveSha256: saved.record.source.sha256, selection: saved.record.selection }, new AbortController().signal);
    assert.equal(reviewMatchesSelection(await preflight.json(), saved.record.selection, saved.record.source), true);
  }
});

test('source replacement invalidates only annotations without a retained source hash', () => {
  const note = { id: 'original-note', sourceSha256: 'a'.repeat(64), recordedAt: '2026-01-02T03:04:05Z', summary: 'Authored history only.' };
  const evidence = { authority: 'annotations-only', decisions: [note, { ...note, id: 'returned-note', sourceSha256: 'b'.repeat(64) }], candidateHistory: [{ ...note, candidateSha256: 'c'.repeat(64) }], machineObservations: [{ ...note, sourceSha256: 'b'.repeat(64), machineVersion: 'fictional' }] };
  const retained = retainProjectEvidence(evidence, new Set(['a'.repeat(64)]));
  assert.equal(retained.removed, 2);
  assert.deepEqual(retained.evidence.decisions, [note]);
  assert.deepEqual(retained.evidence.candidateHistory, evidence.candidateHistory);
  assert.deepEqual(retained.evidence.machineObservations, []);
  assert.equal(retained.evidence.authority, 'annotations-only');
  assert.deepEqual(retainProjectEvidence(evidence, new Set(['a'.repeat(64), 'b'.repeat(64)])), { evidence, removed: 0 });
  assert.deepEqual(retainProjectEvidence(evidence, new Set()), { evidence: undefined, removed: 4 });
});

test('placement invalidation preserves the project note while dropping exact-row annotations', () => {
  const existing = Object.freeze({ session: 'Native job questions remain relevant when placement changes.', 'row:1': 'Only this previous row.', 'row:240': 'Old source identity.' });
  assert.deepEqual(retainSessionNote(existing), { session: existing.session });
  assert.deepEqual(retainSessionNote({ 'row:1': 'Old row only.' }), {});
  assert.deepEqual(retainSessionNote({ session: '' }), { session: '' });
  assert.equal(existing['row:1'], 'Only this previous row.');
});
