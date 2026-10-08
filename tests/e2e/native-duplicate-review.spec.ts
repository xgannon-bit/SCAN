import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { makeArchive, syntheticMembers, syntheticSelection } from '../synthetic-archive.mjs';

// Independently authored data; the test does not qualify a real native job.
const job = `<JobContainer><JobXmlVersion>10.2</JobXmlVersion><ModuleDataList><ModuleData><ID>STORY-M</ID><TB>unqualified-side</TB></ModuleData></ModuleDataList><PartDataList>${['LEFT', 'RIGHT'].map((side, index) => `<PartData><ID>STORY-${side}</ID><ParentId>STORY-M</ParentId><RefID>STORY-R</RefID><MasterKey>MODEL-${side}</MasterKey><ENABLE>True</ENABLE><Roi><cx>${index + 2}</cx><cy>8</cy><w>1</w><h>2</h><a>0</a></Roi><WND_PAD>authored-binding-${index}</WND_PAD></PartData>`).join('')}</PartDataList></JobContainer>`;
const master = `<JobContainer><JobXmlVersion>10.2</JobXmlVersion><PartDataList>${['LEFT', 'RIGHT'].map(side => `<PartData><MasterKey>MODEL-${side}</MasterKey><RefID>STORY-R</RefID></PartData>`).join('')}</PartDataList><WindowDataList>${['LEFT', 'RIGHT'].map((side, index) => `<WindowData><ID>WINDOW-${side}</ID><Name>Authored body</Name><ParentId>MODEL-${side}</ParentId><GroupID>authored-group</GroupID><RelRoi><cx>0</cx><cy>0</cy><w>1</w><h>1</h><a>0</a></RelRoi><AlgorithmDataList><AlgorithmData><ID>ALGORITHM-${side}</ID><Type>invented</Type><UnlistedSetting>${index + 10}</UnlistedSetting></AlgorithmData></AlgorithmDataList></WindowData>`).join('')}</WindowDataList></JobContainer>`;
const archive = (masterText = master) => makeArchive({ ...syntheticMembers, [syntheticSelection.jobMember]: job, [syntheticSelection.masterMember]: masterText });

async function load(page: Page, bytes: Buffer) {
  await page.getByRole('navigation', { name: 'SCAN screens' }).getByRole('link', { name: 'Source intake', exact: true }).click();
  const section = page.getByRole('region', { name: 'Existing native job archive', exact: true });
  await section.getByLabel('Native job archive (.zip)').setInputFiles({ name: 'invented-duplicates.zip', mimeType: 'application/zip', buffer: bytes });
  await section.getByRole('button', { name: 'Inventory archive', exact: true }).click();
  await section.getByRole('combobox', { name: 'Job root', exact: true }).selectOption(syntheticSelection.root);
  for (const [name, member] of [['Job snapshot', syntheticSelection.jobMember], ['Master snapshot', syntheticSelection.masterMember]]) await section.getByRole('combobox', { name, exact: true }).selectOption(JSON.stringify({ role: 'main', member }));
  await section.getByRole('button', { name: 'Capture and verify selection' }).click();
  await expect(section.getByRole('heading', { name: 'Snapshot integrity verified; native preparation blocked' })).toBeVisible();
  await page.getByRole('navigation', { name: 'SCAN screens' }).getByRole('link', { name: 'Repair Review', exact: true }).click();
}

async function download(page: Page, name: string) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name, exact: true }).click();
  return readFile((await (await pending).path())!);
}

test('duplicate pair comparison, preferred survivor and exact-evidence reopen keep suppression held', async ({ page }, info) => {
  test.setTimeout(60_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/intake');
  await load(page, archive());
  const region = page.getByRole('region', { name: 'Compare duplicate placements' });
  await expect(region.getByText(/1 duplicate reference\/module scopes/)).toBeVisible();
  await region.locator('summary').filter({ hasText: 'STORY-R · module STORY-M · 2 placements' }).click();
  await expect(region.getByText(/SUPPRESSION_SIDE_EFFECTS_UNQUALIFIED/)).toBeVisible();
  await region.getByText('Window and algorithm parameter comparison', { exact: true }).click();
  await expect(region.getByText(/algorithm parameters 1/)).toBeVisible();
  await region.getByRole('combobox', { name: 'Duplicate review disposition', exact: true }).selectOption('prefer-left');
  await region.getByLabel('Duplicate reviewer', { exact: true }).fill('Fictional operator');
  await region.getByLabel('Survivor reason or exact missing evidence', { exact: true }).fill('Synthetic fixture preference only; geometry and teaching need independent physical evidence before suppression.');
  await region.getByRole('button', { name: 'Save duplicate review decision', exact: true }).click();
  await expect(region.getByText(/Saved: prefer-left/)).toBeVisible();
  const review = JSON.parse((await download(page, 'Download duplicate comparisons and decisions')).toString());
  expect(review.comparison.groups[0].pairs[0].windowComparisons[0].algorithmParameters.changedFieldCount).toBe(1);
  expect(review.decisions[0].decision.disposition).toBe('prefer-left');
  expect(review.suppressionAuthorized).toBe(false);
  expect(review.nativeEditsApplied).toBe(false);
  const saved = await download(page, 'Save project');
  const project = JSON.parse(saved.toString());
  expect(project.repair.work[0].key).toMatch(/^duplicate-review:/);
  expect(project.repair.request).toBeNull();
  expect(project.repair.history).toHaveLength(0);
  expect(Buffer.from(project.archives.original.source.base64, 'base64')).toEqual(archive());
  await page.reload();
  await page.getByLabel('Saved placement review file', { exact: true }).setInputFiles({ name: 'duplicates.scan-project.json', mimeType: 'application/json', buffer: saved });
  await expect(page.getByRole('status').filter({ hasText: 'Project reopened.' })).toBeVisible();
  await region.locator('summary').filter({ hasText: 'STORY-R · module STORY-M · 2 placements' }).click();
  await expect(region.getByRole('combobox', { name: 'Duplicate review disposition', exact: true })).toHaveValue('prefer-left');
  await expect(region.getByText(/Suppression held:/)).toBeVisible();
  await page.screenshot({ path: info.outputPath('duplicate-review.png'), fullPage: true });
  await load(page, archive(master.replace('<UnlistedSetting>10</UnlistedSetting>', '<UnlistedSetting>22</UnlistedSetting>')));
  await expect(region.getByText(/1 earlier duplicate decisions do not match/)).toBeVisible();
  await region.locator('summary').filter({ hasText: 'STORY-R · module STORY-M · 2 placements' }).click();
  await expect(region.getByRole('combobox', { name: 'Duplicate review disposition', exact: true })).toHaveValue('needs-evidence');
  const changed = JSON.parse((await download(page, 'Download duplicate comparisons and decisions')).toString());
  expect(changed.staleDecisions).toHaveLength(1);
  expect(changed.decisions[0].decision).toBeNull();
  expect(errors).toEqual([]);
});
