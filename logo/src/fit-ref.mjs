// fit-ref.mjs — coordinate-descent the reference preset's free parameters
// against measured IoU with the reference bitmap. Rasterizes in-process with
// node-canvas (Path2D on the emitted `d`), so no resvg round-trip per trial.
//
//   node src/fit-ref.mjs

// NOTE: `canvas` is CJS (default import only, same gotcha as opentype.js), and
// this build ships NO Path2D constructor — so candidates are rasterized by
// resvg, the same engine used for visual review. ~50ms/trial, acceptable.
import canvasPkg from 'canvas';
const { createCanvas, loadImage } = canvasPkg;
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import pathMod from 'node:path';
import fsSync from 'node:fs';
import { referenceGraph, traceOutline, MOLECULE_DEFAULTS } from './molecule.mjs';

const S = 512;

// --- reference mask (same crop + letterbox as diff-ref.mjs) ---
async function refMask() {
  const img = await loadImage('references/logo_suggestion_chatgpt.png');
  const c = createCanvas(img.width, img.height);
  const cx = c.getContext('2d');
  cx.drawImage(img, 0, 0);
  const { data } = cx.getImageData(0, 0, img.width, img.height);
  const ink = (x, y) => data[(y * img.width + x) * 4] < 128;
  const colHas = new Array(img.width).fill(false);
  for (let x = 0; x < img.width; x++) for (let y = 0; y < img.height; y++) if (ink(x, y)) { colHas[x] = true; break; }
  let x0 = colHas.indexOf(true), x1 = x0;
  while (x1 + 1 < img.width && colHas.slice(x1 + 1, Math.min(img.width, x1 + 40)).some(Boolean)) x1++;
  let y0 = img.height, y1 = 0;
  for (let x = x0; x <= x1; x++) for (let y = 0; y < img.height; y++) if (ink(x, y)) { if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const sw = x1 - x0 + 1, sh = y1 - y0 + 1;
  const k = (S - 16) / Math.max(sw, sh);
  const dw = sw * k, dh = sh * k;
  const c2 = createCanvas(S, S);
  const g = c2.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, S, S);
  g.drawImage(img, x0, y0, sw, sh, (S - dw) / 2, (S - dh) / 2, dw, dh);
  const d = g.getImageData(0, 0, S, S).data;
  const m = new Uint8Array(S * S);
  for (let i = 0; i < S * S; i++) m[i] = d[i * 4] < 128 ? 1 : 0;
  return m;
}

const ref = await refMask();

const tmp = fsSync.mkdtempSync(pathMod.join(os.tmpdir(), 'rhizz-fit-'));
const tmpSvg = pathMod.join(tmp, 'c.svg');
const tmpPng = pathMod.join(tmp, 'c.png');

// rasterize a candidate the same way the reference was treated:
// trim ink bbox, letterbox into S x S preserving aspect
async function rasterize(d) {
  fsSync.writeFileSync(tmpSvg,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">` +
    `<path d="${d}" fill="#000"/></svg>\n`);
  execFileSync('resvg', ['--background', 'white', tmpSvg, tmpPng], { stdio: 'ignore' });
  const img = await loadImage(tmpPng);
  const c = createCanvas(img.width, img.height);
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const px = g.getImageData(0, 0, img.width, img.height).data;
  let x0 = img.width, x1 = 0, y0 = img.height, y1 = 0;
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    if (px[(y * img.width + x) * 4] < 128) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  if (x1 < x0) return new Uint8Array(S * S);
  const sw = x1 - x0 + 1, sh = y1 - y0 + 1;
  const k = (S - 16) / Math.max(sw, sh);
  const c2 = createCanvas(S, S);
  const g2 = c2.getContext('2d');
  g2.fillStyle = '#fff'; g2.fillRect(0, 0, S, S);
  g2.drawImage(c, x0, y0, sw, sh, (S - sw * k) / 2, (S - sh * k) / 2, sw * k, sh * k);
  const d2 = g2.getImageData(0, 0, S, S).data;
  const m = new Uint8Array(S * S);
  for (let i = 0; i < S * S; i++) m[i] = d2[i * 4] < 128 ? 1 : 0;
  return m;
}

function iou(m) {
  let inter = 0, uni = 0;
  for (let i = 0; i < S * S; i++) { const a = ref[i], b = m[i]; if (a && b) inter++; if (a || b) uni++; }
  return inter / uni;
}

// candidate = reference graph with hub nudged + geometry params
async function score(p) {
  const cfg = { ...MOLECULE_DEFAULTS, dotR: p.dotR, barW: p.barW, hubR: p.hubR, fillet: p.fillet };
  const graph = referenceGraph(cfg);
  graph.nodes[0].x += p.hubDx;
  graph.nodes[0].y += p.hubDy;
  const d = traceOutline(graph, cfg);
  if (!d) return 0;
  try { return iou(await rasterize(d)); } catch { return 0; }
}

let p = { dotR: 38.6, barW: 28.2, hubR: 15, fillet: 5, hubDx: 0, hubDy: 0 };
let best = await score(p);
console.log(`start IoU ${(best * 100).toFixed(2)}%`);

const steps = { dotR: 2, barW: 2, hubR: 3, fillet: 2, hubDx: 6, hubDy: 6 };
for (let pass = 0; pass < 8; pass++) {
  let improved = false;
  for (const k of Object.keys(steps)) {
    for (const dir of [1, -1]) {
      const q = { ...p, [k]: p[k] + steps[k] * dir };
      if (q.hubR < 1 || q.fillet < 0 || q.barW < 4 || q.dotR < 4) continue;
      const s = await score(q);
      if (s > best + 1e-5) { best = s; p = q; improved = true; }
    }
  }
  if (!improved) { for (const k of Object.keys(steps)) steps[k] = Math.max(steps[k] / 2, 0.25); }
  console.log(`pass ${pass}: IoU ${(best * 100).toFixed(2)}%  ${JSON.stringify(p)}`);
}
console.log(`\nbest IoU ${(best * 100).toFixed(2)}%`);
console.log(JSON.stringify(p, null, 2));
