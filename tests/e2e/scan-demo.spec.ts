import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

const label = "SYNTHETIC DEMO — NOT REAL JOB ANALYSIS";
const first = "MODULE-A / Top / DEMO-PLACE-A-T-R7";
const control = "MODULE-B / Top / DEMO-PLACE-B-T-R7";

async function capture(page: Page, path: string) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path, fullPage: true, animations: "disabled" });
}

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
  await capture(page, testInfo.outputPath("01-intake.png"));
  await page.getByRole("button", { name: "Open fictional session", exact: true }).click();
  await assertStage(page, "Board Workspace");
  await page.getByRole("button", { name: `Select ${first}`, exact: true }).click();
  await expect(page.getByRole("button", { name: `Select ${first}`, exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: `Select ${control}`, exact: true })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("illustration-DEMO-F001")).toContainText("Selected placement");
  await expect(page.getByTestId("illustration-DEMO-F002")).toContainText("Not selected");
  await capture(page, testInfo.outputPath("02-board.png"));
  await page.getByRole("button", { name: "View selected evidence" }).click();
  await assertStage(page, "Selected Finding / Evidence");
  const evidence = page.getByRole("region", { name: "Selected evidence" });
  await expect(evidence).toContainText("DEMO-PLACE-A-T-R7");
  await expect(evidence).not.toContainText("DEMO-PLACE-B-T-R7");
  await expect(evidence).toContainText("No file was analyzed");
  await capture(page, testInfo.outputPath("03-evidence.png"));
  await page.getByRole("button", { name: "Review fictional proposal" }).click();
  await assertStage(page, "Repair Review / Before–After");
  await expect(page.getByRole("region", { name: "Simulated repair review" })).toContainText("Before · fictional source");
  await expect(page.getByRole("region", { name: "Simulated repair review" })).toContainText("After · proposal only");
  await capture(page, testInfo.outputPath("04-repair.png"));
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
  await capture(page, testInfo.outputPath("05-debug.png"));
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
  await expect(page.getByRole("link", { name: "Real placement intake", exact: true })).toHaveAttribute("href", "/intake");
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

test("demo supports keyboard entry and reduced motion", async ({ page: dashboard }) => {
  await dashboard.goto("/");
  const popup = dashboard.waitForEvent("popup");
  await dashboard.getByRole("link", { name: "Explore synthetic demo" }).click();
  const page = await popup;
  await page.emulateMedia({ reducedMotion: "reduce" });
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

test("presentation controls, downloaded record and restart preserve truthful state", async ({ page, baseURL }, testInfo) => {
  const errors: string[] = [];
  const external: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (new URL(request.url()).origin !== baseURL) external.push(request.url()); });
  await page.goto("/demo");
  const notes = page.getByRole("region", { name: "Presenter notes", exact: true });
  await expect(notes).toContainText("engineering review workspace");
  await page.getByRole("button", { name: "Hide presenter notes" }).click();
  await expect(notes).toBeHidden();
  await expect(page.getByRole("button", { name: "Show presenter notes" })).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: "Show presenter notes" }).click();
  await page.getByRole("button", { name: "Open fictional session" }).click();
  await expect(notes).toContainText("reference designator alone is not enough");
  await page.getByRole("button", { name: "Debug Queue", exact: true }).click();
  const downloadButton = page.getByRole("button", { name: "Download review record (.json)", exact: true });
  await expect(downloadButton).toBeDisabled();
  await expect(page.getByRole("button", { name: "Print review queue" })).toBeDisabled();

  // Deterministic fixture order guides a presentation without auto-accepting any finding.
  for (const [placement, choice] of [[first, "Accept"], [control, "Reject"]]) {
    await page.getByRole("button", { name: "Review next unreviewed finding" }).click();
    const evidence = page.getByRole("region", { name: "Selected evidence" });
    await expect(evidence).toContainText(placement.split(" / ")[2]);
    await page.getByRole("button", { name: "Review fictional proposal" }).click();
    await page.getByRole("button", { name: `Simulate ${choice}`, exact: true }).click();
  }
  await expect(page.getByLabel("Review progress", { exact: true })).toContainText("2 / 3");
  const downloaded = page.waitForEvent("download");
  await downloadButton.click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toMatch(/^SCAN-synthetic-review-.*\.json$/);
  const reportPath = testInfo.outputPath("synthetic-review.json");
  await download.saveAs(reportPath);
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  expect(report.classification).toBe(label);
  expect(report.summary).toEqual({ total: 3, reviewed: 2, simulatedAccepted: 1, simulatedRejected: 1, unreviewed: 1 });
  expect(report.findings.map((item: { identity: { placementId: string }; simulatedDecision: string }) => [item.identity.placementId, item.simulatedDecision])).toEqual([
    ["DEMO-PLACE-A-T-R7", "Accepted"], ["DEMO-PLACE-B-T-R7", "Rejected"], ["DEMO-PLACE-A-B-U3", "Unreviewed"],
  ]);
  expect(report.coverage).toEqual({ represented: 3, enabled: null, taught: null, verified: null, released: null });
  expect(report.source.sourceSha256).toBeNull();
  expect(report.machineJobExport.available).toBe(false);
  await expect(page.getByText("Review record sent to browser downloads.", { exact: false })).toBeVisible();
  await capture(page, testInfo.outputPath("06-review-record.png"));

  // Test the print action without opening an interactive OS print dialog.
  await page.evaluate(() => { window.print = () => { document.documentElement.dataset.printRequested = "true"; }; });
  await page.getByRole("button", { name: "Print review queue" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-print-requested", "true");
  await page.emulateMedia({ media: "print" });
  await expect(notes).toBeHidden();
  await expect(page.getByRole("complementary", { name: "Synthetic demo navigation" })).toBeHidden();
  await expect(page.getByRole("status")).toContainText(label);
  await expect(page.getByRole("article", { name: "Debug item DEMO-DBG001" })).toBeVisible();
  await expect(page.getByText("Machine-job export unavailable", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Released: unknown", { exact: true })).toHaveText("—");
  await expect(page.getByText("Simulated rejected", { exact: true }).last()).toHaveCSS("color", "rgb(17, 17, 17)");
  await expect(page.getByText("Simulated rejected", { exact: true }).last()).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await capture(page, testInfo.outputPath("07-print-queue.png"));
  await page.emulateMedia({ media: "screen" });

  // Completion means three choices, never three verified components.
  await page.getByRole("button", { name: "Review next unreviewed finding" }).click();
  await expect(page.getByRole("region", { name: "Selected evidence" })).toContainText("DEMO-PLACE-A-B-U3");
  await page.getByRole("button", { name: "Review fictional proposal" }).click();
  await page.getByRole("button", { name: "Simulate Accept", exact: true }).click();
  await expect(page.getByRole("button", { name: "Review next unreviewed finding" })).toHaveCount(0);
  await expect(page.getByText("All three fictional findings have a simulated decision.", { exact: false })).toBeVisible();
  await expect(page.getByLabel("Verified: unknown", { exact: true })).toHaveText("—");

  // Returning through browser history cannot resurrect a discarded presentation.
  await page.getByRole("button", { name: "Restart demo", exact: true }).click();
  await assertStage(page, "Open Job / Source Intake");
  await expect(page.getByRole("heading", { name: "Open Job / Source Intake", exact: true })).toBeFocused();
  await page.goBack();
  await assertStage(page, "Open Job / Source Intake");
  await page.getByRole("button", { name: "Open fictional session" }).click();
  await page.getByRole("button", { name: "Selected Finding", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Select a placement first" })).toBeVisible();
  await page.getByRole("button", { name: "Debug Queue", exact: true }).click();
  await expect(page.getByLabel("Review progress", { exact: true })).toContainText("0 / 3");
  await expect(page.getByRole("article", { name: /Debug item/ })).toHaveCount(0);
  await expect(downloadButton).toBeDisabled();
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});

test("a failed download leaves review choices available for retry", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("button", { name: "Open fictional session" }).click();
  await page.getByRole("button", { name: "Debug Queue", exact: true }).click();
  await page.getByRole("button", { name: "Review next unreviewed finding" }).click();
  await page.getByRole("button", { name: "Review fictional proposal" }).click();
  await page.getByRole("button", { name: "Simulate Reject", exact: true }).click();
  await page.evaluate(() => { URL.createObjectURL = () => { throw new Error("Synthetic download failure"); }; });
  await page.getByRole("button", { name: "Download review record (.json)", exact: true }).click();
  await expect(page.getByText("The review record could not be prepared.", { exact: false })).toBeVisible();
  await expect(page.getByRole("article", { name: "Debug item DEMO-DBG001" })).toContainText("Simulated rejected");
  await expect(page.getByRole("button", { name: "Download review record (.json)", exact: true })).toBeEnabled();
});
