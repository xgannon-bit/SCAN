import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { originEvidenceWorker, validateOriginEvidenceControl } from '../lib/scan/origin-evidence-worker.ts';
import { initialBomConfig } from '../lib/scan/bom-types.ts';
import { POST } from '../app/api/origin-evidence/route.ts';
import { reserveWorker } from '../lib/scan/worker-budget.ts';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const python = process.env.SCAN_PYTHON || path.join(process.cwd(), '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
function fixture() {
  const generated = spawnSync(python, ['-c', 'import json\nfrom workers.scan.tests.test_paired_terminal_constructor import fixture\nj,m,p,e=fixture(angle=90)\nprint(json.dumps({"pcb":p.decode(),"profile":e}))'], { encoding: 'utf8', windowsHide: true, shell: false });
  assert.equal(generated.status, 0, 'Authored synthetic geometry generated locally.');
  const { pcb: raw, profile } = JSON.parse(generated.stdout);
  const pcb = Buffer.from(raw), bom = Buffer.from('Quantity,RefDes,Value,Description,Manufacturer,MPN,Footprint\n1,N1,VALUE,Invented body,FABLE,fictional-coil,invented-coil\n');
  return { pcb, bom, control: { layoutSha256: hash(pcb), bomSha256: hash(bom), bomSheetIndex: 0, bomDelimiter: ',', bomConfig: initialBomConfig(), packageProfiles: [profile] } };
}
function request(f, change = () => {}, headers = {}) {
  const form = new FormData();
  form.append('pcb', new File([f.pcb], 'invented.pcb'));
  form.append('bom', new File([f.bom], 'invented.csv'));
  form.append('control', JSON.stringify(f.control));
  change(form);
  return new Request('http://127.0.0.1:3213/api/origin-evidence', { method: 'POST', body: form,
    headers: { host: '127.0.0.1:3213', origin: 'http://127.0.0.1:3213', ...headers } });
}

test('actual two-file worker and route derive source-owned evidence without native/centroid input', async () => {
  const f = fixture();
  const result = await originEvidenceWorker(f.pcb, f.bom, { ...f.control, bomKind: 'csv' }, new AbortController().signal);
  assert.equal(result.status, 'success');
  assert.equal(result.layoutSha256, hash(f.pcb)); assert.equal(result.bomSha256, hash(f.bom));
  assert.equal(result.records.length, 1); assert.equal(result.records[0].reference, 'N1');
  assert.equal(result.records[0].status, 'supported'); assert.equal(result.records[0].mpnMatched, true);
  assert.equal(result.records[0].sourceSide, null); // Geometry never establishes physical side.
  assert.equal(result.nativeEditsApplied, false); assert.equal(result.machineQualified, false);
  const response = await POST(request(f));
  assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await response.json(), result);
  assert.equal(hash(f.pcb), f.control.layoutSha256); assert.equal(hash(f.bom), f.control.bomSha256);
});

test('source hashes, bounds, unexpected settings and cancelled work refuse before evidence publication', async () => {
  const f = fixture(), signal = new AbortController().signal;
  await assert.rejects(originEvidenceWorker(f.pcb, f.bom, { ...f.control, bomKind: 'csv', layoutSha256: '0'.repeat(64) }, signal), /hashes changed/);
  await assert.rejects(originEvidenceWorker(Buffer.alloc(8_000_001), f.bom, { ...f.control, bomKind: 'csv' }, signal), /8 MB/);
  await assert.rejects(originEvidenceWorker(f.pcb, Buffer.alloc(0), { ...f.control, bomKind: 'csv' }, signal), /8 MB/);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(originEvidenceWorker(f.pcb, f.bom, { ...f.control, bomKind: 'csv' }, abort.signal), /cancelled/);
  for (const changed of [{ ...f.control, desiredCenter: [1, 2] }, { ...f.control, bomSheetIndex: 20 }, { ...f.control, bomDelimiter: '|' },
    { ...f.control, bomConfig: { ...f.control.bomConfig, release: true } }, { ...f.control, packageProfiles: [...f.control.packageProfiles, ...f.control.packageProfiles] }]) {
    assert.throws(() => validateOriginEvidenceControl(changed));
  }
  const stale = await POST(request({ ...f, control: { ...f.control, bomSha256: '0'.repeat(64) } }));
  assert.equal(stale.status, 400); assert.match((await stale.json()).message, /hashes changed/);
});

test('route refuses foreign origins, duplicated fields, unsupported file types and oversized controls', async () => {
  const f = fixture();
  assert.equal((await POST(request(f, undefined, { origin: 'https://outside.invalid' }))).status, 403);
  assert.equal((await POST(request(f, undefined, { 'content-length': '16270001' }))).status, 413);
  for (const change of [
    form => form.append('control', JSON.stringify(f.control)), form => form.append('nativeJob', 'not accepted'),
    form => form.set('pcb', new File([f.pcb], 'unsupported.xml')), form => form.set('bom', new File([f.bom], 'unsupported.txt')),
    form => form.set('control', '{bad'), form => form.set('control', ' '.repeat(240001)),
    form => form.set('control', JSON.stringify({ ...f.control, bomConfig: { ...f.control.bomConfig, unsupported: true } })),
  ]) assert.equal((await POST(request(f, change))).status, 400);
});

test('blocked parsing and unavailable runtime clean up both private captured files', async () => {
  const f = fixture(), parent = await mkdtemp(path.join(tmpdir(), 'scan-origin-test-'));
  const original = { TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR, SCAN_PYTHON: process.env.SCAN_PYTHON };
  try {
    process.env.TEMP = parent; process.env.TMP = parent; process.env.TMPDIR = parent;
    const invalid = Buffer.from('invented non-PCB');
    const result = await originEvidenceWorker(invalid, f.bom, { ...f.control, bomKind: 'csv', layoutSha256: hash(invalid) }, new AbortController().signal);
    assert.equal(result.status, 'blocked'); assert.equal(result.nativeEditsApplied, false);
    assert.deepEqual(await readdir(parent), []);
    process.env.SCAN_PYTHON = path.join(parent, 'nonexistent-python');
    await assert.rejects(originEvidenceWorker(f.pcb, f.bom, { ...f.control, bomKind: 'csv' }, new AbortController().signal), /Local Python worker is unavailable/);
    assert.deepEqual(await readdir(parent), []);
  } finally {
    for (const [name, value] of Object.entries(original)) if (value === undefined) delete process.env[name]; else process.env[name] = value;
    const resolved = path.resolve(parent);
    assert.equal(path.dirname(resolved), path.resolve(tmpdir()));
    assert.ok(path.basename(resolved).startsWith('scan-origin-test-'));
    await rm(resolved, { recursive: true, force: true });
  }
});

function streamingRequest(body, signal) {
  return new Request('http://127.0.0.1:3213/api/origin-evidence', { method: 'POST', body, duplex: 'half', signal,
    headers: { host: '127.0.0.1:3213', origin: 'http://127.0.0.1:3213', 'content-type': 'multipart/form-data; boundary=synthetic-boundary' } });
}
function assertBudgetReleased() {
  const one = reserveWorker('placement');
  try { const two = reserveWorker('placement'); two(); } finally { one(); }
}

test('upload admission rejects before reading and transfers one slot through the real worker', async () => {
  let pulls = 0;
  const stream = new ReadableStream({ pull() { pulls++; } }, { highWaterMark: 0 });
  const one = reserveWorker('placement'), two = reserveWorker('placement');
  try {
    const response = await POST(streamingRequest(stream));
    assert.equal(response.status, 400); assert.match((await response.json()).message, /Two imports/);
    assert.equal(pulls, 0);
  } finally { one(); two(); await stream.cancel(); }
  const occupied = reserveWorker('placement');
  try {
    // With one other slot occupied, double reservation would fail this request.
    const response = await POST(request(fixture()));
    assert.equal(response.status, 200); assert.equal((await response.json()).status, 'success');
  } finally { occupied(); }
  assertBudgetReleased();
});

test('stalled upload abort returns promptly even when stream cancellation never acknowledges', async () => {
  let cancelled = 0;
  const stream = new ReadableStream({ cancel() { cancelled++; return new Promise(() => {}); } }, { highWaterMark: 0 });
  const abort = new AbortController(), response = POST(streamingRequest(stream, abort.signal));
  abort.abort();
  const result = await response;
  assert.equal(result.status, 408); assert.equal(cancelled, 1); assert.match((await result.json()).message, /interrupted/);
  assert.equal(stream.locked, false); assertBudgetReleased();
});

test('upload deadline bounds a stalled body and releases its admission slot', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let cancelled = 0;
  const stream = new ReadableStream({ cancel() { cancelled++; } }, { highWaterMark: 0 });
  const response = POST(streamingRequest(stream));
  context.mock.timers.tick(30_000);
  const result = await response;
  assert.equal(result.status, 408); assert.equal(cancelled, 1); assert.match((await result.json()).message, /30-second limit/);
  assert.equal(stream.locked, false); assertBudgetReleased();
});

test('streamed body overrun cannot wait indefinitely for cancellation cleanup', async () => {
  const stream = new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(16_270_001)); },
    cancel() { return new Promise(() => {}); },
  }, { highWaterMark: 0 });
  const result = await POST(streamingRequest(stream));
  assert.equal(result.status, 413); assert.equal(stream.locked, false); assertBudgetReleased();
});
