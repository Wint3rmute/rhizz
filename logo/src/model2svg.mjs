// model2svg.mjs — render a hand-authored node/edge model (editor format) through
// the metaball tracer. Same blobsToSvg as the editor, so what you see in the
// browser is what this bakes. Writes SVG + .bounds.json (lockup-compatible).
//
//   node src/model2svg.mjs editor/models/reference.json renders/reference-mark.svg
//   node src/model2svg.mjs editor/models/reference.json renders/reference-mark.svg --smooth 14 --grid 384

import { blobsToSvg } from './metaball.mjs';
import fs from 'node:fs';

const args = process.argv.slice(2);
const get = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d;
};

const [modelPath, outPath] = args;
if (!modelPath || !outPath) {
  console.error('usage: node src/model2svg.mjs model.json out.svg [--smooth 16 --grid 384 --discs 10]');
  process.exit(1);
}
const model = JSON.parse(fs.readFileSync(modelPath, 'utf8'));
const smooth = parseFloat(get('smooth', '16'));
const grid = parseInt(get('grid', '384'), 10);
const discsPer = parseInt(get('discs', '10'), 10);

const byId = new Map(model.nodes.map((n) => [n.id, n]));
const blobs = [];
for (const n of model.nodes) if (n.r > 0) blobs.push({ x: n.x, y: n.y, r: n.r });
for (const e of model.edges) {
  const a = byId.get(e.a), b = byId.get(e.b);
  for (let k = 0; k < discsPer; k++) {
    const t = discsPer === 1 ? 0 : k / (discsPer - 1);
    blobs.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, r: (e.w0 + (e.w1 - e.w0) * t) / 2 });
  }
}
const { svg, bounds } = blobsToSvg(blobs, { smooth, grid, chaikin: 2 }, 512, { recenter: false });
fs.writeFileSync(outPath, svg);
fs.writeFileSync(outPath.replace(/\.svg$/, '.bounds.json'), JSON.stringify({ model: modelPath, smooth, grid, bounds }) + '\n');
console.log(`wrote ${outPath} (${model.nodes.length} nodes, ${model.edges.length} edges, smooth ${smooth})`);
