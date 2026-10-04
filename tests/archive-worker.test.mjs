import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { createHash } from 'node:crypto';
import { readdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { archiveWorker } from '../lib/scan/archive-worker.ts';
import { POST } from '../app/api/archive/route.ts';
import { makeArchive, syntheticMembers, syntheticSelection } from './synthetic-archive.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const bytes = makeArchive();
const signal = () => new AbortController().signal;
const selection = syntheticSelection;
const control = { action: 'preflight', expectedArchiveSha256: hash(bytes), selection };
const dirs = async () => (await readdir(tmpdir())).filter(value => value.startsWith('scan-archive-')).sort();
const originalTemp = { TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR };
const originalTempRoot = path.resolve(tmpdir());
let testTemporary;
before(async () => {
  testTemporary = await mkdtemp(path.join(originalTempRoot, 'scan-worker-tests-'));
  for (const key of Object.keys(originalTemp)) process.env[key] = testTemporary;
});
after(async () => {
  for (const [key, value] of Object.entries(originalTemp)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  if (testTemporary && path.dirname(path.resolve(testTemporary)) === originalTempRoot && path.basename(testTemporary).startsWith('scan-worker-tests-')) await rm(testTemporary, { recursive: true, force: true });
});

test('real archive inventory, capture receipt, XML preflight and streamed download agree', async () => {
  const before = await dirs();
  const inventory = await (await archiveWorker(bytes, { action: 'inventory' }, signal())).json();
  assert.equal(inventory.inventory.archive_sha256, hash(bytes));
  const review = await (await archiveWorker(bytes, control, signal())).json();
  assert.equal(review.status, 'success');
  assert.equal(review.preflight.xmlEnvelopes.job.status, 'well-formed');
  assert.equal(review.preflight.machineExportAllowed, false);
  assert.equal(review.preflight.readiness.packageComplete, null);
  const response = await archiveWorker(bytes, { ...control, action: 'download', expectedPackageSha256: review.capture.packageSha256 }, signal());
  assert.equal(response.headers.get('x-scan-sha256'), review.capture.packageSha256);
  const downloaded = Buffer.from(await response.arrayBuffer());
  assert.equal(hash(downloaded), review.capture.packageSha256);
  assert.equal(downloaded.length, review.capture.size);
  assert.deepEqual(await dirs(), before);
});

test('wrong hashes, unknown/path fields and invalid selection fail closed', async () => {
  for (const input of [{ ...control, expectedArchiveSha256: '0'.repeat(64) }, { ...control, selection: { ...selection, jobRole: 'temp' } }, { ...control, destination: 'should-never-be-used' }, { ...control, action: 'download', expectedPackageSha256: '0'.repeat(64) }]) {
    const result = await (await archiveWorker(bytes, input, signal())).json();
    assert.equal(result.status, 'blocked');
  }
  const malformed = makeArchive({ ...syntheticMembers, [selection.jobMember]: '<Malformed' });
  const result = await (await archiveWorker(malformed, { ...control, expectedArchiveSha256: hash(malformed) }, signal())).json();
  assert.equal(result.preflight.xmlEnvelopes.job.status, 'blocked');
  assert.equal(result.machineExportAllowed, false);
});

test('preserved native reference streams verified evidence without applying native edits', async () => {
  const before = await dirs();
  const review = await (await archiveWorker(bytes, control, signal())).json();
  const response = await archiveWorker(bytes, { ...control, action: 'reference', expectedPackageSha256: review.capture.packageSha256 }, signal());
  assert.equal(response.headers.get('x-scan-source-sha256'), hash(bytes));
  assert.equal(response.headers.get('x-scan-native-edits'), 'none');
  const output = Buffer.from(await response.arrayBuffer());
  assert.equal(hash(output), response.headers.get('x-scan-sha256'));
  assert.equal(output.length, Number(response.headers.get('content-length')));
  assert.deepEqual(await dirs(), before);
  const stale = await (await archiveWorker(bytes, { ...control, action: 'reference', expectedPackageSha256: '0'.repeat(64) }, signal())).json();
  assert.equal(stale.status, 'blocked');
});

test('aborts, stream cancellation and unavailable interpreter release their temporary resources', async () => {
  const before = await dirs();
  const abort = new AbortController(); abort.abort();
  await assert.rejects(archiveWorker(bytes, control, abort.signal), /cancelled/);
  const inFlight = new AbortController(); const pending = archiveWorker(bytes, control, inFlight.signal); inFlight.abort();
  await assert.rejects(pending, /cancelled/);
  const review = await (await archiveWorker(bytes, control, signal())).json();
  const response = await archiveWorker(bytes, { ...control, action: 'download', expectedPackageSha256: review.capture.packageSha256 }, signal());
  await response.body.cancel();
  const previous = process.env.SCAN_PYTHON; process.env.SCAN_PYTHON = 'SCAN-nonexistent-python-command';
  try { await assert.rejects(archiveWorker(bytes, control, signal()), /unavailable/); }
  finally { if (previous === undefined) delete process.env.SCAN_PYTHON; else process.env.SCAN_PYTHON = previous; }
  assert.equal((await (await archiveWorker(bytes, { action: 'inventory' }, signal())).json()).code, 'INVENTORIED');
  assert.deepEqual(await dirs(), before);
});

test('an active archive upload rejects another before reading its body', async () => {
  let finish;
  const headers = { origin: 'http://127.0.0.1:3210', host: '127.0.0.1:3210', 'content-type': 'multipart/form-data; boundary=fixture' };
  const firstBody = new ReadableStream({ start(controller) { finish = () => { controller.enqueue(new TextEncoder().encode('--fixture--\r\n')); controller.close(); }; } });
  const first = POST(new Request('http://127.0.0.1:3210/api/archive', { method: 'POST', headers, body: firstBody, duplex: 'half' }));
  let reads = 0;
  const secondBody = new ReadableStream({ pull() { reads += 1; } }, { highWaterMark: 0 });
  const rejected = await POST(new Request('http://127.0.0.1:3210/api/archive', { method: 'POST', headers, body: secondBody, duplex: 'half' }));
  assert.match((await rejected.json()).message, /already running/);
  assert.equal(reads, 0);
  finish(); await first; await secondBody.cancel();
  assert.equal((await (await archiveWorker(bytes, { action: 'inventory' }, signal())).json()).code, 'INVENTORIED');
});

test('a pre-aborted archive upload cancels its stalled body and releases admission', async () => {
  const abort = new AbortController(); abort.abort(); let cancelled = false;
  const body = new ReadableStream({ cancel() { cancelled = true; } }, { highWaterMark: 0 });
  const response = await POST(new Request('http://127.0.0.1:3210/api/archive', { method: 'POST', headers: { origin: 'http://127.0.0.1:3210', host: '127.0.0.1:3210', 'content-type': 'multipart/form-data; boundary=fixture' }, body, duplex: 'half', signal: abort.signal }));
  assert.equal(response.status, 408); assert.equal(cancelled, true);
  assert.equal((await (await archiveWorker(bytes, { action: 'inventory' }, signal())).json()).code, 'INVENTORIED');
});
