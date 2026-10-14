import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import type { ArchiveSelection } from '../../lib/scan/archive-types';
import { encodeProject } from '../../lib/scan/project-session';
import { authoredDiagnosis } from '../native-diagnosis-fixture.mjs';
import { makeArchive, syntheticMembers, syntheticSelection } from '../synthetic-archive.mjs';
import { authoredPreparation } from '../native-preparation-fixture.mjs';
import { appendVisualJournal } from '../../lib/scan/visual-workspace';

const nav = (page: Page, name: string) => page.getByRole('navigation', { name: 'SCAN screens' }).getByRole('link', { name, exact: true });
const python = path.join(process.cwd(), '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const original = (file: File, selection: ArchiveSelection = syntheticSelection as ArchiveSelection) => ({ file, selection, draft: { root: selection.root, job: JSON.stringify({ role: selection.jobRole, member: selection.jobMember }), master: JSON.stringify({ role: selection.masterRole, member: selection.masterMember }) } });
async function load(page: Page, blob: Blob) {
  await page.goto('/workspace');
  await page.getByLabel('Saved placement review file', { exact: true }).setInputFiles({ name: 'SYNTHETIC.scan-project.json', mimeType: 'application/json', buffer: Buffer.from(await blob.arrayBuffer()) });
  await expect(page.getByRole('status').filter({ hasText: /(?:Project|Review) reopened\./ })).toBeVisible();
}
async function tool(page: Page, name: string) {
  await page.getByRole('button', { name: 'Engineering tools', exact: true }).click();
  await page.getByRole('navigation', { name: 'Engineering tool selection' }).getByRole('button', { name, exact: true }).click();
}

test('actual parsed crosses, scoped duplicates, Gerber primitives, view persistence and read-only event replay', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  const records = Array.from({ length: 48 }, (_, i) => [`S${i + 1}`, 8 + (i % 8) * 9, 6 + Math.floor(i / 8) * 8, (i % 4) * 90, 'Top']);
  records.push(['S1', -8, 6, 90, 'Bottom']);
  const csv = records.map(r => r.join(',')).join('\n');
  const gerber = '%MOMM*%\n%FSLAX33Y33*%\n%ADD10R,3X1.5*%\nD10*\n' + records.slice(0, 48).flatMap(r => [-1, 1].map(dx => `X${Math.round((Number(r[1]) + dx * 2) * 1000)}Y${Number(r[2]) * 1000}D03*`)).join('\n') + '\n%LPC*%\nX6000Y6000D03*\nM02*';
  const project = await encodeProject({ placement: { file: new File([csv], 'SYNTHETIC-visual-board.csv'), settings: { config: { startRow: 1, columns: { refdes: 1, x: 2, y: 3, rotation: 4, side: 5 }, module: 'SYNTHETIC-A', side: '', units: 'mm', rotationDirection: 'ccw', decimalSeparator: '.', pairSeparator: ',' }, sheetIndex: 0, delimiter: ',', validated: true, selectedRow: null, notes: { session: 'Wholly authored visual regression. Not a manufacturing board.' } } },
    gerber: { file: new File([gerber], 'SYNTHETIC-layer.gbr'), settings: { config: { formatOverride: null, assumeLinear: false }, points: Array.from({ length: 4 }, (_, i) => ({ id: `point-${i + 1}`, role: i === 3 ? 'check' as const : 'fit' as const, cad: ['', ''] as [string, string], gerber: ['', ''] as [string, string], evidence: '' })), scope: { module: '', side: '', boardInstance: '' }, tolerance: '.1', basis: '', checked: false } }, original: null, returned: null, notes: {}, machineVersion: '' });
  await load(page, project);
  const canvas = page.getByRole('img', { name: 'Interactive board canvas' });
  await expect(canvas.locator('[data-ref]')).toHaveCount(48);
  await expect(canvas.locator('[data-ref="S1"]')).toHaveAttribute('data-x', '8');
  await page.getByLabel('Search component references').fill('S19'); await page.getByLabel('Search component references').press('Enter');
  await expect(page.getByLabel('Placement to inspect')).toHaveValue('19');
  const before = await canvas.getAttribute('viewBox'); await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  expect(await canvas.getAttribute('viewBox')).not.toBe(before);
  const zoomed = await canvas.getAttribute('viewBox'); const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 45, box.y + box.height / 2 + 20); await page.mouse.up();
  expect(await canvas.getAttribute('viewBox')).not.toBe(zoomed);
  await page.getByRole('button', { name: 'Fit view', exact: true }).click();
  await page.screenshot({ path: info.outputPath('SYNTHETIC-source-canvas.png'), fullPage: true });
  await page.getByLabel('Canvas module and side').selectOption('["SYNTHETIC-A","Bottom"]');
  await expect(canvas.locator('[data-ref]')).toHaveCount(1); await expect(canvas.locator('[data-ref="S1"]')).toHaveAttribute('data-x', '-8');
  await page.getByLabel('Coordinate view').selectOption('gerber');
  await expect(page.getByTestId('actual-gerber-geometry')).toBeVisible(); await expect(canvas.locator('[data-ref]')).toHaveCount(0);
  await expect(page.getByText('CAD overlay held until registration', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Layers', exact: true }).click();
  await page.screenshot({ path: info.outputPath('SYNTHETIC-unregistered-gerber.png'), fullPage: true });
  await page.getByLabel('Coordinate view').selectOption('source');
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  const savedView = await canvas.getAttribute('viewBox'), saving = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save project', exact: true }).click(); const saved = await readFile((await (await saving).path())!);
  const data = JSON.parse(saved.toString()); expect(data.visualWorkspace.authority).toBe('presentation-only'); expect(data.visualWorkspace.events.length).toBeGreaterThan(0); expect(data.placement.source.base64).toBe(Buffer.from(csv).toString('base64'));
  await page.reload(); await page.getByLabel('Saved placement review file').setInputFiles({ name: 'reopen.json', mimeType: 'application/json', buffer: saved });
  await expect(page.getByRole('status').filter({ hasText: 'Review reopened.' })).toBeVisible(); await expect(canvas).toHaveAttribute('viewBox', savedView!);
  const operations: string[] = []; page.on('request', r => { if (r.method() === 'POST') operations.push(r.url()); });
  await page.getByRole('button', { name: 'Recorded replay', exact: true }).click();
  await page.getByLabel('Recorded event position').fill('0'); await page.getByRole('button', { name: 'Play recorded replay', exact: true }).click();
  await expect(page.getByText('Recorded event replay · read only', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Next recorded event', exact: true }).click();
  expect(operations).toEqual([]); expect(JSON.parse(saved.toString()).repair?.history ?? []).toEqual([]);
  await page.screenshot({ path: info.outputPath('SYNTHETIC-recorded-replay.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); expect(errors).toEqual([]);
});

test('visual exact proposal preview, reject/undo/accept, guarded candidate and fresh reopening', async ({ page }, info) => {
  test.setTimeout(120_000);
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  const fixture = authoredDiagnosis(), context = fixture.context;
  const bitmap = Buffer.alloc(58); bitmap.write('BM'); bitmap.writeUInt32LE(58, 2); bitmap.writeUInt32LE(54, 10); bitmap.writeUInt32LE(40, 14); bitmap.writeUInt32LE(1, 18); bitmap.writeUInt32LE(1, 22); bitmap.writeUInt16LE(1, 26); bitmap.writeUInt16LE(24, 28);
  // Explicit authored zero module transform qualifies this positive overlay fixture.
  fixture.members[fixture.selection.jobMember] = fixture.members[fixture.selection.jobMember].replace('<ModuleData><ID>1</ID></ModuleData>', '<ModuleData><ID>1</ID><Angle>0</Angle><Shift><X>0</X><Y>0</Y></Shift><RotCenter><X>0</X><Y>0</Y></RotCenter></ModuleData>');
  fixture.members['Fictional/Board/Invented.bmp'] = bitmap.toString('utf8'); // Entire authored 1×1 BMP is ASCII-range bytes.
  fixture.archive = makeArchive(fixture.members);
  const project = await encodeProject({ placement: { file: new File([fixture.placement], 'SYNTHETIC-REV1.csv'), settings: { config: context.placementConfig.config, sheetIndex: 0, delimiter: ',', validated: true, selectedRow: null, notes: {} } }, layout: { file: new File([fixture.pcb], 'SYNTHETIC-REV1.pcb'), checked: true }, bom: { file: new File([fixture.bom], 'SYNTHETIC-BOM-REV1.csv'), config: context.bomConfig.config, sheet: 0, delimiter: ',', checked: true }, original: original(new File([new Uint8Array(fixture.archive)], 'SYNTHETIC-native.zip'), fixture.selection), returned: null, gerber: null, notes: {}, machineVersion: '', nativeDiagnosis: { settings: context.settings, reviewer: 'Synthetic visual test' }, nativePreparation: { review: null, reviewer: '', history: [], packageProfiles: context.packageProfiles } });
  await load(page, project);
  await page.getByRole('button', { name: 'Layers', exact: true }).click();
  await page.getByLabel('Preserved scan image').selectOption('Fictional/Board/Invented.bmp');
  await expect(page.getByTestId('preserved-scan-image')).toBeVisible();
  await page.getByLabel('Coordinate view').selectOption('native');
  await page.getByRole('button', { name: 'Analyze on board', exact: true }).click();
  await expect(page.getByTestId('native-analyzed').locator('strong')).not.toHaveText('0');
  await expect(page.getByTestId('component-processing-ring')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show results of last run', exact: true }).click();
  await expect(page.getByTestId('board-component-event')).toContainText('analysis-');
  await expect(page.getByTestId('component-processing-ring').first()).toBeVisible();
  await expect(page.getByTestId('component-display-mode')).toContainText('static event layer');
  await page.getByRole('button', { name: 'Registration', exact: true }).click();
  await expect(page.getByLabel('Native registration evidence')).toContainText('supported-diagnostic');
  await expect(page.getByTestId('native-registration-control').first()).toBeVisible();
  await page.screenshot({ path: info.outputPath('SYNTHETIC-board-registration-and-events.png'), fullPage: true });
  await page.getByRole('button', { name: 'Findings', exact: true }).click();
  await page.getByRole('complementary', { name: 'Board inspector' }).getByRole('button', { name: /N1 · module 1 · ID 87/ }).click();
  await expect(page.getByRole('complementary', { name: 'Board inspector' })).toContainText('Derived target');
  await page.screenshot({ path: info.outputPath('SYNTHETIC-source-derived-finding.png'), fullPage: true });
  await page.getByRole('button', { name: 'Review this finding and source evidence', exact: true }).click();
  await page.getByRole('button', { name: 'Send exact derived placement to native review', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'freshly verified and added to native review' })).toBeVisible();
  await page.getByRole('button', { name: 'Close engineering tools' }).click();
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await page.getByRole('complementary', { name: 'Board inspector' }).getByRole('button', { name: /N1 · module 1 · ID 87/ }).click();
  const canvas = page.getByRole('img', { name: 'Interactive board canvas' }), baseline = canvas.locator('[data-ref="N1"]:not([data-proposed])'), preview = canvas.locator('[data-ref="N1"][data-proposed]');
  const originalX = Number(await baseline.getAttribute('data-x')), originalY = Number(await baseline.getAttribute('data-y'));
  await expect(preview).toHaveAttribute('data-x', String(fixture.expected[0]));
  await page.getByLabel('Proposal preview fraction').fill('0.5');
  expect(Number(await preview.getAttribute('data-x'))).toBeCloseTo((originalX + fixture.expected[0]) / 2, 8);
  expect(Number(await baseline.getAttribute('data-y'))).toBe(originalY);
  await page.getByRole('button', { name: 'Reject', exact: true }).click(); await page.getByRole('button', { name: 'Undo decision', exact: true }).click();
  await page.getByRole('button', { name: 'Accept exact proposal', exact: true }).click();
  await page.screenshot({ path: info.outputPath('SYNTHETIC-reviewed-preview.png'), fullPage: true });
  await page.getByRole('button', { name: 'Open guarded review & candidate build', exact: true }).click();
  await page.getByRole('checkbox', { name: /I acknowledge QUALIFICATION ONLY/ }).check();
  const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: 'Generate qualification candidate (2 accepted)', exact: true }).click();
  const output = info.outputPath('SYNTHETIC-visual-candidate.zip'); await (await downloading).saveAs(output);
  await page.getByRole('button', { name: 'Close engineering tools' }).click(); await tool(page, 'Candidate checks');
  await expect(page.getByRole('status').filter({ hasText: '2 accepted scalar edits verified in the actual candidate.' })).toBeVisible();
  const extracted = info.outputPath('SYNTHETIC-reopened.scan-project.json');
  const checked = spawnSync(python, ['-c', `import json,zipfile,io,sys,pathlib
f=json.loads(sys.stdin.read())
with zipfile.ZipFile(sys.argv[1]) as z:
 p=z.read('SCAN.scan-project.json');pathlib.Path(sys.argv[2]).write_bytes(p);saved=json.loads(p)
 with zipfile.ZipFile(io.BytesIO(z.read('engineering-QUALIFICATION-ONLY.zip'))) as e:
  with zipfile.ZipFile(io.BytesIO(e.read('CANDIDATE.zip'))) as c:
   assert set(c.namelist())==set(f['members'])
   for n,b in f['members'].items():
    if n!=f['selection']['jobMember']:assert c.read(n)==b.encode()
assert saved['visualWorkspace']['authority']=='presentation-only'
assert len(saved['repair']['history'])==1
print('Authored unrelated file payloads and saved history preserved.')`, output, extracted], { input: JSON.stringify(fixture), encoding: 'utf8' });
  expect(checked.status, checked.stderr).toBe(0);
  await page.reload(); await page.getByLabel('Saved placement review file').setInputFiles(extracted);
  await expect(page.getByRole('status').filter({ hasText: 'Project reopened.' })).toBeVisible();
  await tool(page, 'Candidate checks'); await expect(page.getByRole('status').filter({ hasText: '2 accepted scalar edits verified in the actual candidate.' })).toBeVisible();
  await page.getByRole('button', { name: 'Close engineering tools' }).click();
  await page.getByLabel('Coordinate view').selectOption('image');
  await expect(page.getByTestId('preserved-scan-image')).toBeVisible();
  await page.getByLabel('Coordinate view').selectOption('native'); await page.getByLabel('Native display snapshot').selectOption('candidate');
  await expect(canvas.locator('[data-ref="N1"]')).toHaveAttribute('data-x', String(fixture.expected[0]));
  await expect(page.getByTestId('candidate-literal-proof')).toHaveText('Literal read-back: verified');
  await expect(page.getByTestId('candidate-full-proof')).toHaveText('Full native preservation: freshly verified');
  await page.getByLabel('Native display snapshot').selectOption('baseline');
  await page.getByRole('button', { name: 'Analyze on board', exact: true }).click();
  await expect(page.getByTestId('native-analyzed').locator('strong')).not.toHaveText('0');
  await page.getByLabel('Native display snapshot').selectOption('candidate');
  await expect(canvas.getByLabel('Registered CAD origins')).toBeVisible();
  await expect(page.getByTestId('candidate-overlay-hold')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('SYNTHETIC-candidate-reopened.png'), fullPage: true });
  const recordedProject = JSON.parse(await readFile(extracted, 'utf8'));
  const componentIndex = recordedProject.visualWorkspace.events.findIndex((e: any) => e.geometry?.identity.ref === 'N1' && e.componentPhase === 'placement-checked');
  expect(componentIndex).toBeGreaterThanOrEqual(0);
  const componentEvent = recordedProject.visualWorkspace.events[componentIndex];
  expect(componentEvent.geometry.before.x).toBe(originalX); expect(componentEvent.geometry.after.x).toBe(fixture.expected[0]);
  expect(recordedProject.visualWorkspace.events.filter((e: any) => e.componentPhase === 'placement-checked')).toHaveLength(1);
  const replayRequests: string[] = []; page.on('request', r => { if (r.method() === 'POST') replayRequests.push(r.url()); });
  await page.getByRole('button', { name: 'Recorded replay', exact: true }).click();
  await page.getByLabel('Recorded event position').fill(String(componentIndex));
  const recorded = page.getByRole('img', { name: 'Recorded component geometry' });
  await expect(recorded.locator('[data-recorded-phase="before"]')).toHaveAttribute('data-x', String(originalX));
  await expect(recorded.locator('[data-recorded-phase="after"]')).toHaveAttribute('data-x', String(fixture.expected[0]));
  await expect(canvas).toBeVisible();
  await expect(page.getByRole('button', { name: 'Engineering tools', exact: true })).toBeDisabled();
  await page.screenshot({ path: info.outputPath('SYNTHETIC-recorded-component-geometry.png'), fullPage: true });
  expect(replayRequests).toEqual([]);
  await page.getByRole('button', { name: 'Return to live', exact: true }).click();
  await expect(canvas.locator('[data-ref="N1"]')).toHaveAttribute('data-x', String(fixture.expected[0]));

  // Presentation trimming cannot grant or remove a freshly reproduced candidate proof.
  const partial = structuredClone(recordedProject);
  for (let sequence=1;sequence<=602;sequence++) partial.visualWorkspace=appendVisualJournal(partial.visualWorkspace,{id:`synthetic-trim-${sequence}`,run:'synthetic-trim-run',sequence,at:'2026-01-01T00:00:00Z',source:'authored-stress-only',stage:'SYNTHETIC bounded journal',status:sequence===602?'completed':sequence===1?'started':'progress',message:'Wholly authored stress event. No geometry or repair authority.',count:null,entity:null});
  await load(page,new Blob([JSON.stringify(partial)]));
  await page.getByLabel('Coordinate view').selectOption('native'); await page.getByLabel('Native display snapshot').selectOption('candidate');
  await expect(page.getByTestId('partial-history')).toBeVisible();
  await expect(page.getByTestId('candidate-literal-proof')).toHaveText('Literal read-back: verified');
  await expect(page.getByTestId('candidate-full-proof')).toHaveText('Full native preservation: freshly verified');
  await expect(canvas.locator('[data-ref]')).toHaveCount(2);
  await expect(canvas.locator('[data-ref="N1"]')).toHaveAttribute('data-x',String(fixture.expected[0]));
  await page.screenshot({path:info.outputPath('SYNTHETIC-partial-history-fresh-candidate-proof.png'),fullPage:true});

  // Missing export history cannot restore either proof or candidate overlay; native records remain visible.
  const missing = structuredClone(recordedProject); missing.repair.history = [];
  await page.reload(); await page.getByLabel('Saved placement review file').setInputFiles({ name: 'SYNTHETIC-missing-receipt.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(missing)) });
  await expect(page.getByRole('status').filter({ hasText: 'Project reopened.' })).toBeVisible();
  await page.getByLabel('Coordinate view').selectOption('native'); await page.getByLabel('Native display snapshot').selectOption('candidate');
  await expect(page.getByTestId('candidate-full-proof')).toHaveText('Full native preservation: unverified');
  await expect(page.getByTestId('candidate-literal-proof')).toHaveText('Literal read-back: unconfirmed');
  await expect(page.getByTestId('candidate-overlay-hold')).toBeVisible();
  await expect(canvas.locator('[data-ref="N1"]')).toBeVisible();
  await expect(canvas.getByLabel('Registered CAD origins')).toHaveCount(0);
  // An unobserved XML comment preserves literal records but must fail full byte reproduction.
  const altered = spawnSync(python, ['-c', `import sys,json,base64,zipfile,io,hashlib
p=json.loads(sys.stdin.read());r=p['archives']['generated']['source'];b=io.BytesIO()
with zipfile.ZipFile(io.BytesIO(base64.b64decode(r['base64']))) as z,zipfile.ZipFile(b,'w') as w:
 for n in z.namelist():
  raw=z.read(n)
  if n==p['archives']['generated']['selection']['jobMember']:raw=raw.replace(b'</JobContainer>',b'<!--authored unknown byte change--></JobContainer>')
  w.writestr(n,raw)
raw=b.getvalue();r.update(base64=base64.b64encode(raw).decode(),size=len(raw),sha256=hashlib.sha256(raw).hexdigest())
p['repair']['history'][0]['candidateSha256']=r['sha256']
print(json.dumps(p))`], { input: JSON.stringify(recordedProject), encoding: 'utf8', maxBuffer: 5_000_000 });
  expect(altered.status, altered.stderr).toBe(0);
  await page.reload(); await page.getByLabel('Saved placement review file').setInputFiles({ name: 'SYNTHETIC-unknown-xml-byte.json', mimeType: 'application/json', buffer: Buffer.from(altered.stdout) });
  await expect(page.getByRole('status').filter({ hasText: 'Project reopened.' })).toBeVisible();
  await page.getByLabel('Coordinate view').selectOption('native'); await page.getByLabel('Native display snapshot').selectOption('candidate');
  await expect(page.getByTestId('candidate-literal-proof')).toHaveText('Literal read-back: verified');
  await expect(page.getByRole('alert').filter({ hasText: 'Candidate main XML bytes differ' })).toBeVisible();
  await expect(page.getByTestId('candidate-full-proof')).toHaveText('Full native preservation: unverified');
  await expect(page.getByTestId('candidate-overlay-hold')).toBeVisible();
  await expect(canvas.locator('[data-ref="N1"]')).toBeVisible();
  await page.screenshot({ path: info.outputPath('SYNTHETIC-literal-only-full-proof-held.png'), fullPage: true });
  // Module-frame changes and a missing companion are separately held, even with updated archive hashes.
  for (const mode of ['module', 'asset']) {
    const modified = spawnSync(python, ['-c', `import sys,json,base64,zipfile,io,hashlib
p=json.loads(sys.stdin.read());r=p['archives']['generated']['source'];b=io.BytesIO()
with zipfile.ZipFile(io.BytesIO(base64.b64decode(r['base64']))) as z,zipfile.ZipFile(b,'w') as w:
 for n in z.namelist():
  if sys.argv[1]=='asset' and n.endswith('unknown-preserved.txt'):continue
  raw=z.read(n)
  if sys.argv[1]=='module' and n==p['archives']['generated']['selection']['jobMember']:raw=raw.replace(b'<Shift><X>0</X>',b'<Shift><X>1</X>')
  w.writestr(n,raw)
raw=b.getvalue();r.update(base64=base64.b64encode(raw).decode(),size=len(raw),sha256=hashlib.sha256(raw).hexdigest())
p['repair']['history'][0]['candidateSha256']=r['sha256'];print(json.dumps(p))`, mode], { input: JSON.stringify(recordedProject), encoding: 'utf8', maxBuffer: 5_000_000 });
    expect(modified.status, modified.stderr).toBe(0);
    await page.reload(); await page.getByLabel('Saved placement review file').setInputFiles({ name: `SYNTHETIC-held-${mode}.json`, mimeType: 'application/json', buffer: Buffer.from(modified.stdout) });
    await expect(page.getByRole('status').filter({ hasText: 'Project reopened.' })).toBeVisible();
    await page.getByLabel('Coordinate view').selectOption('native'); await page.getByLabel('Native display snapshot').selectOption('candidate');
    await expect(page.getByTestId('candidate-full-proof')).toHaveText('Full native preservation: unverified');
    await expect(page.getByTestId('candidate-literal-proof')).toHaveText('Literal read-back: unconfirmed');
    await expect(page.getByTestId('candidate-overlay-hold')).toBeVisible();
    await expect(canvas.locator('[data-ref="N1"]')).toBeVisible();
    await expect(canvas.getByLabel('Registered CAD origins')).toHaveCount(0);
  }


  expect(errors).toEqual([]);
});

test('supported preserved raster is hash verified, visibly unregistered and retained on project reopening', async ({ page }) => {
  test.setTimeout(60_000);
  const imageResponses: string[] = [], busyResponses: number[] = [];
  page.on('response', response => {
    if (!response.url().endsWith('/api/archive')) return;
    if (response.headers()['x-scan-registration'] === 'unregistered') imageResponses.push(response.url());
    if ([409, 429].includes(response.status())) busyResponses.push(response.status());
  });
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNQKJgAAAHUASFijxa9AAAAAElFTkSuQmCC', 'base64');
  const members = { ...Object.fromEntries(Object.entries(syntheticMembers).map(([k, v]) => [k, Buffer.from(v).toString('base64')])), 'Fictional/Board/Invented.png': image.toString('base64'), 'Fictional/Board/Unsupported.tif': Buffer.from('II-invented-unsupported').toString('base64') };
  const result = spawnSync(python, ['-c', 'import sys,json,zipfile,io,base64\nb=io.BytesIO()\nwith zipfile.ZipFile(b,"w") as z:\n for n,v in json.loads(sys.stdin.read()).items(): z.writestr(n,base64.b64decode(v))\nsys.stdout.buffer.write(b.getvalue())'], { input: JSON.stringify(members) });
  expect(result.status).toBe(0);
  await load(page, await encodeProject({ placement: null, gerber: null, original: original(new File([new Uint8Array(result.stdout)], 'SYNTHETIC-image.zip')), generated: original(new File([new Uint8Array(result.stdout)], 'SYNTHETIC-copy.zip')), returned: null, notes: {}, machineVersion: '' }));
  await page.getByRole('button', { name: 'Layers', exact: true }).click(); await page.getByLabel('Preserved scan image').selectOption('Fictional/Board/Invented.png');
  await expect(page.getByTestId('preserved-scan-image')).toBeVisible(); await expect(page.getByText('1 × 1 pixels · preserved bytes verified')).toBeVisible();
  await expect(page.getByRole('img', { name: 'Interactive board canvas' }).locator('[data-ref]')).toHaveCount(0);
  const saving = page.waitForEvent('download'); await page.getByRole('button', { name: 'Save project', exact: true }).click(); const saved = (await (await saving).path())!;
  await page.reload(); await page.getByLabel('Saved placement review file').setInputFiles(saved);
  await expect(page.getByTestId('preserved-scan-image')).toBeVisible();
  await page.getByRole('button', { name: 'Layers', exact: true }).click(); await page.getByLabel('Preserved scan image').selectOption('Fictional/Board/Unsupported.tif');
  await expect(page.getByRole('complementary', { name: 'Board inspector' }).getByRole('alert')).toContainText('Image is unsupported'); await expect(page.getByTestId('preserved-scan-image')).toHaveCount(0);
  expect(imageResponses).toHaveLength(2); // First selection and fresh reopen; unsupported selection does not return pixels.
  expect(busyResponses).toEqual([]);
});

test('workspace prepares a reviewed disabled draft, displays actual candidate records and preserves its receipt on reopening', async ({ page }, info) => {
  test.setTimeout(120_000);
  const fixture = authoredPreparation();
  const bytes = makeArchive({ ...syntheticMembers, [syntheticSelection.jobMember]: fixture.job, [syntheticSelection.masterMember]: fixture.master });
  await load(page, await encodeProject({ placement: null, gerber: null, original: original(new File([new Uint8Array(bytes)], 'SYNTHETIC-preparation.zip')), returned: null, layout: { file: new File([fixture.pcb], 'SYNTHETIC.pcb'), checked: true }, notes: {}, machineVersion: '' }));
  await tool(page, 'Prepare parts');
  const region = page.getByRole('region', { name: 'Native part preparation', exact: true });
  await region.getByRole('button', { name: 'Find supported native preparation', exact: true }).click();
  await expect(region).toContainText('2 proposals retain the full template window set');
  await region.getByLabel('Preparation reviewer', { exact: true }).fill('Synthetic visual preparation test');
  await region.getByText('N1 · disabled model proposal', { exact: true }).click();
  await region.getByRole('combobox', { name: 'Decision for N1', exact: true }).selectOption('accepted');
  await region.getByRole('checkbox', { name: /I acknowledge qualification-only output/ }).check();
  const downloading = page.waitForEvent('download');
  await region.getByRole('button', { name: 'Apply accepted part preparation to a separate candidate', exact: true }).click();
  const bundle = info.outputPath('SYNTHETIC-prepared.zip'), project = info.outputPath('SYNTHETIC-prepared.scan-project.json');
  await (await downloading).saveAs(bundle);
  const verified = spawnSync(python, ['-c', `import json,zipfile,pathlib,sys
with zipfile.ZipFile(sys.argv[1]) as z:
 w=json.loads(z.read('component-by-component-Eagle-work.json'));assert w['counts']['preparedReferences']==1
 assert next(r for r in w['rows'] if r['reference']=='N1')['nativeCreation']=='prepared-offline'
 pathlib.Path(sys.argv[2]).write_bytes(z.read('SCAN.scan-project.json'))`, bundle, project], { encoding: 'utf8' });
  expect(verified.status, verified.stderr).toBe(0);
  await page.getByRole('button', { name: 'Close engineering tools' }).click();
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Prepared draft receipt' })).toBeVisible();
  await page.getByRole('button', { name: 'View candidate records', exact: true }).click();
  const canvas = page.getByRole('img', { name: 'Interactive board canvas' });
  await expect(canvas.locator('[data-ref="N1"]')).toHaveCount(1);
  await expect(canvas.locator('[data-ref="N2"]')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('SYNTHETIC-prepared-candidate.png'), fullPage: true });
  await page.reload(); await page.getByLabel('Saved placement review file').setInputFiles(project);
  await expect(page.getByRole('status').filter({ hasText: 'Project reopened.' })).toBeVisible();
  await tool(page, 'Candidate checks');
  await expect(page.getByRole('region', { name: 'Generated candidate and remaining work' })).toContainText('3 intended references');
  await page.getByRole('button', { name: 'Close engineering tools' }).click();
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Prepared draft receipt' })).toBeVisible();
  await expect(page.getByLabel('Actual processing events')).toContainText('Preparation read-back');
  const saved = JSON.parse(await readFile(project, 'utf8'));
  const index = saved.visualWorkspace.events.findIndex((e: any) => e.geometry?.identity.ref === 'N1' && e.componentPhase === 'preparation-checked');
  expect(index).toBeGreaterThanOrEqual(0); expect(saved.visualWorkspace.events[index].geometry.before).toBeNull();
  expect(saved.visualWorkspace.events.filter((e: any) => e.componentPhase === 'preparation-checked')).toHaveLength(1);
  await page.getByRole('button', { name: 'Recorded replay', exact: true }).click();
  await page.getByLabel('Recorded event position').fill(String(index));
  await expect(page.getByRole('img', { name: 'Recorded component geometry' }).locator('[data-recorded-phase="after"]')).toHaveCount(1);
  await expect(page.getByRole('img', { name: 'Recorded component geometry' }).locator('[data-recorded-phase="before"]')).toHaveCount(0);

});
