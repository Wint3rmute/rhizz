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

      await expect(page).toHaveScreenshot(`${story.id}--${theme}.png`, {
        fullPage: true,
      });
    });
  }
}
