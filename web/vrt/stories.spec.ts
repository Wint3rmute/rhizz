import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";

// One full-page screenshot per Storybook story per theme. The story list
// comes from the static build's index.json, so every new story is covered
// automatically. Opt a story out with `tags: ["no-vrt"]`.

interface IndexEntry {
  type: "story" | "docs";
  id: string;
  title: string;
  name: string;
  tags?: string[];
}

const THEMES = ["dark", "light"] as const;
const INDEX = resolve(import.meta.dirname, "../storybook-static/index.json");

function loadStories(): IndexEntry[] {
  let raw: string;
  try {
    raw = readFileSync(INDEX, "utf8");
  } catch {
    throw new Error(
      `${INDEX} not found — build Storybook first (\`just vrt\` does this)`,
    );
  }
  const index = JSON.parse(raw) as { entries: Record<string, IndexEntry> };
  return Object.values(index.entries).filter(
    (e) => e.type === "story" && !(e.tags ?? []).includes("no-vrt"),
  );
}

type RenderPhase = string | undefined;

// Storybook's MINIMAL_VIEWPORTS (storybook/viewport). Stories pick one via
// `globals.viewport.value` or `parameters.viewport.defaultViewport`; that is
// only applied by the Storybook manager UI, so the test resizes itself.
const VIEWPORTS: Record<string, { width: number; height: number }> = {
  mobile1: { width: 320, height: 568 },
  mobile2: { width: 414, height: 896 },
  tablet: { width: 834, height: 1112 },
  desktop: { width: 1280, height: 1024 },
};

async function waitForStory(page: Page): Promise<void> {
  const shown = await page.waitForFunction(() => {
    const cls = document.body.classList;
    if (cls.contains("sb-show-errordisplay")) return "error";
    return cls.contains("sb-show-main") ? "main" : false;
  });
  expect(await shown.jsonValue(), "story rendered without error").toBe(
    "main",
  );
  // Play functions run after the first render; wait for every story render
  // to reach a terminal phase ("finished" in Storybook 10).
  await page.waitForFunction(() => {
    const renders = (window as unknown as {
      __STORYBOOK_PREVIEW__?: { storyRenders?: { phase?: RenderPhase }[] };
    }).__STORYBOOK_PREVIEW__?.storyRenders ?? [];
    const done = ["finished", "completed", "errored", "aborted"];
    return renders.every((r) => r.phase && done.includes(r.phase));
  });
  await page.evaluate(() => document.fonts.ready);
}

// Gives the story a definite, viewport-sized height — the same box the app
// shell hands a page. Without it the whole ancestor chain above a story is
// auto-height, and a canvas SVG sized `width:100%; height:100%` falls back to
// its *intrinsic aspect ratio* (an `h-full` with no definite parent means
// `auto`), so the document grows to the SVG's ratio-driven height instead of
// the viewport's.
//
// That made `fullPage: true` self-referential: capturing resizes the viewport
// to the document height, the page re-lays out, and the document height
// changes again — so the same story settled on a different size depending on
// timing (1280×960 vs the 1280×1280 the baselines happened to capture) and
// failed with "expected 1280×1280, received 1280×960". With a definite height
// the document is exactly the viewport, `fullPage` is the viewport, and a
// genuinely long page still expands and is captured in full.
//
// `!important` because this has to win against Storybook's own preview CSS,
// not because the value is contentious.
async function pinViewportHeight(page: Page): Promise<void> {
  await page.addStyleTag({
    content: "html, body, #storybook-root { height: 100% !important; }",
  });
}

// Waits until the page's scrollable size *and* the canvas box stop changing.
// Pinning the height re-lays out the page, and a canvas story refits itself
// (`zoomToFill`) to the new box, so capturing straight away would race that —
// two consecutive identical samples, a frame apart, is enough; the loop is
// bounded so a permanently animating story still gets captured.
async function waitForStableLayout(page: Page): Promise<void> {
  let previous = "";
  let stable = 0;
  for (let attempt = 0; attempt < 20; attempt++) {
    const current = await page.evaluate(() => {
      const root = document.documentElement;
      const svg = document.querySelector("svg");
      const box = svg?.getBoundingClientRect();
      return `${root.scrollWidth}x${root.scrollHeight}:` +
        `${box?.width ?? 0}x${box?.height ?? 0}`;
    });
    stable = current === previous ? stable + 1 : 0;
    if (stable >= 2) return;
    previous = current;
    await page.evaluate(() => new Promise(requestAnimationFrame));
  }
}

async function storyViewport(page: Page): Promise<string | undefined> {
  return page.evaluate(() => {
    const story = (window as unknown as {
      __STORYBOOK_PREVIEW__?: {
        currentRender?: {
          story?: {
            storyGlobals?: { viewport?: { value?: string } };
            parameters?: { viewport?: { defaultViewport?: string } };
          };
        };
      };
    }).__STORYBOOK_PREVIEW__?.currentRender?.story;
    return story?.storyGlobals?.viewport?.value ??
      story?.parameters?.viewport?.defaultViewport;
  });
}

for (const story of loadStories()) {
  for (const theme of THEMES) {
    // Title format is relied on by galleryReporter.ts and `just vrt-accept`.
    test(`${story.id} ${theme}`, async ({ page }, testInfo) => {
      testInfo.annotations.push(
        { type: "story", description: `${story.title} / ${story.name}` },
        { type: "storyId", description: story.id },
        { type: "theme", description: theme },
      );

      await page.emulateMedia({ colorScheme: theme });
      await page.goto(
        `/iframe.html?id=${story.id}&viewMode=story&globals=theme:${theme}`,
        { waitUntil: "networkidle" },
      );
      await waitForStory(page);

      const viewport = await storyViewport(page);
      const size = viewport ? VIEWPORTS[viewport] : undefined;
      if (size) {
        // Reload so layouts measured on mount see the final size.
        await page.setViewportSize(size);
        await page.reload({ waitUntil: "networkidle" });
        await waitForStory(page);
      }
      testInfo.annotations.push({
        type: "viewport",
        description: size
          ? `${viewport ?? ""} ${size.width}×${size.height}`
          : "default 1280×800",
      });

      await pinViewportHeight(page);
      await waitForStableLayout(page);

      await expect(page).toHaveScreenshot(`${story.id}--${theme}.png`, {
        fullPage: true,
      });
    });
  }
}
