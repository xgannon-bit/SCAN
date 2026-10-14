import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { encodeProject } from '../../lib/scan/project-session';
import { emptyVisualWorkspace, appendVisualJournal } from '../../lib/scan/visual-workspace';
import { makeArchive, syntheticMembers, syntheticSelection } from '../synthetic-archive.mjs';
import type { ArchiveSelection } from '../../lib/scan/archive-types';

/** Entirely authored XML; tests the observed reader profile, never machine compatibility. */
function authoredFullBoard() {
  const part = (id: number, ref: string, module: string, cx: string, cy: string, angle = '0') => `<PartData><ID>${id}</ID><RefID>${ref}</RefID><ParentId>${module}</ParentId><MasterKey>${id + 1000}</MasterKey><ENABLE>False</ENABLE><Roi>${cx}${cy}<w>2.5</w><h>1.25</h><a>${angle}</a></Roi><WND_PAD/><FovList/><CenterPosX>0</CenterPosX><CenterPosY>0</CenterPosY></PartData>`;
  const records = Array.from({ length: 300 }, (_, i) => ({ id: i + 1, ref: `S${i + 1}`, x: -12.125 + (i % 20) * 5.5, y: 8.375 + Math.floor(i / 20) * 4.25, angle: (i % 4) * 90 }));
  const main = records.map(r => part(r.id, r.ref, '1', `<cx>${r.x}</cx>`, `<cy>${r.y}</cy>`, String(r.angle)));
  main.push(part(301, 'FAR_COORD', '1', '<cx>9000</cx>', '<cy>-7000</cy>'));
  main.push(part(302, 'MISSING_X', '1', '', '<cy>10</cy>'));
  main.push(part(303, 'INVALID_X', '1', '<cx>NaN</cx>', '<cy>10</cy>'));
  main.push(part(304, 'REPEATED_Y', '1', '<cx>10</cx>', '<cy>1</cy><cy>2</cy>'));
  main.push(part(305, 'NO_MODULE', '', '<cx>10</cx>', '<cy>10</cy>'));
  for (let i = 0; i < 10; i++) main.push(part(306 + i, `S${i + 1}`, '2', `<cx>${500 + i * 8}</cx>`, '<cy>-30</cy>', '180'));
  const job = `<JobContainer><JobXmlVersion>10.1</JobXmlVersion><ModuleDataList><ModuleData><ID>1</ID><TB>unqualified-authored-side</TB></ModuleData><ModuleData><ID>2</ID><TB>unqualified-authored-side</TB></ModuleData></ModuleDataList><PartDataList>${main.join('')}</PartDataList></JobContainer>`;
  const members = { ...syntheticMembers, [syntheticSelection.jobMember]: job, [syntheticSelection.masterMember]: '<JobContainer><JobXmlVersion>10.1</JobXmlVersion><PartDataList/></JobContainer>' };
  return { archive: makeArchive(members), records };
}

test('complete native-only population is scoped, selectable and reopenable without per-component events', async ({ page }, info) => {
  test.setTimeout(90_000);
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  const fixture = authoredFullBoard(), selection = syntheticSelection as ArchiveSelection;
  const original = { file: new File([new Uint8Array(fixture.archive)], 'SYNTHETIC-full-board.zip'), selection,
    draft: { root: selection.root, job: JSON.stringify({ role: selection.jobRole, member: selection.jobMember }), master: JSON.stringify({ role: selection.masterRole, member: selection.masterMember }) } };
  const project = await encodeProject({ placement: null, gerber: null, original, returned: null, notes: { session: 'Wholly authored 315-record native scene fixture; no CAD, scan, per-component events or machine qualification.' }, machineVersion: '', visualWorkspace: emptyVisualWorkspace() });
  await page.goto('/workspace');
  await page.getByLabel('Saved placement review file', { exact: true }).setInputFiles({ name: 'SYNTHETIC-full-board.scan-project.json', mimeType: 'application/json', buffer: Buffer.from(await project.arrayBuffer()) });
  await expect(page.getByRole('status').filter({ hasText: 'Project reopened.' })).toBeVisible();
  await expect(page.getByLabel('Coordinate view')).toHaveValue('native');
  const canvas = page.getByRole('img', { name: 'Interactive board canvas' });
  const inspector = page.getByRole('complementary', { name: 'Board inspector' });
  const marked = canvas.locator('[data-ref]:not([data-proposed])');
  await expect(marked).toHaveCount(301); // More than the event transport's 256-component cap.
  expect(await marked.evaluateAll(nodes => nodes.map(node => ({ ref: node.getAttribute('data-ref'), x: Number(node.getAttribute('data-x')), y: Number(node.getAttribute('data-y')) })))).toEqual([
    ...fixture.records.map(({ ref, x, y }) => ({ ref, x, y })), { ref: 'FAR_COORD', x: 9000, y: -7000 },
  ]);
  await expect(page.getByTestId('native-total').locator('strong')).toHaveText('315');
  await expect(page.getByTestId('native-plotted').locator('strong')).toHaveText('301');
  await expect(page.getByTestId('native-analyzed').locator('strong')).toHaveText('0');
  await expect(page.getByTestId('native-written').locator('strong')).toHaveText('0');
  await expect(page.getByTestId('native-preserved').locator('strong')).toHaveText('0');
  await expect(page.getByTestId('native-eagle').locator('strong')).toHaveText('315');
  await expect(page.getByTestId('preserved-scan-image')).toHaveCount(0);
  await expect(canvas.locator('[data-ref="S1"]')).toHaveAttribute('data-x', '-12.125');
  await expect(canvas.locator('[data-ref="S1"]')).toHaveAttribute('data-y', '8.375');
  await expect(canvas.locator('[data-ref="FAR_COORD"]')).toHaveAttribute('data-native-state', 'held');
  await expect(canvas.locator('[data-ref="FAR_COORD"]')).toHaveAttribute('data-x', '9000');
  await expect(canvas.locator('[data-ref="MISSING_X"], [data-ref="INVALID_X"], [data-ref="REPEATED_Y"], [data-ref="NO_MODULE"]')).toHaveCount(0);
  await page.getByText('State evidence', { exact: true }).click();
  await expect(page.getByText(/4 unplottable · 1 fit outliers/)).toBeVisible();
  await page.getByText('State evidence', { exact: true }).click();
  await inspector.getByText('Coordinate holds / outliers', { exact: true }).click();
  for (const ref of ['MISSING_X', 'INVALID_X', 'REPEATED_Y', 'NO_MODULE', 'FAR_COORD']) await expect(inspector.getByText(new RegExp(`^${ref} · module`))).toBeVisible();
  await inspector.getByText('Coordinate holds / outliers', { exact: true }).click();
  await page.screenshot({ path: info.outputPath('SYNTHETIC-complete-native-population.png'), fullPage: true });

  const expected = fixture.records[149], target = canvas.locator(`[data-ref="${expected.ref}"]`), boardView = await canvas.getAttribute('viewBox');
  await expect(target).toHaveAttribute('data-native-state', 'unreviewed');
  // Click the exact native origin through the SVG viewport transform. Dense
  // neighboring hit targets need not have disjoint bounding rectangles.
  await canvas.scrollIntoViewIfNeeded();
  const clickAt = await canvas.evaluate((svg, point) => {
    const node = svg as SVGSVGElement, pixel = node.createSVGPoint(); pixel.x = point.x; pixel.y = point.y;
    const transformed = pixel.matrixTransform(node.getScreenCTM()!); return { x: transformed.x, y: transformed.y };
  }, { x: expected.x, y: expected.y });
  await page.mouse.click(clickAt.x, clickAt.y);
  await expect(inspector.getByRole('heading', { name: 'S150', exact: true })).toBeVisible();
  await expect(page.getByTestId('selected-review-state')).toHaveText('Review: unreviewed');
  await expect(page.getByTestId('selected-write-state')).toHaveText('Candidate: unconfirmed');
  const selectedKey = await target.getAttribute('data-entity-key');
  expect(await canvas.getAttribute('viewBox')).not.toBe(boardView);
  const focusedView = (await canvas.getAttribute('viewBox'))!.split(' ').map(Number);
  expect(focusedView[2]).toBeGreaterThanOrEqual(14 - 1e-8); expect(focusedView[3]).toBeGreaterThanOrEqual(14 - 1e-8);
  expect(focusedView[0] + focusedView[2] / 2).toBeCloseTo(expected.x, 7); expect(focusedView[1] + focusedView[3] / 2).toBeCloseTo(expected.y, 7);
  const focusedBounds = (await canvas.boundingBox())!;
  expect(focusedView[2] / focusedView[3]).toBeCloseTo(focusedBounds.width / focusedBounds.height, 5);
  await expect(target).toHaveAttribute('data-x', String(expected.x)); await expect(target).toHaveAttribute('data-y', String(expected.y));
  await expect(target.locator('rect')).toHaveAttribute('width', '2.5'); await expect(target.locator('rect')).toHaveAttribute('height', '1.25');
  await expect(target.locator('rect')).toHaveAttribute('transform', `rotate(${expected.angle} ${expected.x} ${expected.y})`);
  const selectedInspector = inspector.locator('[aria-label="Selected placement"]');
  await selectedInspector.getByRole('button', { name: 'Return to board', exact: true }).click();
  await expect(marked).toHaveCount(301); expect(Number((await canvas.getAttribute('viewBox'))!.split(' ')[2])).toBeGreaterThan(9000);
  await expect(target).toHaveAttribute('data-entity-key', selectedKey!);
  await expect(inspector.getByRole('heading', { name: 'S150', exact: true })).toBeVisible();

  // Reused S1 refers to a different module/Part/Master at a wholly separate coordinate scope.
  const scopeControl = page.getByLabel('Canvas module and side');
  await scopeControl.selectOption('["2","native side unqualified"]');
  await expect(marked).toHaveCount(10); await expect(page.getByTestId('native-total').locator('strong')).toHaveText('315');
  await expect(canvas.locator('[data-ref="S1"]')).toHaveAttribute('data-x', '500');
  await expect(canvas.locator('[data-ref="S1"]')).toHaveAttribute('data-y', '-30');
  const module2Key = await canvas.locator('[data-ref="S1"]').getAttribute('data-entity-key');
  await page.getByLabel('Search component references').fill('S1'); await page.getByLabel('Search component references').press('Enter');
  await expect(inspector.locator('[aria-label="Selected placement"]')).toContainText('Part 306 · Master 1306');
  await scopeControl.selectOption('["1","native side unqualified"]');
  expect(await canvas.locator('[data-ref="S1"]').getAttribute('data-entity-key')).not.toBe(module2Key);
  await page.getByLabel('Search component references').fill('S150'); await page.getByLabel('Search component references').press('Enter');
  await expect(inspector.getByRole('heading', { name: 'S150', exact: true })).toBeVisible();
  await selectedInspector.getByRole('button', { name: 'Return to board', exact: true }).click();
  const retainedView = await canvas.getAttribute('viewBox');

  const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: 'Save project', exact: true }).click();
  const saved = await readFile((await (await downloading).path())!), json = JSON.parse(saved.toString());
  expect(json.placement).toBeNull(); expect(json.gerber).toBeNull(); expect(json.archives.original.source.base64).toBe(fixture.archive.toString('base64'));
  expect(json.visualWorkspace.events.filter((e: { geometry?: unknown }) => e.geometry)).toHaveLength(0);
  expect(json.visualWorkspace.selected).toBe(selectedKey); expect(json.machineExportAllowed).toBe(false);
  await page.reload(); await page.getByLabel('Saved placement review file', { exact: true }).setInputFiles({ name: 'SYNTHETIC-full-board-reopen.json', mimeType: 'application/json', buffer: saved });
  await expect(page.getByRole('status').filter({ hasText: 'Project reopened.' })).toBeVisible();
  await expect(page.getByLabel('Coordinate view')).toHaveValue('native'); await expect(marked).toHaveCount(301);
  await expect(canvas).toHaveAttribute('viewBox', retainedView!); await expect(inspector.getByRole('heading', { name: 'S150', exact: true })).toBeVisible();
  await expect(target).toHaveAttribute('data-entity-key', selectedKey!);
  await expect(page.getByTestId('native-total').locator('strong')).toHaveText('315'); await expect(page.getByTestId('native-written').locator('strong')).toHaveText('0');
  await page.screenshot({ path: info.outputPath('SYNTHETIC-complete-native-reopened.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('R02 partial saved replay retains the complete native scene and grants no proof or work status', async ({page}, info) => {
  test.setTimeout(90_000);
  const fixture=authoredFullBoard(), selection=syntheticSelection as ArchiveSelection;
  let visual=emptyVisualWorkspace(); visual.frame='native';
  for(let sequence=1;sequence<=602;sequence++) visual=appendVisualJournal(visual,{id:`synthetic-${sequence}`,run:'synthetic-history-stress',sequence,at:'2026-01-01T00:00:00Z',source:'authored-history-only',stage:'SYNTHETIC history stress',status:sequence===1?'started':sequence===602?'completed':'progress',message:'Authored presentation-only event; no component or candidate authority.',count:null,entity:null});
  const project=await encodeProject({placement:null,original:{file:new File([new Uint8Array(fixture.archive)],'SYNTHETIC-history-board.zip'),selection,draft:{root:selection.root,job:JSON.stringify({role:selection.jobRole,member:selection.jobMember}),master:JSON.stringify({role:selection.masterRole,member:selection.masterMember})}},returned:null,gerber:null,notes:{},machineVersion:'',visualWorkspace:visual});
  await page.goto('/workspace');
  await page.getByLabel('Saved placement review file',{exact:true}).setInputFiles({name:'SYNTHETIC-partial-history.json',mimeType:'application/json',buffer:Buffer.from(await project.arrayBuffer())});
  await expect(page.getByRole('status').filter({hasText:'Project reopened.'})).toBeVisible();
  const canvas=page.getByRole('img',{name:'Interactive board canvas'});
  await expect(page.getByTestId('partial-history')).toContainText('Partial history');
  await expect(page.getByTestId('native-total').locator('strong')).toHaveText('315');
  await expect(canvas.locator('[data-ref]')).toHaveCount(301);
  for(const id of ['analyzed','accepted','written']) await expect(page.getByTestId(`native-${id}`).locator('strong')).toHaveText('0');
  const downloading=page.waitForEvent('download'); await page.getByRole('button',{name:'Save project',exact:true}).click();
  const saved=await readFile((await (await downloading).path())!), json=JSON.parse(saved.toString());
  expect(json.visualWorkspace.events.length).toBeLessThanOrEqual(500); expect(json.visualWorkspace.historyOmitted).toBeGreaterThanOrEqual(102);
  expect(json.archives.original.source.base64).toBe(fixture.archive.toString('base64')); expect(json.machineExportAllowed).toBe(false);
  await page.reload(); await page.getByLabel('Saved placement review file',{exact:true}).setInputFiles({name:'SYNTHETIC-partial-reopened.json',mimeType:'application/json',buffer:saved});
  await expect(page.getByRole('status').filter({hasText:'Project reopened.'})).toBeVisible();
  const posts:string[]=[]; page.on('request',r=>{if(r.method()==='POST')posts.push(r.url());});
  await page.getByRole('button',{name:'Recorded replay',exact:true}).click(); await page.getByLabel('Recorded event position').fill('0');
  await expect(page.getByTestId('partial-history')).toContainText('This run retains');
  await expect(page.getByTestId('component-display-mode')).toContainText('Recorded historical');
  await expect(canvas.locator('[data-ref]')).toHaveCount(301); await expect(page.getByTestId('native-total').locator('strong')).toHaveText('315');
  await page.screenshot({path:info.outputPath('SYNTHETIC-partial-history-full-board.png'),fullPage:true});
  await page.getByRole('button',{name:'Return to live',exact:true}).click();
  await expect(page.getByTestId('component-processing-ring')).toHaveCount(0); expect(posts).toEqual([]);
});
