import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { archiveWorker } from '../lib/scan/archive-worker.ts';
import { buildSourceReport, sourceReportText } from '../lib/scan/source-report.ts';
import { NativeBindingDetails } from '../components/scan/NativeAccounting.tsx';
import { makeArchive, syntheticMembers, syntheticSelection } from './synthetic-archive.mjs';

// Wholly authored source strings; no vendor job or private source fixture.
const xml = body => `<JobContainer><JobXmlVersion>10.2</JobXmlVersion>${body}</JobContainer>`;
const job = tag => xml(`<ModuleDataList><ModuleData><ID>${tag}-module</ID></ModuleData></ModuleDataList>
  <PartDataList><PartData><ID>${tag}-instance</ID><ParentId>${tag}-module</ParentId><RefID>FICTION-REF</RefID><MasterKey>${tag}-master</MasterKey><WND_PAD>${tag}-group|${tag}-pad|opaque|marker|2.75|-6.25</WND_PAD></PartData></PartDataList>
  <GerberList><GerberPad><ID>${tag}-pad</ID><ModelID>${tag}-module</ModelID><BlockID>invented-block</BlockID><PartNo>${tag}-cad</PartNo><C>2.750,-6.250</C></GerberPad></GerberList>
  <CadData><CpList><Cp><ID>${tag}-cad</ID><ModuleID>${tag}-module</ModuleID><RefID>FICTION-DIFFERENT</RefID></Cp></CpList></CadData>`);
const master = tag => xml(`<WindowDataList><WindowData><ID>separate-window-id</ID><ParentId>${tag}-master</ParentId><GroupID>${tag}-group</GroupID></WindowData></WindowDataList>`);
const temporary = { ...syntheticSelection, jobMember: 'Fictional/Board/Board_Temp.xml', jobRole: 'temp', masterMember: 'Fictional/Master/Master_Temp.xml', masterRole: 'temp' };
const members = { ...syntheticMembers,
  [syntheticSelection.jobMember]: job('authored-main'), [syntheticSelection.masterMember]: master('authored-main'),
  [temporary.jobMember]: job('authored-temp'), [temporary.masterMember]: master('authored-temp'),
};
const digest = value => createHash('sha256').update(value).digest('hex');
async function inspect(selection = syntheticSelection, contents = members) {
  const bytes = makeArchive(contents), before = Buffer.from(bytes);
  const review = await (await archiveWorker(bytes, { action: 'preflight', expectedArchiveSha256: digest(bytes), selection }, new AbortController().signal)).json();
  assert.deepEqual(bytes, before);
  assert.equal(review.status, 'success');
  return { review, bytes };
}

test('worker binds literal chains to exact independently verified main and temp selections', async () => {
  for (const selection of [syntheticSelection, temporary]) {
    const { review, bytes } = await inspect(selection);
    const report = review.preflight.nativeBindings;
    assert.equal(report.status, 'recorded');
    assert.equal(report.sourceContext.archiveSha256, digest(bytes));
    assert.equal(report.sourceContext.packageSha256, review.capture.packageSha256);
    assert.equal(report.sourceContext.snapshotId, review.capture.snapshotId);
    assert.deepEqual(report.sourceContext.selection, review.preflight.selection);
    assert.equal(report.sourceContext.selection.job.member, selection.jobMember);
    assert.equal(report.sourceContext.selection.job.role, selection.jobRole);
    assert.equal(report.sourceContext.selection.job.sha256, digest(members[selection.jobMember]));
    assert.equal(report.sourceContext.selection.master.member, selection.masterMember);
    assert.equal(report.sourceContext.selection.master.role, selection.masterRole);
    assert.equal(report.sourceContext.selection.master.sha256, digest(members[selection.masterMember]));
    assert.equal(report.bindings[0].window.state, 'unique-literal-match');
    assert.equal(report.bindings[0].pad.state, 'unique-literal-match');
    assert.equal(report.bindings[0].coordinateComparison.state, 'decimal-equal-text-differs');
    assert.equal(report.bindings[0].tokens[0], selection.jobRole === 'main' ? 'authored-main-group' : 'authored-temp-group');
    assert.equal(report.ownershipQualified, false); assert.equal(report.machineExportAllowed, false);
    assert.equal(report.nativeEditsApplied, false); assert.equal(review.candidateId, null);
    assert.equal(report.findings.length, 0);
    assert.equal(report.padCadRelationExperiment.boundPartReferenceComparisonCounts['different-reference-literals'], 1);
  }
});

test('no selected Master and blocked job preserve provenance without fabricated binding counts', async () => {
  const noMaster = (await inspect({ ...temporary, masterMember: null, masterRole: null })).review.preflight.nativeBindings;
  assert.equal(noMaster.sourceContext.selection.master, null);
  assert.equal(noMaster.counts.masterDocumentAvailable, false);
  assert.equal(noMaster.bindings[0].window.state, 'unavailable-document');
  assert.equal(noMaster.findings.length, 0);
  const blocked = (await inspect(syntheticSelection, { ...members, [syntheticSelection.jobMember]: '<Malformed' })).review.preflight.nativeBindings;
  assert.equal(blocked.status, 'unavailable');
  assert.equal(blocked.counts, null); assert.equal(blocked.literalObservationsComplete, false);
  assert.equal(blocked.sourceContext.selection.job.sha256, digest('<Malformed'));
  assert.equal(blocked.machineExportAllowed, false);
});

test('handoff preserves raw evidence and separates relation experiments from findings', async () => {
  const { review } = await inspect();
  const input = { sourceName: null, result: null, notes: {}, archiveName: 'authored.zip', archive: review };
  const handoff = buildSourceReport(input), bindings = review.preflight.nativeBindings;
  assert.deepEqual(handoff.nativeBindings, bindings);
  assert.deepEqual(JSON.parse(JSON.stringify(handoff)).nativeBindings.sourceContext, bindings.sourceContext);
  assert.equal(handoff.workItems.filter(item => item.scope === 'native-literal-binding').length, 0);
  const text = sourceReportText(handoff);
  for (const literal of [bindings.sourceContext.archiveSha256, bindings.sourceContext.selection.job.sha256,
    bindings.sourceContext.selection.master.sha256, bindings.bindings[0].rawSegment, 'OWNERSHIP UNKNOWN',
    'NOT OWNERSHIP EVIDENCE OR DEFECT FINDINGS']) assert.ok(text.includes(literal));
  assert.equal(handoff.candidateId, null); assert.equal(handoff.machineExportAllowed, false);
  const malformed = structuredClone(review);
  malformed.preflight.nativeBindings.findings = [{ code: 'AUTHORED_OBSERVATION', severity: 'observation',
    sourcePath: 'authored-part[1]', segmentOrdinal: 4, message: 'Authored literal discrepancy.', ownershipQualified: false, repairEligibility: 'unqualified' }];
  const observed = buildSourceReport({ ...input, archive: malformed });
  const item = observed.workItems.find(item => item.scope === 'native-literal-binding');
  assert.equal(item.severity, 'observation'); assert.equal(item.bindingContext.segmentOrdinal, 4);
  assert.deepEqual(item.bindingContext.sourceContext, bindings.sourceContext);
  assert.match(sourceReportText(observed), /Exact binding evidence:/);
});

test('rendered binding details disclose scope, bounded examples and unavailable states without candidate actions', async () => {
  const { review } = await inspect(temporary);
  const bindings = review.preflight.nativeBindings;
  const markup = renderToStaticMarkup(createElement(NativeBindingDetails, { report: bindings }));
  for (const label of ['Native window and pad links', 'Download native bindings (.json)', 'Ownership: unknown',
    'temp · Fictional/Board/Board_Temp.xml', 'Reference differences here are not defect findings.',
    'Showing 1', '2.750,-6.250']) assert.ok(markup.includes(label), label);
  assert.ok(!markup.includes('Export native candidate'));
  const noMaster = (await inspect({ ...temporary, masterMember: null, masterRole: null })).review.preflight.nativeBindings;
  const missing = renderToStaticMarkup(createElement(NativeBindingDetails, { report: noMaster }));
  assert.match(missing, /Explicitly not selected/);
  assert.match(missing, /unavailable, not assumed to be missing links/);
});
