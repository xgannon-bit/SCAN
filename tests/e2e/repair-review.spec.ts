import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { makeArchive, syntheticMembers, syntheticSelection } from '../synthetic-archive.mjs';

test('real repair screen creates a changed native copy and reopens exact decisions/history', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const job = '<JobContainer><JobXmlVersion>10.2</JobXmlVersion><ModuleDataList><ModuleData><ID>FABLE-M</ID></ModuleData></ModuleDataList><PartDataList><PartData><ID>FABLE-42</ID><ParentId>FABLE-M</ParentId><MasterKey>FABLE-MASTER</MasterKey><RefID>FABLE-C8</RefID><ENABLE>True</ENABLE><Roi><cx>17.250</cx><cy>6</cy><w>2</w><h>1</h><a>0</a></Roi><Unrelated>KEEP EXACT</Unrelated></PartData></PartDataList></JobContainer>';
  await page.goto('/intake');
  const section = page.getByRole('region', { name: 'Existing native job archive', exact: true });
  await section.getByLabel('Native job archive (.zip)').setInputFiles({ name: 'synthetic.zip', mimeType: 'application/zip', buffer: makeArchive({ ...syntheticMembers, [syntheticSelection.jobMember]: job }) });
  await section.getByRole('button', { name: 'Inventory archive', exact: true }).click();
  await section.getByRole('combobox', { name: 'Job root', exact: true }).selectOption(syntheticSelection.root);
  await section.getByRole('combobox', { name: 'Job snapshot', exact: true }).selectOption(JSON.stringify({ role: 'main', member: syntheticSelection.jobMember }));
  await section.getByRole('combobox', { name: 'Master snapshot', exact: true }).selectOption('none');
  await section.getByRole('button', { name: 'Capture and verify selection' }).click();
  await expect(section.getByRole('heading', { name: 'Snapshot integrity verified; native preparation blocked' })).toBeVisible();
  await page.getByRole('navigation', { name: 'SCAN screens' }).getByRole('link', { name: 'Repair Review', exact: true }).click();
  await page.getByRole('combobox', { name: 'Placement', exact: true }).selectOption('JobContainer/PartDataList/PartData[1]');
  await page.getByLabel('Exact proposed X literal').fill('18.625');
  await page.getByLabel('Reviewer', { exact: true }).fill('Authored reviewer');
  await page.getByLabel('Supporting evidence file').setInputFiles({ name: 'fictional-evidence.txt', mimeType: 'text/plain', buffer: Buffer.from('Synthetic test basis; no real board or manufacturing information.') });
  await page.getByLabel('Independent basis, coordinate frame and unresolved dependencies').fill('Authored synthetic geometry trial. Binding and inspection dependencies unresolved; scalar preservation test only.');
  await page.getByRole('button', { name: 'Check and add proposal' }).click();
  await expect(page.getByRole('heading', { name: 'Exact proposed changes' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Generate qualification candidate (0 accepted)' })).toBeDisabled();
  await page.getByRole('combobox', { name: /^Decision / }).selectOption('accepted');
  await expect(page.getByRole('button', { name: 'Generate qualification candidate (1 accepted)' })).toBeDisabled();
  await page.getByRole('checkbox', { name: /I acknowledge QUALIFICATION ONLY/ }).check();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Generate qualification candidate (1 accepted)' }).click();
  const downloaded = await pending;
  const bundlePath = info.outputPath('authored-evaluation.zip'); await downloaded.saveAs(bundlePath);
  const projectPath = info.outputPath('authored-project.json');
  const python = path.join(process.cwd(), '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const check = spawnSync(python, ['-c', `import zipfile,io,json,sys,pathlib
with zipfile.ZipFile(sys.argv[1]) as outer:
 assert outer.testzip() is None
 project=outer.read('SCAN.scan-project.json')
 pathlib.Path(sys.argv[2]).write_bytes(project)
 data=json.loads(project)
 assert data['repair']['request']['acceptances'][0]['decision']=='accepted'
 assert len(data['repair']['history'])==1
 assert data['attachments'][0]['role']=='evidence'
 with zipfile.ZipFile(io.BytesIO(outer.read('engineering-QUALIFICATION-ONLY.zip'))) as engineering:
  receipt=json.loads(engineering.read('qualification-receipt.json'))
  assert len(receipt['changes'])==1 and receipt['inspectionRepairEstablished'] is False
  with zipfile.ZipFile(io.BytesIO(engineering.read('CANDIDATE.zip'))) as candidate:
   xml=candidate.read('${syntheticSelection.jobMember}').decode()
   assert '<cx>18.625</cx>' in xml and '<Unrelated>KEEP EXACT</Unrelated>' in xml
  assert json.loads(engineering.read('qualification.json'))['eagleOpenSaveReopen']=='not-performed'
`, bundlePath, projectPath], { encoding: 'utf8' });
  expect(check.stderr).toBe(''); expect(check.status).toBe(0);
  await page.screenshot({ path: info.outputPath('repair-review.png'), fullPage: true });
  await page.reload();
  await page.getByLabel('Saved placement review file', { exact: true }).setInputFiles({ name: 'authored.scan-project.json', mimeType: 'application/json', buffer: await readFile(projectPath) });
  await expect(page.getByRole('status').filter({ hasText: 'Project reopened.' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: /^Decision / })).toHaveValue('accepted');
  await expect(page.getByRole('button', { name: 'Generate qualification candidate (1 accepted)' })).toBeDisabled();
  await expect(page.getByRole('heading', { name: 'Candidate revisions' })).toBeVisible();
  await page.getByRole('button', { name: 'Recheck exact proposal set' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Source, exact identity' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: /^Decision / })).toHaveValue('accepted');
  expect(errors).toEqual([]);
});
