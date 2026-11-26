// favicon.mjs — browser-tab favicon from the molecule mark: the black mark's
// path on a white rounded square, centred on its bounds. One fixed look for every tab
// colour (a favicon cannot inherit the page's text colour).
//
//   node src/favicon.mjs --mark renders/molecule/molecule-ref.svg --out ../web/static/favicon.svg

import fsSync from 'node:fs';

const args = process.argv.slice(2);
const get = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d;
};

const markPath = get('mark', 'renders/molecule/molecule-ref.svg');
const boundsPath = get('bounds', markPath.replace(/\.svg$/, '.bounds.json'));
const outPath = get('out', 'favicon.svg');
const pad = parseFloat(get('pad', '0.095')); // fraction of the side kept clear
const radius = parseFloat(get('radius', '0.094')); // corner radius, fraction of the side (as the original favicon)

const d = /<path d="([^"]+)"/.exec(fsSync.readFileSync(markPath, 'utf8'))?.[1];
if (!d) {
  console.error(`No <path d="..."> found in ${markPath}`);
  process.exit(1);
}
const { x, y, w, h } = JSON.parse(fsSync.readFileSync(boundsPath, 'utf8')).bounds;
const side = Math.max(w, h) * (1 + 2 * pad);
const r = (n) => +n.toFixed(2);
const vx = r(x + w / 2 - side / 2);
const vy = r(y + h / 2 - side / 2);

fsSync.writeFileSync(
  outPath,
  `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vx} ${vy} ${r(side)} ${r(side)}">
<rect x="${vx}" y="${vy}" width="${r(side)}" height="${r(side)}" rx="${r(side * radius)}" fill="#fff"/>
<path d="${d}" fill="#000"/>
</svg>
`,
);
console.log(`wrote ${outPath}`);
