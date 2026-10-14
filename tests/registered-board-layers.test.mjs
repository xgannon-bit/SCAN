import test from 'node:test';
import assert from 'node:assert/strict';
import { registeredBoardLayers, boardLayerPoint } from '../lib/scan/registered-board-layers.ts';
import { preservationIdentity } from '../lib/scan/candidate-proof.ts';

// Wholly authored registration evidence. No customer coordinates or mappings.
const hash = c => c.repeat(64);
const identity = () => [[1, 0, 0], [0, 1, 0]];
function fixture() {
  const placement = { status: 'success', sourceSha256: hash('a'), interpretationSha256: hash('b'), normalizerVersion: 'authored-1', delimiter: ',', coordinateFrame: 'source-mm-y-up', schemaVersion: '1', sheetIndex: 0, mapping: { units: 'mm' }, placements: [{ module: 'source-module', side: 'Top', refdes: 'SYN1', xMm: '2', yMm: '3' }] };
  const baseline = { source: { sha256: hash('c') }, integrity: { status: 'verified-against-capture-hash', allArchivedFilesVerified: true }, selection: { root: 'invented', job: { member: 'invented/job.xml', role: 'main', sha256: hash('d') }, master: { member: 'invented/master.xml', role: 'main', sha256: hash('e') } }, nativeRecords: { job: { status: 'recorded', records: [{ kind: 'module-record', rawFields: { ID: ['7'], Angle: ['0'], 'Shift/X': ['0'], 'Shift/Y': ['0'], 'RotCenter/X': ['0'], 'RotCenter/Y': ['0'] } }] } } };
  const report = { status: 'success', diagnosisSha256: hash('f'), settings: { module: '7', framesConfirmed: true, frameStatement: 'Synthetic independently selected source controls.', sourceSide: 'top', nativeSide: 'top', nativeUnits: 'mm', nativeYDirection: 'up', nativeRotation: 'ccw', nativeRoiAnchor: 'body-center' }, source: { archiveSha256: hash('c'), jobSha256: hash('d'), masterSha256: hash('e'), root: 'invented', jobMember: 'invented/job.xml', masterMember: 'invented/master.xml', placementSha256: hash('a'), layoutSha256: hash('1'), bomSha256: hash('2') }, sourceRegistration: { transform: { matrix: [[0, -1, 10], [1, 0, 20]] } }, frame: { holds: [], transform: { matrix: [[-1, 0, 100], [0, -1, 200]] } } };
  const result = { status: 'success', geometry_complete: true, source_sha256: hash('3'), coordinate_format: { x_integer: 2, x_decimal: 4, y_integer: 2, y_decimal: 4 }, interpretation_overrides: [], adapter_version: 'authored-parser-1', apertures: [{ d_code: 10, template: 'C', parameters: ['1'] }], objects: [{ operation: 'flash', aperture_d_code: 10, end_x: '9', end_y: '-1' }] };
  const basis = JSON.stringify({ placementHash: placement.sourceSha256, normalizedHash: placement.interpretationSha256, normalizer: placement.normalizerVersion, delimiter: placement.delimiter, frame: placement.coordinateFrame, schema: placement.schemaVersion, sheet: placement.sheetIndex, mapping: placement.mapping, gerberHash: result.source_sha256, format: result.coordinate_format, overrides: result.interpretation_overrides, parser: result.adapter_version });
  const alignment = { status: 'success', basis, fingerprint: hash('4'), holds: [], scope: { module: 'source-module', side: 'Top', boardInstance: 'authored-A' }, toleranceMm: .1, maxResidualMm: .005, transform: { matrix: [[1, 0, 7], [0, 1, -4]], scale: 1, mirror: false }, residuals: ['fit', 'fit', 'fit', 'check'].map((role, i) => ({ id: `p${i}`, role, withinTolerance: true, residualMm: .005 })) };
  return { baseline, nativeModule: '7', placement, sourceScope: { module: 'source-module', side: 'Top' }, layoutSha256: hash('1'), bomSha256: hash('2'), currentDiagnosisBasis: 'current-source-and-interpretation', finding: { basis: 'current-source-and-interpretation', report }, gerber: { result, alignment, basis } };
}
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} differs from ${b}`);
test('candidate layers need fresh exact ROI-only frame proof; unrelated frames and stale proofs stay held', () => {
  const input = fixture(); input.candidateView = true;
  input.baseline.nativeRecords.job.schemaVersionClaim = '10.1';
  input.candidate = structuredClone(input.baseline); input.candidate.source.sha256 = hash('9'); input.candidate.selection.job.sha256 = hash('8');
  input.candidateRequest = { proposals: [{ id: 'x', path: 'JobContainer/PartDataList/PartData[1]/Roi/cx', beforeRoi: { cx: '1', cy: '2', w: '3', h: '4', a: '0' } }], acceptances: [{ proposalId: 'x', decision: 'accepted' }] };
  assert.equal(registeredBoardLayers(input).cad.matrix, null);
  input.preservationProof = { identity: preservationIdentity(input.baseline, input.candidate, input.candidateRequest), work: { originalSha256: input.baseline.source.sha256, candidateSha256: input.candidate.source.sha256, actualCandidateRecordsVerified: true } };
  assert.equal(registeredBoardLayers(input).cad.status, 'supported-diagnostic');
  assert.equal(registeredBoardLayers(input).gerber.provenance.candidateSha256, input.candidate.source.sha256);
  for (const mutate of [x => x.candidate.source.sha256 = hash('7'), x => x.candidateRequest.acceptances[0].decision = 'rejected', x => x.candidate.selection.master.sha256 = hash('6'), x => x.baseline.source.sha256 = hash('5'), x => x.preservationProof = null]) {
    const next = structuredClone(input); mutate(next); assert.equal(registeredBoardLayers(next).cad.matrix, null);
  }
  for (const mutate of [x => x.candidate.nativeRecords.job.records[0].rawFields['Shift/X'] = ['2'], x => x.candidate.nativeRecords.job.records[0].rawFields.TB = ['changed'], x => x.candidate.nativeRecords.job.schemaVersionClaim = '11.0', x => x.candidateRequest.proposals[0].path = 'JobContainer/PartDataList/PartData[1]/CenterPosX']) {
    const next = structuredClone(input); mutate(next); next.preservationProof.identity = preservationIdentity(next.baseline, next.candidate, next.candidateRequest);
    assert.equal(registeredBoardLayers(next).cad.matrix, null); assert.equal(registeredBoardLayers(next).gerber.matrix, null);
  }
});
test('existing source and artwork transforms compose into native literals without changing engineering data', () => {
  const input = fixture(), before = structuredClone(input), { cad, gerber } = registeredBoardLayers(input);
  assert.equal(cad.status, 'supported-diagnostic'); assert.equal(gerber.status, 'supported-diagnostic');
  assert.deepEqual(boardLayerPoint(cad.matrix, { x: 2, y: 3 }), { x: 93, y: 178 });
  assert.deepEqual(boardLayerPoint(gerber.matrix, { x: 9, y: -1 }), { x: 93, y: 178 });
  assert.equal(cad.provenance.jobSha256, input.baseline.selection.job.sha256);
  assert.equal(gerber.provenance.boardInstance, 'authored-A');
  assert.equal(cad.machineQualified, false); assert.equal(gerber.padOwnershipEstablished, false);
  assert.deepEqual(input, before);
});
test('explicit native mil/Y-down conversion is inverted once, not guessed from apparent overlap', () => {
  const input = fixture(); input.finding.report.settings.nativeUnits = 'mil'; input.finding.report.settings.nativeYDirection = 'down';
  const { cad, gerber } = registeredBoardLayers(input);
  const point = boardLayerPoint(cad.matrix, { x: 2, y: 3 });
  close(point.x, 93 / .0254); close(point.y, -178 / .0254);
  const artworkPoint = boardLayerPoint(gerber.matrix, { x: 9, y: -1 }); close(artworkPoint.x, point.x); close(artworkPoint.y, point.y);
  for (const setting of ['nativeUnits', 'nativeYDirection', 'nativeRotation', 'nativeRoiAnchor']) {
    const bad = structuredClone(input); bad.finding.report.settings[setting] = 'unknown';
    assert.equal(registeredBoardLayers(bad).cad.matrix, null);
  }
});
test('cardinal and non-cardinal proper registrations preserve the exact composition direction', () => {
  for (const angle of [0, 90, 180, 270, 31]) {
    const input = fixture(), r = angle * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
    input.finding.report.sourceRegistration.transform.matrix = [[c, -s, 10], [s, c, -5]];
    input.finding.report.frame.transform.matrix = identity();
    input.gerber.alignment.transform.matrix = [[c, -s, 7], [s, c, 9]];
    const layers = registeredBoardLayers(input), fromGerber = boardLayerPoint(layers.gerber.matrix, { x: c * 2 - s * 3 + 7, y: s * 2 + c * 3 + 9 });
    close(fromGerber.x, c * 2 - s * 3 + 10); close(fromGerber.y, s * 2 + c * 3 - 5);
  }
});
test('absent, stale and incompatible native/source evidence stays held without blocking native geometry', () => {
  const empty = registeredBoardLayers({ nativeModule: '7', currentDiagnosisBasis: '' });
  assert.equal(empty.cad.matrix, null); assert.ok(empty.cad.holds.some(h => h.code === 'PRIMARY_SOURCE'));
  const changes = [
    x => { x.finding.basis = 'old'; }, x => { x.finding.report.source.jobSha256 = hash('5'); },
    x => { x.finding.report.source.masterMember = 'another/master.xml'; }, x => { x.layoutSha256 = hash('6'); },
    x => { x.baseline.selection.job.role = 'temp'; }, x => { x.baseline.integrity.allArchivedFilesVerified = false; },
    x => { x.nativeModule = '8'; }, x => { x.finding.report.settings.nativeSide = 'bottom'; },
    x => { x.finding.report.frame.holds.push({ code: 'FIT_HELD', message: 'Failed independent control.' }); },
    x => { x.baseline.nativeRecords.job.records.push(structuredClone(x.baseline.nativeRecords.job.records[0])); },
    x => { x.baseline.nativeRecords.job.records[0].rawFields['Shift/X'] = ['1']; },
    x => { delete x.baseline.nativeRecords.job.records[0].rawFields.Angle; },
    x => { x.placement.placements.push({ module: 'other', side: 'Top', refdes: 'SYN1' }); },
  ];
  for (const change of changes) { const input = fixture(); change(input); const layers = registeredBoardLayers(input); assert.equal(layers.cad.status, 'held'); assert.equal(layers.gerber.matrix, null); }
});
test('Gerber requires exact source interpretation and successful scope/check evidence independently of CAD', () => {
  const changes = [
    x => { x.gerber.result.source_sha256 = hash('7'); }, x => { x.gerber.basis = 'not-json'; },
    x => { x.gerber.result.interpretation_overrides = ['changed format']; }, x => { x.gerber.alignment.status = 'blocked'; },
    x => { x.gerber.alignment.scope.module = 'another'; }, x => { x.gerber.alignment.scope.side = 'Bottom'; },
    x => { x.gerber.alignment.scope.boardInstance = ''; }, x => { x.gerber.alignment.residuals[3].role = 'fit'; },
    x => { x.gerber.alignment.residuals[3].withinTolerance = false; }, x => { x.gerber.alignment.transform.scale = 2; },
    x => { x.gerber.result.objects[0].operation = 'draw'; x.gerber.result.apertures[0].parameters = ['2', '1']; },
  ];
  for (const change of changes) { const input = fixture(); change(input); const layers = registeredBoardLayers(input); assert.equal(layers.cad.status, 'supported-diagnostic'); assert.equal(layers.gerber.status, 'held'); assert.equal(layers.gerber.matrix, null); }
});
test('singular, reflected, scaled and non-finite transforms are held rather than normalized', () => {
  for (const bad of [[[0, 0, 0], [0, 0, 0]], [[-1, 0, 0], [0, 1, 0]], [[2, 0, 0], [0, 2, 0]], [[1, .0001, 0], [0, Math.sqrt(1 - 1e-8), 0]], [[1, 0, NaN], [0, 1, 0]], [[1, 0], [0, 1]]]) {
    for (const location of ['sourceRegistration', 'frame']) { const input = fixture(); input.finding.report[location].transform.matrix = bad; assert.equal(registeredBoardLayers(input).cad.matrix, null); }
    const input = fixture(); input.gerber.alignment.transform.matrix = bad; assert.equal(registeredBoardLayers(input).gerber.matrix, null);
  }
});
