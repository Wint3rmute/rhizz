import { defineConfig } from "@playwright/test";

// Visual regression tests: a full-page screenshot of every Storybook story in
// both themes, compared against committed baselines in vrt/__screenshots__/.
// Deliberately separate from playwright.config.ts so `just test` (and CI)
// are unaffected — run via `just vrt` / `just vrt-accept`.
const PORT = 6199;

export default defineConfig({
  testDir: "./vrt",
  outputDir: "./test-results/vrt",
  snapshotPathTemplate: "{testDir}/__screenshots__/{arg}{ext}",
  retries: 0,
  fullyParallel: true,
  reporter: [
    ["list"],
    ["./vrt/galleryReporter.ts", { outputDir: "vrt-report" }],
  ],
  expect: {
    toHaveScreenshot: {
      animations: "disabled",
      // Playwright's default per-pixel colour tolerance (0.2) ignores subtle
      // but real changes, e.g. a card background shifting grey -> navy.
      // Rendering here is deterministic, so compare near-exactly.
      threshold: 0.02,
      caret: "hide",
      scale: "css",
    },
  },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    locale: "en-US",
    timezoneId: "UTC",
    colorScheme: "dark",
    reducedMotion: "reduce",
  },
  webServer: {
    command:
      `deno run --allow-net --allow-read vrt/serve.ts storybook-static ${PORT}`,
    url: `http://127.0.0.1:${PORT}/iframe.html`,
    reuseExistingServer: true,
  },
});
