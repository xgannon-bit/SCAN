import test from 'node:test';
import assert from 'node:assert/strict';
import { draftPreparation, sourceDraftClass } from '../lib/scan/draft-preparation.ts';

const pad = (number, x) => ({ padNumber: number, shape: 'Rect', widthMm: .8, heightMm: .4, local: { xMm: x, yMm: .5 }, localRotationDegrees: 0 });
const source = () => ({ sourcePath: '/invented/1', refdes: 'F7', patternRef: 'authored-family', ownedPadCentersAvailable: true, identityHolds: [], mountingEvidence: 'explicit-zero-holes', explicitLayerGeometry: [{ layerNumber: '1', pads: [pad('1', -1), pad('2', 3)], unresolvedClassPaths: [] }] });
const layout = part => ({ sourceSha256: 'a'.repeat(64), placements: [part] });

test('family classification is geometric, never a name or historical reference rule', () => {
  assert.equal(sourceDraftClass(source()), 'two-pad-rectangular-source-family');
  const different = source(); different.patternRef = 'unrelated'; different.refdes = 'NEW123';
  assert.equal(sourceDraftClass(different), sourceDraftClass(source()));
  for (const mutate of [p => p.explicitLayerGeometry[0].pads[1].local.yMm = 2,
    p => p.explicitLayerGeometry[0].pads[1].shape = 'Oval',
    p => p.explicitLayerGeometry[0].pads[1].widthMm = 9,
    p => p.explicitLayerGeometry[0].pads[1].local.xMm = -.9,
    p => p.explicitLayerGeometry[0].pads[1].localRotationDegrees = 15]) {
    const part = source(); mutate(part);
    assert.equal(sourceDraftClass(part), 'other-family-not-supported');
  }
});

test('holes, identity holds and missing evidence are explicit without exclusions', () => {
  const part = source(); part.mountingEvidence = 'hole-bearing';
  const result = draftPreparation('F7', layout(part), null, false, false);
  assert.equal(result.classification, 'hole-bearing-separate-workflow');
  assert.match(result.nextAction, /not automatically excluded/);
  part.identityHolds = [{ code: 'AMBIGUOUS', sourcePath: '/' }];
  assert.equal(sourceDraftClass(part), 'source-geometry-held');
  assert.equal(sourceDraftClass(null), 'source-layout-needed');
});

test('template names and source geometry never qualify native creation or population', () => {
  const record = (kind, fields) => ({ kind, sourcePath: '/authored', rawFields: fields });
  const archive = { preflight: { nativeRecords: { master: { records: [record('part-record', { MasterKey: ['8'], PackageName: ['authored-family'] }), record('window-record', { ParentId: ['8'] })] }, job: { records: [record('part-record', { MasterKey: ['8'] }), record('part-record', { MasterKey: ['8'] })] } } } };
  const result = draftPreparation('F7', layout(source()), archive, false, false);
  assert.equal(result.templateCandidates[0].linkedPlacementCount, 2);
  assert.equal(result.templateCandidates[0].windowCount, 1);
  assert.equal(result.status, 'held');
  assert.equal(result.nativeRecordsCreated, 0);
  assert.equal(result.machineExportAllowed, false);
  assert.equal(result.populationApproved, false);
  assert.match(result.holds.join(' '), /names are insufficient/);
  assert.match(draftPreparation('F7', layout(source()), archive, true, false).nextAction, /DNP/);
  assert.match(draftPreparation('F7', layout(source()), archive, false, true).nextAction, /preserved/);
  assert.equal(draftPreparation('F7', { ...layout(source()), placements: [source(), source()] }, archive, false, false).classification, 'source-identity-ambiguous');
});
