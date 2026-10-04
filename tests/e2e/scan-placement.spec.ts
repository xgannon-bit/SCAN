import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

// Authored records, generated in memory; no private source or saved workbook fixture.
const makeXlsx = () => {
  const python = process.env.SCAN_PYTHON || path.join(process.cwd(), '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const generated = spawnSync(python, ['-c', 'import io,sys; from openpyxl import Workbook; w=Workbook(); s=w.active; s.append(["R7","FICTIONAL",None,"1.25,-2","Top",90,"SYNTHETIC"]); s.append(["R7","OTHER-FICTIONAL",None,"0,0","Bottom",0,"SYNTHETIC"]); b=io.BytesIO(); w.save(b); sys.stdout.buffer.write(b.getvalue())']);
  if (generated.status !== 0) throw new Error('Synthetic workbook generation failed');
  return generated.stdout;
};

test('real XLSX upload, mapping, holds, conversion, download and clear', async ({ page, baseURL }, testInfo) => {
  const errors: string[] = [], external: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', request => { if (new URL(request.url()).origin !== baseURL) external.push(request.url()); });
  await page.goto('/intake');
  await page.getByLabel('Placement file').setInputFiles({ name: 'fictional.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: makeXlsx() });
  await page.getByRole('button', { name: 'Read file', exact: true }).click();
  await expect(page.getByText('2 source rows')).toBeVisible();
  await page.getByLabel('Module for this sheet').fill('Fictional-A');
  await page.getByRole('button', { name: 'Validate placements' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Placement review needs attention' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save placement record (JSON)' })).toBeDisabled();
  await expect(page.getByText('Confirm placement units before coordinate conversion.')).toBeVisible();
  await page.getByLabel('Placement units').selectOption('inch');
  await expect(page.getByRole('heading', { name: '3. Placement review' })).toHaveCount(0);
  await page.getByLabel('Source rotation direction').selectOption('cw');
  await page.getByRole('button', { name: 'Validate placements' }).click();
  await expect(page.getByText('Placement parsing complete')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export Eagle/Athena job' })).toBeDisabled();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save placement record (JSON)' }).click();
  const downloaded = await downloadPromise;
  const result = JSON.parse(await readFile((await downloaded.path())!, 'utf8'));
  expect(result.counts.parsed).toBe(2);
  expect(result.placements[0].xMm).toBe('31.750');
  expect(result.placements[0].rotationCcwDegrees).toBe('270');
  expect(result.placements[1].side).toBe('Bottom');
  expect(result.placements[1].xMm).toBe('0.0');
  expect(result.coverage.taught).toBeNull();
  expect(result.machineExportAllowed).toBe(false);
  expect(result.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('placement-review.png'), fullPage: true });
  await page.getByRole('button', { name: 'Clear file' }).click();
  await expect(page.getByRole('heading', { name: '3. Placement review' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Read file', exact: true })).toBeDisabled();
  expect(errors).toEqual([]); expect(external).toEqual([]);
});

test('CSV row error cannot become a complete placement download', async ({ page }) => {
  await page.goto('/intake');
  await page.getByLabel('Placement file').setInputFiles({ name: 'fictional.csv', mimeType: 'text/csv', buffer: Buffer.from('R7,P,,"1,2",Top,90,SYNTHETIC\nR8,P,,bad,Top,0,SYNTHETIC\n') });
  await page.getByRole('button', { name: 'Read file', exact: true }).click();
  await page.getByLabel('Module for this sheet').fill('Fictional-A');
  await page.getByLabel('Placement units').selectOption('mm');
  await page.getByLabel('Source rotation direction').selectOption('ccw');
  await page.getByRole('button', { name: 'Validate placements' }).click();
  await expect(page.getByText(/1 parsed · 1 errors/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save placement record (JSON)' })).toBeDisabled();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Read file', exact: true })).toBeDisabled();
});

test('HTTP refuses cross-origin, absent origin, and oversized uploads', async ({ request, baseURL }) => {
  for (const origin of [undefined, 'https://example.invalid']) {
    const response = await request.post('/api/placements', { headers: origin ? { Origin: origin } : {}, data: 'not read' });
    expect(response.status()).toBe(403);
  }
  const tooLarge = await request.post('/api/placements', { headers: { Origin: baseURL!, 'Content-Type': 'multipart/form-data; boundary=x' }, data: Buffer.alloc(8_030_001) });
  expect(tooLarge.status()).toBe(413);
});
