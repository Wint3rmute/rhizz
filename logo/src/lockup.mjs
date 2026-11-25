// lockup.mjs — "<mark> Rhizome" lockup: paper.js mark + Roboto Bold wordmark as outlines.
// Text is converted to paths (opentype.js) so the SVG needs no webfont —
// what you see in resvg/browser is the final artifact.
//
// Stages (always written together — review each):
//   <out>-text.svg  ... wordmark outlines alone, tight viewBox
//   <out>.svg       ... final lockup: mark + gap + wordmark
// (mark-alone stage is the input --mark file itself)
//
//   node src/lockup.mjs --mark renders/paper-rhizome-001.svg --out renders/lockup-001.svg
//   node src/lockup.mjs --mark renders/paper-rhizome-001.svg --text Rhizome --hub-hole-note no

import pkg from 'opentype.js';
const { parse: parseFont } = pkg;
import fsSync from 'node:fs';

const args = process.argv.slice(2);
const get = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d;
};

const markPath = get('mark', 'renders/paper-rhizome-001.svg');
const outPath = get('out', 'renders/lockup-001.svg');
const text = get('text', 'Rhizome');
// Roboto Bold comes from nixpkgs: `nix develop` exports ROBOTO_BOLD (see flake.nix).
const fontPath = get('font', process.env.ROBOTO_BOLD);
if (!fontPath) {
  console.error('No font: set ROBOTO_BOLD (run inside `nix develop`) or pass --font <path-to-Roboto-Bold.ttf>');
  process.exit(1);
}
const fontSize = parseFloat(get('font-size', '200'));
const tracking = parseFloat(get('tracking', '-15')); // font units per glyph, tightened for logo feel
const gapFactor = parseFloat(get('gap', '0.42')); // × cap-height
const iconFactor = parseFloat(get('icon', '1.18')); // icon content height × cap-height
const contentPad = parseFloat(get('pad', '8')); // extra optical inset around measured bounds (units)

const fontBuf = fsSync.readFileSync(fontPath);
const font = parseFont(fontBuf.buffer.slice(fontBuf.byteOffset, fontBuf.byteOffset + fontBuf.byteLength));
const upm = font.unitsPerEm;
const capH = ((font.tables.os2 && font.tables.os2.sCapHeight) || 0.71 * upm) * (fontSize / upm);

// --- wordmark outlines, baseline at y=0, starting x=0 ---
// NOTE: font.getPath() runs full GSUB shaping and crashes on Roboto's ccmp lookup
// (opentype.js lacks substFormat 2). Manual per-glyph layout avoids shaping entirely.
const { Path: OPath } = pkg;
const scale = fontSize / font.unitsPerEm;
const tp = new OPath();
let penX = 0;
let prevGlyph = null;
for (const ch of text) {
  const g = font.charToGlyph(ch);
  if (prevGlyph) penX += font.getKerningValue(prevGlyph, g) * scale;
  tp.extend(g.getPath(penX, 0, fontSize));
  penX += (g.advanceWidth + tracking) * scale;
  prevGlyph = g;
}
const tb = tp.getBoundingBox();
const textD = tp.toPathData(2);

// --- mark: extract inner markup from its <svg> wrapper ---
const { default: fs } = await import('node:fs');
const markSrc = fs.readFileSync(markPath, 'utf8'); // (font already loaded via fsSync above)
const svgOpen = markSrc.indexOf('<svg');
const inner = markSrc.slice(markSrc.indexOf('>', svgOpen) + 1, markSrc.lastIndexOf('</svg>'));
const markBox = 512; // paper-rhizome viewBox is 512

// --- mark content bounds: measured .bounds.json from the generator, else pad fallback ---
let mb = null;
try {
  mb = JSON.parse(fs.readFileSync(markPath.replace(/\.svg$/, '.bounds.json'), 'utf8')).bounds;
} catch { /* hand-made mark without metadata */ }
if (!mb) mb = { x: contentPad, y: contentPad, w: markBox - 2 * contentPad, h: markBox - 2 * contentPad };
console.log(`mark bounds x=${mb.x} y=${mb.y} w=${mb.w} h=${mb.h}`);

// --- layout: icon content height = iconFactor × capH, content center on cap middle ---
const s = (iconFactor * capH) / mb.h;
const gap = gapFactor * capH;
const capMid = -capH / 2;
const ccx = mb.x + mb.w / 2, ccy = mb.y + mb.h / 2;
const iconLeft = -mb.x * s; // content left edge lands at x=0
const iconTop = capMid - ccy * s;
const textX = mb.w * s + gap;

// tight viewBox around real content
const top = Math.min(iconTop + mb.y * s, tb.y1);
const bot = Math.max(iconTop + (mb.y + mb.h) * s, tb.y2);
const right = textX + tb.x2;
const padOut = 0.08 * capH;
const vx = -padOut, vy = top - padOut, vw = right + 2 * padOut, vh = bot - top + 2 * padOut;

const fmt = (n) => +n.toFixed(2);
const lockup =
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(vx)} ${fmt(vy)} ${fmt(vw)} ${fmt(vh)}">\n` +
  `<g transform="translate(${fmt(iconLeft)} ${fmt(iconTop)}) scale(${s.toFixed(4)})" fill="#000" stroke="#000">${inner}</g>\n` +
  `<g transform="translate(${fmt(textX)} 0)"><path d="${textD}" fill="#000"/></g>\n` +
  `</svg>\n`;

const textOnly =
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(tb.x1 - padOut)} ${fmt(tb.y1 - padOut)} ${fmt(tb.x2 - tb.x1 + 2 * padOut)} ${fmt(tb.y2 - tb.y1 + 2 * padOut)}">\n` +
  `<path d="${textD}" fill="#000"/>\n</svg>\n`;

const textPath = outPath.replace(/\.svg$/, '-text.svg');
fs.writeFileSync(outPath, lockup);
fs.writeFileSync(textPath, textOnly);
console.log(`capH=${fmt(capH)} iconScale=${s.toFixed(4)} gap=${fmt(gap)}`);
console.log(`wrote ${outPath} (${fmt(vw)}x${fmt(vh)})`);
console.log(`wrote ${textPath} (wordmark stage)`);
