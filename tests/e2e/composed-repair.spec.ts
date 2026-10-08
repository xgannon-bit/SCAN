import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { authoredPreparation } from '../native-preparation-fixture.mjs';
import { makeArchive, syntheticMembers, syntheticSelection } from '../synthetic-archive.mjs';

test('reviewed scalar and disabled part prepare one candidate, rejected change absent, both decisions reopen', async ({ page }, info) => {
  const f = authoredPreparation();
  await page.goto('/intake');
  const archive = page.getByRole('region', { name: 'Existing native job archive', exact: true });
  await archive.getByLabel('Native job archive (.zip)').setInputFiles({ name: 'fictional.zip', mimeType: 'application/zip', buffer: makeArchive({ ...syntheticMembers, [syntheticSelection.jobMember]: f.job, [syntheticSelection.masterMember]: f.master }) });
  await archive.getByRole('button', { name: 'Inventory archive', exact: true }).click();
  await archive.getByRole('combobox', { name: 'Job root', exact: true }).selectOption(syntheticSelection.root);
  for (const [label, member] of [['Job snapshot', syntheticSelection.jobMember], ['Master snapshot', syntheticSelection.masterMember]]) await archive.getByRole('combobox', { name: label, exact: true }).selectOption(JSON.stringify({ role: 'main', member }));
  await archive.getByRole('button', { name: 'Capture and verify selection' }).click();
  await expect(archive.getByRole('heading', { name: 'Snapshot integrity verified; native preparation blocked' })).toBeVisible();
  await page.getByLabel('Source layout (.pcb)').setInputFiles({ name: 'fictional.pcb', mimeType: 'text/plain', buffer: Buffer.from(f.pcb) });
  await page.getByRole('button', { name: 'Read source layout', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '3 source placements' })).toBeVisible();
  await page.getByRole('navigation', { name: 'SCAN screens' }).getByRole('link', { name: 'Repair Review', exact: true }).click();
  await page.getByRole('combobox', { name: 'Placement', exact: true }).selectOption('JobContainer/PartDataList/PartData[1]');
  await page.getByLabel('Exact proposed X literal').fill('13.125');
  await page.getByLabel('Reviewer', { exact: true }).fill('Fictional development test');
  await page.getByLabel('Supporting evidence file').setInputFiles({ name: 'fictional.txt', mimeType: 'text/plain', buffer: Buffer.from('Invented software fixture; no engineering or operator approval.') });
  await page.getByLabel('Independent basis, coordinate frame and unresolved dependencies').fill('Invented raw-frame preservation test; dependent window propagation and binding remain unresolved.');
  await page.getByRole('button', { name: 'Check and add proposal', exact: true }).click();
  await page.getByRole('combobox', { name: /^Decision (?!for )/ }).selectOption('accepted');
  await expect(page.getByRole('img', { name: 'Requested native ROI before and after, unqualified frame' }).first()).toBeVisible();
  await page.getByRole('combobox', { name: 'Operation', exact: true }).selectOption('CenterPosX');
  await page.getByLabel('Exact proposed X literal').fill('900');
  await page.getByRole('button', { name: 'Check and add proposal', exact: true }).click();
  const scalarDecisions = page.getByRole('combobox', { name: /^Decision (?!for )/ });
  await scalarDecisions.nth(1).selectOption('rejected');
  const prep = page.getByRole('region', { name: 'Native part preparation', exact: true });
  await prep.getByRole('button', { name: 'Find supported native preparation', exact: true }).click();
  await expect(prep).toContainText('2 proposals retain the full template window set');
  await prep.getByLabel('Preparation reviewer', { exact: true }).fill('Fictional development test');
  await prep.getByText('N1 · disabled model proposal', { exact: true }).click();
  await prep.getByRole('combobox', { name: 'Decision for N1', exact: true }).selectOption('accepted');
  await prep.getByRole('checkbox', { name: /I acknowledge qualification-only output/ }).check();
  // Finish server construction but delay receipt delivery, then change the
  // separately reviewed scalar in the other panel. No stale bundle may publish.
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const reached = new Promise<void>(resolve => { entered = resolve; });
  await page.route('**/api/archive', async route => {
    if (!route.request().postData()?.includes('repair-export')) return route.continue();
    const response = await route.fetch(); entered(); await gate; await route.fulfill({ response });
  });
  await prep.getByRole('button', { name: 'Apply accepted part preparation to a separate candidate', exact: true }).click();
  await reached;
  await scalarDecisions.nth(0).selectOption('rejected'); release();
  await expect(prep.getByRole('status')).toContainText('exact reviewed decisions changed during export');
  await page.unroute('**/api/archive');
  await scalarDecisions.nth(0).selectOption('accepted');
  const pending = page.waitForEvent('download');
  await prep.getByRole('button', { name: 'Apply accepted part preparation to a separate candidate', exact: true }).click();
  const download = await pending, bundlePath = info.outputPath('composed.zip'), projectPath = info.outputPath('composed.scan-project.json');
  await download.saveAs(bundlePath);
  const python = path.join(process.cwd(), '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const check = spawnSync(python, ['-c', `import sys,json,zipfile,io,pathlib,xml.etree.ElementTree as E
with zipfile.ZipFile(sys.argv[1]) as z:
 p=z.read('SCAN.scan-project.json');pathlib.Path(sys.argv[2]).write_bytes(p);d=json.loads(p)
 assert len(d['repair']['history'])==len(d['nativePreparation']['history'])==1
 assert len(d['repair']['history'][0]['composition']['accepted'])==1
 assert [x['decision'] for x in d['repair']['request']['acceptances']]==['accepted','rejected']
 assert 'baseline-offline-review.json' in z.namelist()
 work=json.loads(z.read('component-by-component-Eagle-work.json'));assert len(work['rows'])==3 and work['counts']['preparedReferences']==1
 changed=next(r for r in work['rows'] if r['reference']=='T1')
 assert changed['state']=='existing-scalar-trial-applied' and changed['nativePlacement']=='existing-scalar-trial-applied-qualification-required'
 assert changed['alignment']=='scalar-geometry-trial-unverified' and changed['teaching']=='preserved-unverified'
 assert len(changed['appliedScalarTrials'])==1 and changed['appliedScalarTrials'][0]['field']=='Roi/cx' and changed['appliedScalarTrials'][0]['after']=='13.125'
 assert 'position retention' in ' '.join(changed['atEagle']) and 'dependent Master windows' in ' '.join(changed['atEagle'])
 assert '13.125' in z.read('component-by-component-Eagle-work.csv').decode()
 assert 'existing-placement scalar trials are included' in z.read('OPEN_FIRST.txt').decode()
 with zipfile.ZipFile(io.BytesIO(z.read('engineering-QUALIFICATION-ONLY.zip'))) as e:
  r=json.loads(e.read('composed-qualification-receipt.json'));assert len(r['appliedScalarChanges'])==1 and r['scalarRollbackRecoversPreparedXml']
  with zipfile.ZipFile(io.BytesIO(e.read('CANDIDATE.zip'))) as c:
   j=E.fromstring(c.read('${syntheticSelection.jobMember}'));parts=j.findall('PartDataList/PartData')
   assert len(parts)==2 and parts[0].findtext('Roi/cx')=='13.125' and parts[0].findtext('CenterPosX')!='900'
   assert parts[1].findtext('ENABLE')=='False'
`, bundlePath, projectPath], { encoding: 'utf8' });
  expect(check.status, check.stderr).toBe(0);
  await page.reload();
  await page.getByLabel('Saved placement review file', { exact: true }).setInputFiles(projectPath);
  await expect(page.getByRole('status').filter({ hasText: 'Project reopened.' })).toBeVisible();
  await expect(scalarDecisions.nth(0)).toHaveValue('accepted'); await expect(scalarDecisions.nth(1)).toHaveValue('rejected');
  await expect(page.getByRole('button', { name: 'Generate qualification candidate (1 accepted)' })).toBeDisabled();
  await prep.getByRole('button', { name: 'Find supported native preparation', exact: true }).click();
  await prep.getByText('N1 · disabled model proposal', { exact: true }).click();
  await expect(prep.getByRole('combobox', { name: 'Decision for N1', exact: true })).toHaveValue('accepted');
  await expect(prep.getByRole('button', { name: 'Apply accepted part preparation to a separate candidate', exact: true })).toBeDisabled();
});
