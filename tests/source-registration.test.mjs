import test from 'node:test';
import assert from 'node:assert/strict';
import { emptySourceRegistration, validateSourceRegistrationSession, registrationScope, sourceRegistrationAnalysis, registrationDigest, buildCorrectedSourcePlacement } from '../lib/scan/source-registration.ts';
import { coordinateSources } from '../lib/scan/coordinate-sources.ts';

// Authored geometric witnesses only; no manufacturing fixtures.
function fixture(angle = 0, offset = [7, -4]) {
  const points = [[1, 2], [16, 2], [4, 14], [11, 9], [6, 6]].map(([x, y], i) => ({ reference: `X${i + 1}`, identity: `row:${i}`, module: 'M', side: 'top', x, y, rotation: i * 90, holds: [] }));
  const source = { id: 'from', label: 'synthetic original', sha256: 'a'.repeat(64), interpretation: 'mm CCW source', frame: 'synthetic source mm', inputUnits: 'mm', normalizedUnits: 'mm', revisionHint: '', points };
  const r = angle * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
  const target = { ...source, id: 'to', sha256: 'b'.repeat(64), frame: 'synthetic target mm', points: points.map(p => ({ ...p, x: p.x * c - p.y * s + offset[0], y: p.x * s + p.y * c + offset[1], identity: `target:${p.identity}` })) };
  const draft = { ...emptySourceRegistration(), sourceId: source.id, targetId: target.id, sourceScope: registrationScope(points[0]), targetScope: registrationScope(points[0]), sourceRevision: '4', targetRevision: '4', sourceSide: 'top', targetSide: 'top', framesConfirmed: true, frameEvidence: 'Authored same footprint origins and top view with explicit millimeters.', fitReferences: ['X1', 'X2', 'X3'], checkReferences: ['X4'], toleranceMm: '0.001' };
  return { source, target, draft };
}
for (const angle of [0, 90, 180, 270]) test(`source registration proves cardinal ${angle} with nonzero origin offset`, async () => {
  const { source, target, draft } = fixture(angle, [21.7, -19.2]);
  const analysis = sourceRegistrationAnalysis(source, target, draft);
  assert.equal(analysis.status, 'reviewable'); assert.equal(analysis.transform.scale, 1); assert.equal(analysis.transform.mirror, false);
  assert.ok(analysis.residuals.every(p => p.residual < 1e-10));
  draft.decision = { digest: await registrationDigest(source, target, draft), choice: 'accepted', reviewer: 'Synthetic reviewer', reason: 'Reviewed authored geometry' };
  const out = await buildCorrectedSourcePlacement(source, target, draft);
  assert.equal(out.placements.length, source.points.length); assert.equal(out.nativeEditsApplied, false);
  assert.deepEqual(out.placements.map(p => p.rotationCcwDegrees), source.points.map(p => ((p.rotation + angle) % 360 + 360) % 360));
  assert.deepEqual(out, await buildCorrectedSourcePlacement(source, target, draft));
});
test('wrong units are not absorbed as a scale factor', () => {
  const { source, target, draft } = fixture(); target.points = target.points.map(p => ({ ...p, x: p.x * 25.4, y: p.y * 25.4 }));
  const r = sourceRegistrationAnalysis(source, target, draft); assert.equal(r.status, 'held'); assert.ok(r.holds.some(h => h.includes('fixed scale')));
});
test('swapped axes and reflection are refused', () => {
  for (const map of [p => ({ ...p, x: p.y, y: p.x }), p => ({ ...p, x: -p.x })]) {
    const { source, target, draft } = fixture(); target.points = target.points.map(map);
    const r = sourceRegistrationAnalysis(source, target, draft); assert.equal(r.transform, null); assert.ok(r.holds.some(h => h.includes('reflection')));
  }
});
test('different sides and unknown native units remain held', () => {
  const { source, target, draft } = fixture(); target.points.forEach(p => p.side = 'bottom'); draft.targetScope = registrationScope(target.points[0]); draft.targetSide = 'bottom';
  assert.ok(sourceRegistrationAnalysis(source, target, draft).holds.some(h => h.includes('Different board sides')));
  target.normalizedUnits = 'unqualified-native'; assert.ok(sourceRegistrationAnalysis(source, target, draft).holds.some(h => h.includes('Native coordinate')));
});
test('unknown target side is held without inventing a different physical side', () => {
  const { source, target, draft } = fixture(); target.points.forEach(p => p.side = 'unknown'); draft.targetScope = registrationScope(target.points[0]); draft.targetSide = '';
  const result = sourceRegistrationAnalysis(source, target, draft);
  assert.equal(result.status, 'held'); assert.ok(result.holds.some(h => h.includes('Record the physical board side'))); assert.ok(!result.holds.some(h => h.includes('Different board sides'))); assert.ok(result.transform);
});
test('revision mismatch, conflicting filename revision and unreviewed origins hold correction', () => {
  const { source, target, draft } = fixture(); draft.sourceRevision = '3';
  assert.ok(sourceRegistrationAnalysis(source, target, draft).holds.some(h => h.includes('Different source revisions')));
  draft.sourceRevision = '4'; source.revisionHint = '3'; assert.ok(sourceRegistrationAnalysis(source, target, draft).holds.some(h => h.includes('filename revision')));
  source.revisionHint = ''; draft.framesConfirmed = false; assert.equal(sourceRegistrationAnalysis(source, target, draft).status, 'held');
});
test('independent checkpoint cannot be fit or hide a local origin error', () => {
  const { source, target, draft } = fixture(); target.points[3].x += .6;
  const r = sourceRegistrationAnalysis(source, target, draft); assert.equal(r.status, 'held'); assert.ok(Math.abs(r.transform.matrix[0][2] - 7) < 1e-10); assert.ok(r.holds.some(h => h.includes('independent check residual')));
  draft.fitReferences.push('X4'); assert.ok(sourceRegistrationAnalysis(source, target, draft).holds.some(h => h.includes('disjoint')));
});
test('unselected local-origin outlier blocks blanket transform but remains visible', () => {
  const { source, target, draft } = fixture(); target.points[4].y += .25;
  const r = sourceRegistrationAnalysis(source, target, draft); assert.ok(r.holds.some(h => h.includes('Unselected references'))); assert.equal(r.residuals.find(p => p.reference === 'X5').role, 'unselected');
});
test('missing and duplicate references never resolve through ordinal or nearest match', () => {
  for (const mutation of [t => t.points.pop(), t => t.points.push({ ...t.points[4], identity: 'different' })]) {
    const { source, target, draft } = fixture(); mutation(target); const r = sourceRegistrationAnalysis(source, target, draft);
    assert.equal(r.status, 'held'); assert.equal(r.scopeHolds[0].reference, 'X5');
  }
});
test('collinear controls and same physical checkpoint are refused', () => {
  const { source, target, draft } = fixture(); source.points[2].y = 2; target.points[2].y = -2;
  assert.ok(sourceRegistrationAnalysis(source, target, draft).holds.some(h => h.includes('collinear')));
  source.points[3] = { ...source.points[0], reference: 'X4', identity: 'overlap' };
  assert.ok(sourceRegistrationAnalysis(source, target, draft).holds.some(h => h.includes('distinct physical')));
});
test('stale source, mapping, evidence, controls and rejected decision forbid export', async () => {
  const f = fixture(); f.draft.decision = { digest: await registrationDigest(f.source, f.target, f.draft), choice: 'accepted', reviewer: 'Tester', reason: 'authored' };
  for (const mutate of [x => x.source.sha256 = 'c'.repeat(64), x => x.source.interpretation = 'other', x => x.draft.frameEvidence += ' changed', x => x.draft.checkReferences = ['X5'], x => x.draft.decision.choice = 'rejected']) {
    const copy = structuredClone(f); mutate(copy); await assert.rejects(buildCorrectedSourcePlacement(copy.source, copy.target, copy.draft));
  }
  const reopened = validateSourceRegistrationSession(JSON.parse(JSON.stringify(f.draft)));
  assert.deepEqual(await buildCorrectedSourcePlacement(f.source, f.target, reopened), await buildCorrectedSourcePlacement(f.source, f.target, f.draft));
});
test('saved transforms, invented state fields and malformed decisions cannot be restored', () => {
  assert.throws(() => validateSourceRegistrationSession({ ...emptySourceRegistration(), transform: [1, 0, 3] }));
  assert.throws(() => validateSourceRegistrationSession({ ...emptySourceRegistration(), decision: { digest: 'x', choice: 'accepted', reviewer: 't', reason: 't' } }));
});
test('placement adapter preserves actual conversion evidence and excludes native frame authority', () => {
  const p = { artifactType: 'scan.normalized-placements', sourceSha256: 'a'.repeat(64), normalizerVersion: 'test', mapping: { units: 'in', rotationDirection: 'CW' }, coordinateFrame: 'imported-mm', sheetIndex: 0, issues: [], placements: [{ refdes: 'X1', placementId: 'row:1', module: 'M', side: 'top', sourceRow: 1, xMm: '25.4', yMm: '50.8', rotationCcwDegrees: '270' }] };
  const sources = coordinateSources({ name: 'fixture_V03_PNP.csv', result: p }, [], { name: '', result: null }, null);
  assert.equal(sources[0].inputUnits, 'in'); assert.equal(sources[0].points[0].x, 25.4); assert.equal(sources[0].points[0].rotation, 270); assert.equal(sources[0].revisionHint, '3');
});
