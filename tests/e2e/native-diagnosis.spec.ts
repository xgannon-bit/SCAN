import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { authoredDiagnosis } from '../native-diagnosis-fixture.mjs';
import { encodeProject } from '../../lib/scan/project-session';

async function authoredProject(options?: { aligned?: boolean; duplicate?: boolean }) {
  const fixture = authoredDiagnosis(options), context = fixture.context;
  const project = await encodeProject({
    placement: { file: new File([fixture.placement], 'authored-REV1.csv'), settings: { config: context.placementConfig.config, sheetIndex: 0, delimiter: ',', validated: true, selectedRow: null, notes: {} } },
    layout: { file: new File([fixture.pcb], 'authored-REV1.pcb'), checked: true },
    bom: { file: new File([fixture.bom], 'authored-BOM-REV1.csv'), config: context.bomConfig.config, sheet: 0, delimiter: ',', checked: true },
    original: { file: new File([new Uint8Array(fixture.archive)], 'authored-native.zip'), selection: fixture.selection, draft: { root: fixture.selection.root, job: JSON.stringify({ role: 'main', member: fixture.selection.jobMember }), master: JSON.stringify({ role: 'main', member: fixture.selection.masterMember }) } },
    returned: null, gerber: null, notes: {}, machineVersion: '', nativeDiagnosis: { settings: context.settings, reviewer: 'Authored browser reviewer' },
    nativePreparation: { review: null, reviewer: '', history: [], packageProfiles: context.packageProfiles },
  });
  return { fixture, project: Buffer.from(await project.arrayBuffer()) };
}

test('independent source findings connect to review, rejection/undo, exact complete export and fresh project reopening', async ({ page, baseURL }, info) => {
  test.setTimeout(90_000);
  const errors: string[] = [], external: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { if (new URL(r.url()).origin !== baseURL) external.push(r.url()); });
  const { fixture, project } = await authoredProject();
  await page.goto('/intake');
  await page.getByLabel('Saved placement review file', { exact: true }).setInputFiles({ name: 'authored.scan-project.json', mimeType: 'application/json', buffer: project });
  await expect(page.getByRole('status').filter({ hasText: 'Project reopened.' })).toBeVisible();
  await page.getByRole('navigation', { name: 'SCAN screens' }).getByRole('link', { name: 'Repair Review', exact: true }).click();
  const diagnosis = page.locator('#native-diagnosis');
  await expect(diagnosis.getByLabel('Diagnosis module', { exact: true })).toHaveValue('1');
  await diagnosis.getByRole('button', { name: 'Derive independent native findings', exact: true }).click();
  await expect(diagnosis.getByRole('status')).toContainText('independent findings frozen');
  await expect(diagnosis.getByRole('heading', { name: 'N1: local-native-roi-offset', exact: true })).toBeVisible();
  await expect(diagnosis.getByRole('img', { name: 'Original and proposed native geometry N1', exact: true })).toBeVisible();
  await expect(diagnosis).toContainText('complete inspection repairs: 0');
  await diagnosis.getByRole('button', { name: 'Send exact derived placement to native review', exact: true }).click();
  await expect(diagnosis.getByRole('status')).toContainText('freshly verified and added to native review');
  const decision = page.getByRole('combobox', { name: /^Decision / });
  await expect(decision).toHaveCount(1); await expect(decision).toHaveValue('pending');
  await expect(page.getByText('Independently derived placement experiment — complete repair held', { exact: true })).toBeVisible();
  await decision.selectOption('rejected');
  await expect(page.getByRole('button', { name: 'Generate qualification candidate (0 accepted)', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Undo decision N1 / 87', exact: true }).click(); await expect(decision).toHaveValue('pending');
  await decision.selectOption('accepted');
  const panel = page.getByRole('region', { name: 'Generated candidate and remaining work', exact: true }), files: string[] = [];
  for (let n = 0; n < 2; n++) {
    await page.getByRole('checkbox', { name: /I acknowledge QUALIFICATION ONLY/ }).check();
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Generate qualification candidate (2 accepted)', exact: true }).click();
    const file = info.outputPath(`authored-independent-${n}.zip`); await (await pending).saveAs(file); files.push(file);
    await expect(panel.getByRole('region', { name: 'Reanalyzed placement edits', exact: true }).getByRole('status')).toContainText('2 accepted scalar edits verified in the actual candidate.');
    await expect(panel).toContainText('1 source-derived placement experiments freshly reproduced.');
    await expect(panel).toContainText('Physically qualified corrections: 0.');
  }
  const projectPath = info.outputPath('fresh-independent.scan-project.json');
  const python = path.join(process.cwd(), '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const verified = spawnSync(python, ['-c', `import io,json,zipfile,pathlib,sys,re,xml.etree.ElementTree as E
fixture=json.loads(sys.stdin.read());native=[]
for name in sys.argv[1:3]:
 with zipfile.ZipFile(name) as outer:
  project=outer.read('SCAN.scan-project.json');data=json.loads(project);pathlib.Path(sys.argv[3]).write_bytes(project)
  request=data['repair']['request'];assert len(request['proposals'])==2 and all(a['decision']=='accepted' for a in request['acceptances'])
  assert request['diagnosis']['source']==fixture['context']['source']
  assert data['nativeDiagnosis']['settings']==fixture['context']['settings']
  with zipfile.ZipFile(io.BytesIO(outer.read('engineering-QUALIFICATION-ONLY.zip'))) as engineering:
   diagnosis=json.loads(engineering.read('independent-placement-diagnosis.json'));receipt=json.loads(engineering.read('independent-diagnosis-receipt.json'))
   assert diagnosis['diagnosisSha256']==request['diagnosis']['diagnosisSha256'] and diagnosis['physicalCorrectnessVerified'] is False
   assert receipt['derivedScalars']==receipt['acceptedScalars']==2 and receipt['acceptedPlacementGroups']==1
   native.append(engineering.read('CANDIDATE.zip'))
   with zipfile.ZipFile(io.BytesIO(native[-1])) as z:
    assert set(z.namelist())==set(fixture['members'])
    original=fixture['job'];blocks=list(re.finditer(r'<PartData>.*?</PartData>',original,re.S));expected=original
    block=next(m for m in blocks if E.fromstring(m.group(0)).findtext('ID')=='87' and E.fromstring(m.group(0)).findtext('RefID')=='N1')
    node=E.fromstring(block.group(0));assert node.findtext('ParentId')=='1' and node.findtext('MasterKey')=='88'
    replacement=block.group(0)
    for p in request['proposals']:
     key=p['path'].rsplit('/',1)[-1];assert node.findtext('Roi/'+key)==p['before'];replacement=replacement.replace('<'+key+'>'+p['before']+'</'+key+'>','<'+key+'>'+p['after']+'</'+key+'>',1)
    expected=original[:block.start()]+replacement+original[block.end():]
    for member,content in fixture['members'].items():
     assert z.read(member).decode()==(expected if member==fixture['selection']['jobMember'] else content)
    updated=next(p for p in E.fromstring(z.read(fixture['selection']['jobMember'])).findall('PartDataList/PartData') if p.findtext('ID')=='87')
    assert updated.findtext('ENABLE')==node.findtext('ENABLE')
    for axis,wanted in zip(('cx','cy'),fixture['expected']):assert abs(float(updated.findtext('Roi/'+axis))-wanted)<1e-7
assert native[0]==native[1] and len(data['repair']['history'])==2
`, ...files, projectPath], { input: JSON.stringify(fixture), encoding: 'utf8', maxBuffer: 1_000_000 });
  expect(verified.status, verified.stderr).toBe(0);
  await page.reload(); await page.getByLabel('Saved placement review file', { exact: true }).setInputFiles({ name: 'reopened.scan-project.json', mimeType: 'application/json', buffer: await readFile(projectPath) });
  await expect(page.getByRole('status').filter({ hasText: 'Project reopened.' })).toBeVisible();
  await expect(panel.getByRole('region', { name: 'Reanalyzed placement edits', exact: true }).getByRole('status')).toContainText('2 accepted scalar edits verified in the actual candidate.');
  await expect(decision).toHaveValue('accepted');
  await panel.getByText('N1 · module 1 · ID 87 · Source-derived placement experiment applied', { exact: true }).click();
  await expect(panel).toContainText('Acquisition/window coverage: unverified.');
  await diagnosis.getByRole('textbox', { name: 'Physical frame and anchor evidence', exact: true }).fill('Changed invented interpretation invalidates the old reviewed proposal.');
  await expect(page.getByRole('button', { name: 'Generate qualification candidate (0 accepted)', exact: true })).toBeDisabled();
  await diagnosis.getByRole('button', { name: 'Derive independent native findings', exact: true }).click();
  await expect(diagnosis.getByRole('status')).toContainText('independent findings frozen');
  await diagnosis.getByRole('button', { name: 'Send exact derived placement to native review', exact: true }).click();
  await expect(diagnosis.getByRole('status')).toContainText('existing decisions will not be discarded');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]); expect(external).toEqual([]);
});

test('clean and scoped ambiguous inputs have no actionable target edit, and missing frame evidence stays held', async ({ page }) => {
  for (const options of [{ aligned: true }, { duplicate: true }]) {
    const { project } = await authoredProject(options);
    await page.goto('/intake'); await page.getByLabel('Saved placement review file', { exact: true }).setInputFiles({ name: 'authored.scan-project.json', mimeType: 'application/json', buffer: project });
    await expect(page.getByRole('status').filter({ hasText: 'Project reopened.' })).toBeVisible();
    await page.getByRole('navigation', { name: 'SCAN screens' }).getByRole('link', { name: 'Repair Review', exact: true }).click();
    const diagnosis = page.locator('#native-diagnosis'); await diagnosis.getByRole('button', { name: 'Derive independent native findings', exact: true }).click();
    await expect(diagnosis.getByRole('status')).toContainText('independent findings frozen');
    const select = diagnosis.getByRole('combobox', { name: 'Diagnosed native component', exact: true });
    const value = await select.locator('option').filter({ hasText: /^N1 ·/ }).first().getAttribute('value');
    await select.selectOption(value!);
    await expect(diagnosis.getByRole('heading', { name: options.aligned ? 'N1: already-aligned' : 'N1: held', exact: true })).toBeVisible();
    if (options.duplicate) await expect(diagnosis).toContainText('DIAGNOSIS_NATIVE_DUPLICATE');
    await expect(diagnosis.getByRole('button', { name: 'Send exact derived placement to native review', exact: true })).toBeDisabled();
    await diagnosis.getByRole('combobox', { name: 'Diagnosis nativeSide', exact: true }).selectOption('unknown');
    await expect(diagnosis.getByRole('status').filter({ hasText: 'Findings and derived proposals are stale' })).toBeVisible();
    await diagnosis.getByRole('button', { name: 'Derive independent native findings', exact: true }).click();
    await expect(diagnosis.getByRole('status')).toContainText('independent findings frozen');
    await expect(diagnosis).toContainText('DIAGNOSIS_SIDE_UNKNOWN');
    await expect(diagnosis.getByRole('button', { name: 'Send exact derived placement to native review', exact: true })).toBeDisabled();
  }
});
