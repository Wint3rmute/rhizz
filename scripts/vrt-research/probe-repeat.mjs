#!/usr/bin/env node
// Repeat-load one VRT story and record the state of the Monaco chrome at the
// exact moment the spec would take the screenshot: is the overview-ruler
// canvas painted or blank? Reproduces the flaky race deterministically if the
// race is real, and reports the blank/painted split.
//
// usage: node probe-repeat.mjs [storyId] [theme] [loads]
import { createRequire } from "node:module";

const require = createRequire(new URL("../../web/package.json", import.meta.url));
const { chromium } = require("playwright-core");

const storyId = process.argv[2] ?? "pages-code--default";
const theme = process.argv[3] ?? "light";
const loads = Number(process.argv[4] ?? 10);
const fontconfig = process.env.RHIZZ_VRT_FONTCONFIG_FILE;
if (!fontconfig) {
  console.error("RHIZZ_VRT_FONTCONFIG_FILE unset — run inside `nix develop`");
  process.exit(1);
}
const PORT = 6197;

const server = require("node:child_process").spawn(
  "node",
  ["vrt/serve.ts", "storybook-static", String(PORT)],
  { cwd: new URL("../../web/", import.meta.url).pathname, stdio: "ignore" },
);
await new Promise((r) => setTimeout(r, 1500));

const browser = await chromium.launch({
  env: { ...process.env, FONTCONFIG_FILE: fontconfig },
  args: [
    "--disable-gpu",
    "--disable-gpu-compositing",
    "--use-gl=swiftshader",
    "--force-color-profile=srgb",
    "--font-render-hinting=none",
    "--disable-font-subpixel-positioning",
    "--disable-lcd-text",
    "--disable-partial-raster",
    "--disable-skia-runtime-opts",
  ],
});
const context = await browser.newContext({
  baseURL: `http://127.0.0.1:${PORT}`,
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
  locale: "en-US",
  timezoneId: "UTC",
  colorScheme: theme,
  reducedMotion: "reduce",
});
const page = await context.newPage();

function state() {
  return page.evaluate(() => {
    const rulers = [...document.querySelectorAll("canvas.decorationsOverviewRuler")];
    const scrollbars = [...document.querySelectorAll(".monaco-scrollable-element > .scrollbar")];
    let painted = -1;
    const c = rulers[0];
    if (c) {
      painted = 0;
      const d = c.getContext?.("2d")?.getImageData(0, 0, c.width, c.height).data;
      for (let i = 3; d && i < d.length; i += 4) if (d[i] !== 0) { painted = 1; break; }
    }
    return {
      painted,
      rulerCount: rulers.length,
      faded: scrollbars.every((el) => el.classList.contains("invisible")),
      scrollbarCount: scrollbars.length,
    };
  });
}

let painted = 0;
let blank = 0;
for (let i = 0; i < loads; i++) {
  await page.emulateMedia({ colorScheme: theme });
  await page.goto(
    `/iframe.html?id=${storyId}&viewMode=story&globals=theme:${theme}`,
    { waitUntil: "networkidle" },
  );
  await page.waitForFunction(() => {
    const cls = document.body.classList;
    return cls.contains("sb-show-main");
  });
  await page.waitForFunction(() => {
    const renders = window.__STORYBOOK_PREVIEW__?.storyRenders ?? [];
    return renders.every((r) =>
      ["finished", "completed", "errored", "aborted"].includes(r.phase),
    );
  });
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({
    content: "html, body, #storybook-root { height: 100% !important; }",
  });

  // The spec's waitForMonacoChrome: poll every 100ms up to 5s, silently giving
  // up on timeout.
  await page
    .waitForFunction(
      () => {
        const rulers = [...document.querySelectorAll("canvas.decorationsOverviewRuler")];
        const scrollbars = [...document.querySelectorAll(".monaco-scrollable-element > .scrollbar")];
        const faded = scrollbars.every((el) => el.classList.contains("invisible"));
        const ok = rulers.every((c) => {
          if (c.width === 0 || c.height === 0) return true;
          const d = c.getContext("2d")?.getImageData(0, 0, c.width, c.height).data;
          if (!d) return true;
          for (let j = 3; j < d.length; j += 4) if (d[j] !== 0) return true;
          return false;
        });
        return faded && ok;
      },
      undefined,
      { timeout: 5000, polling: 100 },
    )
    .catch(() => {});

  const s = await state();
  if (s.painted === 1) painted++;
  else blank++;
  console.log(
    `load ${i + 1}/${loads}: painted=${s.painted} rulers=${s.rulerCount} faded=${s.faded} scrollbars=${s.scrollbarCount}`,
  );
}
console.log(`\n${storyId} ${theme}: ${loads} loads — painted ${painted}, blank ${blank}`);
await browser.close();
server.kill();
