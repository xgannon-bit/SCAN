import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { makeArchive, syntheticMembers, syntheticSelection } from '../synthetic-archive.mjs';

test('guarded historical XY review exports, repeats and reopens without source PCB; rejected and stale edits are held', async ({ page }, info) => {
  const job = '<JobContainer><JobXmlVersion>10.1</JobXmlVersion><ModuleDataList><ModuleData><ID>FICTION-M</ID></ModuleData></ModuleDataList><PartDataList><PartData><ID>FICTION-7</ID><ParentId>FICTION-M</ParentId><MasterKey>FICTION-S</MasterKey><RefID>FICTION-P</RefID><ENABLE>True</ENABLE><Roi><cx>12.000</cx><cy>-7</cy><w>3</w><h>2</h><a>90</a></Roi><CenterPosX>9</CenterPosX><CenterPosY>-10</CenterPosY><FovList><Fov0>4</Fov0></FovList><WND_PAD>preserved</WND_PAD><PrivateUnknown>EXACT PRESERVATION</PrivateUnknown></PartData></PartDataList></JobContainer>';
  const master = '<JobContainer><JobXmlVersion>10.1</JobXmlVersion><PartDataList><PartData><ID>FICTION-S</ID><MasterKey>FICTION-S</MasterKey><RefID>FICTION-P</RefID><ENABLE>True</ENABLE></PartData></PartDataList><WindowDataList><WindowData><ID>W-1</ID><ParentId>FICTION-S</ParentId><ENABLE>True</ENABLE><RelRoi><cx>0.5</cx><cy>0</cy><w>1</w><h>1</h><a>0</a></RelRoi></WindowData></WindowDataList></JobContainer>';
  const original = makeArchive({ ...syntheticMembers, [syntheticSelection.jobMember]: job, [syntheticSelection.masterMember]: master });
  await page.goto('/intake');
  const intake = page.getByRole('region', { name: 'Existing native job archive', exact: true });
  await intake.getByLabel('Native job archive (.zip)').setInputFiles({ name: 'authored-10.1.zip', mimeType: 'application/zip', buffer: original });
  await intake.getByRole('button', { name: 'Inventory archive', exact: true }).click();
  await intake.getByRole('combobox', { name: 'Job root', exact: true }).selectOption(syntheticSelection.root);
  await intake.getByRole('combobox', { name: 'Job snapshot', exact: true }).selectOption(JSON.stringify({ role: 'main', member: syntheticSelection.jobMember }));
  await intake.getByRole('combobox', { name: 'Master snapshot', exact: true }).selectOption(JSON.stringify({ role: 'main', member: syntheticSelection.masterMember }));
  await intake.getByRole('button', { name: 'Capture and verify selection' }).click();
  await expect(intake.getByRole('heading', { name: 'Snapshot integrity verified; original baseline preserved' })).toBeVisible();
  await page.getByRole('navigation', { name: 'SCAN screens' }).getByRole('link', { name: 'Repair Review', exact: true }).click();
  await page.getByRole('combobox', { name: 'Placement', exact: true }).selectOption('JobContainer/PartDataList/PartData[1]');
  await page.getByRole('combobox', { name: 'Operation', exact: true }).selectOption('Roi/xy');
  await page.getByLabel('Exact proposed X literal').fill('13.125');
  await page.getByLabel('Exact proposed Y literal').fill('-5.625');
  await page.getByLabel('Reviewer', { exact: true }).fill('Synthetic replay reviewer');
  await page.getByRole('combobox', { name: 'Evidence basis', exact: true }).selectOption('historical-replay');
  await page.getByLabel('Supporting evidence file').setInputFiles({ name: 'authored-history.txt', mimeType: 'text/plain', buffer: Buffer.from('Invented old and new coordinates; not physical evidence or any actual machine archive.') });
  await page.getByLabel('Independent basis, coordinate frame and unresolved dependencies').fill('Replay authored historical ROI only. Stored center, Master, binding and FOV are preserved; actual geometry and machine behavior unverified.');
  await page.getByRole('button', { name: 'Check and add proposal' }).click();
  const decision = page.getByRole('combobox', { name: /^Decision / });
  await expect(decision).toHaveCount(1);
  await expect(page.getByText('Atomic dependency group: all 2 exact scalar edits must share one accepted decision.')).toBeVisible();
  const xyImpact = page.getByRole('region', { name: 'Exact repair impact' }).last();
  const exactWrites = xyImpact.locator('p').filter({ hasText: /^Exact byte edits:/ });
  await expect(exactWrites).toContainText('JobContainer/PartDataList/PartData[1]/Roi/cx');
  await expect(exactWrites).toContainText('JobContainer/PartDataList/PartData[1]/Roi/cy');
  await expect(xyImpact).not.toContainText('Only this scalar is written.');
  await decision.selectOption('rejected');
  await expect(page.getByRole('button', { name: 'Generate qualification candidate (0 accepted)' })).toBeDisabled();
  await page.getByRole('button', { name: 'Undo decision FICTION-P / FICTION-7', exact: true }).click();
  await expect(decision).toHaveValue('pending');
  await decision.selectOption('accepted');
  const candidatePanel = page.getByRole('region', { name: 'Generated candidate and remaining work', exact: true });
  const files: string[] = [];
  for (let i = 0; i < 2; i++) {
    await page.getByRole('checkbox', { name: /I acknowledge QUALIFICATION ONLY/ }).check();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Generate qualification candidate (2 accepted)' }).click();
    const file = info.outputPath(`authored-replay-${i}.zip`); await (await download).saveAs(file); files.push(file);
    await expect(candidatePanel.getByRole('region', { name: 'Reanalyzed placement edits' }).getByRole('status')).toContainText('2 accepted scalar edits verified in the actual candidate.');
  }
  await candidatePanel.getByText('FICTION-P · module FICTION-M · ID FICTION-7 · Historical replay applied', { exact: true }).click();
  await expect(candidatePanel).toContainText('FOV assignment: literal-assignment-present.');
  await expect(candidatePanel).toContainText('Acquisition/window coverage: unverified.');
  const project = info.outputPath('authored-replay.scan-project.json');
  const python = path.join(process.cwd(), '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const check = spawnSync(python, ['-c', `import io,json,zipfile,pathlib,sys
native=[]
for f in sys.argv[1:3]:
 with zipfile.ZipFile(f) as outer:
  data=json.loads(outer.read('SCAN.scan-project.json'));pathlib.Path(sys.argv[3]).write_bytes(outer.read('SCAN.scan-project.json'))
  assert data.get('layout') is None
  request=data['repair']['request'];assert len(request['proposals'])==2
  assert all(p['beforeRoi']==dict(cx='12.000',cy='-7',w='3',h='2',a='90') for p in request['proposals'])
  assert all(e.get('kind')=='historical-replay' and e['independentSupport'] is False for e in request['evidence'])
  assert all(a['decision']=='accepted' for a in request['acceptances'])
  with zipfile.ZipFile(io.BytesIO(outer.read('engineering-QUALIFICATION-ONLY.zip'))) as bundle:
   native.append(bundle.read('CANDIDATE.zip'))
   receipt=json.loads(bundle.read('qualification-receipt.json'));assert len(receipt['changes'])==2
   with zipfile.ZipFile(io.BytesIO(native[-1])) as z:
    actual=z.read('${syntheticSelection.jobMember}').decode()
    assert actual==${JSON.stringify(job)}.replace('<cx>12.000</cx>','<cx>13.125</cx>').replace('<cy>-7</cy>','<cy>-5.625</cy>')
    assert z.read('${syntheticSelection.masterMember}').decode()==${JSON.stringify(master)}
    assert z.read('Fictional/Board/Board_Temp.xml')==b'<FictionalTemp />'
assert native[0]==native[1]
assert len(data['repair']['history'])==2
`, ...files, project], { encoding: 'utf8' });
  expect(check.stderr).toBe(''); expect(check.status).toBe(0);
  await page.reload();
  await page.getByLabel('Saved placement review file', { exact: true }).setInputFiles({ name: 'authored-replay.scan-project.json', mimeType: 'application/json', buffer: await readFile(project) });
  await expect(page.getByRole('status').filter({ hasText: 'Project reopened.' })).toBeVisible();
  await expect(candidatePanel.getByRole('region', { name: 'Reanalyzed placement edits' }).getByRole('status')).toContainText('2 accepted scalar edits verified in the actual candidate.');
  await expect(decision).toHaveValue('accepted');
  const stale = JSON.parse(await readFile(project, 'utf8')).repair.request;
  stale.source.jobSha256 = '0'.repeat(64);
  await page.getByText('Import an existing exact qualification request', { exact: true }).click();
  await page.getByLabel('Qualification request', { exact: true }).setInputFiles({ name: 'stale.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(stale)) });
  await expect(page.getByRole('status').filter({ hasText: /currently selected main snapshot/ })).toBeVisible();
  await expect(decision).toHaveValue('accepted');
  await page.screenshot({ path: info.outputPath('historical-replay.png'), fullPage: true });
});
