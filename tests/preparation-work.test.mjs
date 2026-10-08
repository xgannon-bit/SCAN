import test from 'node:test';
import assert from 'node:assert/strict';
import { preparationWork, preparationWorkCsv } from '../lib/scan/preparation-work.ts';

test('component work separates DNP, drill and missing SMT; approvals alone do not count as applied', () => {
  const row = (reference, mountingEvidence='explicit-zero-holes') => ({ reference, module: '1', nativeCadId: '100', placementIds: [], masterKeys: [], mountingEvidence, status: 'held-no-supported-template', holdCode: 'MODEL', holdReason: 'An owned local model contract is missing.', nextAction: 'Prepare model.' });
  const accounting = [row('X1'), row('X2'), row('X3', 'hole-bearing'), { ...row('X4'), placementIds: ['7', '9'], masterKeys: ['8'], status: 'existing-structure-preserved' }];
  const bom = { sourceSha256: 'a'.repeat(64), references: ['X1','X2','X3','X4'].map(normalizedRefdes => ({ normalizedRefdes, populationEvidence: normalizedRefdes === 'X2' ? 'engineering-dnp' : 'engineering-listed', sourceRow: 2, scope: {module:'',side:'',boardInstance:''} })) };
  const item = { status: 'ready-for-review', reference: 'X1', digest: 'b'.repeat(64), selection: { moduleId:'1' }, dependencies: {partId:'30',masterKey:'31',windowIds:['Body','Pad1']}, remaining:['binding-unresolved'] };
  const before = preparationWork(accounting, [item], [], bom, null);
  assert.equal(before.counts.preparedReferences, 0);
  assert.equal(before.counts.missingPopulatedSmtIntent, 1);
  assert.equal(before.counts.missingEngineeringDnp, 1);
  assert.equal(before.counts.missingHoleBearing, 1);
  assert.match(before.rows[3].atEagle.join(' '), /every listed placement/);
  assert.match(before.rows[3].atEagle.join(' '), /Reteach only/);
  const acceptedOnly = preparationWork(accounting, [item], [item.digest], bom, null);
  assert.equal(acceptedOnly.counts.preparedReferences, 0);
  assert.deepEqual(acceptedOnly.rows[0].placementIds, []);
  const actualAccounting = accounting.map(r => r.reference === 'X1' ? {...r,status:'prepared-disabled',placementIds:['30'],masterKeys:['31']} : r);
  const applied = preparationWork(actualAccounting, [item], [item.digest], bom, null);
  assert.equal(applied.counts.preparedPopulatedSmtIntent, 1);
  assert.equal(applied.rows[0].windows.length, 2);
  assert.equal(applied.rows[0].windows[1].id, 'Pad1');
  assert.equal(applied.rows[0].nativeCreation, 'prepared-offline');
  assert.equal(applied.rows[1].intentionallyExcluded, false);
  assert.equal(applied.rows[2].intentionallyExcluded, false);
  assert.ok(applied.rows.every(r => !r.machineValidated && !r.enabledBySCAN && !r.released));
  assert.match(preparationWorkCsv(applied), /reference,module,category/);
});

test('BOM population scoped to another module stays visible but does not classify this scope', () => {
  const row={reference:'N1',module:'1',status:'proposal-awaiting-review',placementIds:[],masterKeys:[],mountingEvidence:'explicit-zero-holes',nextAction:'Review.'};
  for(const populationEvidence of ['engineering-listed','engineering-dnp']) {
    const bom={sourceSha256:'a'.repeat(64),references:[{normalizedRefdes:'N1',populationEvidence,sourceRow:2,scope:{module:'2',side:'top',boardInstance:'board'}}]};
    const work=preparationWork([row],[],[],bom,null);
    assert.equal(work.rows[0].category,'population-or-mounting-unknown');
    assert.equal(work.rows[0].rawBomPopulationEvidence,populationEvidence);
    assert.equal(work.rows[0].bomApplicability,'unresolved-module-applicability');
    assert.equal(work.counts.missingPopulatedSmtIntent,0);
  }
});

test('actual partial records count as partial preparation and keep exact omitted Eagle work', () => {
  const omittedWindows=[{windowId:'SkippedTerminal',reasons:['external-parent-window'],relatedWindowIds:['Outside'],templateAlgorithmsNotTransferred:2}];
  const accounting=[{reference:'N1',module:'1',status:'prepared-partial-disabled',placementIds:['40'],masterKeys:['41'],nextAction:'Partial review.',mountingEvidence:'explicit-zero-holes',omittedWindows}];
  const item={status:'ready-for-review',reference:'N1',digest:'a'.repeat(64),selection:{moduleId:'1'},dependencies:{partId:'40',masterKey:'41',windowIds:['Body'],windowPreparation:'partial-closed-window-subset',omittedWindows}};
  const work=preparationWork(accounting,[item],[item.digest],null,null);
  assert.equal(work.counts.preparedReferences,1);
  assert.equal(work.counts.preparedWithCompleteTemplateWindowCopy,0);
  assert.equal(work.counts.preparedWithPartialWindows,1);
  assert.equal(work.rows[0].state,'prepared-partial-disabled');
  assert.equal(work.rows[0].windows.length,1);
  assert.match(work.rows[0].atEagle.join(' '),/SkippedTerminal/);
  assert.match(work.rows[0].atEagle.join(' '),/No omitted window is an approved inspection exclusion/);
});

test('shared windows and ambiguous BOM evidence remain explicit and CSV formula cells are inert', () => {
  const rows = [{reference:'=FICTION',module:'2',status:'existing-structure-preserved',placementIds:['10'],masterKeys:['15'],nextAction:'Preserve.'}];
  const archive = {capture:{packageSha256:'e'.repeat(64)},preflight:{nativeInspectionWork:{scopes:[{id:'s',masterKeyLiteral:'15',partIds:['p','q'],windowIds:['w']}],windows:[{id:'w',scopeId:'s',rawFields:{ID:['Terminal'],ParentId:['15']},algorithmIds:['a','b'],geometryReview:'unverified',bindingReview:'unresolved'}]}}};
  const bom = {sourceSha256:'f'.repeat(64),references:[{normalizedRefdes:'=FICTION'},{normalizedRefdes:'=FICTION'}]};
  const work=preparationWork(rows,[],[],bom,archive);
  assert.equal(work.rows[0].populationEvidence,'missing-or-ambiguous-bom');
  assert.equal(work.rows[0].sharedMasterScopes[0].placementCount,2);
  assert.equal(work.rows[0].windows[0].algorithmCount,2);
  assert.match(preparationWorkCsv(work), /"'=FICTION"/);
});

test('applied scalar receipt is carried to exactly its component and CSV without claiming teaching or full repair', () => {
  const original = ['FABLE-A', 'FABLE-B'].map((reference, i) => ({ reference, module: '2', status: 'existing-structure-preserved',
    placementIds: [String(10 + i)], masterKeys: ['15'], existingTeaching: 'preserved-unverified', nextAction: 'Preserve.' }));
  const baseline = preparationWork(original, [], [], null, null);
  const accounting = structuredClone(original);
  accounting[0] = { ...accounting[0], status: 'existing-scalar-trial-applied', stateBeforeScalarTrial: 'existing-structure-preserved',
    appliedScalarTrials: [{ proposalId: 'fictional-scalar', path: 'JobContainer/PartDataList/PartData[1]/Roi/cx', field: 'Roi/cx',
      identity: { ID: '10', ParentId: '2', MasterKey: '15', RefID: 'FABLE-A' }, before: '12', after: '13.125', qualificationOnly: true, inspectionRepairEstablished: false }],
    scalarTrialChecks: ['Verify the exact Roi/cx scalar and owned pad bindings with dependent windows.', 'Verify position retention after binding, teaching, save and reopen.'] };
  const work = preparationWork(accounting, [], [], null, null);
  assert.deepEqual(work.rows[1], baseline.rows[1]);
  assert.equal(work.rows[0].nativePlacement, 'existing-scalar-trial-applied-qualification-required');
  assert.equal(work.rows[0].alignment, 'scalar-geometry-trial-unverified');
  assert.equal(work.rows[0].teaching, 'preserved-unverified');
  assert.equal(work.rows[0].scalarTrialState, 'applied-qualification-only');
  assert.equal(work.rows[0].appliedScalarTrials[0].after, '13.125');
  assert.match(work.rows[0].atEagle.join(' '), /dependent windows/);
  assert.match(work.rows[0].atEagle.join(' '), /retention after binding, teaching/);
  assert.equal(work.counts.originalReferencesPreserved, 1);
  assert.equal(work.counts.originalReferencesRetained, 2);
  assert.equal(work.counts.existingTeachingPreservedReferences, 2);
  assert.equal(work.counts.appliedScalarTrialReferences, 1);
  assert.equal(work.inspectionRepairEstablished, false);
  const csv = preparationWorkCsv(work);
  assert.match(csv, /appliedScalarTrials/); assert.match(csv, /fictional-scalar/); assert.match(csv, /13\.125/);
  assert.match(csv.split('\r\n')[1], /position retention after binding/);
  assert.doesNotMatch(csv.split('\r\n')[2], /fictional-scalar|scalar-geometry-trial-unverified/);
});
