// diff-ref.mjs — overlay a rendered mark against the reference crop.
// Red = reference only, blue = render only, black = agreement.
// Prints IoU so "closer to the reference" is a number, not a vibe.
//
//   node src/diff-ref.mjs renders/png/molecule-ref.png out.png

import { createCanvas, loadImage } from 'canvas';
import fs from 'node:fs';

const renderPath = process.argv[2];
const outPath = process.argv[3] || 'renders/png/diff-ref.png';
const S = 512;

async function maskOf(path, crop) {
  const img = await loadImage(path);
  let sx = 0, sy = 0, sw = img.width, sh = img.height;
  if (crop) {
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
    sx = x0; sy = y0; sw = x1 - x0 + 1; sh = y1 - y0 + 1;
  } else {
    // trim whitespace around the render too
    const c = createCanvas(img.width, img.height);
    const cx = c.getContext('2d');
    cx.drawImage(img, 0, 0);
    const { data } = cx.getImageData(0, 0, img.width, img.height);
    const ink = (x, y) => data[(y * img.width + x) * 4] < 128;
    let x0 = img.width, x1 = 0, y0 = img.height, y1 = 0;
    for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) if (ink(x, y)) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    sx = x0; sy = y0; sw = x1 - x0 + 1; sh = y1 - y0 + 1;
  }
  // letterbox into S x S preserving aspect
  const k = (S - 16) / Math.max(sw, sh);
  const dw = sw * k, dh = sh * k;
  const c2 = createCanvas(S, S);
  const g = c2.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, S, S);
  g.drawImage(img, sx, sy, sw, sh, (S - dw) / 2, (S - dh) / 2, dw, dh);
  const d = g.getImageData(0, 0, S, S).data;
  const m = new Uint8Array(S * S);
  for (let i = 0; i < S * S; i++) m[i] = d[i * 4] < 128 ? 1 : 0;
  return m;
}

const ref = await maskOf('references/logo_suggestion_chatgpt.png', true);
const got = await maskOf(renderPath, false);

let inter = 0, uni = 0, refOnly = 0, gotOnly = 0;
const out = createCanvas(S, S);
const og = out.getContext('2d');
const id = og.createImageData(S, S);
for (let i = 0; i < S * S; i++) {
  const a = ref[i], b = got[i];
  if (a && b) inter++;
  if (a || b) uni++;
  if (a && !b) refOnly++;
  if (!a && b) gotOnly++;
  let col = [255, 255, 255];
  if (a && b) col = [0, 0, 0];
  else if (a) col = [230, 60, 60];
  else if (b) col = [60, 110, 230];
  id.data[i * 4] = col[0]; id.data[i * 4 + 1] = col[1]; id.data[i * 4 + 2] = col[2]; id.data[i * 4 + 3] = 255;
}
og.putImageData(id, 0, 0);
fs.writeFileSync(outPath, out.toBuffer('image/png'));
console.log(`IoU = ${(inter / uni * 100).toFixed(2)}%   refOnly=${refOnly}  renderOnly=${gotOnly}`);
console.log(`wrote ${outPath}`);
