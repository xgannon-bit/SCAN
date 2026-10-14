import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNativeBoardScene } from '../lib/scan/native-board-scene.ts';
import { emptyRepair } from '../lib/scan/repair-session.ts';
import { nativeEntities } from '../lib/scan/visual-workspace.ts';

// Authored fictional native literals: no private board data or archived oracles.
const hash = digit => digit.repeat(64);
const part = (id, ref, module = '1', x = '10', y = '20') => ({ kind: 'part-record', sourcePath: `JobContainer/PartDataList/PartData[${id}]`, rawFields: {
  ID: [String(id)], RefID: [ref], ParentId: [module], MasterKey: [String(Number(id) + 100)],
  'Roi/cx': [x], 'Roi/cy': [y], 'Roi/w': ['2.5'], 'Roi/h': ['1.25'], 'Roi/a': ['90'], ENABLE: ['1'],
  CenterPosX: ['17'], FovList: [''], WND_PAD: ['original-binding-literal'], UnknownProtectedField: ['preserve-me'],
} });
const snapshot = records => ({ status: 'success', snapshotId: 'authored-snapshot', source: { sha256: hash('a') },
  integrity: { status: 'verified-against-capture-hash', allArchivedFilesVerified: true },
  selection: { root: 'Fiction', job: { member: 'Fiction/Job.xml', role: 'main', sha256: hash('b'), size: 400 }, master: { member: 'Fiction/Master.xml', role: 'main', sha256: hash('c'), size: 100 } },
  nativeRecords: { job: { status: 'recorded', schemaVersionClaim: '10.1', records }, master: { status: 'recorded', records: [] } },
  preservedFiles: ['Job.xml', 'Master.xml', 'Temp/Job.xml', 'Image.bin'].map((name, i) => ({ originalName: `Fiction/${name}`, path: `Fiction/${name}`, sha256: hash(String(i + 1)), size: 20 })), preservedDirectories: ['Fiction/Temp/'],
});
const selected = { root: 'Fiction', jobMember: 'Fiction/Job.xml', jobRole: 'main', masterMember: 'Fiction/Master.xml', masterRole: 'main' };
const baseInput = baseline => ({ baseline, selection: selected, repair: emptyRepair(), sourceContext: hash('f') });
const proposal = (record, field, after, id = field) => ({ id, path: `${record.sourcePath}/${field}`, identity: Object.fromEntries(['ParentId', 'RefID', 'ID', 'MasterKey'].map(k => [k, record.rawFields[k][0]])), before: record.rawFields[field][0], after,
  beforeRoi: Object.fromEntries(['cx', 'cy', 'w', 'h', 'a'].map(k => [k, record.rawFields[`Roi/${k}`][0]])), evidenceIds: ['authored'] });
function withRepair(baseline, proposals, decision = 'accepted') {
  const request = { artifactType: 'scan.qualification-patch-request', schemaVersion: '1', purpose: 'qualification-only', source: { archiveSha256: baseline.source.sha256, jobSha256: baseline.selection.job.sha256, root: baseline.selection.root, jobMember: baseline.selection.job.member, jobRole: 'main', masterMember: baseline.selection.master.member, masterSha256: baseline.selection.master.sha256, masterRole: 'main' },
    reviewer: 'Synthetic reviewer', targetEagleBuild: null, targetMachine: null, trialPurpose: 'Authored scene test', proposals,
    evidence: [{ id: 'authored', summary: 'Authored synthetic test only.', independentSupport: false, kind: 'historical-replay', references: [] }],
    acceptances: proposals.map(p => ({ proposalId: p.id, proposalSha256: hash('d'), decision, reviewer: 'Synthetic reviewer' })),
  };
  return { ...baseInput(baseline), repair: { ...emptyRepair(), sourceContext: hash('f'), request } };
}
function withCandidate(input) {
  const candidate = structuredClone(input.baseline), request = structuredClone(input.repair.request);
  candidate.source.sha256 = hash('e'); candidate.selection.job.sha256 = hash('9');
  for (const p of request.proposals.filter(p => request.acceptances.find(a => a.proposalId === p.id)?.decision === 'accepted')) {
    const record = candidate.nativeRecords.job.records.find(r => p.path.startsWith(`${r.sourcePath}/`));
    record.rawFields[p.path.slice(record.sourcePath.length + 1)] = [p.after];
  }
  candidate.preservedFiles[0].sha256 = hash('9');
  return { ...input, candidate, repair: { ...input.repair, history: [{ id: 'authored-revision', recordedAt: '2026-01-01T00:00:00Z', sourceSha256: input.baseline.source.sha256, candidateSha256: candidate.source.sha256, packageSha256: hash('8'), request }] } };
}

test('complete native scene is independent of CAD and capped/missing component telemetry', () => {
  const records = Array.from({ length: 300 }, (_, i) => part(i + 1, `S${i + 1}`, i < 150 ? '1' : '2', String(i % 30), String(Math.floor(i / 30))));
  records[150].rawFields.RefID = ['S1']; // Same reference in another module remains a distinct placement.
  const input = baseInput(snapshot(records)), untouched = structuredClone(input), scene = buildNativeBoardScene(input);
  assert.equal(scene.entities.length, 300); assert.equal(scene.counts.total, 300); assert.equal(scene.counts.invalid, 0);
  assert.deepEqual(scene.scopes.map(s => [s.module, s.counts.eligible]), [['1', 150], ['2', 150]]);
  assert.deepEqual(scene.entities, nativeEntities(input.baseline)); // No transformation, snapping, rounding or guessed mirror.
  assert.equal(new Set(scene.entities.map(e => e.key)).size, 300);
  assert.equal(scene.counts.analyzed, 0); assert.equal(scene.counts.written, 0); assert.equal(scene.counts.preserved, 0);
  assert.equal(scene.counts.unreviewed, 300); assert.equal(scene.counts.machineVerified, 0);
  const fakeEvents = Array.from({ length: 256 }, (_, i) => ({ entity: `S${i + 1}`, stage: 'written', status: 'completed' }));
  assert.deepEqual(buildNativeBoardScene({ ...input, events: fakeEvents }), scene);
  assert.deepEqual(input, untouched);
});

test('missing/malformed coordinates and unresolved modules remain counted; outliers stay selectable', () => {
  const records = Array.from({ length: 24 }, (_, i) => part(i + 1, `S${i + 1}`, '1', String(i % 8), String(Math.floor(i / 8))));
  records.push(part(25, 'FAR', '1', '-10000', '99999'));
  for (const [i, x] of ['', 'NaN', 'Infinity', '1e20', '0x10', 'not-a-number'].entries()) records.push(part(30 + i, `BAD${i}`, '1', x));
  const repeated = part(40, 'REPEAT'); repeated.rawFields['Roi/cx'] = ['1', '2']; records.push(repeated);
  const absent = part(41, 'ABSENT'); delete absent.rawFields['Roi/cy']; records.push(absent);
  records.push(part(42, 'UNKNOWN', '', '3', '4'));
  const scene = buildNativeBoardScene(baseInput(snapshot(records)));
  assert.deepEqual([scene.counts.total, scene.counts.eligible, scene.counts.invalid, scene.counts.outliers], [34, 25, 9, 1]);
  const far = scene.placements.find(p => p.identity.RefID === 'FAR');
  assert.equal(far.entity.x, -10000); assert.equal(far.entity.y, 99999); assert.equal(far.status.outlier, true); assert.equal(scene.byKey.get(far.entity.key), far);
  const scope = scene.scopes.find(s => s.module === '1'); assert.equal(scope.counts.invalid, 8); assert.ok(scope.camera.width < 50); assert.ok(scope.allCamera.height > 99999);
  assert.equal(scene.scopes.find(s => s.module === '').counts.invalid, 1);
});

test('review and exact written/preserved evidence are distinct and survive undoing current review', () => {
  const baseline = snapshot([part(1, 'S1'), part(2, 'S2', '1', '30', '40')]);
  const p = proposal(baseline.nativeRecords.job.records[0], 'Roi/cx', '12.5000');
  const reviewed = withRepair(baseline, [p]), accepted = buildNativeBoardScene(reviewed);
  assert.equal(accepted.placements[0].status.review, 'accepted'); assert.equal(accepted.placements[0].proposedEntity.x, 12.5);
  assert.equal(accepted.counts.written, 0); assert.equal(accepted.counts.preserved, 0);
  const input = withCandidate(reviewed), before = structuredClone(input), scene = buildNativeBoardScene(input);
  assert.equal(scene.candidateState, 'confirmed'); assert.equal(scene.candidateRevisionId, 'authored-revision');
  assert.equal(scene.candidateProofLevel, 'literal-readback'); assert.match(scene.candidateReason, /Full main-XML byte preservation still requires/);
  assert.equal(scene.counts.written, 1); assert.equal(scene.counts.preserved, 1); assert.equal(scene.counts.analyzed, 0);
  assert.equal(scene.placements[0].entity.x, 10); assert.equal(scene.placements[0].candidateEntity.x, 12.5);
  assert.equal(scene.placements[0].candidateEntity.y, 20); assert.equal(scene.placements[0].writtenChanges[0].after, '12.5000');
  assert.equal(scene.byKey.get(scene.placements[0].candidateEntity.key), scene.placements[0]);
  assert.equal(scene.placements[1].status.review, 'unreviewed'); assert.equal(scene.placements[1].status.preserved, true);
  assert.deepEqual(input, before);
  input.repair.request.acceptances[0].decision = 'rejected';
  const rejected = buildNativeBoardScene(input); assert.equal(rejected.counts.rejected, 1); assert.equal(rejected.counts.accepted, 0); assert.equal(rejected.counts.written, 1);
  input.repair.request = null;
  assert.equal(buildNativeBoardScene(input).counts.written, 1); assert.equal(buildNativeBoardScene(input).counts.unreviewed, 2);
});

test('candidate statuses refuse stale hashes, identity/before/after drift and unrelated teaching/assets', () => {
  const baseline = snapshot([part(1, 'S1'), part(2, 'S2')]), original = withCandidate(withRepair(baseline, [proposal(baseline.nativeRecords.job.records[0], 'Roi/cx', '12')]));
  const cases = [
    i => { i.candidate.source.sha256 = hash('7'); },
    i => { i.repair.history[0].sourceSha256 = hash('7'); },
    i => { i.repair.history[0].request.source.jobSha256 = hash('7'); },
    i => { i.repair.history[0].packageSha256 = ''; },
    i => { i.candidate.integrity.allArchivedFilesVerified = false; },
    i => { i.candidate.selection.job.role = 'temp'; },
    i => { i.candidate.nativeRecords.job.schemaVersionClaim = 'unsupported-version'; },
    i => { i.candidate.selection.master.sha256 = hash('7'); },
    i => { i.candidate.nativeRecords.job.records[0].rawFields.ID = ['wrong']; },
    i => { i.candidate.nativeRecords.job.records[0].sourcePath += '/changed'; },
    i => { i.candidate.nativeRecords.job.records[0].rawFields['Roi/cy'] = ['21']; },
    i => { i.candidate.nativeRecords.job.records[0].rawFields['Roi/cx'] = ['12.0']; }, // Literal after-value, not numeric-only equivalence.
    i => { i.repair.history[0].request.proposals[0].before = '10.0'; },
    i => { i.repair.history[0].request.proposals[0].beforeRoi.w = '3'; },
    i => { i.candidate.nativeRecords.job.records[1].rawFields.ENABLE = ['0']; },
    i => { i.candidate.nativeRecords.job.records[0].rawFields.UnknownProtectedField = ['edited']; },
    i => { i.candidate.preservedFiles[2].sha256 = hash('7'); },
    i => { i.candidate.preservedFiles.pop(); },
    i => { i.candidate.nativeRecords.job.records.push(part(3, 'S3')); },
    i => { i.repair.history[0].request.acceptances.push(structuredClone(i.repair.history[0].request.acceptances[0])); },
  ];
  for (const [index, change] of cases.entries()) {
    const input = structuredClone(original); change(input); const scene = buildNativeBoardScene(input);
    assert.notEqual(scene.candidateState, 'confirmed', `case ${index}`); assert.equal(scene.counts.written, 0, `case ${index}`); assert.equal(scene.counts.preserved, 0, `case ${index}`);
  }
});

test('exact review scope and complete dependency decisions are required without hiding any placement', () => {
  const baseline = snapshot([part(1, 'S1'), part(2, 'S1', '2')]), record = baseline.nativeRecords.job.records[0];
  const x = proposal(record, 'Roi/cx', '12', 'x'), y = proposal(record, 'Roi/cy', '22', 'y');
  x.dependencyProposalIds = ['y']; y.dependencyProposalIds = ['x'];
  const input = withCandidate(withRepair(baseline, [x, y])), scene = buildNativeBoardScene(input);
  assert.equal(scene.counts.accepted, 1); assert.equal(scene.counts.written, 1); assert.equal(scene.counts.eligible, 2);
  assert.equal(scene.placements[1].status.review, 'unreviewed');
  for (const mutate of [i => { i.sourceContext = hash('7'); }, i => { i.selection.jobRole = 'temp'; }, i => { i.selection.root = 'other'; }, i => { i.selection.masterMember = 'Fiction/Temp/Master.xml'; }, i => { i.repair.request.source.root = 'different'; }, i => { i.repair.request.proposals[0].beforeRoi.h = '2'; }]) {
    const stale = structuredClone(input); mutate(stale); const result = buildNativeBoardScene(stale);
    assert.equal(result.placements[0].status.review, 'stale'); assert.equal(result.placements[0].proposedEntity, null); assert.equal(result.counts.written, 1); // Previously written candidate still exact.
  }
  input.repair.request.acceptances[1].decision = 'pending';
  assert.equal(buildNativeBoardScene(input).placements[0].status.review, 'mixed');
  input.repair.history[0].request.acceptances[1].decision = 'pending';
  assert.equal(buildNativeBoardScene(input).counts.written, 0);
  const duplicates = structuredClone(baseline); const twin = structuredClone(record); twin.sourcePath = 'JobContainer/PartDataList/PartData[9]'; duplicates.nativeRecords.job.records.push(twin);
  const duplicateScene = buildNativeBoardScene(withRepair(duplicates, [x, y]));
  assert.equal(duplicateScene.entities.length, 3); assert.equal(duplicateScene.counts.accepted, 0); assert.equal(duplicateScene.counts.held, 2);
});

test('only source-bound exact diagnosis establishes analyzed state; readiness remains unverified', () => {
  const baseline = snapshot([part(1, 'S1'), part(2, 'S2')]), record = baseline.nativeRecords.job.records[0], p = proposal(record, 'Roi/cx', '12');
  const diagnosis = { source: { archiveSha256: baseline.source.sha256, jobSha256: baseline.selection.job.sha256 }, rows: [{ sourcePath: record.sourcePath, identity: p.identity, beforeRoi: p.beforeRoi, holds: [{ code: 'SOURCE_ORIGIN_UNRESOLVED', message: 'Authored evidence hold.' }], dependencyHolds: [{ code: 'BINDING_PENDING', message: 'Runtime semantics unqualified.' }] }] };
  const input = { ...baseInput(baseline), diagnosis }, scene = buildNativeBoardScene(input);
  assert.equal(scene.counts.analyzed, 1); assert.equal(scene.counts.held, 1); assert.equal(scene.counts.unreviewed, 2); assert.equal(scene.counts.machineVerified, 0);
  assert.match(scene.placements[0].reasons.join(' '), /SOURCE_ORIGIN_UNRESOLVED/);
  for (const change of [d => { d.source.archiveSha256 = hash('8'); }, d => { d.rows[0].identity.MasterKey = 'wrong'; }, d => { d.rows[0].beforeRoi.a = '0'; }]) {
    const d = structuredClone(diagnosis); change(d); assert.equal(buildNativeBoardScene({ ...input, diagnosis: d }).counts.analyzed, 0);
  }
});
