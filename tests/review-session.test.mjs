import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeReview, decodeReview, validateReviewSession } from '../lib/scan/review-session.ts';
import { buildSourceReport, sourceReportText } from '../lib/scan/source-report.ts';
import { placementWorker } from '../lib/scan/placement-worker.ts';

const config = { startRow: 1, columns: { refdes: 1, mpn: 2, xy: 3, side: 4, rotation: 5 }, module: 'FICTIONAL', side: '', units: 'mm', rotationDirection: 'ccw', decimalSeparator: '.', pairSeparator: ',' };
const settings = { config, sheetIndex: 0, delimiter: ',', validated: true, selectedRow: 2, notes: { session: 'User notes only', 'row:2': 'Check exact duplicate scope' } };
const source = new File(['R1,A,"1,2",Top,0\nR1,B,"3,4",Top,0\n'], 'authored.csv');
const savedFile = value => new File([JSON.stringify(value, null, 2)], 'review.json');

test('saved review preserves original bytes, explicit conventions and blocked review notes', async () => {
  const record = await encodeReview(source, settings);
  const restored = await decodeReview(savedFile(record));
  assert.equal(await restored.source.text(), await source.text());
  assert.deepEqual(restored.record.config, config);
  assert.deepEqual(restored.record.notes, settings.notes);
  assert.equal(restored.record.selectedRow, 2);
  assert.equal(restored.record.machineExportAllowed, false);
  assert.equal(Object.hasOwn(restored.record, 'placementResult'), false);
});

test('tampered bytes, authority flags, stale derived results and unknown mappings cannot be restored', async () => {
  const record = await encodeReview(source, settings);
  for (const mutation of [v => { v.machineExportAllowed = true; }, v => { v.placementResult = { status: 'success' }; }, v => { v.config.columns.arbitrary = 1; }, v => { v.notes['row:0'] = 'bad'; }, v => { v.source.name = '../path.csv'; }]) {
    const changed = structuredClone(record); mutation(changed);
    assert.throws(() => validateReviewSession(changed));
  }
  const changed = structuredClone(record); changed.source.base64 = btoa((await source.text()).replace('R1', 'R2'));
  await assert.rejects(decodeReview(savedFile(changed)), /hash/);
  await assert.rejects(decodeReview(new File(['not JSON'], 'review.json')), /valid JSON/);
});

test('review save rejects a serialized document that cannot be reopened', async () => {
  const notes = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`row:${i + 1}`, '\u0800'.repeat(2000)]));
  await assert.rejects(encodeReview(new File([Buffer.alloc(8_000_000, 65)], 'large.csv'), { ...settings, notes }), /14 MB save limit/);
  await assert.rejects(encodeReview(new File([Buffer.alloc(8_000_001)], 'large.csv'), settings), /8 MB/);
});

test('handoff retains duplicate source rows and notes without clearing actual parser holds', async () => {
  const result = await placementWorker(Buffer.from(await source.arrayBuffer()), { action: 'normalize', format: 'csv', sheetIndex: 0, delimiter: ',', config }, new AbortController().signal);
  const report = buildSourceReport({ sourceName: source.name, result, notes: settings.notes, archiveName: null, archive: null });
  assert.equal(result.status, 'blocked');
  assert.equal(report.placements.length, 2);
  assert.deepEqual(report.placements.map(v => v.sourceRow), [1, 2]);
  assert.equal(report.workItems.find(v => v.sourceRow === 2).annotation, settings.notes['row:2']);
  assert.equal(report.annotationsDoNotResolveHolds, true);
  assert.equal(report.machineExportAllowed, false);
  assert.equal(report.readiness.packageComplete, null);
  assert.match(sourceReportText(report), /Row 1[\s\S]*Row 2/);
});

test('readable handoff distinguishes native root, main/temp/master and capture identities', () => {
  const report = buildSourceReport({ sourceName: null, result: null, notes: {}, archiveName: 'authored.zip', archive: { capture: { snapshotId: 'snapshot-identity', packageSha256: 'b'.repeat(64), size: 1 }, preflight: { source: { sha256: 'a'.repeat(64) }, selection: { root: 'Fictional/Board', job: { role: 'temp', member: 'Fictional/Board/Board_Temp.xml' }, master: null }, holds: [] } } });
  const readable = sourceReportText(report);
  for (const text of ['temp | Fictional/Board/Board_Temp.xml', 'Master snapshot: Explicitly not selected', 'snapshot-identity', 'b'.repeat(64)]) assert.ok(readable.includes(text));
});
