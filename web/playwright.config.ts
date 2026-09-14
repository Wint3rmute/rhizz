import { defineConfig } from "@playwright/test";

// Bootstrap end-to-end config: real Chromium (provided by the flake via
// PLAYWRIGHT_BROWSERS_PATH, version-matched to the `playwright` npm
// package), app served by `vite dev`. Traces on first retry give the
// step-by-step visibility (screenshots, DOM, console) that motivated this.
// Video is always on: every spec emits a `.webm` under `test-results/`,
// uploaded as a CI artifact for direct viewing (the HTML report embeds it
// too). Local runs stay gitignored (see web/.gitignore).
export default defineConfig({
  testDir: "./e2e",
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["html", { open: "never" }], ["list"]] : "list",
  use: {
    baseURL: "http://localhost:5199",
    trace: "on-first-retry",
    video: "on",
  },
  webServer: {
    command: "npx vite dev --port 5199",
    url: "http://localhost:5199",
    reuseExistingServer: !process.env.CI,
  },
});
