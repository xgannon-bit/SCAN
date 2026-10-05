import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { makeArchive, syntheticMembers, syntheticSelection } from '../synthetic-archive.mjs';

// Independently authored fictional records; these do not qualify an Eagle job.
function job(reference: string, parts: number) {
  return `<JobContainer><JobXmlVersion>10.2</JobXmlVersion><ModuleDataList><ModuleData><ID>PROJECT-MODULE</ID><TB>unmapped</TB></ModuleData></ModuleDataList><CadData><CpList><Cp><ID>CAD-INDEPENDENT</ID><ModuleID>PROJECT-MODULE</ModuleID><RefID>${reference}</RefID><X>1</X><Y>2</Y></Cp></CpList></CadData><PartDataList>${Array.from({ length: parts }, (_, i) => `<PartData><ID>AUTHORED-PART-${i}</ID><ParentId>PROJECT-MODULE</ParentId><RefID>${reference}</RefID><MasterKey>FICTIONAL-MODEL</MasterKey><ENABLE>${i ? '0' : '1'}</ENABLE><CenterPosX>${i + 1}</CenterPosX><CenterPosY>2</CenterPosY></PartData>`).join('')}</PartDataList></JobContainer>`;
}
const tempMember = 'Fictional/Board/Board_Temp.xml';
const tempMaster = 'Fictional/Master/Master_Temp.xml';
const members = { ...syntheticMembers, [syntheticSelection.jobMember]: job('MAIN-ONLY', 1), [tempMember]: job('PROJECT-R1', 2) };
const originalBytes = makeArchive(members);
const returnedBytes = makeArchive({ ...members, [syntheticSelection.jobMember]: job('RETURNED-R1', 1), 'README.txt': 'Authored returned archive; no machine execution claim.' });
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const nav = (page: Page, name: string) => page.getByRole('navigation', { name: 'SCAN screens' }).getByRole('link', { name, exact: true });
const archiveRegion = (page: Page, returned = false) => page.getByRole('region', { name: returned ? 'Job archive returned from Eagle' : 'Existing native job archive', exact: true });

async function selectArchive(page: Page, bytes: Buffer, returned = false, temporary = false, omitMaster = false) {
  const section = archiveRegion(page, returned);
  await section.getByLabel('Native job archive (.zip)').setInputFiles({ name: returned ? 'authored-returned.zip' : 'authored-original.zip', mimeType: 'application/zip', buffer: bytes });
  await section.getByRole('button', { name: 'Inventory archive', exact: true }).click();
  await expect(section.getByRole('combobox', { name: 'Job root', exact: true })).toBeVisible();
  await section.getByRole('combobox', { name: 'Job root', exact: true }).selectOption(syntheticSelection.root);
  const role = temporary ? 'temp' : 'main';
  const jobChoice = JSON.stringify({ role, member: temporary ? tempMember : syntheticSelection.jobMember });
  const masterChoice = omitMaster ? 'none' : JSON.stringify({ role, member: temporary ? tempMaster : syntheticSelection.masterMember });
  await section.getByRole('combobox', { name: 'Job snapshot', exact: true }).selectOption(jobChoice);
  await section.getByRole('combobox', { name: 'Master snapshot', exact: true }).selectOption(masterChoice);
  await section.getByRole('button', { name: 'Capture and verify selection' }).click();
  await expect(section.getByRole('heading', { name: 'Snapshot integrity verified; native preparation blocked' })).toBeVisible();
  return { jobChoice, masterChoice };
}
async function download(page: Page, name: string) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name, exact: true }).click();
  return readFile((await (await pending).path())!);
}
async function reopen(page: Page, bytes: Buffer) {
  await page.getByLabel('Saved placement review file', { exact: true }).setInputFiles({ name: 'authored.scan-project.json', mimeType: 'application/json', buffer: bytes });
  await expect(page.getByRole('status').filter({ hasText: 'Project reopened.' })).toBeVisible();
}
function observe(page: Page, baseURL: string | undefined) {
  const requests: string[] = [], errors: string[] = [], external: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.origin !== baseURL) external.push(request.url());
    if (url.pathname.startsWith('/api/')) requests.push(url.pathname);
  });
  return { requests, errors, external };
}
function assertEmbedded(source: { sha256: string; size: number; base64: string }, bytes: Buffer) {
  expect(source.sha256).toBe(sha256(bytes)); expect(source.size).toBe(bytes.length);
  expect(Buffer.from(source.base64, 'base64')).toEqual(bytes);
}

test('native-only project restores both archives, explicit temp/main choices, notes and fresh accounting', async ({ page, baseURL }) => {
  test.setTimeout(60_000);
  const observed = observe(page, baseURL);
  await page.goto('/intake');
  const originalChoices = await selectArchive(page, originalBytes, false, true);
  await page.getByRole('textbox', { name: 'Review notes', exact: true }).fill('Native-only authored project note; not approval.');
  await nav(page, 'Review handoff').click();
  await page.getByLabel('Intended Eagle software version').fill('AUTHORED-PROJECT-VERSION');
  const returnedChoices = await selectArchive(page, returnedBytes, true, false, true);
  const beforeAccounting = JSON.parse((await download(page, 'Download native accounting (.json)')).toString());
  expect(beforeAccounting.counts.cadRows).toBe(1);
  expect(beforeAccounting.counts.nativePartInstances).toBe(2);
  const saved = await download(page, 'Save project'); const record = JSON.parse(saved.toString());
  expect(record.artifactType).toBe('scan.project-session');
  expect(record.placement).toBeNull(); expect(record.gerber).toBeNull();
  expect(record.machineVersion).toBe('AUTHORED-PROJECT-VERSION');
  expect(record.notes.session).toContain('Native-only authored');
  expect(record.archives.original.selection.jobRole).toBe('temp');
  expect(record.archives.original.selection.masterRole).toBe('temp');
  expect(record.archives.returned.selection.jobRole).toBe('main');
  expect(record.archives.returned.selection.masterMember).toBeNull();
  assertEmbedded(record.archives.original.source, originalBytes);
  assertEmbedded(record.archives.returned.source, returnedBytes);
  expect(record).not.toHaveProperty('nativeAccounting');
  expect(record.archives.original).not.toHaveProperty('preflight');
  expect(record.machineExportAllowed).toBe(false);

  await page.reload();
  await expect(page.getByRole('button', { name: 'Save project', exact: true })).toBeDisabled();
  observed.requests.length = 0;
  await reopen(page, saved);
  expect(observed.requests.filter(path => path === '/api/archive')).toHaveLength(4);
  expect(observed.requests.filter(path => path === '/api/placements' || path === '/api/gerber')).toHaveLength(0);
  await expect(page.getByLabel('Intended Eagle software version')).toHaveValue(record.machineVersion);
  await expect(page.getByRole('textbox', { name: 'Review notes', exact: true })).toHaveValue(record.notes.session);
  await expect(archiveRegion(page, true).getByRole('combobox', { name: 'Job snapshot', exact: true })).toHaveValue(returnedChoices.jobChoice);
  await expect(archiveRegion(page, true).getByRole('combobox', { name: 'Master snapshot', exact: true })).toHaveValue('none');
  const accounting = JSON.parse((await download(page, 'Download native accounting (.json)')).toString());
  expect(accounting.sourceContext.archiveSha256).toBe(sha256(originalBytes));
  expect(accounting.sourceContext.jobMember).toBe(tempMember);
  expect(accounting.sourceContext.jobSha256).toBe(sha256(Buffer.from(members[tempMember])));
  expect(accounting.counts).toEqual(beforeAccounting.counts);
  expect(accounting.nativeEditsApplied).toBe(false);
  expect(accounting.componentCoverage[0].nativeCorrespondence).toBe('multiple-literal-matches');
  expect(accounting.componentCoverage[0].nativePreparation).toBe('not-prepared');
  const comparison = JSON.parse((await download(page, 'Save native qualification (.json)')).toString());
  expect(comparison.before.archiveSha256).toBe(sha256(originalBytes));
  expect(comparison.after.archiveSha256).toBe(sha256(returnedBytes));
  expect(comparison.holds).toContainEqual(expect.objectContaining({ code: 'SNAPSHOT_SELECTION_CHANGED' }));
  await expect(page.getByRole('link', { name: 'Review and export qualification candidate', exact: true })).toHaveAttribute('href', '/repair');
  await nav(page, 'Source intake').click();
  await expect(archiveRegion(page).getByRole('combobox', { name: 'Job snapshot', exact: true })).toHaveValue(originalChoices.jobChoice);
  await expect(archiveRegion(page).getByRole('combobox', { name: 'Master snapshot', exact: true })).toHaveValue(originalChoices.masterChoice);

  // A bad returned source must not replace even the original or its fresh report.
  const tampered = structuredClone(record); tampered.archives.returned.source.sha256 = '0'.repeat(64);
  observed.requests.length = 0;
  await page.getByLabel('Saved placement review file', { exact: true }).setInputFiles({ name: 'authored-tampered.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(tampered)) });
  await expect(page.getByRole('main').getByRole('alert')).toContainText('do not match their hash');
  expect(observed.requests).toHaveLength(0);
  await expect(archiveRegion(page).getByRole('combobox', { name: 'Job snapshot', exact: true })).toHaveValue(originalChoices.jobChoice);
  await expect(page.getByRole('textbox', { name: 'Review notes', exact: true })).toHaveValue(record.notes.session);

  // Explicitly supplied historical summaries remain annotations; source removal
  // removes only affected summaries and keeps the project saveable.
  const note = { id: 'original-note', sourceSha256: record.archives.original.source.sha256, recordedAt: '2026-01-02T03:04:05Z', summary: 'Authored source observation; no approval.' };
  record.evidence = { authority: 'annotations-only', decisions: [note, { ...note, id: 'returned-note', sourceSha256: record.archives.returned.source.sha256 }], candidateHistory: [], machineObservations: [] };
  await reopen(page, Buffer.from(JSON.stringify(record)));
  await nav(page, 'Review handoff').click();
  await archiveRegion(page, true).getByRole('button', { name: 'Clear archive', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '1 historical annotation(s) invalidated' })).toBeVisible();
  const retained = JSON.parse((await download(page, 'Save project')).toString());
  expect(retained.archives.returned).toBeNull();
  expect(retained.evidence.decisions).toEqual([note]);
  expect(retained.evidence.authority).toBe('annotations-only');
  expect(retained.machineExportAllowed).toBe(false);
  expect(observed.errors).toEqual([]); expect(observed.external).toEqual([]);
});

test('combined project restores source hashes, mappings, selected row and freshly checked Gerber alignment', async ({ page, baseURL }) => {
  test.setTimeout(60_000);
  const observed = observe(page, baseURL);
  const placement = Buffer.from('A1;FICTIONAL;;"0,0";Top;0;SYNTHETIC\nA2;FICTIONAL;;"10,0";Top;0;SYNTHETIC\nA3;FICTIONAL;;"0,20";Top;0;SYNTHETIC\nA4;FICTIONAL;;"7,11";Top;0;SYNTHETIC\n');
  const gerber = Buffer.from('%MOMM*%\n%FSLAX23Y23*%\n%ADD10C,1*%\nD10*\nX100000Y50000D03*\nX100000Y60000D03*\nX80000Y50000D03*\nX89000Y57000D03*\nM02*\n');
  await page.goto('/intake');
  await page.getByLabel('Placement file (.xlsx, .xls or .csv)', { exact: true }).setInputFiles({ name: 'authored-project.csv', mimeType: 'text/csv', buffer: placement });
  await page.getByLabel('CSV delimiter').selectOption(';');
  await page.getByRole('button', { name: 'Read file', exact: true }).click();
  await expect(page.getByText('4 source rows')).toBeVisible();
  await page.getByLabel('Module for this sheet').fill('FICTIONAL-PROJECT');
  await page.getByLabel('Placement units').selectOption('mm');
  await page.getByLabel('Source rotation direction').selectOption('ccw');
  await page.getByRole('button', { name: 'Validate placements' }).click();
  await expect(page.getByText('4 parsed · 0 errors', { exact: false })).toBeVisible();
  await selectArchive(page, originalBytes);
  await page.getByLabel('Gerber file').setInputFiles({ name: 'authored-project.gbx', mimeType: 'text/plain', buffer: gerber });
  await page.getByText('Review an incorrect source declaration', { exact: true }).click();
  await page.getByLabel('Coordinate format override').selectOption('FSLAX33Y33');
  await page.getByLabel('I have reviewed the source').check();
  await page.getByRole('button', { name: 'Read Gerber', exact: true }).click();
  await expect(page.getByText('Gerber geometry parsed', { exact: true })).toBeVisible();
  await nav(page, 'Board workspace').click();
  await page.getByLabel('Placement module and side').selectOption('["FICTIONAL-PROJECT","Top"]');
  await page.getByLabel('Gerber board instance').fill('Authored project board');
  await page.getByLabel('Allowed residual (mm)').fill('0.02');
  const controls = [[0, 0, 100, 50], [10, 0, 100, 60], [0, 20, 80, 50], [7, 11, 89, 57]];
  for (const [i, point] of controls.entries()) {
    for (const [axis, label] of ['CAD X', 'CAD Y', 'Gerber X', 'Gerber Y'].entries()) await page.getByLabel(`${label} mm · point ${i + 1}`, { exact: true }).fill(String(point[axis]));
    await page.getByLabel(`Physical match evidence · point ${i + 1}`).fill(`Authored independent feature ${i + 1}`);
  }
  await page.getByRole('button', { name: 'Fit and check alignment' }).click();
  await expect(page.getByRole('heading', { name: 'Alignment checks passed' })).toBeVisible();
  await page.getByLabel('Placement to inspect').selectOption('3');
  await page.getByLabel('Placement review note').fill('Preserve exact authored row three.');
  await nav(page, 'Job dashboard').click();
  await page.getByRole('textbox', { name: 'Review notes', exact: true }).fill('Combined authored project; alignment is not native preparation.');
  await nav(page, 'Review handoff').click();
  await page.getByLabel('Intended Eagle software version').fill('AUTHORED-COMBINED-VERSION');
  const saved = await download(page, 'Save project'); const record = JSON.parse(saved.toString());
  assertEmbedded(record.archives.original.source, originalBytes);
  assertEmbedded(record.placement.source, placement); assertEmbedded(record.gerber.source, gerber);
  expect(record.placement.delimiter).toBe(';'); expect(record.placement.selectedRow).toBe(3);
  expect(record.placement.config.module).toBe('FICTIONAL-PROJECT');
  expect(record.gerber.config).toEqual({ formatOverride: 'FSLAX33Y33', assumeLinear: true });
  expect(record.gerber.checked).toBe(true); expect(record.gerber).not.toHaveProperty('alignment');
  await page.reload(); observed.requests.length = 0;
  await reopen(page, saved);
  expect(observed.requests.filter(path => path === '/api/archive')).toHaveLength(2);
  expect(observed.requests.filter(path => path === '/api/placements')).toHaveLength(2);
  expect(observed.requests.filter(path => path === '/api/gerber')).toHaveLength(1);
  expect(observed.requests.filter(path => path === '/api/alignment')).toHaveLength(1);
  await expect(page.getByLabel('Intended Eagle software version')).toHaveValue(record.machineVersion);
  const accounting = JSON.parse((await download(page, 'Download native accounting (.json)')).toString());
  expect(accounting.sourceContext.archiveSha256).toBe(sha256(originalBytes));
  expect(accounting.sourceContext.jobMember).toBe(syntheticSelection.jobMember);
  expect(accounting.counts.cadRows).toBe(1); expect(accounting.counts.nativePartInstances).toBe(1);
  const report = JSON.parse((await download(page, 'Download complete review (.json)')).toString());
  expect(report.placementResult.sourceSha256).toBe(sha256(placement));
  expect(report.gerber.source_sha256).toBe(sha256(gerber));
  expect(report.alignment.status).toBe('success'); expect(report.machineExportAllowed).toBe(false);
  await nav(page, 'Board workspace').click();
  await expect(page.getByLabel('Placement to inspect')).toHaveValue('3');
  await expect(page.getByLabel('Placement review note')).toHaveValue(record.notes['row:3']);
  await expect(page.getByRole('heading', { name: 'Alignment checks passed' })).toBeVisible();
  await expect(page.getByLabel('Placement module and side')).toHaveValue('["FICTIONAL-PROJECT","Top"]');
  await expect(page.getByLabel('Gerber board instance')).toHaveValue('Authored project board');
  await expect(page.getByLabel('Allowed residual (mm)')).toHaveValue('0.02');
  await expect(page.getByLabel('Physical match evidence · point 4')).toHaveValue('Authored independent feature 4');
  await expect(page.getByLabel('Gerber X mm · point 4', { exact: true })).toHaveValue('89');
  await nav(page, 'Source intake').click();
  await expect(page.getByLabel('CSV delimiter')).toHaveValue(';');
  await expect(page.getByLabel('Module for this sheet')).toHaveValue('FICTIONAL-PROJECT');
  await expect(page.getByLabel('Placement units')).toHaveValue('mm');
  await expect(page.getByLabel('Source rotation direction')).toHaveValue('ccw');
  await expect(page.getByLabel('Coordinate format override')).toHaveValue('FSLAX33Y33');
  await expect(page.getByLabel('I have reviewed the source')).toBeChecked();
  await nav(page, 'Job dashboard').click();
  await expect(page.getByRole('textbox', { name: 'Review notes', exact: true })).toHaveValue(record.notes.session);
  expect(observed.errors).toEqual([]); expect(observed.external).toEqual([]);
});

test('adding and remapping placement preserves native project notes while Clear session removes them', async ({ page }) => {
  test.setTimeout(60_000);
  const note = 'Authored native-only project question that also applies after adding placement.';
  const placement = { name: 'authored-note-scope.csv', mimeType: 'text/csv', buffer: Buffer.from('N1,FICTIONAL,,"1,2",Top,0,SYNTHETIC\n') };
  await page.goto('/intake');
  await selectArchive(page, originalBytes);
  await page.getByRole('textbox', { name: 'Review notes', exact: true }).fill(note);
  await page.getByLabel('Placement file (.xlsx, .xls or .csv)', { exact: true }).setInputFiles(placement);
  const afterAdding = JSON.parse((await download(page, 'Save project')).toString());
  expect(afterAdding.notes).toEqual({ session: note });
  await page.getByRole('button', { name: 'Read file', exact: true }).click();
  await expect(page.getByText('1 source rows')).toBeVisible();
  await page.getByLabel('Module for this sheet').fill('AUTHORED-NOTES');
  await page.getByLabel('Placement units').selectOption('mm');
  await page.getByLabel('Source rotation direction').selectOption('ccw');
  await page.getByRole('button', { name: 'Validate placements' }).click();
  await expect(page.getByText('1 parsed · 0 errors', { exact: false })).toBeVisible();
  await nav(page, 'Board workspace').click();
  await page.getByLabel('Placement to inspect').selectOption('1');
  await page.getByLabel('Placement review note').fill('Authored note tied to this exact source row and mapping.');
  await nav(page, 'Source intake').click();
  const beforeMappingChange = JSON.parse((await download(page, 'Save project')).toString());
  expect(beforeMappingChange.notes['row:1']).toContain('exact source row');
  await page.getByLabel('Placement units').selectOption('inch');
  const afterMappingChange = JSON.parse((await download(page, 'Save project')).toString());
  expect(afterMappingChange.notes).toEqual({ session: note });
  await page.getByLabel('Worksheet index').fill('1');
  await page.getByLabel('CSV delimiter').selectOption(';');
  const afterSheetAndDelimiter = JSON.parse((await download(page, 'Save project')).toString());
  expect(afterSheetAndDelimiter.notes).toEqual({ session: note });
  await nav(page, 'Job dashboard').click();
  await expect(page.getByRole('textbox', { name: 'Review notes', exact: true })).toHaveValue(note);
  await page.getByRole('button', { name: 'Clear session', exact: true }).click();
  await nav(page, 'Source intake').click();
  await page.getByLabel('Placement file (.xlsx, .xls or .csv)', { exact: true }).setInputFiles(placement);
  const fresh = JSON.parse((await download(page, 'Save project')).toString());
  expect(fresh.notes).toEqual({});
  expect(fresh.archives.original).toBeNull();
});
