import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// Entirely invented source, no Eagle/production compatibility claim.
const pcb = Buffer.from(`ACCEL_ASCII "invented"
(asciiHeader(asciiVersion 3 0)(fileUnits mm))
(library(padStyleDef "rect"(holeDiam 0)(padShape(layerNumRef 1)(padShapeType Rect)(shapeWidth .8)(shapeHeight .4)))
(patternDefExtended "fictional"(patternGraphicsDef(patternGraphicsNameDef "primary")(multiLayer
(pad(padNum 1)(padStyleRef "rect")(pt -1 .5)(rotation 90))
(pad(padNum 2)(padStyleRef "rect")(pt 3 .5)(rotation 90))))))
(netlist(compInst "F7"(compRef "authored")))
(pcbDesign "invented"(multiLayer(pattern(patternRef "fictional")(patternGraphicsNameRef "primary")(refDesRef "F7")(pt 10 20)(rotation 0))))`);

test('source family review is connected, held and recomputed after project reopen', async ({ page, baseURL }, info) => {
  const errors: string[] = [], external: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { if (new URL(r.url()).origin !== baseURL) external.push(r.url()); });
  await page.goto('/intake');
  await page.getByLabel('Source layout (.pcb)').setInputFiles({ name: 'invented.pcb', mimeType: 'text/plain', buffer: pcb });
  await page.getByRole('button', { name: 'Read source layout', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '1 source placements' })).toBeVisible();
  await page.getByRole('navigation', { name: 'SCAN screens' }).getByRole('link', { name: 'Source findings', exact: true }).click();
  const region = page.getByRole('region', { name: 'Disabled draft preparation' });
  await region.getByText('two pad rectangular source family · 1 references', { exact: true }).click();
  await region.getByText('F7 · source family review', { exact: true }).click();
  await expect(region).toContainText('Explicit source layer 1');
  await expect(region).toContainText('candidate history and candidate accounting');
  await expect(region).toContainText('90°');
  const pendingReview = page.waitForEvent('download');
  await region.getByRole('button', { name: 'Download draft preparation review' }).click();
  const before = JSON.parse(await readFile((await (await pendingReview).path())!, 'utf8'));
  expect(before.recipes[0].status).toBe('held');
  expect(before.recipes[0].nativeRecordsCreated).toBe(0);
  const pendingProject = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save project', exact: true }).click();
  const saved = await readFile((await (await pendingProject).path())!);
  await page.reload();
  await page.getByLabel('Saved placement review file', { exact: true }).setInputFiles({ name: 'invented.scan-project.json', mimeType: 'application/json', buffer: saved });
  await expect(page.getByRole('status').filter({ hasText: 'Review reopened.' })).toBeVisible();
  const pendingAfter = page.waitForEvent('download');
  await region.getByRole('button', { name: 'Download draft preparation review' }).click();
  expect(JSON.parse(await readFile((await (await pendingAfter).path())!, 'utf8'))).toEqual(before);
  await region.getByText('two pad rectangular source family · 1 references', { exact: true }).click();
  await region.getByText('F7 · source family review', { exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('draft-review.png'), fullPage: true });
  expect(errors).toEqual([]); expect(external).toEqual([]);
});
