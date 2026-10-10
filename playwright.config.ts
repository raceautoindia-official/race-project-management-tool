import { defineConfig } from "@playwright/test";

// End-to-end tests: real browser → production build → throwaway MySQL.
// Run with `npm run test:e2e` (builds first). See e2e/global-setup.ts.
const port = Number(process.env.E2E_PORT ?? 3210);
// Uses the installed Google Chrome by default; set E2E_BROWSER_CHANNEL= (empty)
// to use Playwright's bundled Chromium (`npx playwright install chromium`).
const channel = process.env.E2E_BROWSER_CHANNEL ?? "chrome";

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  // One app + one database shared by all specs, so run them in order.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  outputDir: "test-results/e2e",
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: `http://localhost:${port}`,
    ...(channel ? { channel } : {}),
    viewport: { width: 1280, height: 900 },
    acceptDownloads: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
