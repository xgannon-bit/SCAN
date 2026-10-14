import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

// Authored parser sources, not a saved result or stored transform.
const positions = [[1, 2], [16, 2], [4, 14], [11, 9], [6, 6]];
function review(target: boolean) {
  const bytes = Buffer.from(positions.map(([x, y], i) => `X${i + 1},${target ? -y + 21 : x / 25.4},${target ? x - 4 : y / 25.4},${target ? 90 : 0},Top`).join('\n'));
  return { artifactType: 'scan.placement-review-session', schemaVersion: '1', source: { name: `authored-${target ? 'target' : 'source'}-REV3.csv`, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), base64: bytes.toString('base64') }, config: { startRow: 1, columns: { refdes: 1, x: 2, y: 3, rotation: 4, side: 5 }, module: 'AUTHORED-MODULE', side: '', units: target ? 'mm' : 'inch', rotationDirection: 'ccw', decimalSeparator: '.', pairSeparator: ',' }, sheetIndex: 0, delimiter: ',', validated: true, selectedRow: null, notes: {}, machineExportAllowed: false };
}
const project = { artifactType: 'scan.project-session', schemaVersion: '1', placement: review(false), comparisons: [review(true)], gerber: null, archives: { original: null, returned: null }, notes: {}, machineVersion: '', machineExportAllowed: false };

test('source-origin registration reviews real parsed correspondences and restores exact decision from project', async ({ page, baseURL }, testInfo) => {
  const errors: string[] = [], external: string[] = []; page.on('pageerror', e => errors.push(e.message)); page.on('request', r => { if (new URL(r.url()).origin !== baseURL) external.push(r.url()); });
  await page.goto('/intake');
  await page.getByLabel('Saved placement review file', { exact: true }).setInputFiles({ name: 'authored.scan-project.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
  await expect(page.getByRole('status').filter({ hasText: /(?:Project|Review) reopened\./ })).toBeVisible();
  await page.getByRole('navigation', { name: 'SCAN screens' }).getByRole('link', { name: 'Board workspace', exact: true }).click(); await page.getByRole('button',{name:'Engineering tools',exact:true}).click(); await page.getByRole('navigation',{name:'Engineering tool selection'}).getByRole('button',{name:'Source registration',exact:true}).click();
  const section = page.locator('#source-registration');
  await section.getByRole('combobox', { name: 'Source to review', exact: true }).selectOption('primary');
  await section.getByRole('combobox', { name: 'Target frame', exact: true }).selectOption('comparison:0');
  await section.getByLabel('Frame and origin evidence', { exact: true }).fill('Authored top-view same physical footprint origins. Source explicit inches and target explicit millimeters. Both revision 3, no mirrored views.');
  await section.getByLabel('I reviewed units, side, handedness and the selected physical origin conventions.').check();
  for (const ref of ['X1', 'X2', 'X3']) await section.getByLabel(`Registration role ${ref}`, { exact: true }).selectOption('fit');
  await section.getByLabel('Registration role X4', { exact: true }).selectOption('check');
  await expect(section.getByRole('heading', { name: 'Source transform is ready for review' })).toBeVisible();
  await expect(section.getByRole('img', { name: 'Reviewed source coordinate comparison' })).toBeVisible();
  await section.getByRole('button', { name: 'Show before registration', exact: true }).click();
  await expect(section.getByText('Orange: unchanged source origins;', { exact: false })).toBeVisible();
  await section.getByRole('button', { name: 'Show proposed registration', exact: true }).click();
  await section.getByLabel('Alignment reviewer', { exact: true }).fill('Development test; not operator approval');
  await section.getByLabel('Alignment decision reason', { exact: true }).fill('Independent authored coordinates and fourth checkpoint agree; no native changes.');
  await section.getByRole('button', { name: 'Accept source registration', exact: true }).click();
  await expect(section.getByRole('status')).toContainText('Current source decision: accepted');
  const downloading = page.waitForEvent('download'); await section.getByRole('button', { name: 'Download corrected source placement', exact: true }).click();
  const corrected = JSON.parse(await readFile((await (await downloading).path())!, 'utf-8'));
  expect(corrected.placements).toHaveLength(5); expect(corrected.machineExportAllowed).toBe(false); expect(corrected.nativeEditsApplied).toBe(false);
  corrected.placements.forEach((p: { x: number; y: number }, i: number) => { expect(p.x).toBeCloseTo(-positions[i][1] + 21, 8); expect(p.y).toBeCloseTo(positions[i][0] - 4, 8); });
  const saving = page.waitForEvent('download'); await page.getByRole('button', { name: 'Close engineering tools' }).click(); await page.getByRole('button', { name: 'Save project', exact: true }).click();
  const saved = await readFile((await (await saving).path())!); const parsed = JSON.parse(saved.toString());
  expect(parsed.sourceRegistration.decision.choice).toBe('accepted'); expect(parsed.sourceRegistration).not.toHaveProperty('transform');
  expect(parsed.placement.source).toEqual(project.placement.source); expect(parsed.comparisons[0].source).toEqual(project.comparisons[0].source);
  await page.screenshot({ path: testInfo.outputPath('source-registration-reviewed.png'), fullPage: true });
  await page.reload(); await page.goto('/intake');
  await page.getByLabel('Saved placement review file', { exact: true }).setInputFiles({ name: 'reopened.scan-project.json', mimeType: 'application/json', buffer: saved });
  await expect(page.getByRole('status').filter({ hasText: /(?:Project|Review) reopened\./ })).toBeVisible();
  await page.getByRole('navigation', { name: 'SCAN screens' }).getByRole('link', { name: 'Board workspace', exact: true }).click(); await page.getByRole('button',{name:'Engineering tools',exact:true}).click(); await page.getByRole('navigation',{name:'Engineering tool selection'}).getByRole('button',{name:'Source registration',exact:true}).click();
  await expect(section.getByRole('status')).toContainText('Current source decision: accepted');
  await expect(section.getByRole('button', { name: 'Download corrected source placement', exact: true })).toBeEnabled();
  await section.getByLabel('source revision', { exact: true }).fill('2');
  await expect(section.getByRole('button', { name: 'Download corrected source placement', exact: true })).toBeDisabled();
  await expect(section.getByText('Different source revisions:', { exact: false })).toBeVisible();
  expect(errors).toEqual([]); expect(external).toEqual([]);
});
