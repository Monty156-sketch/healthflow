import { defineConfig } from "@playwright/test";

// Browser tests run against the real Worker (wrangler dev) so the script
// policy, headers and hydration are the ones production serves. Start the
// Worker and the API first; CI does (see .github/workflows/ci.yml).
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:8787",
    launchOptions: { executablePath: process.env.PW_CHROMIUM || undefined, args: ["--no-sandbox"] },
    trace: "retain-on-failure",
  },
});
