// favicon.mjs — browser-tab favicon from the molecule mark: the mark's path in a
// square viewBox centred on its bounds, black on light tabs and white on dark
// ones (a `prefers-color-scheme` rule inside the SVG, since a favicon cannot
// inherit the page's text colour).
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
const pad = parseFloat(get('pad', '0.04')); // fraction of the side kept clear

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
<style>path{fill:#000}@media (prefers-color-scheme:dark){path{fill:#fff}}</style>
<path d="${d}"/>
</svg>
`,
);
console.log(`wrote ${outPath}`);
