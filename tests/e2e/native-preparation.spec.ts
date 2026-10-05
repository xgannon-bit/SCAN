import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { authoredPreparation } from '../native-preparation-fixture.mjs';
import { makeArchive, syntheticMembers, syntheticSelection } from '../synthetic-archive.mjs';

test('complete disabled part models apply individually and decisions/history reopen from original sources', async ({ page, baseURL }, info) => {
  const errors: string[] = [], external: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (new URL(request.url()).origin !== baseURL) external.push(request.url()); });
  const fixture = authoredPreparation();
  await page.goto('/intake');
  const archive = page.getByRole('region', { name: 'Existing native job archive', exact: true });
  await archive.getByLabel('Native job archive (.zip)').setInputFiles({ name: 'authored.zip', mimeType: 'application/zip', buffer: makeArchive({ ...syntheticMembers, [syntheticSelection.jobMember]: fixture.job, [syntheticSelection.masterMember]: fixture.master }) });
  await archive.getByRole('button', { name: 'Inventory archive', exact: true }).click();
  await archive.getByRole('combobox', { name: 'Job root', exact: true }).selectOption(syntheticSelection.root);
  await archive.getByRole('combobox', { name: 'Job snapshot', exact: true }).selectOption(JSON.stringify({ role: 'main', member: syntheticSelection.jobMember }));
  await archive.getByRole('combobox', { name: 'Master snapshot', exact: true }).selectOption(JSON.stringify({ role: 'main', member: syntheticSelection.masterMember }));
  await archive.getByRole('button', { name: 'Capture and verify selection' }).click();
  await expect(archive.getByRole('heading', { name: 'Snapshot integrity verified; native preparation blocked' })).toBeVisible();
  await page.getByLabel('Source layout (.pcb)').setInputFiles({ name: 'authored.pcb', mimeType: 'text/plain', buffer: Buffer.from(fixture.pcb) });
  await page.getByRole('button', { name: 'Read source layout', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '3 source placements' })).toBeVisible();
  await page.getByRole('navigation', { name: 'SCAN screens' }).getByRole('link', { name: 'Repair Review', exact: true }).click();
  const region = page.getByRole('region', { name: 'Native part preparation', exact: true });
  await region.getByRole('button', { name: 'Find supported native preparation', exact: true }).click();
  await expect(region).toContainText('2 complete part proposals ready for review');
  const apply = region.getByRole('button', { name: 'Apply accepted part preparation to a separate candidate', exact: true });
  await expect(apply).toBeDisabled();
  await region.getByLabel('Preparation reviewer', { exact: true }).fill('Authored browser reviewer');
  await region.getByText('N1 · disabled model proposal', { exact: true }).click();
  await region.getByRole('combobox', { name: 'Decision for N1', exact: true }).selectOption('accepted');
  await expect(apply).toBeDisabled();
  await region.getByRole('checkbox', { name: /I acknowledge qualification-only output/ }).check();
  const pending = page.waitForEvent('download'); await apply.click(); const download = await pending;
  const packagePath = info.outputPath('authored-prepared.zip'), projectPath = info.outputPath('authored-prepared-project.json');
  await download.saveAs(packagePath);
  const python = path.join(process.cwd(), '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const verify = spawnSync(python, ['-c', `import zipfile,io,json,sys,pathlib,xml.etree.ElementTree as E
with zipfile.ZipFile(sys.argv[1]) as outer:
 assert outer.testzip() is None
 project=outer.read('SCAN.scan-project.json');pathlib.Path(sys.argv[2]).write_bytes(project)
 saved=json.loads(project)['nativePreparation'];assert len(saved['history'])==1
 assert len(saved['history'][0]['accepted'])==1
 with zipfile.ZipFile(io.BytesIO(outer.read('engineering-QUALIFICATION-ONLY.zip'))) as bundle:
  rows=json.loads(bundle.read('component_accounting.json'));assert sum(r['status']=='prepared-disabled' for r in rows)==1
  assert next(r for r in rows if r['reference']=='N2')['status']=='proposal-awaiting-review'
  assert json.loads(bundle.read('qualification.json'))['EagleOpenSaveReopen']=='not-performed'
  with zipfile.ZipFile(io.BytesIO(bundle.read('CANDIDATE.zip'))) as c:
   j=E.fromstring(c.read('${syntheticSelection.jobMember}'));m=E.fromstring(c.read('${syntheticSelection.masterMember}'))
   assert len(j.findall('PartDataList/PartData'))==2 and len(m.findall('PartDataList/PartData'))==2
   assert j.findall('PartDataList/PartData')[-1].findtext('ENABLE')=='False'
   assert len(m.findall('WindowDataList/WindowData'))==4
` , packagePath, projectPath], { encoding: 'utf8' });
  expect(verify.status, verify.stderr).toBe(0);
  await expect(region).toContainText('1 parts prepared as disabled placements');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('native-preparation.png'), fullPage: true });
  await page.reload();
  await page.getByLabel('Saved placement review file', { exact: true }).setInputFiles({ name: 'authored.scan-project.json', mimeType: 'application/json', buffer: await readFile(projectPath) });
  await expect(page.getByRole('status').filter({ hasText: 'Project reopened.' })).toBeVisible();
  await expect(region).toContainText('Saved exact decisions are retained');
  await expect(region).toContainText('Prepared candidate history · 1');
  await region.getByRole('button', { name: 'Find supported native preparation', exact: true }).click();
  await expect(region).toContainText('2 complete part proposals ready for review');
  await region.getByText('N1 · disabled model proposal', { exact: true }).click();
  await expect(region.getByRole('combobox', { name: 'Decision for N1', exact: true })).toHaveValue('accepted');
  await expect(apply).toBeDisabled();
  await page.getByRole('navigation', { name: 'SCAN screens' }).getByRole('link', { name: 'Job dashboard', exact: true }).click();
  const projectStatus = page.getByRole('region', { name: 'Project status and next action', exact: true });
  await expect(projectStatus).toContainText('1 parts recorded as prepared in the latest matching candidate receipt');
  await expect(projectStatus.getByRole('link', { name: 'Review remaining native preparation and Athena work', exact: true })).toBeVisible();
  expect(errors).toEqual([]); expect(external).toEqual([]);
});
