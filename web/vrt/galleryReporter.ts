import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import type { Reporter, TestCase, TestResult } from "@playwright/test/reporter";

// Playwright reporter that turns a VRT run into a single static, visuals-only
// gallery (vrt-report/index.html): one card per changed / new / broken story
// with a before/after slider, side-by-side and diff views, plus a browsable
// grid of unchanged baselines. Opens straight from disk — no server.

type Status = "changed" | "new" | "error" | "unchanged";

interface Entry {
  status: Status;
  title: string;
  storyId: string;
  theme: string;
  snapshotName: string;
  expected?: string;
  actual?: string;
  diff?: string;
  baseline?: string;
  pixels?: number;
  ratio?: number;
  sizeChange?: string;
  error?: string;
}

interface Options {
  outputDir?: string;
}

const ANSI = new RegExp(String.raw`\u001b\[[0-9;]*m`, "g");

function annotation(test: TestCase, type: string): string {
  return test.annotations.find((a) => a.type === type)?.description ?? "";
}

// Width x height from the PNG IHDR chunk (bytes 16..24), no decoder needed.
function pngArea(file: string): number | undefined {
  try {
    const buf = readFileSync(file);
    return buf.readUInt32BE(16) * buf.readUInt32BE(20);
  } catch {
    return undefined;
  }
}

function esc(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

class GalleryReporter implements Reporter {
  private readonly outDir: string;
  // Directory holding committed baselines; mirrors `snapshotPathTemplate`
  // (`{testDir}/__screenshots__`) — the spec lives at the testDir root.
  private shotsDir = "";
  private readonly entries: Entry[] = [];

  constructor(options: Options = {}) {
    this.outDir = resolve(options.outputDir ?? "vrt-report");
  }

  onBegin(): void {
    rmSync(this.outDir, { recursive: true, force: true });
    mkdirSync(resolve(this.outDir, "img"), { recursive: true });
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    if (result.status === "skipped") return;
    const storyId = annotation(test, "storyId");
    const theme = annotation(test, "theme");
    const snapshotName = `${storyId}--${theme}`;
    const entry: Entry = {
      status: "unchanged",
      title: annotation(test, "story") || test.title,
      storyId,
      theme,
      snapshotName,
    };

    this.shotsDir = resolve(dirname(test.location.file), "__screenshots__");
    const baseline = resolve(this.shotsDir, `${snapshotName}.png`);

    const images: Partial<Record<"expected" | "actual" | "diff", string>> = {};
    for (const att of result.attachments) {
      if (!att.path || att.contentType !== "image/png") continue;
      const kind = /-(expected|actual|diff)\.png$/.exec(att.name)?.[1];
      if (kind !== "expected" && kind !== "actual" && kind !== "diff") {
        continue;
      }
      const file = `${snapshotName}-${kind}.png`;
      copyFileSync(att.path, resolve(this.outDir, "img", file));
      images[kind] = `img/${file}`;
    }
    Object.assign(entry, images);

    const message = (result.errors[0]?.message ?? "").replace(ANSI, "");
    // Playwright rounds its ratio to 2 decimals ("0.01"), so derive a
    // precise one from the pixel count and the actual image size.
    const pixels = /(\d+) pixels \(ratio/.exec(message);
    if (pixels?.[1]) {
      entry.pixels = Number(pixels[1]);
      const area = images.actual
        ? pngArea(resolve(this.outDir, images.actual))
        : undefined;
      if (area) entry.ratio = entry.pixels / area;
    }
    const size = /Expected an image (\d+px by \d+px), received (\d+px by \d+px)/
      .exec(message);
    if (size?.[1] && size[2]) entry.sizeChange = `${size[1]} → ${size[2]}`;

    if (result.status === "passed") {
      entry.status = "unchanged";
      if (existsSync(baseline)) {
        entry.baseline = relative(this.outDir, baseline);
      }
    } else if (images.actual && /snapshot doesn't exist/.test(message)) {
      // Playwright also attaches the just-written baseline as "expected",
      // so the message is the only reliable "new" signal.
      entry.status = "new";
      delete entry.expected;
    } else if (images.actual && images.expected) {
      entry.status = "changed";
    } else {
      entry.status = "error";
      entry.error = message.split("\n").find((l) => l.trim()) ??
        result.status;
    }
    this.entries.push(entry);
  }

  onEnd(): void {
    const file = resolve(this.outDir, "index.html");
    writeFileSync(file, this.render());
    const count = (s: Status) =>
      this.entries.filter((e) => e.status === s).length;
    console.log(
      `\nVRT gallery: ${count("changed")} changed, ${count("new")} new, ` +
        `${count("error")} errors, ${count("unchanged")} unchanged\n` +
        `  file://${file}\n`,
    );
  }

  printsToStdio(): boolean {
    return false;
  }

  private acceptCommand(e: Entry): string {
    const dest = relative(
      process.cwd(),
      resolve(this.shotsDir, `${e.snapshotName}.png`),
    );
    const src = relative(
      process.cwd(),
      resolve(this.outDir, "img", basename(e.actual ?? "")),
    );
    return `cp ${src} ${dest}`;
  }

  private card(e: Entry): string {
    const badge = e.status === "changed"
      ? e.pixels !== undefined
        ? `<span class="badge changed">${e.pixels.toLocaleString("en-US")} px${
          e.ratio === undefined ? "" : ` · ${(e.ratio * 100).toFixed(3)}%`
        }</span>`
        : `<span class="badge changed">${esc(e.sizeChange ?? "changed")}</span>`
      : `<span class="badge ${e.status}">${e.status}</span>`;
    const sizeNote = e.sizeChange && e.pixels !== undefined
      ? `<span class="muted">size ${esc(e.sizeChange)}</span>`
      : "";
    const head = `<header>
        <div><h2>${esc(e.title)}</h2>
        <code>${esc(e.storyId)}</code> <span class="theme ${esc(e.theme)}">${
      esc(e.theme)
    }</span> ${sizeNote}</div>
        ${badge}
      </header>`;
    const accept = e.actual
      ? `<button class="copy" data-copy="${
        esc(this.acceptCommand(e))
      }">Copy accept command</button>`
      : "";

    if (e.status === "changed" && e.expected && e.actual) {
      return `<article class="card" data-status="changed">${head}
        <nav class="tabs">
          <button class="active" data-view="slider">Slider</button>
          <button data-view="side">Side by side</button>
          <button data-view="diff">Diff</button>
          <span class="spacer"></span>
          <button class="fit active">Fit</button>
          ${accept}
        </nav>
        <div class="view slider active">
          <div class="frame" style="--pos:50%">
            <img src="${e.actual}" alt="actual" draggable="false">
            <div class="clip"><img src="${e.expected}" alt="expected" draggable="false"></div>
            <div class="handle"></div>
            <span class="label l">baseline</span><span class="label r">new</span>
          </div>
        </div>
        <div class="view side">
          <figure><figcaption>baseline</figcaption><img src="${e.expected}" alt="expected"></figure>
          <figure><figcaption>new</figcaption><img src="${e.actual}" alt="actual"></figure>
        </div>
        <div class="view diff">${
        e.diff ? `<img src="${e.diff}" alt="diff">` : "<p>No diff image.</p>"
      }</div>
      </article>`;
    }
    if (e.status === "new" && e.actual) {
      return `<article class="card" data-status="new">${head}
        <nav class="tabs"><span class="muted">No baseline yet — written on this run.</span><span class="spacer"></span>${accept}</nav>
        <div class="view active single"><img src="${e.actual}" alt="new"></div>
      </article>`;
    }
    return `<article class="card" data-status="error">${head}
      <p class="error">${esc(e.error ?? "failed")}</p>
    </article>`;
  }

  private render(): string {
    const order: Status[] = ["changed", "new", "error"];
    const flagged = this.entries
      .filter((e) => e.status !== "unchanged")
      .sort((a, b) =>
        order.indexOf(a.status) - order.indexOf(b.status) ||
        (b.pixels ?? 0) - (a.pixels ?? 0) ||
        a.snapshotName.localeCompare(b.snapshotName)
      );
    const unchanged = this.entries
      .filter((e) => e.status === "unchanged")
      .sort((a, b) => a.snapshotName.localeCompare(b.snapshotName));
    const count = (s: Status) =>
      this.entries.filter((e) => e.status === s).length;

    const thumbs = unchanged.map((e) =>
      `<a class="thumb" href="${
        esc(e.baseline ?? "")
      }" target="_blank" title="${esc(`${e.title} (${e.theme})`)}">
        <img loading="lazy" src="${esc(e.baseline ?? "")}" alt="">
        <span>${esc(e.title)} <em class="theme ${esc(e.theme)}">${
        esc(e.theme)
      }</em></span></a>`
    ).join("");

    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Rhizz VRT — ${count("changed")} changed</title>
<style>${CSS}</style></head>
<body>
<header class="top">
  <h1>Visual changes</h1>
  <div class="filters">
    <button class="active" data-filter="all">All flagged</button>
    <button data-filter="changed">Changed <b>${count("changed")}</b></button>
    <button data-filter="new">New <b>${count("new")}</b></button>
    <button data-filter="error">Errors <b>${count("error")}</b></button>
  </div>
  <span class="muted">${count("unchanged")} unchanged · ${
      new Date().toLocaleString("en-GB")
    }</span>
</header>
<main>
  ${
      flagged.length
        ? flagged.map((e) => this.card(e)).join("\n")
        : `<p class="empty">No visual changes. ✨</p>`
    }
  <details class="unchanged">
    <summary>Unchanged (${unchanged.length})</summary>
    <div class="grid">${thumbs}</div>
  </details>
</main>
<script>${SCRIPT}</script>
</body></html>`;
  }
}

const CSS = `
:root { color-scheme: dark; --bg:#14161a; --card:#1d2026; --line:#2c313a;
  --fg:#e6e8eb; --muted:#8b93a1; --accent:#5b9dff; --changed:#f5a524;
  --new:#3fb950; --error:#f85149; }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--fg);
  font:14px/1.45 system-ui, sans-serif; }
code { font:12px ui-monospace, monospace; color:var(--muted); }
button { font:inherit; color:inherit; background:#262a32; border:1px solid var(--line);
  border-radius:6px; padding:4px 10px; cursor:pointer; }
button:hover { border-color:var(--accent); }
button.active { background:var(--accent); border-color:var(--accent); color:#fff; }
.muted { color:var(--muted); font-size:12px; }
.top { position:sticky; top:0; z-index:5; display:flex; gap:16px; align-items:center;
  padding:12px 24px; background:rgba(20,22,26,.92); backdrop-filter:blur(6px);
  border-bottom:1px solid var(--line); }
.top h1 { font-size:16px; margin:0; }
.filters { display:flex; gap:6px; }
.filters b { margin-left:4px; }
main { padding:24px; display:flex; flex-direction:column; gap:24px; max-width:1500px; margin:auto; }
.card { background:var(--card); border:1px solid var(--line); border-radius:10px; overflow:hidden; }
.card > header { display:flex; justify-content:space-between; align-items:start; gap:12px;
  padding:12px 16px; border-bottom:1px solid var(--line); }
.card h2 { font-size:15px; margin:0 0 2px; }
.badge { padding:2px 8px; border-radius:99px; font-size:12px; font-weight:600; white-space:nowrap; }
.badge.changed { background:rgba(245,165,36,.15); color:var(--changed); }
.badge.new { background:rgba(63,185,80,.15); color:var(--new); }
.badge.error { background:rgba(248,81,73,.15); color:var(--error); }
.theme { font-size:11px; font-style:normal; padding:1px 6px; border-radius:4px; border:1px solid var(--line); }
.theme.light { background:#e6e8eb; color:#14161a; }
.theme.dark { background:#000; color:#e6e8eb; }
.tabs { display:flex; gap:6px; align-items:center; padding:8px 16px; border-bottom:1px solid var(--line); }
.spacer { flex:1; }
.view { display:none; padding:16px; overflow:auto;
  background:repeating-conic-gradient(#22252b 0 25%, #1a1c21 0 50%) 0 0/16px 16px; }
.view.active { display:block; }
.view img { display:block; max-width:100%; }
.frame { position:relative; display:grid; width:max-content; margin:auto;
  cursor:ew-resize; user-select:none; touch-action:none; }
.frame > * { grid-area:1/1; }
/* clip-path makes .clip a stacking context painted above plain siblings */
.handle, .label { position:relative; z-index:1; }
/* Images never receive the pointer, so the browser's native image
   drag-and-drop (Firefox especially) can't hijack a slider drag. */
.frame img { max-width:none; pointer-events:none; -webkit-user-drag:none; }
.clip { clip-path:inset(0 calc(100% - var(--pos)) 0 0); }
.handle { width:2px; margin-left:calc(var(--pos) - 1px); background:var(--accent);
  box-shadow:0 0 0 1px rgba(0,0,0,.5); pointer-events:none; }
.label { align-self:start; margin:8px; padding:2px 8px; font-size:11px; border-radius:4px;
  background:rgba(0,0,0,.7); color:#fff; pointer-events:none; }
.label.l { justify-self:start; } .label.r { justify-self:end; }
.view.side.active { display:grid; grid-template-columns:1fr 1fr; gap:16px; align-items:start; }
.view.single img, .view.diff img { margin:auto; }
figure { margin:0; } figcaption { color:var(--muted); font-size:12px; margin-bottom:4px; }
.error { color:var(--error); padding:12px 16px; margin:0; font:12px ui-monospace, monospace; }
.empty { text-align:center; color:var(--muted); font-size:16px; padding:48px; }
.unchanged summary { cursor:pointer; color:var(--muted); padding:8px 0; }
.grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(220px, 1fr)); gap:12px; }
.thumb { display:flex; flex-direction:column; gap:6px; color:var(--fg); text-decoration:none;
  background:var(--card); border:1px solid var(--line); border-radius:8px; padding:8px; }
.thumb:hover { border-color:var(--accent); }
.thumb img { width:100%; height:140px; object-fit:cover; object-position:top; border-radius:4px; }
.thumb span { font-size:12px; }
`;

const SCRIPT = `
for (const card of document.querySelectorAll(".card")) {
  const frame = card.querySelector(".frame");
  for (const tab of card.querySelectorAll("[data-view]")) {
    tab.addEventListener("click", () => {
      card.querySelectorAll("[data-view]").forEach((t) => t.classList.toggle("active", t === tab));
      card.querySelectorAll(".view").forEach((v) =>
        v.classList.toggle("active", v.classList.contains(tab.dataset.view)));
      fit(card);
    });
  }
  card.querySelector(".fit")?.addEventListener("click", (ev) => {
    ev.currentTarget.classList.toggle("active");
    fit(card);
  });
  if (frame) {
    const move = (ev) => {
      const r = frame.getBoundingClientRect();
      const pos = Math.min(100, Math.max(0, ((ev.clientX - r.left) / r.width) * 100));
      frame.style.setProperty("--pos", pos + "%");
    };
    frame.addEventListener("dragstart", (ev) => ev.preventDefault());
    frame.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();
      frame.setPointerCapture(ev.pointerId);
      move(ev);
    });
    frame.addEventListener("pointermove", (ev) => { if (frame.hasPointerCapture(ev.pointerId)) move(ev); });
    frame.querySelectorAll("img").forEach((img) => img.addEventListener("load", () => fit(card)));
  }
}
function fit(card) {
  const frame = card.querySelector(".frame");
  if (!frame) return;
  frame.style.zoom = "";
  if (!card.querySelector(".fit")?.classList.contains("active")) return;
  const avail = frame.parentElement.clientWidth - 32;
  const natural = frame.scrollWidth;
  if (natural > avail && avail > 0) frame.style.zoom = String(avail / natural);
}
addEventListener("resize", () => document.querySelectorAll(".card").forEach(fit));
for (const btn of document.querySelectorAll("[data-copy]")) {
  btn.addEventListener("click", async () => {
    await navigator.clipboard.writeText(btn.dataset.copy);
    const old = btn.textContent; btn.textContent = "Copied ✓";
    setTimeout(() => (btn.textContent = old), 1200);
  });
}
for (const f of document.querySelectorAll("[data-filter]")) {
  f.addEventListener("click", () => {
    document.querySelectorAll("[data-filter]").forEach((x) => x.classList.toggle("active", x === f));
    document.querySelectorAll(".card").forEach((c) => {
      c.hidden = f.dataset.filter !== "all" && c.dataset.status !== f.dataset.filter;
    });
  });
}
`;

export default GalleryReporter;
