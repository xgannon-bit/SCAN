import { expect, test } from "@playwright/test";

test("foundation: truthful capabilities, primitives, focus and loopback assets", async ({ page, browser, baseURL }, testInfo) => {
  const errors: string[] = [];
  const external: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("request", request => {
    if (new URL(request.url()).origin !== baseURL) external.push(request.url());
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "No job loaded" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Native job analysis is not implemented");
  await expect(page.getByRole("link", { name: "Open placement intake" })).toHaveAttribute("href", "/intake");
  for (const name of ["Open Job", "Analyze", "Export machine job"]) {
    await expect(page.getByRole("button", { name, exact: true })).toBeDisabled();
  }
  const states = page.getByRole("region", { name: "Coverage states" });
  for (const label of ["Represented", "Enabled", "Taught", "Verified", "Released"]) {
    await expect(states.getByLabel(`${label}: unknown`, { exact: true })).toHaveText("—");
  }
  await expect(page.locator('[data-slot="separator"]')).toHaveCSS("height", "1px");
  await expect(page.locator('[data-slot="badge"]').first()).toHaveCSS("display", "flex");
  await expect(page.getByRole("button", { name: "Open Job", exact: true })).toHaveCSS("background-color", "rgb(56, 189, 248)");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Jobs", exact: true })).toBeFocused();
  await expect(page.getByRole("button", { name: "Jobs", exact: true })).toHaveCSS("outline-style", "solid");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Capability details" })).toBeFocused();
  await expect(page.locator('[data-slot="tooltip-content"]')).toContainText("machine-job export are unavailable");
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-slot="tooltip-content"]')).not.toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.evaluate(() => document.fonts.size)).toBe(0);
  await page.screenshot({ path: testInfo.outputPath("foundation.png"), fullPage: true });
  await testInfo.attach("browser-version", { body: browser.version(), contentType: "text/plain" });
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});

test("foundation respects reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Jobs", exact: true })).toHaveCSS("transition-duration", "0s");
  await page.getByRole("button", { name: "Capability details" }).focus();
  await expect(page.locator('[data-slot="tooltip-content"]')).toHaveCSS("animation-duration", "0s");
});
