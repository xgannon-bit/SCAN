import assert from 'node:assert/strict';
import test from 'node:test';
import { candidateRepairWork } from '../lib/scan/candidate-repair-work.ts';
import { emptyNativeDiagnosis } from '../lib/scan/native-placement-diagnosis.ts';
import { initialBomConfig } from '../lib/scan/bom-types.ts';

// Invented source-shaped observations specifically exercise the fresh-diagnosis
// completion boundary. Actual bytes are independently tested by API/browser tests.
function fixture() {
  const sourcePath = 'JobContainer/PartDataList/PartData[1]', identity = { ID: 'AUTHORED-P', ParentId: 'AUTHORED-M', RefID: 'AUTHORED-X', MasterKey: 'AUTHORED-S' };
  const beforeRoi = { cx: '14', cy: '19', w: '3', h: '2', a: '90' };
  const rawFields = { ...Object.fromEntries(Object.entries(identity).map(([k,v]) => [k,[v]])), ...Object.fromEntries(Object.entries(beforeRoi).map(([k,v]) => [`Roi/${k}`,[v]])), ENABLE: ['False'], CenterPosX: ['12'], CenterPosY: ['17'], WND_PAD: ['preserve-opaque'] };
  const original = { preflight: { source: { sha256: 'a'.repeat(64) }, selection: { root: 'Fable/Board', job: { member: 'Fable/Board/main.xml', role: 'main', sha256: 'b'.repeat(64) }, master: { member: 'Fable/Master.xml', role: 'main', sha256: 'c'.repeat(64) } }, preservedDirectories: [], preservedFiles: [{ originalName: 'Fable/Board/main.xml', size: 100, sha256: 'b'.repeat(64) }, { originalName: 'Fable/Master.xml', size: 100, sha256: 'c'.repeat(64) }, { originalName: 'Fable/Temp.xml', size: 100, sha256: 'd'.repeat(64) }], nativeRecords: { job: { status: 'recorded', schemaVersionClaim: '10.1', records: [{ kind: 'part-record', sourcePath, rawFields }] }, master: { status: 'recorded', records: [] } } } };
  const candidate = structuredClone(original); candidate.preflight.source.sha256 = 'e'.repeat(64); candidate.preflight.selection.job.sha256 = 'f'.repeat(64); candidate.preflight.preservedFiles[0].sha256 = 'f'.repeat(64); candidate.preflight.nativeRecords.job.records[0].rawFields['Roi/cx'] = ['15.5'];
  const diagnosis = { schemaVersion: '1', settings: emptyNativeDiagnosis().settings, source: { layoutSha256: '1'.repeat(64), placementSha256: '2'.repeat(64), bomSha256: '3'.repeat(64) }, placementConfig: { config: { startRow: 1, columns: { refdes: 1, x: 2, y: 3 }, module: 'AUTHORED-M', side: 'Top', units: 'mm', rotationDirection: 'ccw', decimalSeparator: '.', pairSeparator: ',' }, sheet: 0, delimiter: ',' }, bomConfig: { config: initialBomConfig(), sheet: 0, delimiter: ',' }, packageProfiles: [], diagnosisSha256: '4'.repeat(64) };
  const request = { artifactType: 'scan.qualification-patch-request', schemaVersion: '1', purpose: 'qualification-only', source: { archiveSha256: 'a'.repeat(64), jobSha256: 'b'.repeat(64), root: 'Fable/Board', jobMember: 'Fable/Board/main.xml', jobRole: 'main', masterMember: 'Fable/Master.xml', masterSha256: 'c'.repeat(64), masterRole: 'main' }, targetEagleBuild: null, targetMachine: null, reviewer: 'Authored reviewer', trialPurpose: 'Invented source-derived experiment', evidence: [{ id: 'basis', kind: 'independent-source-support', independentSupport: true, summary: 'Authored body evidence', references: [{ sha256: diagnosis.diagnosisSha256, label: 'Frozen finding' }] }], proposals: [{ id: 'edit', path: `${sourcePath}/Roi/cx`, identity, before: '14', after: '15.5', beforeRoi, evidenceIds: ['basis'] }], acceptances: [{ proposalId: 'edit', proposalSha256: '5'.repeat(64), decision: 'accepted', reviewer: 'Authored reviewer' }], diagnosis };
  const report = { artifactType: 'scan.native-placement-diagnosis', schemaVersion: '1', status: 'success', diagnosisSha256: diagnosis.diagnosisSha256, settings: diagnosis.settings, source: { ...diagnosis.source, archiveSha256: request.source.archiveSha256, jobSha256: request.source.jobSha256 }, frame: { holds: [] }, rows: [{ sourcePath, identity, beforeRoi, proposals: [{ field: 'Roi/cx', before: '14', after: '15.5' }], holds: [], dependencyHolds: [{ code: 'BINDING_UNQUALIFIED', message: 'Preserved native binding requires machine evidence.' }], completeRepairClaimHeld: true }] };
  return { original, candidate, request, report };
}

test('candidate completion distinguishes freshly derived placement experiments from physical or inspection validation', () => {
  const f = fixture(), work = candidateRepairWork(f.original, f.candidate, f.request, 'f'.repeat(64), f.report);
  assert.equal(work.independentlyDerivedPlacementExperiments, 1); assert.equal(work.independentlyDiagnosedCorrections, 0); assert.equal(work.inspectionRepairEstablished, false);
  assert.equal(work.diagnosisSha256, f.report.diagnosisSha256); assert.equal(work.eagleOpenSaveReopen, 'not-performed'); assert.equal(work.productionRelease, 'not-granted');
  const row = work.placementEditGroups[0]; assert.equal(row.basis, 'independent-source-derived-experiment'); assert.equal(row.literalEnable, 'False');
  assert.match(row.diagnosis, /physical correctness unverified/); assert.equal(row.bindingState, 'preserved-unqualified'); assert.equal(row.fov.coverage, 'unverified');
  assert.equal(work.masterBytesPreserved, true); assert.equal(work.preservedFiles, 2);
});

test('a saved finding hash or operator declaration alone cannot complete source-derived candidate reanalysis', () => {
  const f = fixture();
  assert.throws(() => candidateRepairWork(f.original, f.candidate, f.request, 'f'.repeat(64)), /freshly reproduced matching diagnosis/);
  for (const mutate of [r => { r.diagnosisSha256 = '0'.repeat(64); }, r => { r.source.archiveSha256 = '0'.repeat(64); }, r => { r.source.jobSha256 = '0'.repeat(64); }, r => { r.frame.holds.push({ code: 'UNKNOWN_FRAME' }); }, r => { r.rows[0].holds.push({ code: 'UNKNOWN_ANCHOR' }); }, r => { r.rows[0].identity.RefID = 'other'; }, r => { r.rows[0].proposals[0].after = '999'; }, r => { r.rows[0].proposals[0].before = '999'; }]) {
    const changed = structuredClone(f.report); mutate(changed);
    assert.throws(() => candidateRepairWork(f.original, f.candidate, f.request, 'f'.repeat(64), changed));
  }
  // An independently declared manual trial remains separate even if a report is
  // supplied; it never acquires derived status without the bound request context.
  delete f.request.diagnosis;
  const manual = candidateRepairWork(f.original, f.candidate, f.request, 'f'.repeat(64), f.report);
  assert.equal(manual.independentlyDerivedPlacementExperiments, 0); assert.equal(manual.placementEditGroups[0].basis, 'operator-declared-unqualified');
});
