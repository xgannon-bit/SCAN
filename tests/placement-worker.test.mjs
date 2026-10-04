import assert from 'node:assert/strict';
import test from 'node:test';
import { permittedOrigin, placementWorker } from '../lib/scan/placement-worker.ts';

test('placement origin gate requires exact loopback origin and host', () => {
  assert.equal(permittedOrigin('http://127.0.0.1:3210', '127.0.0.1:3210'), true);
  for (const [origin, host] of [[null, '127.0.0.1:3210'], ['https://evil.invalid', '127.0.0.1:3210'], ['http://127.0.0.1:3211', '127.0.0.1:3210'], ['http://127.0.0.1.evil.invalid', '127.0.0.1.evil.invalid']]) {
    assert.equal(permittedOrigin(origin, host), false);
  }
});

test('real placement worker reads quoted CSV without a shell', async () => {
  const result = await placementWorker(Buffer.from('R7,FICTIONAL,"1,2",Top,90\n'), {
    action: 'normalize', format: 'csv', sheetIndex: 0, delimiter: ',',
    config: { startRow: 1, columns: { refdes: 1, mpn: 2, xy: 3, side: 4, rotation: 5 }, module: 'Fictional;$(inert)', side: '', units: 'mm', rotationDirection: 'ccw', decimalSeparator: '.', pairSeparator: ',' },
  }, new AbortController().signal);
  assert.equal(result.status, 'success');
  assert.equal(result.placements[0].module, 'Fictional;$(inert)');
  assert.equal(result.placements[0].xMm, '1');
  assert.equal(result.machineExportAllowed, false);
});

test('aborted worker and excessive input fail closed', async () => {
  await assert.rejects(placementWorker(Buffer.alloc(8_000_001), {}, new AbortController().signal), /8 MB/);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(placementWorker(Buffer.from('a'), {}, abort.signal), /cancelled/);
});
