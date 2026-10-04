import { expect, test, type Page } from "@playwright/test";

const label = "SYNTHETIC DEMO — NOT REAL JOB ANALYSIS";
const first = "MODULE-A / Top / DEMO-PLACE-A-T-R7";
const control = "MODULE-B / Top / DEMO-PLACE-B-T-R7";

async function assertStage(page: Page, heading: string) {
  await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  await expect(page.getByRole("status")).toContainText(label);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test("fictional walkthrough keeps duplicate RefDes decisions independent", async ({ page, baseURL }, testInfo) => {
  const errors: string[] = [];
  const external: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("request", request => { if (new URL(request.url()).origin !== baseURL) external.push(request.url()); });
  await page.goto("/demo");
  await assertStage(page, "Open Job / Source Intake");
  await expect(page.getByRole("button", { name: "Open Job (live)" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Analyze", exact: true })).toBeDisabled();
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("01-intake.png"), fullPage: true });
  await page.getByRole("button", { name: "Open fictional session", exact: true }).click();
  await assertStage(page, "Board Workspace");
  await page.getByRole("button", { name: `Select ${first}`, exact: true }).click();
  await expect(page.getByRole("button", { name: `Select ${first}`, exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: `Select ${control}`, exact: true })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("illustration-DEMO-F001")).toContainText("Selected placement");
  await expect(page.getByTestId("illustration-DEMO-F002")).toContainText("Not selected");
  await page.screenshot({ path: testInfo.outputPath("02-board.png"), fullPage: true });
  await page.getByRole("button", { name: "View selected evidence" }).click();
  await assertStage(page, "Selected Finding / Evidence");
  const evidence = page.getByRole("region", { name: "Selected evidence" });
  await expect(evidence).toContainText("DEMO-PLACE-A-T-R7");
  await expect(evidence).not.toContainText("DEMO-PLACE-B-T-R7");
  await expect(evidence).toContainText("No file was analyzed");
  await page.screenshot({ path: testInfo.outputPath("03-evidence.png"), fullPage: true });
  await page.getByRole("button", { name: "Review fictional proposal" }).click();
  await assertStage(page, "Repair Review / Before–After");
  await expect(page.getByRole("region", { name: "Simulated repair review" })).toContainText("Before · fictional source");
  await expect(page.getByRole("region", { name: "Simulated repair review" })).toContainText("After · proposal only");
  await page.screenshot({ path: testInfo.outputPath("04-repair.png"), fullPage: true });
  await page.getByRole("button", { name: "Simulate Accept", exact: true }).click();
  await assertStage(page, "Debug Queue / Export status");
  const firstItem = page.getByRole("article", { name: "Debug item DEMO-DBG001" });
  await expect(firstItem).toContainText("DEMO-PLACE-A-T-R7");
  await expect(firstItem).toContainText("Simulated accepted");
  await expect(firstItem).not.toContainText("DEMO-PLACE-B-T-R7");
  await page.getByRole("button", { name: "Review another fictional finding" }).click();
  await page.getByRole("button", { name: `Select ${control}`, exact: true }).click();
  await expect(page.getByRole("button", { name: `Select ${first}`, exact: true })).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "View selected evidence" }).click();
  await expect(evidence).toContainText("DEMO-PLACE-B-T-R7");
  await expect(evidence).not.toContainText("DEMO-PLACE-A-T-R7");
  await page.getByRole("button", { name: "Review fictional proposal" }).click();
  await expect(page.getByRole("region", { name: "Simulated repair review" })).toContainText("Current decision: unreviewed");
  await page.getByRole("button", { name: "Simulate Reject", exact: true }).click();
  const controlItem = page.getByRole("article", { name: "Debug item DEMO-DBG002" });
  await expect(controlItem).toContainText("DEMO-PLACE-B-T-R7");
  await expect(controlItem).toContainText("Simulated rejected");
  await expect(firstItem).toContainText("Simulated accepted");
  await expect(page.getByRole("article", { name: /Debug item/ })).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Export machine job", exact: true })).toBeDisabled();
  await expect(page.getByText("No captured source, qualified writer", { exact: false })).toBeVisible();
  for (const state of ["Enabled", "Taught", "Verified", "Released"]) {
    await expect(page.getByLabel(`${state}: unknown`, { exact: true })).toHaveText("—");
  }
  await page.screenshot({ path: testInfo.outputPath("05-debug.png"), fullPage: true });
  await page.getByRole("button", { name: "Revisit DEMO-DBG001" }).click();
  await expect(page.getByRole("region", { name: "Simulated repair review" })).toContainText("DEMO-PLACE-A-T-R7");
  await expect(page.getByRole("region", { name: "Simulated repair review" })).toContainText("Review note: absent");
  await page.getByRole("button", { name: "Simulate Reject", exact: true }).click();
  await expect(firstItem).toContainText("Simulated rejected");
  await expect(page.getByRole("article", { name: /Debug item/ })).toHaveCount(2);
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});

test("navigation, bottom-side identity and refresh reset remain truthful", async ({ page }) => {
  await page.goto("/demo#repair");
  await assertStage(page, "Open Job / Source Intake");
  await expect(page.getByRole("button", { name: "Repair Review", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Open fictional session" }).click();
  await page.getByRole("button", { name: "Selected Finding", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Select a placement first" })).toBeVisible();
  await page.getByRole("button", { name: "Debug Queue", exact: true }).click();
  await expect(page.getByText("No simulated decisions yet.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export machine job", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Board Workspace", exact: true }).click();
  await page.getByRole("button", { name: "Select MODULE-A / Bottom / DEMO-PLACE-A-B-U3", exact: true }).click();
  await page.getByRole("button", { name: "View selected evidence" }).click();
  await expect(page.getByRole("region", { name: "Selected evidence" })).toContainText("DEMO-PLACE-A-B-U3");
  await expect(page.getByRole("region", { name: "Selected evidence" })).toContainText("Bottom");
  await page.goBack();
  await assertStage(page, "Board Workspace");
  await expect(page.getByRole("button", { name: "Select MODULE-A / Bottom / DEMO-PLACE-A-B-U3", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.goForward();
  await assertStage(page, "Selected Finding / Evidence");
  await page.getByRole("button", { name: "Review fictional proposal" }).click();
  await page.getByRole("button", { name: "Simulate Accept", exact: true }).click();
  await expect(page.getByRole("article", { name: "Debug item DEMO-DBG003" })).toContainText("DEMO-PLACE-A-B-U3");
  await expect(page.getByRole("status")).toContainText("Decisions reset on refresh");
  await page.reload();
  await assertStage(page, "Open Job / Source Intake");
  await expect(page.getByRole("button", { name: "Open fictional session" })).toBeVisible();
  await page.getByRole("button", { name: "Open fictional session" }).click();
  await page.getByRole("button", { name: "Debug Queue", exact: true }).click();
  await expect(page.getByRole("article", { name: /Debug item/ })).toHaveCount(0);
});

test("demo supports keyboard entry and reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByRole("link", { name: "Explore synthetic demo" }).click();
  await assertStage(page, "Open Job / Source Intake");
  // Step headings receive focus after navigation; Tab reaches the primary action.
  await page.keyboard.press("Tab");
  const open = page.getByRole("button", { name: "Open fictional session", exact: true });
  await expect(open).toBeFocused();
  await expect(open).toHaveCSS("outline-style", "solid");
  await expect(open).toHaveCSS("transition-duration", "0s");
  await page.keyboard.press("Enter");
  await assertStage(page, "Board Workspace");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: `Select ${first}`, exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: `Select ${first}`, exact: true })).toHaveAttribute("aria-pressed", "true");
});
