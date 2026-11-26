// gradient.mjs — the mark as a window onto a slowly flowing gradient, as MP4.
//
// Six soft colour blobs drift on closed Lissajous paths (integer frequencies),
// so the last frame flows straight back into the first and the video loops
// seamlessly. Frames are drawn on a <canvas> in headless Chromium (the mark is
// the exact Path2D from molecule.mjs) and encoded by video.mjs.
//
// Run through `just logo-video`: it provides Chromium and ffmpeg from nixpkgs.
//
//   node src/gradient.mjs --outdir renders/video
//   node src/gradient.mjs --variant dark --seconds 4 --fps 60 --outdir /tmp/x

import { renderMolecule } from './molecule.mjs';
import { encodeVideo } from './video.mjs';
import fs from 'node:fs';
import path from 'node:path';

export const VARIANTS = {
  // Deeper, saturated hues so the gradient holds up against white.
  light: { bg: '#ffffff', base: '#7fb6e6', blobs: ['#3fcf86', '#2fb0c2', '#5f7fe0', '#9a6fe0', '#ec7fb4', '#f0c94a'] },
  // Brighter pastels for a near-black background.
  dark: { bg: '#111318', base: '#8fc8f0', blobs: ['#6ff0a6', '#4fd8e8', '#7f9cff', '#c09cff', '#ff9fcf', '#ffe27a'] },
};

// Runs inside the page: draws frame k of n onto the canvas, returns a PNG data URL.
function drawFrame({ d, v, W, H, k, n, markH, bounds }) {
  let c = document.getElementById('c');
  if (!c) {
    c = document.createElement('canvas');
    c.id = 'c'; c.width = W; c.height = H;
    document.body.appendChild(c);
  }
  const ctx = c.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = v.bg;
  ctx.fillRect(0, 0, W, H);

  // mark space (512 units) -> screen: ink centred, `markH` px tall
  const s = markH / bounds.h;
  const cx = bounds.x + bounds.w / 2, cy = bounds.y + bounds.h / 2;
  ctx.setTransform(s, 0, 0, s, W / 2 - cx * s, H / 2 - cy * s);
  ctx.clip(new Path2D(d));

  const t = (k / n) * Math.PI * 2;
  ctx.fillStyle = v.base;
  ctx.fillRect(0, 0, 512, 512);
  v.blobs.forEach((col, i) => {
    const ph = i * 1.7;
    const fx = 1 + (i % 2), fy = 1 + ((i + 1) % 2);
    const ax = 0.32 + 0.05 * (i % 3), ay = 0.3 + 0.04 * (i % 2);
    const x = 256 + 512 * ax * Math.sin(fx * t + ph);
    const y = 256 + 512 * ay * Math.cos(fy * t + ph * 1.3);
    const g = ctx.createRadialGradient(x, y, 0, x, y, 245);
    g.addColorStop(0, col);
    g.addColorStop(1, col + '00');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 512);
  });
  return c.toDataURL('image/png');
}

export async function renderVideo({ variant, out, width = 1920, height = 1080, fps = 30, seconds = 8, markScale = 0.62 }) {
  const v = VARIANTS[variant];
  if (!v) throw new Error(`unknown variant ${variant} (use ${Object.keys(VARIANTS).join(', ')})`);
  const { d, bounds } = renderMolecule({ preset: 'reference' });
  const n = Math.round(fps * seconds);

  await encodeVideo({
    out, width, height, fps, frames: n, draw: drawFrame,
    frameArg: (k) => ({ d, v, W: width, H: height, k, n, markH: height * markScale, bounds }),
  });
}

// ------------------------------------------------------------------ CLI ---
const isCLI = typeof process !== 'undefined' && process.argv && import.meta.url === `file://${process.argv[1]}`;
if (isCLI) {
  const args = process.argv.slice(2);
  const get = (k, d) => {
    const i = args.indexOf(`--${k}`);
    return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d;
  };
  const outdir = get('outdir', 'renders/video');
  const variants = get('variant', null) ? [get('variant')] : Object.keys(VARIANTS);
  fs.mkdirSync(outdir, { recursive: true });
  for (const variant of variants) {
    const out = path.join(outdir, `rhizome-gradient-${variant}.mp4`);
    await renderVideo({
      variant, out,
      width: +get('width', 1920), height: +get('height', 1080),
      fps: +get('fps', 30), seconds: +get('seconds', 8),
    });
    console.log(`wrote ${out} (${(fs.statSync(out).size / 1024 / 1024).toFixed(1)} MB)`);
  }
}
