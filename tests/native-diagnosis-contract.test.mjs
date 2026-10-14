import assert from 'node:assert/strict';
import test from 'node:test';
import { appendDiagnosisSources, emptyNativeDiagnosis, validateNativeDiagnosisContext, validateNativeDiagnosisDraft } from '../lib/scan/native-placement-diagnosis.ts';
import { initialBomConfig } from '../lib/scan/bom-types.ts';
import { validatePlacementConfig } from '../lib/scan/placement-types.ts';
import { decodeProject, encodeProject } from '../lib/scan/project-session.ts';
import { validateRepairSession } from '../lib/scan/repair-session.ts';

// Entirely invented evidence/settings. No actual board identities or dimensions.
function draft() {
  const value = emptyNativeDiagnosis();
  value.reviewer = 'Synthetic reviewer';
  Object.assign(value.settings, { module: 'FICTION-M', sourceRevision: 'Invented-layout-A', nativeRevision: 'Invented-native-A', bomRevision: 'Invented-BOM-A',
    sourceSide: 'top', nativeSide: 'top', nativeUnits: 'mm', nativeYDirection: 'up', nativeRotation: 'ccw', nativeRoiAnchor: 'body-center',
    frameStatement: 'Authored offline frame interpretation; machine geometry is unverified.', toleranceBasis: 'Invented controls; no physical qualification.',
    fitReferences: ['FABLE-A', 'FABLE-B', 'FABLE-C'], checkReferences: ['FABLE-D'], framesConfirmed: true });
  return value;
}
const placementConfig = () => ({ config: { startRow: 2, columns: { refdes: 1, x: 2, y: 3, rotation: 4, mpn: 5 }, module: 'FICTION-M', side: 'Top', units: 'mm', rotationDirection: 'ccw', decimalSeparator: '.', pairSeparator: ',' }, sheet: 0, delimiter: ',' });
function context() {
  return { schemaVersion: '1', settings: draft().settings,
    source: { layoutSha256: '1'.repeat(64), placementSha256: '2'.repeat(64), bomSha256: '3'.repeat(64) },
    placementConfig: placementConfig(), bomConfig: { config: initialBomConfig(), sheet: 0, delimiter: ',' }, packageProfiles: [] };
}
const asFile = value => new File([value instanceof Blob ? value : JSON.stringify(value)], 'invented.scan-project.json');

test('unknown native conventions remain explicit and reviewed interpretation never carries a transform or machine authority', () => {
  const unreviewed = emptyNativeDiagnosis();
  assert.equal(validateNativeDiagnosisDraft(unreviewed).settings.nativeRoiAnchor, 'unknown');
  assert.equal(unreviewed.settings.framesConfirmed, false);
  const reviewed = draft();
  assert.deepEqual(validateNativeDiagnosisDraft(reviewed), reviewed);
  for (const mutate of [
    d => { d.settings.machineQualified = true; }, d => { d.settings.transform = [1, 0, 0, 1]; }, d => { d.settings.sourceSide = 'Top'; },
    d => { d.settings.nativeUnits = 'inches'; }, d => { d.settings.nativeRoiAnchor = 'nearest-pad'; }, d => { d.settings.nativeYDirection = 'image'; },
    d => { d.settings.nativeRotation = 'clockwise'; }, d => { d.settings.framesConfirmed = 'true'; }, d => { d.settings.fitReferences.push('FABLE-A'); },
    d => { d.settings.checkReferences = ['']; }, d => { d.settings.fitReferences = Array.from({ length: 33 }, (_, i) => `AUTHORED-${i}`); },
    d => { d.settings.frameStatement = 'x'.repeat(3001); }, d => { d.reviewer = 'bad\0reviewer'; }, d => { delete d.settings.nativeRevision; },
    d => { d.report = { diagnosisSha256: 'a'.repeat(64) }; },
  ]) { const changed = structuredClone(reviewed); mutate(changed); assert.throws(() => validateNativeDiagnosisDraft(changed)); }
});

test('diagnosis context binds all three sources, exact mappings and optional frozen digest without accepting unbounded or extra records', () => {
  const fresh = context();
  assert.deepEqual(validateNativeDiagnosisContext(fresh), fresh);
  const frozen = { ...fresh, diagnosisSha256: '4'.repeat(64) };
  assert.deepEqual(validateNativeDiagnosisContext(frozen), frozen);
  for (const mutate of [
    c => { c.schemaVersion = '2'; }, c => { c.source.jobSha256 = '5'.repeat(64); }, c => { c.source.layoutSha256 = 'F'.repeat(64); },
    c => { delete c.source.bomSha256; }, c => { c.diagnosisSha256 = ''; }, c => { c.diagnosisSha256 = null; },
    c => { c.placementConfig.sheet = -1; }, c => { c.bomConfig.sheet = 20; }, c => { c.placementConfig.delimiter = '|'; },
    c => { c.bomConfig.config = null; }, c => { c.placementConfig.checked = true; }, c => { c.packageProfiles = [{ id: 'invalid', kind: 'unproved' }]; },
    c => { c.eagleQualified = true; },
  ]) { const changed = structuredClone(frozen); mutate(changed); assert.throws(() => validateNativeDiagnosisContext(changed)); }
});

test('diagnosis mapping accepts paired or separate coordinates but refuses ambiguous columns, malformed types and unsafe conventions', () => {
  const separate = placementConfig().config, paired = { ...separate, columns: { refdes: 1, xy: 2, rotation: 4, mpn: 5 } };
  for (const config of [separate, paired, { ...paired, units: 'unknown', rotationDirection: 'unknown', encoding: 'windows-1252', csvRecovery: true }]) {
    assert.deepEqual(validatePlacementConfig(config), config);
    const c = context(); c.placementConfig.config = config; assert.deepEqual(validateNativeDiagnosisContext(c).placementConfig.config, config);
  }
  for (const invalid of [null, [], {}, 'mapping', 1, true]) {
    assert.throws(() => validatePlacementConfig(invalid));
    const c = context(); c.placementConfig.config = invalid; assert.throws(() => validateNativeDiagnosisContext(c));
  }
  for (const mutate of [
    c => { c.columns.y = c.columns.x; }, c => { c.columns.rotation = c.columns.refdes; },
    c => { delete c.columns.refdes; }, c => { delete c.columns.y; }, c => { c.columns.xy = 6; },
    c => { c.columns = []; }, c => { c.columns = null; }, c => { c.columns.x = '2'; }, c => { c.columns.x = 0; },
    c => { c.columns.x = 65; }, c => { c.columns.x = 1.5; }, c => { c.columns.x = Number.NaN; }, c => { c.columns.x = Number.POSITIVE_INFINITY; },
    c => { c.columns.geometry = 6; }, c => { c.startRow = '2'; }, c => { c.startRow = 0; }, c => { c.startRow = 10001; },
    c => { c.module = '\0unsafe'; }, c => { c.side = 'x'.repeat(257); }, c => { c.module = null; }, c => { c.side = true; },
    c => { c.units = 'pixels'; }, c => { c.rotationDirection = 'arbitrary'; }, c => { c.decimalSeparator = ';'; },
    c => { c.pairSeparator = '|'; }, c => { c.encoding = 'utf-16'; }, c => { c.csvRecovery = 'true'; },
    c => { c.transform = { scale: 1 }; }, c => { c.machineQualified = true; },
  ]) {
    const config = structuredClone(separate); mutate(config); assert.throws(() => validatePlacementConfig(config));
    const c = context(); c.placementConfig.config = config; assert.throws(() => validateNativeDiagnosisContext(c));
  }
  for (const columns of [{ refdes: 1, xy: 2, x: 3 }, { refdes: 1, xy: 2, y: 3 }, { refdes: 1, xy: 1 }, { xy: 2 }]) assert.throws(() => validatePlacementConfig({ ...paired, columns }));
});

test('diagnosis context validates actual BOM interpretation instead of accepting an arbitrary config object', () => {
  for (const invalid of [null, [], {}, 'mapping', { ...initialBomConfig(), headerRow: 0 }]) {
    const c = context(); c.bomConfig.config = invalid; assert.throws(() => validateNativeDiagnosisContext(c));
  }
  for (const mutate of [
    c => { c.columns.quantity = c.columns.refdes; }, c => { c.columns.quantity = '1'; }, c => { c.columns.mpn = 65; },
    c => { delete c.columns.footprint; }, c => { c.columns.supplier = 8; }, c => { c.headerRow = '1'; },
    c => { c.scope.side = '\0unsafe'; }, c => { c.scope.module = 'x'.repeat(257); }, c => { c.scope.boardInstance = false; },
    c => { c.scope.extra = 'untrusted'; }, c => { c.revision = null; }, c => { c.variant = '\0unsafe'; }, c => { c.populationApproved = true; },
  ]) { const c = context(); mutate(c.bomConfig.config); assert.throws(() => validateNativeDiagnosisContext(c)); }
});

test('re-review attaches exact source bytes once and refuses incomplete evidence before modifying a request', async () => {
  const files = { layout: new File(['ACCEL_ASCII "invented"'], 'invented.pcb'), placement: new File(['Ref,X,Y\nFABLE,1,2'], 'invented-placement.csv'), bom: new File(['Qty,Ref\n1,FABLE'], 'invented-bom.csv') };
  const form = new FormData(); form.set('action', 'repair-review'); form.set('layout', new File(['stale'], 'old.pcb'));
  appendDiagnosisSources(form, undefined, { layout: null, placement: null, bom: null });
  assert.equal(form.get('layout').name, 'old.pcb');
  appendDiagnosisSources(form, context(), files); appendDiagnosisSources(form, context(), files);
  assert.equal(form.getAll('layout').length, 1); assert.equal(form.get('action'), 'repair-review');
  for (const [field, original] of [['layout', files.layout], ['diagnosisPlacement', files.placement], ['diagnosisBom', files.bom]]) {
    assert.equal(form.get(field).name, original.name);
    assert.deepEqual(Buffer.from(await form.get(field).arrayBuffer()), Buffer.from(await original.arrayBuffer()));
  }
  for (const missing of ['layout', 'placement', 'bom']) {
    const incomplete = new FormData(); incomplete.set('action', 'repair-export');
    assert.throws(() => appendDiagnosisSources(incomplete, context(), { ...files, [missing]: null }), /exact PCB, placement and BOM/);
    assert.deepEqual([...incomplete.keys()], ['action']);
  }
});

test('saved project retains native interpretation and every source byte; prior projects remain compatible and cached findings are refused', async () => {
  const input = { placement: { file: new File(['Ref,X,Y,Rotation,MPN\nFABLE,1,2,0,AUTHORED'], 'invented.csv'), settings: { config: placementConfig().config, sheetIndex: 0, delimiter: ',', validated: false, selectedRow: null, notes: {} } },
    layout: { file: new File(['ACCEL_ASCII "invented"'], 'invented.pcb'), checked: false },
    bom: { file: new File(['Qty,Ref,Value,Description,Maker,MPN,Footprint\n1,FABLE,x,authored,Fiction,AUTHORED,FABLE-FP'], 'invented-bom.csv'), config: initialBomConfig(), sheet: 0, delimiter: ',', checked: false },
    gerber: null, original: null, returned: null, notes: {}, machineVersion: '', nativeDiagnosis: draft() };
  const saved = await encodeProject(input), restored = await decodeProject(asFile(saved));
  assert.deepEqual(restored.record.nativeDiagnosis, draft()); assert.equal(restored.record.machineExportAllowed, false);
  for (const [fresh, source] of [[restored.placement.source, input.placement.file], [restored.layout.file, input.layout.file], [restored.bom.file, input.bom.file]]) assert.deepEqual(Buffer.from(await fresh.arrayBuffer()), Buffer.from(await source.arrayBuffer()));
  const legacy = JSON.parse(await saved.text()); delete legacy.nativeDiagnosis;
  assert.equal((await decodeProject(asFile(legacy))).record.nativeDiagnosis, undefined);
  const forged = JSON.parse(await saved.text()); forged.nativeDiagnosis.report = { rows: [{ classification: 'repaired' }] };
  await assert.rejects(decodeProject(asFile(forged)), /native diagnosis draft/);
  for (const locate of [p => p.layout.source, p => p.bom.source, p => p.placement.source]) {
    const changed = JSON.parse(await saved.text()); locate(changed).sha256 = '0'.repeat(64);
    await assert.rejects(decodeProject(asFile(changed)), /hash/);
  }
});

test('saved derived proposal must retain its frozen finding hash; a context alone cannot become reviewed authority', () => {
  const request = { artifactType: 'scan.qualification-patch-request', schemaVersion: '1', purpose: 'qualification-only', source: { archiveSha256: 'a'.repeat(64), jobSha256: 'b'.repeat(64), root: 'Fiction/Board', jobMember: 'Fiction/Board/main.xml', jobRole: 'main' },
    targetEagleBuild: null, targetMachine: null, reviewer: 'Synthetic reviewer', trialPurpose: 'Synthetic independent offline experiment', evidence: [], proposals: [], acceptances: [], diagnosis: context() };
  assert.throws(() => validateRepairSession({ request, history: [], work: [] }), /frozen finding hash/);
  request.diagnosis.diagnosisSha256 = '4'.repeat(64);
  assert.deepEqual(validateRepairSession({ request, history: [], work: [] }).request.diagnosis, request.diagnosis);
  request.diagnosis.source.placementSha256 = 'not-a-hash';
  assert.throws(() => validateRepairSession({ request, history: [], work: [] }), /source hashes/);
});
