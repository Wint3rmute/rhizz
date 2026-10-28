import { copyFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

// Live-app screenshots for the landing/projects scrolling background
// (`src/components/ScrollingBackground.svelte`, consumed by
// `ProjectsPage.svelte`). Four views of the `apollo-11` example, matching the
// previous hand-taken set: modeling+inspector, overview, code editor, explore.
//
// Runs in the standard VRT flow: `just vrt` verifies both the page rendering
// (via `toHaveScreenshot` against `vrt/__screenshots__/backgrounds/*`, with
// the usual 0.02 threshold) and that `src/screenshots/background_N.png` is an
// exact copy of that baseline. `just vrt-accept` (`--update-snapshots=all`)
// refreshes the VRT baseline and mirrors it into `src/screenshots/`.
//
// Light theme only: the committed set is light, and the background component
// blurs + overlays it anyway, so one theme halves the churn.

const APP_URL = "http://127.0.0.1:5199";
const SRC_DIR = resolve(import.meta.dirname, "../src/screenshots");

const BACKGROUNDS = [
  { n: 1, storyId: "backgrounds-background-1", file: "background_1.png" },
  { n: 2, storyId: "backgrounds-background-2", file: "background_2.png" },
  { n: 3, storyId: "backgrounds-background-3", file: "background_3.png" },
  { n: 4, storyId: "backgrounds-background-4", file: "background_4.png" },
] as const;

function annotate(testInfo: TestInfo, storyId: string, n: number): string {
  // Same annotation shape as stories.spec.ts so galleryReporter.ts renders
  // these cards identically (title / storyId / theme / snapshotName).
  const snapshotName = `${storyId}--light`;
  testInfo.annotations.push(
    { type: "story", description: `Backgrounds / background_${n}` },
    { type: "storyId", description: storyId },
    { type: "theme", description: "light" },
  );
  return `${snapshotName}.png`;
}

async function settleThemeEarly(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const apply = () => {
      const root = document.documentElement;
      if (root && !root.getAttribute("data-theme")) {
        root.setAttribute("data-theme", "light");
      }
    };
    apply();
    new MutationObserver(apply).observe(document, { childList: true });
  });
}

// Waits until the page's scrollable size *and* the canvas box stop changing.
// Copied from stories.spec.ts: a canvas story refits itself (`zoomToFill`)
// after a resize, so capturing straight away races that.
async function waitForStableLayout(page: Page): Promise<void> {
  let previous = "";
  let stable = 0;
  for (let attempt = 0; attempt < 20; attempt++) {
    const current = await page.evaluate(() => {
      const root = document.documentElement;
      const svg = document.querySelector("svg");
      const box = svg?.getBoundingClientRect();
      return (
        `${root.scrollWidth}x${root.scrollHeight}:` +
        `${box?.width ?? 0}x${box?.height ?? 0}`
      );
    });
    stable = current === previous ? stable + 1 : 0;
    if (stable >= 2) return;
    previous = current;
    await page.evaluate(() => new Promise(requestAnimationFrame));
  }
}

// Monaco paints scrollbars + overview ruler asynchronously; wait for the
// resting state so captures don't race the fade/repaint. Copied from
// stories.spec.ts (bounded, no-op on pages without an editor).
async function waitForMonacoChrome(page: Page): Promise<void> {
  await page
    .waitForFunction(
      () => {
        const scrollbars = [
          ...document.querySelectorAll(
            ".monaco-scrollable-element > .scrollbar",
          ),
        ];
        const faded = scrollbars.every((el) =>
          el.classList.contains("invisible"),
        );
        const rulersPainted = [
          ...document.querySelectorAll("canvas.decorationsOverviewRuler"),
        ].every((node) => {
          const canvas = node as HTMLCanvasElement;
          if (canvas.width === 0 || canvas.height === 0) return true;
          const data = canvas
            .getContext("2d")
            ?.getImageData(0, 0, canvas.width, canvas.height).data;
          if (!data) return true;
          for (let i = 3; i < data.length; i += 4) {
            if (data[i] !== 0) return true;
          }
          return false;
        });
        return faded && rulersPainted;
      },
      undefined,
      { timeout: 5000, polling: 100 },
    )
    .catch(() => {});
}

// Monaco's text cursor blinks on a JS interval — hide the node so the capture
// can't land mid-blink. Copied from stories.spec.ts.
async function hideBlinkingCursors(page: Page): Promise<void> {
  await page.addStyleTag({
    content: ".monaco-editor .cursor { visibility: hidden !important; }",
  });
}

async function skipTourIfPresent(page: Page): Promise<void> {
  const tourDialog = page.getByRole("alertdialog");
  if (await tourDialog.isVisible()) {
    await tourDialog.getByRole("button", { name: "Skip" }).click();
    await expect(tourDialog).toBeHidden();
  }
}

// Seeds a fresh apollo-11 project through the real UI (same as e2e/helpers'
// createFromExample, but against the VRT app server with an absolute URL).
async function createApollo(page: Page, name: string): Promise<string> {
  await page.goto(`${APP_URL}/`);
  await page.getByRole("button", { name: "Learn by example" }).click();
  page.once("dialog", (dialog) => void dialog.accept(name));
  await page.getByRole("button", { name: /Apollo 11 Mission Stack/ }).click();
  await expect(page).toHaveURL(/\/projects\/.+\/(code|overview)/);
  await skipTourIfPresent(page);
  const id = new URL(page.url()).pathname.split("/")[2];
  if (!id) throw new Error("project id missing from URL");
  return id;
}

async function stabilise(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await waitForStableLayout(page);
  await waitForMonacoChrome(page);
  await hideBlinkingCursors(page);
}

// After toHaveScreenshot verifies/updates the VRT baseline, keep
// src/screenshots/ in sync: on --update-snapshots mirror baseline -> src,
// otherwise fail when src has drifted from baseline.
async function syncSrc(
  testInfo: TestInfo,
  snapshotFile: string,
  srcFile: string,
): Promise<void> {
  const baselinePath = testInfo.snapshotPath(snapshotFile);
  const targetPath = resolve(SRC_DIR, srcFile);
  if (testInfo.config.updateSnapshots === "all") {
    await copyFile(baselinePath, targetPath);
  } else {
    const [baseline, current] = await Promise.all([
      readFile(baselinePath),
      readFile(targetPath),
    ]);
    expect(
      baseline.equals(current),
      `${srcFile} outdated — run just vrt-accept`,
    ).toBe(true);
  }
}

test("backgrounds background_1 light", async ({ page }, testInfo) => {
  const snapshotFile = annotate(testInfo, BACKGROUNDS[0].storyId, 1);
  await page.emulateMedia({ colorScheme: "light" });
  await settleThemeEarly(page);
  const id = await createApollo(page, "VRT backgrounds apollo 1");
  await page.goto(`${APP_URL}/projects/${id}/modeling`);
  await expect(page.getByTestId("diagram-canvas")).toBeVisible();
  await expect(page.getByTestId("diagram-toolbar")).toBeVisible();
  // Open the inspector via the Components tree (unified selection updates the
  // inspector; a canvas-SVG text click is click-position sensitive).
  const right = page.getByTestId("modeling-pane-right");
  await expect(right).toBeVisible();
  await right.getByRole("button", { name: "lm-descent" }).first().click();
  await expect(page.getByTestId("node-inspector")).toBeVisible();
  await stabilise(page);
  await expect(page).toHaveScreenshot(snapshotFile, { fullPage: true });
  await syncSrc(testInfo, snapshotFile, BACKGROUNDS[0].file);
});

test("backgrounds background_2 light", async ({ page }, testInfo) => {
  const snapshotFile = annotate(testInfo, BACKGROUNDS[1].storyId, 2);
  await page.emulateMedia({ colorScheme: "light" });
  await settleThemeEarly(page);
  const id = await createApollo(page, "VRT backgrounds apollo 2");
  await page.goto(`${APP_URL}/projects/${id}/overview`);
  await expect(page.getByText(/Completion Breakdown/)).toBeVisible();
  await expect(page.getByText(/Model fully specified/)).toBeVisible();
  await stabilise(page);
  await expect(page).toHaveScreenshot(snapshotFile, { fullPage: true });
  await syncSrc(testInfo, snapshotFile, BACKGROUNDS[1].file);
});

test("backgrounds background_3 light", async ({ page }, testInfo) => {
  const snapshotFile = annotate(testInfo, BACKGROUNDS[2].storyId, 3);
  await page.emulateMedia({ colorScheme: "light" });
  await settleThemeEarly(page);
  const id = await createApollo(page, "VRT backgrounds apollo 3");
  await page.goto(`${APP_URL}/projects/${id}/code`);
  await expect(page.locator(".monaco-editor").first()).toBeVisible();
  const files = page.getByTestId("code-pane-left");
  await expect(files).toBeVisible();
  // Show a view file, as in the previous set (diagrams/main.hcl).
  const main = files.getByText("main.hcl").first();
  if (await main.isVisible()) await main.click();
  await stabilise(page);
  await expect(page).toHaveScreenshot(snapshotFile, { fullPage: true });
  await syncSrc(testInfo, snapshotFile, BACKGROUNDS[2].file);
});

test("backgrounds background_4 light", async ({ page }, testInfo) => {
  const snapshotFile = annotate(testInfo, BACKGROUNDS[3].storyId, 4);
  await page.emulateMedia({ colorScheme: "light" });
  await settleThemeEarly(page);
  const id = await createApollo(page, "VRT backgrounds apollo 4");
  await page.goto(`${APP_URL}/projects/${id}/explore`);
  const sidebar = page.getByRole("complementary", { name: "Diagrams" });
  await expect(sidebar).toBeVisible();
  await expect(page.locator("svg").first()).toBeVisible();
  await stabilise(page);
  await expect(page).toHaveScreenshot(snapshotFile, { fullPage: true });
  await syncSrc(testInfo, snapshotFile, BACKGROUNDS[3].file);
});
