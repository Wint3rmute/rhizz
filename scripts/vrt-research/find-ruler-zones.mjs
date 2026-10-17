#!/usr/bin/env node
// Scan VRT baselines for the Monaco overview-ruler cursor zone: a ~13x2 px
// saturated block at the TOP of the 14px-wide ruler strip at the right edge
// (x=1267..1279, y=45..46 at the default viewport). Prints the two dominant
// colours so a theme flip's colour drift can be spotted (the zone is painted
// with editorCursor.foreground of whatever theme was active when the ruler
// last rendered).
// usage: node find-ruler-zones.mjs <screenshotsDir>
import { createRequire } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(new URL("../../web/package.json", import.meta.url));
const { PNG } = require("pngjs");

const dir = process.argv[2] ?? "../vrt/__screenshots__";
for (const file of readdirSync(dir).filter((f) => f.endsWith(".png")).sort()) {
  const img = PNG.sync.read(readFileSync(join(dir, file)));
  if (img.width !== 1280) continue; // zone position is viewport-relative
  // A cursor zone is a saturated, non-text-coloured block in the top 2 rows
  // of the ruler strip. Text pixels are narrow and vary per column.
  const rowHits = (y) => {
    let n = 0;
    for (let x = 1267; x <= 1279; x++) {
      const i = (img.width * y + x) << 2;
      const [r, g, b] = [img.data[i], img.data[i + 1], img.data[i + 2]];
      const sat = Math.max(r, g, b) - Math.min(r, g, b);
      if (sat > 60) n++;
    }
    return n;
  };
  const y45 = rowHits(45);
  const y46 = rowHits(46);
  if (y45 + y46 >= 20) {
    const sample = (y) => {
      const i = (img.width * y + 1273) << 2;
      return [img.data[i], img.data[i + 1], img.data[i + 2]].join(",");
    };
    console.log(
      `${file}: zone y45=${y45}/13 y46=${y46}/13 colours ${sample(45)} / ${sample(46)}`,
    );
  }
}
