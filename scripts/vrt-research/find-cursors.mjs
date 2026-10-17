#!/usr/bin/env node
// Scan VRT baselines for Monaco text-cursor pixels: a ~2px-wide, >=15px-tall
// column of one saturated colour that is not the editor background. The cursor
// is the only thing in these screenshots with that shape, so a hit means the
// baseline captured the cursor in its visible phase (or a solid cursor).
// usage: node find-cursors.mjs <screenshotsDir>
import { createRequire } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(new URL("../../web/package.json", import.meta.url));
const { PNG } = require("pngjs");

const dir = process.argv[2] ?? "../vrt/__screenshots__";
for (const file of readdirSync(dir).filter((f) => f.endsWith(".png")).sort()) {
  const img = PNG.sync.read(readFileSync(join(dir, file)));
  const hits = [];
  for (let x = 0; x < img.width; x++) {
    let run = 0;
    let color = null;
    for (let y = 0; y < img.height; y++) {
      const i = (img.width * y + x) << 2;
      const [r, g, b, a] = [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
      const saturated = a > 200 && (Math.max(r, g, b) - Math.min(r, g, b)) > 40;
      if (saturated && color === `${r},${g},${b}`) {
        run++;
        if (run >= 15) {
          hits.push({ x, y: y - run + 1, h: run, color });
          break;
        }
      } else {
        run = saturated ? 1 : 0;
        color = saturated ? `${r},${g},${b}` : null;
      }
    }
  }
  // merge adjacent x hits (a cursor is 1-3 px wide)
  const merged = [];
  for (const h of hits) {
    const last = merged.at(-1);
    if (last && h.x - last.x2 <= 2) Object.assign(last, { x2: h.x });
    else merged.push({ ...h, x2: h.x });
  }
  if (merged.length) {
    console.log(
      `${file}: ${merged.length} cursor-like column(s): ` +
        merged.map((m) => `x=${m.x}-${m.x2} y=${m.y} ${m.color}`).join("; "),
    );
  }
}
