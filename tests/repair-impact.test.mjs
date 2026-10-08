import assert from 'node:assert/strict';
import test from 'node:test';
import { repairImpact } from '../lib/scan/repair-impact.ts';
import { compositionDecisionContext, preparationNeedsRecompute } from '../lib/scan/composition-context.ts';

function report() {
  return { source: { sha256: 'a'.repeat(64) }, snapshotId: 'b'.repeat(64), nativeRecords: { job: { records: [
    { kind: 'part-record', sourcePath: 'part-a', rawFields: { ID: ['7'], ParentId: ['mod'], MasterKey: ['shared'], RefID: ['FABLE-A'],
      'Roi/cx': ['11'], 'Roi/cy': ['-4'], 'Roi/w': ['3'], 'Roi/h': ['2'], 'Roi/a': ['90'], CenterPosX: ['8'], WND_PAD: ['preserve'] } }] } },
    nativeInspectionWork: { parts: [{ id: 'a', sourcePath: 'part-a', scopeId: 's', identityLiterals: { RefID: ['FABLE-A'] } },
      { id: 'b', sourcePath: 'part-b', scopeId: 's', identityLiterals: { RefID: ['FABLE-B'] } }],
      scopes: [{ id: 's', masterMatchState: 'unique-literal-match', partIds: ['a', 'b'], windowIds: ['w1', 'w2'], masterPartSourcePaths: ['master'] }],
      windows: [{ id: 'w1', sourcePath: 'window1', rawFields: { ID: ['10'], GroupID: ['5'], ParentWndId: ['0'], AlignWndID: [''], 'RelRoi/cx': ['2'] }, algorithmIds: ['algo'] },
        { id: 'w2', sourcePath: 'window2', rawFields: { ID: ['11'], GroupID: ['5'], ParentWndId: ['10'], AlignWndID: ['10'] }, algorithmIds: [] }] },
    nativeBindings: { literalObservationsComplete: true, bindings: [{ partSourcePath: 'part-a', tokens: ['5', '19'] }] } };
}
test('scalar overlay preserves nonzero origin/rotation and enumerates shared dependent work without qualification', () => {
  const source = report(), frozen = JSON.stringify(source), impact = repairImpact(source, 'part-a', 'Roi/cx', '12.5');
  assert.equal(impact.deltaLiteralUnits, 1.5);
  assert.deepEqual(impact.afterBox, { x: 12.5, y: -4, w: 3, h: 2, angle: 90 });
  assert.equal(impact.scopePlacements.length, 2); assert.equal(impact.windows.length, 2);
  assert.deepEqual(impact.windows[1].parent, ['10']); assert.deepEqual(impact.windows[1].align, ['10']);
  assert.equal(impact.bindingObservations.length, 1);
  assert.equal(impact.machineQualified, false); assert.equal(impact.inspectionRepairEstablished, false);
  assert.equal(impact.cause, 'not-established-by-numeric-difference'); assert.equal(JSON.stringify(source), frozen);
});
test('stored-center edits never masquerade as placement ROI transforms; invalid geometry has no guessed overlay', () => {
  const source = report();
  assert.equal(repairImpact(source, 'part-a', 'CenterPosX', '10').afterBox, null);
  assert.equal(repairImpact(source, 'part-a', 'Roi/cx', 'Infinity').afterBox, null);
  source.nativeRecords.job.records[0].rawFields['Roi/cx'] = ['11', '12'];
  assert.equal(repairImpact(source, 'part-a', 'Roi/cx', '10').beforeBox, null);
  assert.equal(repairImpact(source, 'absent', 'Roi/cx', '10'), null);
});
test('ambiguous model does not select arbitrary windows or claim complete dependencies', () => {
  const source = report(); source.nativeInspectionWork.scopes[0].masterMatchState = 'ambiguous-literal-match';
  const impact = repairImpact(source, 'part-a', 'Roi/cx', '12');
  assert.equal(impact.windows.length, 0); assert.equal(impact.masterMatch, 'ambiguous-literal-match');
});
test('composition context rejects cross-panel decision/profile races without coupling candidate history', () => {
  const preparation = { reviewer: 'test', review: { digest: 'a', decisions: [{ digest: 'part', decision: 'accepted' }] }, packageProfiles: [], history: [] };
  const repair = { acceptances: [{ proposalId: 'scalar', decision: 'accepted' }] };
  const baseline = compositionDecisionContext(preparation, repair);
  preparation.history.push({ id: 'unrelated history' });
  assert.equal(compositionDecisionContext(preparation, repair), baseline);
  repair.acceptances[0].decision = 'rejected'; assert.notEqual(compositionDecisionContext(preparation, repair), baseline);
  repair.acceptances[0].decision = 'accepted'; preparation.packageProfiles.push({ datum: 'changed' });
  assert.notEqual(compositionDecisionContext(preparation, repair), baseline);
});
test('cleared current preparation review cannot silently drop a same-source prepared history', () => {
  const p = { reviewer: 'test', review: null, history: [{ review: { archiveSha256: 'same' }, accepted: ['part'] }] };
  assert.equal(preparationNeedsRecompute(p, 'same'), true);
  assert.equal(preparationNeedsRecompute(p, 'other'), false);
  p.review = { digest: 'recomputed' };
  assert.equal(preparationNeedsRecompute(p, 'same'), false);
});
