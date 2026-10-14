import test from 'node:test';
import assert from 'node:assert/strict';
import { boardProcessingEvent, indexBoardEntities, latestComponentEvent, latestVisualRuns, boardProcessingPhases } from '../lib/scan/board-processing.ts';
import { nativeEntities, emptyVisualWorkspace, validateVisualWorkspace } from '../lib/scan/visual-workspace.ts';
import { nativeRegistrationControls } from '../lib/scan/registration-controls.ts';
const hash = c => c.repeat(64);
function fixture() {
  const baseline = { source: { sha256: hash('a') }, packageSha256: hash('b'), selection: { job: { member: 'synthetic/job.xml', sha256: hash('c') }, master: { member: 'synthetic/Master.xml' } }, integrity: { status: 'verified-against-capture-hash', allArchivedFilesVerified: true }, nativeRecords: { job: { records: [{ kind: 'part-record', sourcePath: 'JobContainer/PartDataList/PartData[1]', rawFields: { ID: ['7'], ParentId: ['1'], MasterKey: ['17'], RefID: ['TEST7'], 'Roi/cx': ['10'], 'Roi/cy': ['20'], 'Roi/w': ['3'], 'Roi/h': ['2'], 'Roi/a': ['90'] } }] } } };
  const before = { x: 10, y: 20, width: 3, height: 2, angle: 90 };
  const event = { id: 'e', run: 'run', sequence: 2, at: '2026-01-01T00:00:00Z', source: hash('a'), stage: 'Native diagnosis', status: 'progress', message: 'Actual authored check', count: 1, entity: '7', componentPhase: 'analysis-checked', nativeSource: { contextHash: hash('d'), packageSha256: hash('b'), jobMember: 'synthetic/job.xml', masterMember: 'synthetic/Master.xml' }, geometry: { frame: 'native-roi-unqualified', identity: { id: '7', module: '1', master: '17', ref: 'TEST7' }, before, after: { ...before, x: 11 } } };
  return { baseline, event, entities: nativeEntities(baseline) };
}
test('component events join only exact source, snapshot, interpretation, identity and before geometry', () => {
  const f = fixture(), unchanged = structuredClone(f);
  const joined = boardProcessingEvent(f.event, f.baseline, f.entities, hash('d'));
  assert.equal(joined.entity.key, f.entities[0].key); assert.equal(joined.geometry.after.x, 11); assert.deepEqual(f, unchanged);
  for (const change of [e => e.source = hash('f'), e => e.nativeSource.packageSha256 = hash('f'), e => e.nativeSource.contextHash = hash('f'), e => e.nativeSource.jobMember = 'Temp.xml', e => e.nativeSource.masterMember = 'other.xml', e => e.geometry.identity.module = '2', e => e.geometry.identity.master = '8', e => e.geometry.before.angle = 0, e => e.geometry.before.x = 0, e => delete e.nativeSource]) {
    const e = structuredClone(f.event); change(e); for (const entities of [f.entities, indexBoardEntities(f.entities)]) assert.equal(boardProcessingEvent(e, f.baseline, entities, hash('d')).geometry, null);
  }
  assert.equal(boardProcessingEvent(f.event, f.baseline, [...f.entities, ...f.entities], hash('d')).geometry, null);
  assert.equal(boardProcessingEvent(f.event, f.baseline, indexBoardEntities([...f.entities, ...f.entities]), hash('d')).geometry, null);
  assert.deepEqual(boardProcessingEvent(f.event, f.baseline, indexBoardEntities(f.entities), hash('d')), joined);
  const saved = { ...emptyVisualWorkspace(), events: [f.event] }; assert.deepEqual(validateVisualWorkspace(saved), saved);
  const bad = structuredClone(saved); bad.events[0].nativeSource.contextHash = 'invented-unbound'; assert.throws(() => validateVisualWorkspace(bad));
});

test('live component selection stops on completion/cancellation/failure; static results and replay are explicit', () => {
  const f = fixture(), start = { ...f.event, componentPhase: 'analysis-started' }, index = indexBoardEntities(f.entities);
  for (const status of ['completed', 'cancelled', 'failed', 'held']) {
    const terminal = { ...f.event, id: 'end', sequence: 3, status }; delete terminal.geometry; delete terminal.componentPhase;
    const events = [start, terminal];
    assert.equal(latestComponentEvent(events, hash('a'), false), null);
    assert.equal(latestComponentEvent(events, hash('a'), true), start);
    assert.equal(boardProcessingPhases(events, start, f.baseline, index, hash('d'), false).get(f.entities[0].key), 'incomplete-event');
  }
  assert.equal(latestComponentEvent([start], hash('a'), false), start);
  assert.equal(boardProcessingPhases([start], start, f.baseline, index, hash('d'), true).get(f.entities[0].key), 'analysis-started');
  assert.equal(boardProcessingPhases([start], start, f.baseline, index, hash('d'), false, true).get(f.entities[0].key), 'analysis-started');
  assert.equal(latestVisualRuns([start, {...start, sequence: 1}]).get(start.run).sequence, 2);
  assert.equal(latestComponentEvent([start], hash('e'), true), null);
  const target = boardProcessingPhases([f.event], f.event, f.baseline, index, hash('d'), false);
  assert.equal(target.get(f.entities[0].key), 'proposal-preview');
  assert.equal(boardProcessingPhases([{...f.event,componentPhase:'analysis-held'}], {...f.event,componentPhase:'analysis-held'}, f.baseline, index, hash('d'), false).get(f.entities[0].key), 'analysis-held');
  assert.equal(boardProcessingPhases([f.event], f.event, f.baseline, index, hash('e'), false).size, 0);
});
test('a new prepared model can appear only as a staged ghost in one explicit existing module', () => {
  const f=fixture(); f.baseline.nativeRecords.job.records.push({kind:'module-record',rawFields:{ID:['1']}});
  f.event.componentPhase='preparation-checked'; f.event.geometry.before=null; f.event.geometry.identity.id='new-8';
  const staged=boardProcessingEvent(f.event,f.baseline,f.entities,hash('d'));
  assert.equal(staged.entity.id,'new-8'); assert.match(staged.reason,/Staged new placement/); assert.equal(f.entities.length,1);
  f.event.geometry.identity.module='unknown'; assert.equal(boardProcessingEvent(f.event,f.baseline,f.entities,hash('d')).geometry,null);
});
test('control residuals retain units/direction and cannot plot when registration is held', () => {
  const report = { settings: { nativeUnits: 'mil', nativeYDirection: 'down' }, frame: { transform: { matrix: [[1, 0, 3], [0, 1, 4]] }, controls: [{ reference: 'S1', role: 'check', sourceOriginMm: [1, 2], nativeOriginCanonicalMm: [4.01, 6], residualMm: .01, sourceRegistrationResidualMm: .003 }] } };
  const result = nativeRegistrationControls(report, { status: 'supported-diagnostic' })[0];
  assert.deepEqual(result.from, [4 / .0254, -6 / .0254]); assert.deepEqual(result.to, [4.01 / .0254, -6 / .0254]); assert.equal(result.residualMm, .01);
  const held = nativeRegistrationControls(report, { status: 'held' })[0]; assert.equal(held.from, null); assert.equal(held.to, null); assert.equal(held.residualMm, .01);
});
