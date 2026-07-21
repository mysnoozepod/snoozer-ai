const { defineConfig, devices } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests",
  testMatch: ["rest-test-mvp.spec.cjs"],
  timeout: 60_000,
  expect: { timeout: 12_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    channel: "chrome",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node scripts/runPodLayoutPreview.cjs",
    url: "http://127.0.0.1:4173/welcome",
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [{ name: "rest-test", use: { ...devices["Desktop Chrome"] } }],
});
