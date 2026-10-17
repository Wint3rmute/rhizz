#!/usr/bin/env node
// Timeline probe: sample the Monaco overview-ruler canvas state from page-init
// (before any app script) until the moment the VRT spec would screenshot, for
// a number of story loads. Records transitions (blank <-> painted, canvas
// resize, editor scrollHeight, data-theme flips) so the flaky "blank ruler"
// capture can be reproduced and explained.
//
// usage: node probe-series.mjs [storyId] [theme] [loads] [cpuStress]
// Records: ruler canvas (size, painted state, editor scrollHeight), data-theme,
// document.activeElement (Monaco focus -> cursor blink) transitions.
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";

const require = createRequire(new URL("../../web/package.json", import.meta.url));
const { chromium } = require("playwright-core");

const storyId = process.argv[2] ?? "pages-code--default";
const theme = process.argv[3] ?? "light";
const loads = Number(process.argv[4] ?? 5);
const stress = process.argv[5] === "stress";
const outFile = process.argv[6];
const fontconfig = process.env.RHIZZ_VRT_FONTCONFIG_FILE;
if (!fontconfig) {
  console.error("RHIZZ_VRT_FONTCONFIG_FILE unset — run inside `nix develop`");
  process.exit(1);
}
const PORT = 6195;

// Optional CPU stress: mimics a busy runner so timing races reproduce.
const hogs = [];
if (stress) {
  for (let i = 0; i < 4; i++) {
    hogs.push(spawn("node", ["-e", "const t=Date.now();while(Date.now()-t<600000){Math.sqrt(Math.random())}"]));
  }
  console.log("cpu stress: 4 hogs started");
}

const server = spawn(
  "node",
  ["vrt/serve.ts", "storybook-static", String(PORT)],
  { cwd: decodeURIComponent(new URL("../../web/", import.meta.url).pathname), stdio: "ignore" },
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

// Installed before any page script: samples every ~10ms from the very start.
await page.addInitScript(() => {
  const stopAt = Date.now() + 20000;
  window.__series = [];
  const sample = () => {
    try {
      const c = document.querySelector?.("canvas.decorationsOverviewRuler");
      const ed = document.querySelector?.(".monaco-editor");
      let painted = -1;
      if (c) {
        painted = 0;
        const d = c.getContext?.("2d")?.getImageData(0, 0, c.width, c.height).data;
        for (let i = 3; d && i < d.length; i += 4) if (d[i] !== 0) { painted = 1; break; }
      }
      const cursor = document.querySelector?.(".monaco-editor .cursors-layer .cursor");
      const cursorStyle = cursor ? getComputedStyle(cursor) : null;
      window.__series.push({
        t: performance.timeOrigin + performance.now(),
        painted,
        cw: c?.width ?? -1,
        ch: c?.height ?? -1,
        sh: ed ? ed.scrollHeight : -1,
        theme: document.documentElement.getAttribute?.("data-theme") ?? null,
        main: document.body.classList.contains?.("sb-show-main") ?? false,
        focus: document.activeElement?.className?.toString?.().slice(0, 60)
          ?? document.activeElement?.tagName
          ?? null,
        cursorVis: cursorStyle ? cursorStyle.visibility : null,
      });
    } catch {}
    if (Date.now() < stopAt) setTimeout(sample, 10);
  };
  sample();
});

const getSeries = () => page.evaluate(() => window.__series);

for (let i = 0; i < loads; i++) {
  await page.emulateMedia({ colorScheme: theme });
  const t0 = Date.now();
  await page.goto(
    `/iframe.html?id=${storyId}&viewMode=story&globals=theme:${theme}`,
    { waitUntil: "networkidle" },
  );
  await page.waitForFunction(() => document.body.classList.contains("sb-show-main"));
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

  // exactly when toHaveScreenshot would run; extend the sampling window a
  // little to see whether a late paint lands after the capture.
  await new Promise((r) => setTimeout(r, 1500));
  const series = await getSeries();
  const first = series[0]?.t ?? t0;
  const rel = (v) => `+${((v - first) / 1000).toFixed(2)}s`;
  const transitions = [];
  for (let k = 1; k < series.length; k++) {
    const a = series[k - 1];
    const b = series[k];
    const changes = [];
    for (const key of ["painted", "cw", "ch", "sh", "theme", "main", "focus", "cursorVis"]) {
      if (a[key] !== b[key]) changes.push(`${key} ${a[key]}->${b[key]}`);
    }
    if (changes.length) transitions.push(`${rel(b.t)} ${changes.join(" ")}`);
  }
  const untilMain = series.find((s) => s.main);
  const atCapture = series.filter((s) => s.t - first < (Date.now() - t0)).at(-1);
  const line =
    `load ${i + 1}/${loads}: main@${rel(untilMain?.t ?? first)} capturedAt=+${((Date.now() - t0) / 1000).toFixed(2)}s state=${JSON.stringify(atCapture)}`;
  console.log(line);
  if (outFile) appendFileSync(outFile, `== ${storyId} ${theme} ${line}\n`);
  for (const t of transitions) {
    console.log("    " + t);
    if (outFile) appendFileSync(outFile, `   ${t}\n`);
  }
}

await browser.close();
server.kill();
for (const h of hogs) h.kill();
