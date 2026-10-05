import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSourceCrosswalk } from '../lib/scan/source-crosswalk.ts';
import { initialBomConfig } from '../lib/scan/bom-types.ts';
import { encodeProject, decodeProject } from '../lib/scan/project-session.ts';
import { translationDiagnostic } from '../lib/scan/source-registration-diagnostic.ts';

test('translation diagnosis holds out checks and never promotes different origins to defects', () => {
  const from = Array.from({ length: 8 }, (_, i) => ({ reference: `R${i}`, x: i * 3, y: i % 3 * 4 }));
  const to = from.map(item => ({ ...item, x: item.x + 20, y: item.y - 7 }));
  to[7].x += 2;
  const result = translationDiagnostic(from, to);
  assert.deepEqual(result.translationMm, [20, -7]);
  assert.equal(result.fitMaxResidualMm, 0);
  assert.equal(result.heldOutMaxResidualMm, 2);
  assert.equal(result.withinDiagnosticThreshold, 7);
  assert.equal(result.qualification, 'unqualified');
  assert.equal(result.machineExportAllowed, false);
  const collided = translationDiagnostic([...from, { ...from[0] }], to);
  assert.equal(collided.matched, 7);
  assert.equal(translationDiagnostic(from.slice(0, 3), to).status, 'insufficient-correspondences');
});

test('source union shows missing refs, normalization conflicts and DNP without inventing preparation', () => {
  const scope = { module: '', side: '', boardInstance: '' };
  const ref = (raw, mpn, population = 'engineering-listed') => ({ sourceRow: 2, rawRefdes: raw, normalizedRefdes: raw.toUpperCase(), scope, mpn, rawMpn: mpn, populationEvidence: population });
  const bom = { sourceSha256: 'a'.repeat(64), config: { scope }, references: [ref('Cn8', 'A-B C'), ref('R9', null, 'engineering-dnp'), ref('D4', 'DI-O-DE')] };
  const placement = { sourceSha256: 'b'.repeat(64), coordinateFrame: 'unregistered-source-mm', placements: [{ sourceRow: 1, refdes: 'CN8', module: 'X', side: 'Top', mpn: 'A-BC', xMm: '1', yMm: '2' }, { sourceRow: 2, refdes: 'R9', module: 'X', side: 'Top', mpn: null, xMm: '3', yMm: '4' }] };
  const result = buildSourceCrosswalk(bom, placement, null);
  assert.deepEqual(result.missingFromActivePlacement, ['D4']);
  assert.deepEqual(result.engineeringDnpReferences, ['R9']);
  assert.match(result.rows.find(row => row.reference === 'CN8').issues.join(), /whitespace removal/);
  assert.ok(result.rows.every(row => row.nativePreparation === 'unassessed' && row.teaching === 'unverified' && row.workOrderPopulation === 'unapproved'));
  assert.equal(result.machineExportAllowed, false);
});

test('BOM-only project plus comparison and layout preserves exact bytes; tampering fails', async () => {
  const bom = { file: new File(['1,R1,value,description,FABLE,PART-1,FOOTPRINT'], 'authored.csv'), config: initialBomConfig(), sheet: 0, delimiter: ',', checked: true };
  const comparison = { file: new File(['R1,1,2'], 'source.csv'), config: { startRow: 1, columns: { refdes: 1, x: 2, y: 3 }, module: 'A', side: 'Top', units: 'mm', rotationDirection: 'ccw', decimalSeparator: '.', pairSeparator: ',', encoding: 'windows-1252', csvRecovery: true }, sheetIndex: 0, delimiter: ',', result: { status: 'success' } };
  const layout = { file: new File(['ACCEL_ASCII "authored"'], 'authored.pcb'), checked: true };
  const blob = await encodeProject({ placement: null, gerber: null, original: null, returned: null, notes: {}, machineVersion: '', bom, comparisons: [comparison], layout });
  const record = JSON.parse(await blob.text());
  const restored = await decodeProject(new File([blob], 'authored.scan-project.json'));
  assert.equal(await restored.bom.file.text(), await bom.file.text());
  assert.deepEqual(restored.bom.config, bom.config);
  assert.equal(await restored.layout.file.text(), await layout.file.text());
  assert.deepEqual(restored.comparisons[0].config, comparison.config);
  assert.equal(restored.comparisons[0].result, null);
  for (const locate of [value => value.bom.source, value => value.comparisons[0].source, value => value.layout.source]) {
    const changed = structuredClone(record); locate(changed).sha256 = '0'.repeat(64);
    await assert.rejects(decodeProject(new File([JSON.stringify(changed)], 'tampered.json')), /hash/);
  }
});
