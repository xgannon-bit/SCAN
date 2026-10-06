import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { authoredPreparation } from '../native-preparation-fixture.mjs';
import { makeArchive, syntheticMembers, syntheticSelection } from '../synthetic-archive.mjs';

test('package construction evidence exports an actual disabled model and survives project reopening', async ({ page }, info) => {
  const python = path.join(process.cwd(), '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const result = spawnSync(python, ['-c', 'import json\nfrom workers.scan.tests.test_paired_terminal_constructor import fixture\nj,m,b,p=fixture(270)\nprint(json.dumps(dict(job=j.decode(),master=m.decode(),pcb=b.decode(),profile=p)))'], { encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(0);
  const f = JSON.parse(result.stdout);
  await page.goto('/intake');
  const archive = page.getByRole('region', { name: 'Existing native job archive', exact: true });
  await archive.getByLabel('Native job archive (.zip)').setInputFiles({ name: 'authored-constructor.zip', mimeType: 'application/zip', buffer: makeArchive({ ...syntheticMembers, [syntheticSelection.jobMember]: f.job, [syntheticSelection.masterMember]: f.master }) });
  await archive.getByRole('button', { name: 'Inventory archive', exact: true }).click();
  await archive.getByRole('combobox', { name: 'Job root', exact: true }).selectOption(syntheticSelection.root);
  await archive.getByRole('combobox', { name: 'Job snapshot', exact: true }).selectOption(JSON.stringify({ role: 'main', member: syntheticSelection.jobMember }));
  await archive.getByRole('combobox', { name: 'Master snapshot', exact: true }).selectOption(JSON.stringify({ role: 'main', member: syntheticSelection.masterMember }));
  await archive.getByRole('button', { name: 'Capture and verify selection' }).click();
  await expect(archive.getByRole('heading', { name: 'Snapshot integrity verified; native preparation blocked' })).toBeVisible();
  await page.getByLabel('Source layout (.pcb)').setInputFiles({ name: 'authored.pcb', mimeType: 'text/plain', buffer: Buffer.from(f.pcb) });
  await page.getByRole('button', { name: 'Read source layout', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '6 source placements' })).toBeVisible();
  await page.getByRole('navigation', { name: 'SCAN screens' }).getByRole('link', { name: 'Repair Review', exact: true }).click();
  const region = page.getByRole('region', { name: 'Native part preparation', exact: true });
  await region.getByLabel('Package geometry evidence profiles (JSON)', { exact: true }).setInputFiles({ name: 'authored-profiles.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify([f.profile])) });
  await region.getByRole('button', { name: 'Find supported native preparation', exact: true }).click();
  await expect(region).toContainText('1 additional proposals construct a manufacturer body');
  await region.getByLabel('Preparation reviewer', { exact: true }).fill('Authored constructor reviewer');
  await region.getByText('N1 · disabled model proposal', { exact: true }).click();
  await expect(region).toContainText('New package construction.');
  await region.getByRole('combobox', { name: 'Decision for N1', exact: true }).selectOption('accepted');
  await region.getByRole('checkbox', { name: /I acknowledge qualification-only output/ }).check();
  const pending = page.waitForEvent('download');
  await region.getByRole('button', { name: 'Apply accepted part preparation to a separate candidate', exact: true }).click();
  const downloaded = await pending, bundlePath = info.outputPath('authored-constructor.zip'), projectPath = info.outputPath('authored-constructor-project.json');
  await downloaded.saveAs(bundlePath);
  const verified = spawnSync(python, ['-c', `import zipfile,json,sys,pathlib
with zipfile.ZipFile(sys.argv[1]) as z:
 p=z.read('SCAN.scan-project.json');pathlib.Path(sys.argv[2]).write_bytes(p)
 saved=json.loads(p)['nativePreparation'];assert len(saved['packageProfiles'])==1 and saved['history'][0]['packageProfiles']==saved['packageProfiles']
 work=json.loads(z.read('component-by-component-Eagle-work.json'));assert work['counts']['preparedWithConstructedGeometry']==1
 row=next(r for r in work['rows'] if r['reference']=='N1');assert len(row['windows'])==3 and row['windows'][1]['referenceGeometry']['pin']=='1'
 assert row['padBinding']['newBindingTuples']==0 and row['machineValidated'] is False
`, bundlePath, projectPath], { encoding: 'utf8' });
  expect(verified.status, verified.stderr).toBe(0);
  await page.reload();
  await page.getByLabel('Saved placement review file', { exact: true }).setInputFiles(projectPath);
  await expect(page.getByRole('status').filter({ hasText: 'Project reopened.' })).toBeVisible();
  await expect(region).toContainText('1 reviewed package evidence profiles retained');
  await region.getByRole('button', { name: 'Find supported native preparation', exact: true }).click();
  await expect(region).toContainText('1 additional proposals construct a manufacturer body');
  await region.getByText('N1 · disabled model proposal', { exact: true }).click();
  await expect(region.getByRole('combobox', { name: 'Decision for N1', exact: true })).toHaveValue('accepted');
  await expect(region.getByRole('button', { name: 'Apply accepted part preparation to a separate candidate', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

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
  await expect(region).toContainText('2 proposals retain the full template window set');
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
 work=json.loads(outer.read('component-by-component-Eagle-work.json'))
 assert work['counts']['preparedReferences']==1
 assert len(work['rows'])==3 and work['inspectionRepairEstablished'] is False
 assert next(r for r in work['rows'] if r['reference']=='N1')['nativeCreation']=='prepared-offline'
 assert next(r for r in work['rows'] if r['reference']=='N2')['nativeCreation']=='proposal-awaiting-review'
 assert 'component-by-component-Eagle-work.csv' in outer.namelist()
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
  await expect(region).toContainText('2 proposals retain the full template window set');
  await region.getByText('N1 · disabled model proposal', { exact: true }).click();
  await expect(region.getByRole('combobox', { name: 'Decision for N1', exact: true })).toHaveValue('accepted');
  await expect(apply).toBeDisabled();
  await page.getByRole('navigation', { name: 'SCAN screens' }).getByRole('link', { name: 'Job dashboard', exact: true }).click();
  const projectStatus = page.getByRole('region', { name: 'Project status and next action', exact: true });
  await expect(projectStatus).toContainText('1 parts recorded as prepared in the latest matching candidate receipt');
  await expect(projectStatus.getByRole('link', { name: 'Review remaining native preparation and Athena work', exact: true })).toBeVisible();
  expect(errors).toEqual([]); expect(external).toEqual([]);
});

test('partial window preparation shows exact omissions and exports actual unfinished Eagle work', async ({ page }, info) => {
  const fixture = authoredPreparation();
  fixture.master = fixture.master.replace(/<WindowData>[\s\S]*?<\/WindowData>/g, (window: string) => window.includes('<ID>21</ID>')
    ? window.replace('<ParentWndId>20</ParentWndId>', '<ParentWndId>700</ParentWndId>').replace('<GroupID>9</GroupID>', '<GroupID>10</GroupID>') : window);
  await page.goto('/intake');
  const archive = page.getByRole('region', { name: 'Existing native job archive', exact: true });
  await archive.getByLabel('Native job archive (.zip)').setInputFiles({ name: 'authored-partial.zip', mimeType: 'application/zip', buffer: makeArchive({ ...syntheticMembers, [syntheticSelection.jobMember]: fixture.job, [syntheticSelection.masterMember]: fixture.master }) });
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
  await expect(region).toContainText('2 additional proposals have explicitly partial local windows');
  await region.getByLabel('Preparation reviewer', { exact: true }).fill('Authored partial reviewer');
  await region.getByText('N1 · disabled model proposal', { exact: true }).click();
  await expect(region).toContainText('Partial window preparation.');
  await expect(region).toContainText('21: external-parent-window');
  await region.getByRole('combobox', { name: 'Decision for N1', exact: true }).selectOption('accepted');
  await region.getByRole('checkbox', { name: /I acknowledge qualification-only output/ }).check();
  const pending = page.waitForEvent('download');
  await region.getByRole('button', { name: 'Apply accepted part preparation to a separate candidate', exact: true }).click();
  const download = await pending, packagePath = info.outputPath('authored-partial.zip'); await download.saveAs(packagePath);
  const python = path.join(process.cwd(), '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const check = spawnSync(python, ['-c', `import zipfile,json,sys,io,xml.etree.ElementTree as E
with zipfile.ZipFile(sys.argv[1]) as outer:
 work=json.loads(outer.read('component-by-component-Eagle-work.json'))
 assert work['counts']['preparedWithPartialWindows']==1 and work['counts']['preparedWithCompleteTemplateWindowCopy']==0
 row=next(r for r in work['rows'] if r['reference']=='N1')
 assert row['state']=='prepared-partial-disabled' and len(row['windows'])==1
 assert row['omittedWindows'][0]['windowId']=='21' and row['intentionallyExcluded'] is False
 assert any('21 (external-parent-window)' in step for step in row['atEagle'])
 assert 'BINDING_NATIVE_PART_MISSING' not in row['padBinding']['holdCodes']
 with zipfile.ZipFile(io.BytesIO(outer.read('engineering-QUALIFICATION-ONLY.zip'))) as eng:
  with zipfile.ZipFile(io.BytesIO(eng.read('CANDIDATE.zip'))) as native:
   m=E.fromstring(native.read('${syntheticSelection.masterMember}'))
   windows=m.findall('WindowDataList/WindowData')
   assert len(windows)==3 and windows[1].findtext('ParentWndId')=='700'
   assert windows[-1].findtext('ID')=='20' and windows[-1].findtext('ENABLE')=='False'
`, packagePath], { encoding: 'utf8' });
  expect(check.status, check.stderr).toBe(0);
  await expect(region).toContainText('1 have explicitly partial windows');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
