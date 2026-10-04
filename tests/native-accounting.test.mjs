import assert from 'node:assert/strict';
import test from 'node:test';
import { componentCoverageCsv, remainingNativeWorkCsv, MAX_NATIVE_CSV_BYTES } from '../lib/scan/native-accounting.ts';
import { buildSourceReport, sourceReportText } from '../lib/scan/source-report.ts';

// Fictional literal records, independently authored without native file samples.
function report(cadCount = 2, partCount = 2) {
  const componentCoverage = Array.from({ length: cadCount }, (_, index) => ({
    id: `row-${index}`, sourcePath: `Fictional/Cad[${index}]`, recordId: `cad-${index}`, groupId: 'group-fiction',
    moduleLiteral: 'module-fiction', referenceLiteral: 'reference-fiction', sourceRepresentation: 'native-cad-row',
    nativeCorrespondence: 'multiple-literal-matches', nativePreparation: 'not-prepared', existingTeaching: 'unassessed',
    enabledState: 'unqualified', verification: 'not-verified', release: 'not-assessed', exclusion: 'not-assessed',
  }));
  const nativeInstances = Array.from({ length: partCount }, (_, index) => ({
    id: `part-${index}`, sourcePath: `Fictional/Part[${index}]`, groupId: 'group-fiction', coverageRowId: null,
    nativeIdLiterals: [`FICTION-PART-${index}`], enableLiterals: [index % 2 ? 'False' : 'True'], enabledMeaning: 'unqualified',
  }));
  return {
    artifactType: 'scan.native-accounting', schemaVersion: '1', analyzerVersion: 'fictional-test',
    status: 'recorded', code: 'LITERAL_ACCOUNTING_RECORDED', accountingComplete: true,
    sourceContext: { archiveSha256: 'a'.repeat(64), snapshotId: 'fictional-snapshot', jobMember: 'Fictional/job.xml', jobSha256: 'b'.repeat(64) },
    interpretation: 'Literal structural evidence only.',
    componentCoverage, nativeInstances,
    correspondenceGroups: [{ id: 'group-fiction', moduleLiteral: 'module-fiction', referenceLiteral: 'reference-fiction',
      cadRecordIds: componentCoverage.map(row => row.recordId), nativeInstanceIds: nativeInstances.map(row => row.id),
      affectedRowIds: componentCoverage.map(row => row.id), moduleMatchState: 'unique-literal-match', duplicateMeaning: 'unqualified' }],
    findings: [{ id: 'finding-fiction', code: 'MULTIPLE_NATIVE_PART_RECORDS', severity: 'observation',
      sourcePaths: nativeInstances.map(row => row.sourcePath), groupId: 'group-fiction',
      message: 'Several fictional native records have the same literal scope; no survivor identified.', repairEligibility: 'unqualified' }],
    sharedBlockers: [{ id: 'blocker-fiction', code: 'NATIVE_SEMANTICS_UNQUALIFIED', scope: 'job',
      affectedRowIds: componentCoverage.map(row => row.id), reason: 'Native field semantics are unqualified.' }],
    remainingWork: [{ id: 'work-observation', findingId: 'finding-fiction', groupId: 'group-fiction', nextAction: 'Check this exact native scope in Eagle.' },
      { id: 'work-shared', blockerId: 'blocker-fiction', nextAction: 'Qualify this shared native prerequisite once.' }],
    counts: { cadRows: cadCount, nativePartInstances: partCount, coverageRows: cadCount, nativeOnlyRows: 0,
      findings: 1, sharedBlockers: 1, nativeEditsApplied: 0 },
    changes: [], machineExportAllowed: false, nativeEditsApplied: false,
  };
}

function parseCsv(text) {
  const rows = [];
  let row = [], value = '', quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { value += '"'; index++; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) { row.push(value); value = ''; }
    else if (char === '\r' && text[index + 1] === '\n' && !quoted) {
      row.push(value); rows.push(row); row = []; value = ''; index++;
    } else value += char;
  }
  assert.equal(quoted, false);
  assert.equal(value, '');
  const [header, ...contents] = rows;
  return contents.map(values => Object.fromEntries(header.map((name, index) => [name, values[index]])));
}

test('CSV keeps every source row and emits each native group member once', () => {
  const input = report(100, 120), before = structuredClone(input);
  const rows = parseCsv(componentCoverageCsv(input));
  const coverage = rows.filter(row => row.record_type === 'component');
  const instances = rows.filter(row => row.record_type === 'native-instance');
  assert.equal(rows.length, 220);
  assert.equal(coverage.length, 100);
  assert.equal(instances.length, 120);
  assert.deepEqual(coverage.map(row => row.accounting_id), input.componentCoverage.map(row => row.id));
  assert.deepEqual(instances.map(row => row.source_record_id), input.correspondenceGroups[0].nativeInstanceIds);
  assert.ok(rows.every(row => row.group_id === 'group-fiction'));
  assert.ok(coverage.every(row => row.native_id_literals_json === ''));
  assert.deepEqual(JSON.parse(instances[0].enable_literals_json_unqualified), ['True']);
  assert.deepEqual(JSON.parse(instances[1].enable_literals_json_unqualified), ['False']);
  assert.ok(rows.every(row => row.native_preparation === 'not-prepared' && row.enabled_state === 'unqualified'));
  assert.deepEqual(input, before);
});

test('CSV neutralizes formulas and retains exact quoted commas and line breaks', () => {
  for (const literal of ['=1+2', '+2', '-8', '@formula', ' \t=3', '\tordinary', '\nordinary']) {
    const input = report();
    input.componentCoverage[0].referenceLiteral = literal;
    assert.equal(parseCsv(componentCoverageCsv(input))[0].reference_literal, "'" + literal);
  }
  const input = report();
  input.componentCoverage[0].sourcePath = 'fiction,"quoted"\nnext line';
  const path = parseCsv(componentCoverageCsv(input))[0].source_path;
  assert.equal(path, 'fiction,"quoted"\nnext line');
  input.remainingWork[0].nextAction = '=HYPERLINK("fiction")';
  assert.equal(parseCsv(remainingNativeWorkCsv(input))[0].next_action, '\'=HYPERLINK("fiction")');
});

test('remaining work retains exact evidence links without expanding repeated affected populations', () => {
  const input = report(90, 80);
  input.remainingWork.push(...Array.from({ length: 100 }, (_, index) => ({ id: `extra-work-${index}`, findingId: 'finding-fiction', groupId: 'group-fiction', nextAction: 'Fictional exact action.' })));
  const rows = parseCsv(remainingNativeWorkCsv(input));
  const of = type => rows.filter(row => row.record_type === type);
  assert.equal(of('work').length, 102);
  assert.equal(of('group-accounting-link').length, 90);
  assert.equal(of('blocker-accounting-link').length, 90);
  assert.equal(of('finding-source-link').length, 80);
  assert.ok(of('work').every(row => row.status === 'not-completed'));
  assert.deepEqual(of('group-accounting-link').map(row => row.accounting_id), input.componentCoverage.map(row => row.id));
  assert.deepEqual(of('finding-source-link').map(row => row.source_path), input.findings[0].sourcePaths);
});

test('native-only and malformed-scope rows retain distinct coverage and instance identities', () => {
  const input = report(1, 1), row = input.componentCoverage[0], instance = input.nativeInstances[0];
  row.sourceRepresentation = 'native-part-only'; row.recordId = instance.id;
  row.groupId = null; row.moduleLiteral = null; row.referenceLiteral = null; row.nativeCorrespondence = 'unusable-scope';
  instance.groupId = null; instance.coverageRowId = row.id;
  input.correspondenceGroups = [];
  input.findings[0].groupId = null; input.remainingWork[0].groupId = null;
  input.counts.cadRows = 0; input.counts.nativeOnlyRows = 1;
  const rows = parseCsv(componentCoverageCsv(input));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].source_representation, 'native-part-only');
  assert.equal(rows[1].accounting_id, row.id);
  assert.equal(rows[1].source_record_id, instance.id);
  assert.equal(rows[1].group_id, '');
});

test('export rejects incomplete, inconsistent and non-finite counts or claims', () => {
  for (const mutate of [
    value => { value.status = 'blocked'; }, value => { value.machineExportAllowed = true; },
    value => { value.nativeEditsApplied = true; }, value => { value.accountingComplete = false; },
    value => { value.counts.cadRows = Infinity; }, value => { value.counts.coverageRows = NaN; },
    value => { value.counts.nativeOnlyRows = -1; }, value => { value.counts.nativePartInstances = 99; },
    value => { value.componentCoverage[0].nativePreparation = 'prepared'; },
    value => { value.componentCoverage[0].verification = 'verified'; },
    value => { value.nativeInstances[0].enabledMeaning = 'enabled'; },
    value => { value.correspondenceGroups[0].nativeInstanceIds.pop(); },
    value => { value.correspondenceGroups[0].affectedRowIds.pop(); },
    value => { value.correspondenceGroups[0].cadRecordIds.push('absent'); },
    value => { value.remainingWork[0].findingId = 'absent'; },
  ]) {
    const input = report(); mutate(input);
    assert.throws(() => componentCoverageCsv(input));
    assert.throws(() => remainingNativeWorkCsv(input));
  }
  assert.throws(() => componentCoverageCsv(report(10_001, 0)), /bounds/);
});

test('CSV cell and byte limits refuse full export instead of silently truncating', () => {
  const cell = report(); cell.componentCoverage[0].sourcePath = '\u754c'.repeat(11_000);
  assert.throws(() => componentCoverageCsv(cell), /cell exceeds 32 KiB/);
  const input = report(3000, 1);
  for (const row of input.componentCoverage) row.referenceLiteral = 'F'.repeat(1000);
  assert.throws(() => componentCoverageCsv(input), /CSV exceeds 3 MB/);
  const small = componentCoverageCsv(report(100, 100));
  assert.ok(Buffer.byteLength(small) <= MAX_NATIVE_CSV_BYTES);
});

function sourceReport(accounting) {
  return buildSourceReport({ sourceName: null, result: null, notes: {}, archiveName: 'fictional.zip',
    archive: { capture: { snapshotId: 'fictional-snapshot', packageSha256: 'c'.repeat(64), size: 10 },
      preflight: { source: { sha256: 'a'.repeat(64) },
        selection: { root: 'Fictional', job: { role: 'main', member: 'Fictional/job.xml' }, master: null },
        nativeAccounting: accounting,
        holds: [{ code: 'NATIVE_ADAPTER_UNQUALIFIED', scope: 'job', reason: 'Covered generic hold.', nextAction: 'Covered generic action.' }] } } });
}

test('source handoff includes complete native observations, grouped blockers and exact next actions', () => {
  const native = report(), handoff = sourceReport(native);
  assert.deepEqual(handoff.nativeAccounting, native);
  assert.equal(handoff.workItems.filter(item => item.reason === 'Covered generic hold.').length, 0);
  assert.equal(handoff.workItems.length, native.remainingWork.length);
  assert.equal(handoff.workItems[0].nativeContext.findingId, native.findings[0].id);
  assert.equal(handoff.workItems[0].nativeContext.groupId, 'group-fiction');
  assert.equal(handoff.workItems[1].nativeContext.blockerId, native.sharedBlockers[0].id);
  assert.equal(handoff.candidateId, null); assert.equal(handoff.machineExportAllowed, false);
  assert.equal(handoff.readiness.offlinePreparationCoverage, null);
  const readable = sourceReportText(handoff);
  for (const value of [native.findings[0].message, native.sharedBlockers[0].reason, native.remainingWork[0].nextAction,
    native.componentCoverage[0].sourcePath, native.nativeInstances[0].sourcePath, 'NO NATIVE EDITS APPLIED', 'preparation=not-prepared']) assert.ok(readable.includes(value));
});

test('source handoff retains explicit unavailable accounting reason', () => {
  const input = report(); input.status = 'blocked'; input.reason = 'Fictional accounting output bound exceeded.';
  input.accountingComplete = false; input.componentCoverage = []; input.nativeInstances = [];
  input.correspondenceGroups = []; input.sharedBlockers = []; input.findings = []; input.remainingWork = []; input.counts = null;
  const handoff = sourceReport(input);
  assert.ok(handoff.workItems.some(item => item.reason === input.reason));
  assert.match(sourceReportText(handoff), /complete literal accounting: false/);
  assert.equal(handoff.machineExportAllowed, false);
});
