import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { processingDecoder, readProcessing, startProcessing } from '../lib/scan/processing-journal.ts';
import { validGeometry } from '../lib/scan/processing-event.ts';
import { appendVisualEvent, emptyVisualWorkspace, validateVisualWorkspace } from '../lib/scan/visual-workspace.ts';
import { GET } from '../app/api/archive/progress/route.ts';

const geometry = { frame: 'native-roi-unqualified', identity: { module: 'invented-module', ref: 'F12', id: '17', master: '8' }, before: { x: 1, y: -2, width: 3, height: 2, angle: 90 }, after: { x: 2.5, y: -1, width: 3, height: 2, angle: 90 } };
const progress = { kind: 'placement-checked', geometry };
test('worker channel ignores private diagnostics, malformed and oversized lines; chunked events preserve exact values', () => {
  const events = [], decoder = processingDecoder(v => events.push(v));
  decoder('private diagnostic\nSCAN_COMPONENT_V1 broken\n');
  decoder('SCAN_COMPONENT_V1 ' + 'x'.repeat(9000)); decoder('\n');
  const line = 'SCAN_COMPONENT_V1 ' + JSON.stringify(progress) + '\n';
  for (let i = 0; i < line.length; i += 7) decoder(line.slice(i, i + 7));
  assert.deepEqual(events, [progress]);
  decoder('SCAN_COMPONENT_V1 ' + JSON.stringify({ ...progress, approval: true }) + '\n'); assert.equal(events.length, 1);
});
test('local transport binds run and source, caps retained events and refuses late events; GET is same-origin and no-store', async () => {
  const id = randomUUID(), run = startProcessing(id, 'a'.repeat(64));
  assert.throws(() => startProcessing(id, 'a'.repeat(64)));
  for (let i = 0; i < 1028; i++) run.record(progress);
  let journal = readProcessing(id); assert.equal(journal.events.length, 1024); assert.equal(journal.dropped, 4);
  assert.equal(journal.events.at(-1).sequence, 1024); assert.equal(journal.source, 'a'.repeat(64));
  journal.events[0].geometry.after.x = 999; assert.equal(readProcessing(id).events[0].geometry.after.x, 2.5);
  run.end(); run.record(progress); assert.equal(readProcessing(id).dropped, 4); assert.equal(readProcessing(id).ended, true);
  const url = 'http://127.0.0.1:3219/api/archive/progress';
  assert.equal((await GET(new Request(url, { headers: { host: '127.0.0.1:3219', 'X-SCAN-Progress': id, origin: 'https://unrelated.invalid' } }))).status, 403);
  const response = await GET(new Request(url, { headers: { host: '127.0.0.1:3219', 'X-SCAN-Progress': id, referer: 'http://127.0.0.1:3219/workspace', 'sec-fetch-site': 'same-origin' } }));
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await response.json()).events.length, 1024);
});
test('historical component geometry is bounded presentation data, supports ordered progress and cannot add authority', () => {
  const event = { id: 'first', run: 'run', sequence: 1, at: '2026-01-01T00:00:00Z', source: 'b'.repeat(64), stage: 'Native writer checks', status: 'started', message: 'Actual checks', count: null, entity: null };
  let events = appendVisualEvent([], event);
  events = appendVisualEvent(events, { ...event, id: 'second', sequence: 2, status: 'progress', geometry });
  events = appendVisualEvent(events, { ...event, id: 'third', sequence: 3, status: 'progress', geometry });
  events = appendVisualEvent(events, { ...event, id: 'done', sequence: 4, status: 'completed' });
  assert.equal(events.length, 4); assert.equal(appendVisualEvent(events, { ...event, id: 'late', sequence: 5, status: 'progress', geometry }), events);
  const saved = { ...emptyVisualWorkspace(), events }; assert.deepEqual(validateVisualWorkspace(JSON.parse(JSON.stringify(saved))), saved);
  assert.equal(validGeometry({ ...geometry, after: { ...geometry.after, x: Infinity } }), false);
  for (const changed of [{ ...geometry, frame: 'qualified' }, { ...geometry, machineVerified: true }, { ...geometry, identity: { ...geometry.identity, master: '' } }]) {
    assert.throws(() => validateVisualWorkspace({ ...saved, events: [{ ...events[1], geometry: changed }] }));
  }
});
