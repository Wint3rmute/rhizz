#!/usr/bin/env node
// Diff two PNGs (or analyse a Playwright diff PNG) without external CLIs.
// Usage: node pngdiff.mjs bbox <diff.png>
//        node pngdiff.mjs cmp  <expected.png> <actual.png> [tolerance]
// Prints: changed-pixel count, bounding box (x,y,w,h), and a coarse 8x8
// occupancy grid (share of changed pixels per cell) so a failure can be
// classified without opening the image.
// pngjs ships as a transitive dependency of playwright; resolve it from web/
// so this script has no dependencies of its own.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(new URL("../../web/package.json", import.meta.url));
const { PNG } = require("pngjs");

function load(path) {
  return PNG.sync.read(readFileSync(path));
}

// Sub-pixel colour distance (pixelmatch-style, per channel avg, 0..1 scale).
function channelDelta(a, b) {
  return (
    (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])) /
    3 /
    255
  );
}

function report(label, count, box, grid) {
  console.log(`${label}: ${count} px changed`);
  if (box) {
    console.log(
      `  bbox: x=${box.x} y=${box.y} w=${box.w} h=${box.h}`,
    );
  }
  if (grid) {
    console.log("  occupancy (rows top->bottom, % of cell px changed):");
    for (const row of grid) {
      console.log("   " + row.map((v) => String(v).padStart(4)).join(""));
    }
  }
}

const mode = process.argv[2];

if (mode === "bbox") {
  // Analyse a Playwright -diff.png: red pixels mark changed areas.
  const img = load(process.argv[3]);
  let count = 0;
  const grid = Array.from({ length: 8 }, () => Array(8).fill(0));
  const cells = Array.from({ length: 8 }, () => Array(8).fill(0));
  let box = null;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const i = (img.width * y + x) << 2;
      const [r, g, b] = [img.data[i], img.data[i + 1], img.data[i + 2]];
      // Playwright's diff is pure-ish red (255,0,0) where different.
      if (r > 128 && g < 128 && b < 128) {
        count++;
        const gx = Math.min(7, (x / img.width) * 8) | 0;
        const gy = Math.min(7, (y / img.height) * 8) | 0;
        grid[gy][gx]++;
        cells[gy][gx]++;
        if (!box) box = { x, y, x2: x, y2: y };
        else {
          box.x = Math.min(box.x, x);
          box.y = Math.min(box.y, y);
          box.x2 = Math.max(box.x2, x);
          box.y2 = Math.max(box.y2, y);
        }
      }
    }
  }
  const out = box
    ? { x: box.x, y: box.y, w: box.x2 - box.x + 1, h: box.y2 - box.y + 1 }
    : null;
  const pct = grid.map((row, gy) =>
    row.map(
      (v, gx) =>
        Math.round(
          (v / ((img.width / 8) * (img.height / 8))) * 100,
        ),
    ),
  );
  report(process.argv[3], count, out, pct);
} else if (mode === "cmp") {
  // Compare two screenshots directly with pixelmatch-like tolerance.
  const a = load(process.argv[3]);
  const b = load(process.argv[4]);
  const tol = process.argv[5] ? Number(process.argv[5]) : 0.02;
  if (a.width !== b.width || a.height !== b.height) {
    console.log(
      `size mismatch: ${a.width}x${a.height} vs ${b.width}x${b.height}`,
    );
    process.exit(1);
  }
  let count = 0;
  const box = { x: a.width, y: a.height, x2: -1, y2: -1 };
  const rows = new Map();
  for (let y = 0; y < a.height; y++) {
    let rowCount = 0;
    for (let x = 0; x < a.width; x++) {
      const i = (a.width * y + x) << 2;
      if (
        channelDelta(
          [a.data[i], a.data[i + 1], a.data[i + 2]],
          [b.data[i], b.data[i + 1], b.data[i + 2]],
        ) > tol
      ) {
        count++;
        rowCount++;
        box.x = Math.min(box.x, x);
        box.y = Math.min(box.y, y);
        box.x2 = Math.max(box.x2, x);
        box.y2 = Math.max(box.y2, y);
      }
    }
    if (rowCount) rows.set(y, rowCount);
  }
  const out =
    box.x2 >= 0
      ? { x: box.x, y: box.y, w: box.x2 - box.x + 1, h: box.y2 - box.y + 1 }
      : null;
  console.log(`${process.argv[3]} vs ${process.argv[4]}: ${count} px differ`);
  if (out) console.log(`  bbox: x=${out.x} y=${out.y} w=${out.w} h=${out.h}`);
  if (rows.size) {
    const ys = [...rows.keys()];
    console.log(
      `  changed rows: ${ys.length} (y=${ys[0]}..${ys[ys.length - 1]}), ` +
        `top rows: ${ys
          .slice(0, 5)
          .map((y) => `${y}:${rows.get(y)}`)
          .join(" ")}`,
    );
  }
} else {
  console.error("usage: pngdiff.mjs bbox <diff.png> | cmp <a.png> <b.png> [tol]");
  process.exit(1);
}
