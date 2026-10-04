import { defineConfig } from "@playwright/test";

const port = process.env.SCAN_PORT ?? "3210";
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  outputDir: process.env.SCAN_EVIDENCE_DIR ?? "test-results",
  reporter: "list",
  use: { baseURL, browserName: "chromium", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
    { name: "laptop", use: { viewport: { width: 1280, height: 800 } } },
    { name: "narrow", use: { viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: "npm run start",
    url: baseURL,
    reuseExistingServer: false,
    env: { NEXT_TELEMETRY_DISABLED: "1", SCAN_PORT: port },
    timeout: 30_000,
  },
});
