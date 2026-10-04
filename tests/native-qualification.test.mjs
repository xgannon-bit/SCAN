import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { archiveWorker } from '../lib/scan/archive-worker.ts';
import { buildNativeQualification, nativeQualificationText } from '../lib/scan/native-qualification.ts';
import { makeArchive, syntheticMembers, syntheticSelection } from './synthetic-archive.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
async function review(members = syntheticMembers, selection = syntheticSelection) {
  const bytes = makeArchive(members);
  const result = await (await archiveWorker(bytes, { action: 'preflight', expectedArchiveSha256: digest(bytes), selection }, new AbortController().signal)).json();
  assert.equal(result.status, 'success');
  return result;
}

test('comparison verifies all file bytes, binds exact capture identities and never authorizes native output', async () => {
  const before = await review();
  const report = buildNativeQualification(before, before, 'TEST-BUILD-ONLY');
  assert.equal(report.comparison.archiveBytesEqual, true);
  assert.equal(report.comparison.filePayloadsEqual, true);
  assert.equal(report.comparison.sameSelection, true);
  assert.equal(report.comparison.counts.unchanged, Object.keys(syntheticMembers).length);
  assert.equal(report.before.captureSha256, before.capture.packageSha256);
  assert.equal(report.application.versionVerified, false);
  assert.equal(report.machineExportAllowed, false);
  assert.equal(report.candidateId, null);
  assert.equal(report.readiness.machineCompatibility, null);
  assert.match(nativeQualificationText(report), /No native job was generated/);
  assert.ok(report.holds.some(hold => hold.code === 'NATIVE_FORMAT_UNQUALIFIED'));
});

test('changed unselected assets, removed files and added files are all included', async () => {
  const initial = { ...syntheticMembers, 'Fictional/Board/opaque-image.bin': 'ORIGINAL-SYNTHETIC' };
  const before = await review(initial);
  const returned = { ...initial, 'Fictional/Board/opaque-image.bin': 'DIFFERENT-SYNTHETIC', 'Fictional/new.asset': 'ADDED' };
  delete returned['README.txt'];
  const report = buildNativeQualification(before, await review(returned), 'TEST-BUILD-ONLY');
  assert.deepEqual(report.comparison.counts, { unchanged: 5, changed: 1, added: 1, removed: 1 });
  assert.equal(report.comparison.filePayloadsEqual, false);
  assert.equal(report.comparison.sameSelection, true);
  assert.ok(report.holds.some(hold => hold.code === 'ARCHIVE_CONTENT_CHANGED'));
  assert.match(nativeQualificationText(report), /REMOVED \| README.txt/);
});

test('repacked identical payloads differ from byte-identical ZIPs and selection changes remain held', async () => {
  const before = await review();
  const reordered = Object.fromEntries(Object.entries(syntheticMembers).reverse());
  const after = await review(reordered);
  const sameFiles = buildNativeQualification(before, after, '');
  assert.equal(sameFiles.comparison.archiveBytesEqual, false);
  assert.equal(sameFiles.comparison.filePayloadsEqual, true);
  assert.ok(sameFiles.holds.some(hold => hold.code === 'SOFTWARE_VERSION_MISSING'));
  const selected = await review(syntheticMembers, { ...syntheticSelection, jobMember: 'Fictional/Board/Board_Temp.xml', jobRole: 'temp' });
  const wrongRole = buildNativeQualification(before, selected, 'TEST');
  assert.equal(wrongRole.comparison.sameSelection, false);
  assert.ok(wrongRole.holds.some(hold => hold.code === 'SNAPSHOT_SELECTION_CHANGED'));
});

test('malformed, forged-success and mismatched capture evidence is rejected', async () => {
  const before = await review();
  const mutations = [
    value => { value.machineExportAllowed = true; },
    value => { value.preflight.nativeSchemaSupported = true; },
    value => { value.capture.packageSha256 = '0'.repeat(64); },
    value => { value.preflight.selection.job.sha256 = '0'.repeat(64); },
    value => { value.preflight.preservedFiles.push(value.preflight.preservedFiles[0]); },
    value => { delete value.preflight.preservedDirectories; },
    value => { value.preflight.integrity.allArchivedFilesVerified = false; },
  ];
  for (const mutate of mutations) {
    const altered = structuredClone(before); mutate(altered);
    assert.throws(() => buildNativeQualification(before, altered, 'TEST'));
  }
  assert.throws(() => buildNativeQualification(before, before, 'X'.repeat(129)));
});

test('native record profile reads only source strings and cannot upgrade qualification', async () => {
  const members = { ...syntheticMembers, [syntheticSelection.jobMember]: '<JobContainer><JobXmlVersion>10.2</JobXmlVersion><PartDataList><PartData><ID>fake-only</ID><RefID>FICTIONAL-R</RefID><Roi><cx>01.2500</cx></Roi></PartData></PartDataList></JobContainer>' };
  const before = await review(members);
  assert.equal(before.preflight.nativeRecords.job.status, 'recorded');
  assert.deepEqual(before.preflight.nativeRecords.job.records[0].rawFields['Roi/cx'], ['01.2500']);
  assert.equal(buildNativeQualification(before, before, '10.2').machineExportAllowed, false);
});

test('explicit directory additions are separate from file payload equality', async () => {
  const before = await review();
  const after = await review({ ...syntheticMembers, 'Fictional/empty-directory/': '' });
  const report = buildNativeQualification(before, after, 'TEST');
  assert.equal(report.comparison.filePayloadsEqual, true);
  assert.equal(report.comparison.directoryEntriesEqual, false);
  assert.deepEqual(report.comparison.directories, [{ path: 'Fictional/empty-directory', state: 'added' }]);
  assert.ok(report.holds.some(hold => hold.code === 'ARCHIVE_CONTENT_CHANGED'));
});
