import { defineConfig, devices } from "@playwright/test";

const PHASE = process.env.TOUR_PHASE || "before";

export default defineConfig({
  testDir: ".",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  outputDir: `artifacts/${PHASE}/_pw`,
  use: {
    baseURL: "http://localhost:5173",
    video: { mode: "on", size: { width: 1280, height: 800 } },
    trace: "off",
    screenshot: "off",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: {
    command: "pnpm --filter @trs/web dev",
    url: "http://localhost:5173",
    reuseExistingServer: true,
    timeout: 60_000,
    stdout: "ignore",
    stderr: "pipe",
  },
  reporter: [["list"]],
});
