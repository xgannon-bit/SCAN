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

test('placement through native record review, changed-asset comparison and complete evidence download', async ({ page, baseURL }, info) => {
  const errors: string[] = [], external: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (new URL(request.url()).origin !== baseURL) external.push(request.url()); });
  await page.goto('/intake');
  await page.getByLabel('Placement file (.xlsx or .csv)', { exact: true }).setInputFiles({ name: 'authored.csv', mimeType: 'text/csv', buffer: Buffer.from('R99,FAKE-MPN,,"1,2",Top,0,SYNTHETIC\n') });
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
