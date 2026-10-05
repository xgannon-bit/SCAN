import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { makeArchive, syntheticMembers, syntheticSelection } from '../synthetic-archive.mjs';

const fixture = '<JobContainer><JobXmlVersion>10.2</JobXmlVersion><PartDataList><PartData><ID>AUTHORED-7</ID><RefID>FICTIONAL-R99</RefID><Roi><cx>001.2500</cx></Roi></PartData></PartDataList></JobContainer>';
const members = { ...syntheticMembers, [syntheticSelection.jobMember]: fixture, 'Fictional/Board/image.bin': 'AUTHORED-IMAGE-BYTES' };
const nav = (page: Page, name: string) => page.getByRole('navigation', { name: 'SCAN screens' }).getByRole('link', { name, exact: true });
async function archive(page: Page, bytes: Buffer, returned = false, role = 'main') {
  const section = page.getByRole('region', { name: returned ? 'Job archive returned from Eagle' : 'Existing native job archive', exact: true });
  await section.getByLabel('Native job archive (.zip)').setInputFiles({ name: 'authored-only.zip', mimeType: 'application/zip', buffer: bytes });
  await section.getByRole('button', { name: 'Inventory archive', exact: true }).click();
  await expect(section.getByRole('combobox', { name: 'Job root', exact: true })).toBeVisible();
  await section.getByRole('combobox', { name: 'Job root', exact: true }).selectOption(syntheticSelection.root);
  const member = role === 'temp' ? 'Fictional/Board/Board_Temp.xml' : syntheticSelection.jobMember;
  await section.getByRole('combobox', { name: 'Job snapshot', exact: true }).selectOption(JSON.stringify({ role, member }));
  await section.getByRole('combobox', { name: 'Master snapshot', exact: true }).selectOption(JSON.stringify({ role: 'main', member: syntheticSelection.masterMember }));
  await section.getByRole('button', { name: 'Capture and verify selection' }).click();
  await expect(section.getByRole('heading', { name: 'Snapshot integrity verified; native preparation blocked' })).toBeVisible();
  return section;
}
async function download(page: Page, name: string) {
  const pending = page.waitForEvent('download'); await page.getByRole('button', { name, exact: true }).click();
  return readFile((await (await pending).path())!);
}

test('inspection review retains shared windows, exports exact work and recomputes on project reopen', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const parts = ['FICT-A', 'FICT-B'].map((ref, i) => `<PartData><ID>P${i}</ID><ParentId>M-FICT</ParentId><RefID>${ref}</RefID><MasterKey>SHARED-FICT</MasterKey><CenterPosX>1</CenterPosX><CenterPosY>2</CenterPosY><Roi><cx>4</cx><cy>2</cy></Roi></PartData>`).join('');
  const cads = ['FICT-A', 'FICT-B'].map((ref, i) => `<Cp><ID>C${i}</ID><ModuleID>M-FICT</ModuleID><RefID>${ref}</RefID><X>1</X><Y>2</Y></Cp>`).join('');
  const job = `<JobContainer><JobXmlVersion>10.2</JobXmlVersion><ModuleDataList><ModuleData><ID>M-FICT</ID></ModuleData></ModuleDataList><CadData><CpList>${cads}</CpList></CadData><PartDataList>${parts}</PartDataList></JobContainer>`;
  const master = '<JobContainer><JobXmlVersion>10.2</JobXmlVersion><PartDataList><PartData><ID>MASTER-FICT</ID><MasterKey>SHARED-FICT</MasterKey></PartData></PartDataList><WindowDataList><WindowData><ID>WINDOW-FICT</ID><Name>Authored window</Name><ParentId>SHARED-FICT</ParentId><RelRoi><cx>1.25</cx></RelRoi><AlgorithmDataList><AlgorithmData><ID>ALGO-FICT</ID><Type>fictional-type</Type></AlgorithmData></AlgorithmDataList></WindowData></WindowDataList></JobContainer>';
  await page.goto('/intake');
  await archive(page, makeArchive({ ...syntheticMembers, [syntheticSelection.jobMember]: job, [syntheticSelection.masterMember]: master }));
  await nav(page, 'Review handoff').click();
  const accounting = page.getByRole('region', { name: 'Native component accounting', exact: true });
  await accounting.getByText('Whole-board coordinate evidence', { exact: true }).click();
  await expect(accounting.getByText(/6 numeric comparisons/)).toBeVisible();
  await accounting.getByLabel('Find native component or source path', { exact: true }).fill('FICT-A');
  await accounting.getByText('M-FICT / FICT-A · unique-literal-match', { exact: true }).click();
  await accounting.getByText('Placement coordinate evidence', { exact: true }).click();
  await expect(accounting.getByText('roi-minus-native-cad: numeric-difference · X=3, Y=0', { exact: true })).toBeVisible();
  const measured = JSON.parse((await download(page, 'Download native accounting (.json)')).toString());
  expect(measured.coordinatePatterns).toHaveLength(2);
  expect(measured.coordinateComparisons).toHaveLength(6);
  expect(measured.findings.some((f: { code: string }) => f.code.includes('NUMERIC_DIFFERENCE'))).toBe(false);
  expect(measured.coordinateComparisons.every((c: { unitsAndCommonFrameQualified: boolean }) => c.unitsAndCommonFrameQualified === false)).toBe(true);
  await accounting.screenshot({ path: info.outputPath('coordinate-evidence.png') });
  const queue = page.getByRole('region', { name: 'Remaining inspection review', exact: true });
  await expect(queue.getByText('2 placement records · 1 Master windows · 1 algorithm records.')).toBeVisible();
  await queue.getByLabel('Find inspection work by component or native ID').fill('FICT-A');
  await queue.getByText('FICT-A · module M-FICT · part P0', { exact: true }).click();
  await expect(queue.getByText(/This literal scope links 2 placement records/)).toBeVisible();
  await queue.getByText('Window WINDOW-FICT · Authored window', { exact: true }).click();
  await expect(queue.getByText('Geometry: unresolved · Binding: unresolved · Teaching: unverified')).toBeVisible();
  const exported = JSON.parse((await download(page, 'Download inspection review queue (.json)')).toString());
  expect(exported.scopes).toHaveLength(1);
  expect(exported.scopes[0].partIds).toHaveLength(2);
  expect(exported.windows).toHaveLength(1);
  expect(exported.algorithms).toHaveLength(1);
  expect(exported.inspectionRepairEstablished).toBe(false);
  expect(exported.sourceContext.selection.job.member).toBe(syntheticSelection.jobMember);
  await queue.screenshot({ path: info.outputPath('inspection-work.png') });
  const saved = await download(page, 'Save project');
  await page.reload();
  await page.getByLabel('Saved placement review file', { exact: true }).setInputFiles({ name: 'authored.scan-project.json', mimeType: 'application/json', buffer: saved });
  await expect(page.getByRole('status').filter({ hasText: 'Project reopened.' })).toBeVisible();
  const restored = JSON.parse((await download(page, 'Download inspection review queue (.json)')).toString());
  expect(restored.counts).toEqual(exported.counts);
  expect(restored.sourceContext.archiveSha256).toBe(exported.sourceContext.archiveSha256);
  expect(restored.windows[0].teachingReview).toBe('unverified');
  const restoredCoordinates = JSON.parse((await download(page, 'Download native accounting (.json)')).toString());
  expect(restoredCoordinates.coordinateComparisons).toEqual(measured.coordinateComparisons);
  await nav(page, 'Source intake').click();
  await nav(page, 'Review handoff').click();
  await expect(page.getByRole('heading', { name: 'Remaining inspection review' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('placement through native record review, changed-asset comparison and complete evidence download', async ({ page, baseURL }, info) => {
  const errors: string[] = [], external: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (new URL(request.url()).origin !== baseURL) external.push(request.url()); });
  await page.goto('/intake');
  await page.getByLabel('Placement file (.xlsx, .xls or .csv)', { exact: true }).setInputFiles({ name: 'authored.csv', mimeType: 'text/csv', buffer: Buffer.from('R99,FAKE-MPN,,"1,2",Top,0,SYNTHETIC\n') });
  await page.getByRole('button', { name: 'Read file', exact: true }).click();
  await expect(page.getByText('1 source rows')).toBeVisible();
  await page.getByLabel('Module for this sheet').fill('AUTHORED');
  await page.getByLabel('Placement units').selectOption('mm');
  await page.getByLabel('Source rotation direction').selectOption('ccw');
  await page.getByRole('button', { name: 'Validate placements' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Placement parsing complete' })).toBeVisible();
  const original = makeArchive(members);
  const section = await archive(page, original);
  await section.getByText('Native record inventory', { exact: true }).click();
  await section.getByLabel('Find native record by raw field or source path').fill('FICTIONAL-R99');
  await expect(section.getByText('1 matching records.', { exact: false })).toBeVisible();
  await section.getByText('job · part-record · JobContainer/PartDataList/PartData[1]', { exact: true }).click();
  await expect(section.getByText('001.2500', { exact: true })).toBeVisible();
  await nav(page, 'Review handoff').click();
  await page.getByLabel('Intended Eagle software version').fill('SYNTHETIC-TEST-BUILD');
  const returned: Record<string, string> = { ...members, 'Fictional/Board/image.bin': 'ALTERED-AUTHORED-IMAGE' };
  delete returned['README.txt'];
  await archive(page, makeArchive(returned), true);
  await expect(page.getByRole('heading', { name: 'Archive changes need review' })).toBeVisible();
  const report = JSON.parse((await download(page, 'Save native qualification (.json)')).toString());
  expect(report.before.archiveSha256).toBe(createHash('sha256').update(original).digest('hex'));
  expect(report.comparison.counts.changed).toBe(1);
  expect(report.comparison.counts.removed).toBe(1);
  expect(report.machineExportAllowed).toBe(false);
  expect(report.application.versionVerified).toBe(false);
  expect(report.readiness.machineCompatibility).toBeNull();
  expect((await download(page, 'Save native qualification (.txt)')).toString()).toContain('REMOVED | README.txt');
  const handoff = JSON.parse((await download(page, 'Download complete review (.json)')).toString());
  expect(handoff.nativeQualification).toEqual(report);
  expect(handoff.nativePreflight.literalDependencies.machineExportAllowed).toBe(false);
  const reference = await download(page, 'Download preserved native source package');
  expect(reference.subarray(0, 4).toString('hex')).toBe('504b0304');
  await expect(page.getByText('Preserved native source package downloaded with fresh integrity evidence.', { exact: false })).toBeVisible();
  expect(handoff.placements).toHaveLength(1);
  await expect(page.getByRole('button', { name: 'Export native candidate', exact: true })).toBeDisabled();
  await page.screenshot({ path: info.outputPath('native-integrity-review.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await nav(page, 'Job dashboard').click();
  await nav(page, 'Review handoff').click();
  await expect(page.getByRole('heading', { name: 'Archive changes need review' })).toBeVisible();
  await nav(page, 'Source intake').click();
  await page.getByRole('button', { name: 'Clear archive', exact: true }).click();
  await nav(page, 'Review handoff').click();
  await expect(page.getByRole('button', { name: 'Save native qualification (.json)' })).toHaveCount(0);
  expect(JSON.parse((await download(page, 'Download complete review (.json)')).toString()).nativeQualification).toBeNull();
  expect(errors).toEqual([]); expect(external).toEqual([]);
});

test('surviving temporary snapshot and unchanged payloads stay explicitly unqualified', async ({ page }) => {
  const recovery: Record<string, string> = { ...members, 'Fictional/Board/Board_Temp.xml': fixture };
  delete recovery[syntheticSelection.jobMember];
  const bytes = makeArchive(recovery);
  await page.goto('/intake');
  await archive(page, bytes, false, 'temp');
  await nav(page, 'Review handoff').click();
  await archive(page, bytes, true, 'temp');
  await expect(page.getByRole('heading', { name: 'Archived payloads preserved' })).toBeVisible();
  const report = JSON.parse((await download(page, 'Save native qualification (.json)')).toString());
  expect(report.before.selection.job.role).toBe('temp');
  expect(report.comparison.filePayloadsEqual).toBe(true);
  expect(report.holds.some((hold: { code: string }) => hold.code === 'SOFTWARE_VERSION_MISSING')).toBe(true);
  await expect(page.getByRole('button', { name: 'Export native candidate', exact: true })).toBeDisabled();
});

test('job selector excludes companion backups and nested snapshots while preserving their bytes', async ({ page }, info) => {
  const source = { ...members,
    'Fictional/Board/Board.his.bak': 'authored history backup',
    'Fictional/Board/Board.pat.bak': 'authored pattern backup',
    'Fictional/Board/nested/Board_Temp.xml': '<AuthoredNested/>',
  };
  await page.goto('/intake');
  const section = await archive(page, makeArchive(source));
  const options = await section.getByRole('combobox', { name: 'Job snapshot', exact: true }).locator('option').allTextContents();
  expect(options.join('\n')).not.toMatch(/\.his\.bak|\.pat\.bak|nested\//);
  expect(options.join('\n')).toContain('Board.xml.bak');
  const report = JSON.parse((await download(page, 'Save archive report (JSON)')).toString());
  expect(report.preflight.integrity.allArchivedFilesVerified).toBe(true);
  for (const name of ['Fictional/Board/Board.pat.bak', 'Fictional/Board/Board.his.bak']) {
    expect(report.preflight.preservedFiles).toContainEqual(expect.objectContaining({
      path: name, sha256: createHash('sha256').update(source[name as keyof typeof source]).digest('hex'),
    }));
  }
  await page.screenshot({ path: info.outputPath('snapshot-selection.png'), fullPage: true });
});
