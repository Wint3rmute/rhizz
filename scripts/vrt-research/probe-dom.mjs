#!/usr/bin/env node
// Load one VRT story in the pinned Chromium and dump the DOM state of the
// Monaco chrome we see in the flaky diffs (right edge, x>=1266): which
// element is under those points, its box/classes, and a time series of
// scrollbar `.invisible` + overview-ruler canvas states.
//
// usage: node probe-dom.mjs [storyId] [theme]
// Requires: nix devshell (PLAYWRIGHT_BROWSERS_PATH, RHIZZ_VRT_FONTCONFIG_FILE),
// web/storybook-static (already built), and Node's playwright resolved from web/.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(new URL("../../web/package.json", import.meta.url));
const { chromium } = require("playwright-core");

const storyId = process.argv[2] ?? "pages-code--default";
const theme = process.argv[3] ?? "light";
const fontconfig = process.env.RHIZZ_VRT_FONTCONFIG_FILE;
if (!fontconfig) {
  console.error("RHIZZ_VRT_FONTCONFIG_FILE unset — run inside `nix develop`");
  process.exit(1);
}

const PORT = 6198;

async function main() {
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

  // Everything the spec does before the screenshot, minus the capture itself.
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
    const renders =
      window.__STORYBOOK_PREVIEW__?.storyRenders ?? [];
    return renders.every((r) =>
      ["finished", "completed", "errored", "aborted"].includes(r.phase),
    );
  });
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({
    content: "html, body, #storybook-root { height: 100% !important; }",
  });

  const probe = () =>
    page.evaluate(() => {
      const out = { points: [], scrollbars: [], rulers: [], editor: {} };
      for (const [x, y] of [
        [1272, 45],
        [1272, 400],
        [1267, 50],
        [1266, 400],
      ]) {
        const el = document.elementFromPoint(x, y);
        out.points.push({
          x,
          y,
          tag: el?.tagName,
          cls: el?.className?.toString?.().slice(0, 80),
          box: el?.getBoundingClientRect
            ? (({ x, y, width, height }) => ({ x, y, w: width, h: height }))(
                el.getBoundingClientRect(),
              )
            : null,
        });
      }
      for (const el of document.querySelectorAll(
        ".monaco-scrollable-element > .scrollbar",
      )) {
        const r = el.getBoundingClientRect();
        out.scrollbars.push({
          cls: el.className,
          vertical: el.className.includes("vertical"),
          box: { x: r.x, y: r.y, w: r.width, h: r.height },
          opacity: getComputedStyle(el).opacity,
          visibility: getComputedStyle(el).visibility,
        });
      }
      for (const c of document.querySelectorAll(
        "canvas.decorationsOverviewRuler",
      )) {
        const ctx = c.getContext("2d");
        let opaque = -1;
        try {
          const d = ctx.getImageData(0, 0, c.width, c.height).data;
          opaque = 0;
          for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) { opaque = 1; break; }
        } catch {}
        out.rulers.push({
          w: c.width,
          h: c.height,
          box: (({ x, y, width, height }) => ({ x, y, w: width, h: height }))(
            c.getBoundingClientRect(),
          ),
          painted: opaque,
        });
      }
      const ed = document.querySelector(".monaco-editor");
      if (ed) {
        const r = ed.getBoundingClientRect();
        out.editor = { box: { x: r.x, y: r.y, w: r.width, h: r.height } };
      }
      return out;
    });

  const waitState = () =>
    page.evaluate(() => {
      const scrollbars = [
        ...document.querySelectorAll(".monaco-scrollable-element > .scrollbar"),
      ];
      const rulers = [
        ...document.querySelectorAll("canvas.decorationsOverviewRuler"),
      ];
      const faded = scrollbars.every((el) => el.classList.contains("invisible"));
      const painted = rulers.every((c) => {
        if (c.width === 0 || c.height === 0) return true;
        const d = c.getContext("2d")?.getImageData(0, 0, c.width, c.height).data;
        if (!d) return true;
        for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) return true;
        return false;
      });
      return { faded, painted };
    });

  // Time series: like the spec's wait, then keep sampling to catch the race.
  console.log(`== probe ${storyId} ${theme} ==`);
  for (let i = 0; i < 40; i++) {
    const t = Date.now() % 100000;
    const st = await waitState();
    const full = await probe();
    const sb = full.scrollbars[0];
    const ru = full.rulers[0];
    console.log(
      `t=${t} faded=${st.faded} painted=${st.painted} ` +
        `sbOp=${sb?.opacity} sbCls=${sb?.cls?.slice(0, 40)} ` +
        `ruler=${ru ? `${ru.w}x${ru.h}@${ru.box.x},${ru.box.y} painted=${ru.painted}` : "none"} ` +
        `pt(1272,45)=${full.points[0].tag}.${full.points[0].cls?.split(" ")[0]} ` +
        `pt(1266,400)=${full.points[3].tag}.${full.points[3].cls?.split(" ")[0]}`,
    );
    if (i === 0) {
      // After the "waitForMonacoChrome" equivalent settles, print the full
      // element detail once.
      console.log(JSON.stringify(full, null, 1));
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  await browser.close();
  server.kill();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
