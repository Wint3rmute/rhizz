// measure-ref.mjs — extract the reference mark's geometry from the bitmap.
//
// Why: every earlier generator was tuned against a hand-eyeballed model
// (editor/models/reference.json) that turned out to be wrong in two ways —
// it invented a hub dot (the real mark has none; bars just converge) and it
// assumed tapered strokes (the real bars are constant width).
//
// Method: threshold -> exact Euclidean distance transform (Felzenszwalb) ->
// local maxima of the DT are dot centers (DT value = dot radius). The modal
// DT value along the thin parts gives the bar half-width.
//
//   node src/measure-ref.mjs references/logo_suggestion_chatgpt.png

import { createCanvas, loadImage } from 'canvas';

const src = process.argv[2] || 'references/logo_suggestion_chatgpt.png';
const img = await loadImage(src);

// --- crop to the mark: leftmost connected ink group, before the wordmark ---
const cnv = createCanvas(img.width, img.height);
const ctx = cnv.getContext('2d');
ctx.drawImage(img, 0, 0);
const { data, width: W, height: H } = ctx.getImageData(0, 0, img.width, img.height);
const ink = (x, y) => data[(y * W + x) * 4] < 128; // near-black on white

// column occupancy -> find the gap between mark and wordmark
const colHas = new Array(W).fill(false);
for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) if (ink(x, y)) { colHas[x] = true; break; }
let x0 = colHas.indexOf(true);
let x1 = x0;
while (x1 + 1 < W && (colHas[x1 + 1] || colHas.slice(x1 + 1, Math.min(W, x1 + 40)).some(Boolean))) x1++;
let y0 = H, y1 = 0;
for (let x = x0; x <= x1; x++) for (let y = 0; y < H; y++) if (ink(x, y)) { if (y < y0) y0 = y; if (y > y1) y1 = y; }
const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
console.log(`mark crop: x=${x0} y=${y0} w=${cw} h=${ch}`);

// --- binary mask ---
const mask = new Uint8Array(cw * ch);
for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) mask[j * cw + i] = ink(x0 + i, y0 + j) ? 1 : 0;

// --- exact squared EDT (Felzenszwalb & Huttenlocher), background = 0 ---
function edt1d(f, n) {
  const d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s;
    while (true) {
      s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      if (s <= z[k]) k--; else break;
    }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
  return d;
}
const INF = 1e12;
const dt = new Float64Array(cw * ch);
for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) dt[j * cw + i] = mask[j * cw + i] ? INF : 0;
{
  const col = new Float64Array(ch);
  for (let i = 0; i < cw; i++) {
    for (let j = 0; j < ch; j++) col[j] = dt[j * cw + i];
    const r = edt1d(col, ch);
    for (let j = 0; j < ch; j++) dt[j * cw + i] = r[j];
  }
  const row = new Float64Array(cw);
  for (let j = 0; j < ch; j++) {
    for (let i = 0; i < cw; i++) row[i] = dt[j * cw + i];
    const r = edt1d(row, cw);
    for (let i = 0; i < cw; i++) dt[j * cw + i] = Math.sqrt(r[i]);
  }
}

// --- dot centers: local maxima of DT, non-max-suppressed by radius ---
const cand = [];
for (let j = 1; j < ch - 1; j++) for (let i = 1; i < cw - 1; i++) {
  const r = dt[j * cw + i];
  if (r < 6) continue;
  let isMax = true;
  for (let dj = -2; dj <= 2 && isMax; dj++) for (let di = -2; di <= 2; di++) {
    if (dt[(j + dj) * cw + (i + di)] > r) { isMax = false; break; }
  }
  if (isMax) cand.push({ x: i, y: j, r });
}
cand.sort((a, b) => b.r - a.r);
const peaks = [];
for (const c of cand) {
  if (peaks.some((p) => Math.hypot(p.x - c.x, p.y - c.y) < Math.max(p.r, c.r) * 0.9)) continue;
  peaks.push(c);
}

// Split: terminals are the big peaks, everything else is bar ridge. The gap in
// the sorted radii is unambiguous on this mark (39..35 then 23), so cut at the
// largest relative drop in the top third.
let cut = 0, best = 0;
for (let i = 0; i < Math.min(peaks.length - 1, 12); i++) {
  const drop = peaks[i].r - peaks[i + 1].r;
  if (drop > best) { best = drop; cut = i + 1; }
}
const dots = peaks.slice(0, cut);
const ridge = peaks.slice(cut);

// --- bar half-width: modal DT over the ridge peaks (excludes dots + junction) ---
const hist = new Map();
for (const p of ridge) {
  const b = Math.round(p.r * 2) / 2;
  hist.set(b, (hist.get(b) || 0) + 1);
}
const modal = [...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

// --- junction: ink wider than a bar but not part of a dot ---
const barHalfGuess = modal[0][0];
let jx = 0, jy = 0, jn = 0;
for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
  const r = dt[j * cw + i];
  if (r < barHalfGuess * 1.35) continue;
  if (dots.some((p) => Math.hypot(p.x - i, p.y - j) < p.r * 1.1)) continue;
  jx += i; jy += j; jn++;
}
if (jn) { jx /= jn; jy /= jn; }

// --- report in a normalized 512 box (longest side -> 512 - 2*margin) ---
const margin = 24;
const scale = (512 - 2 * margin) / Math.max(cw, ch);
const nx = (v) => +(((v - cw / 2) * scale) + 256).toFixed(1);
const ny = (v) => +(((v - ch / 2) * scale) + 256).toFixed(1);

console.log(`\nterminal dots (px): ${dots.length}`);
for (const p of dots) console.log(`  x=${p.x} y=${p.y} r=${p.r.toFixed(1)}`);
console.log(`\nbar half-width modal DT (px): ${modal.map(([v, n]) => `${v}(${n})`).join(' ')}`);
console.log(`junction centroid (px): x=${jx.toFixed(1)} y=${jy.toFixed(1)} (${jn}px of wide ink)`);
const barHalf = modal[0][0];
const meanR = dots.reduce((s, p) => s + p.r, 0) / dots.length;
console.log(`mean dot r=${meanR.toFixed(1)}px  bar w=${(barHalf * 2).toFixed(1)}px  ratio bar/dotDia=${((barHalf * 2) / (meanR * 2)).toFixed(3)}`);

console.log(`\n--- normalized to 512 box (margin ${margin}) ---`);
console.log(`dot r ≈ ${(meanR * scale).toFixed(1)}, bar w ≈ ${(barHalf * 2 * scale).toFixed(1)}`);
console.log(`  center: { x: ${nx(jx)}, y: ${ny(jy)} },`);
for (const p of dots) console.log(`  { x: ${nx(p.x)}, y: ${ny(p.y)}, r: ${(p.r * scale).toFixed(1)} },`);

// angles from the junction — tells us the real fan, which is NOT evenly slotted
console.log(`\nangles from junction (deg, screen y-down):`);
for (const p of dots) {
  const a = Math.atan2(p.y - jy, p.x - jx) * 180 / Math.PI;
  console.log(`  (${p.x},${p.y}) -> ${a.toFixed(1)}  dist=${Math.hypot(p.x - jx, p.y - jy).toFixed(1)}`);
}
