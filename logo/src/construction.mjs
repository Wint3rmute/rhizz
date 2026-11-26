// construction.mjs — a "logo construction sheet" for the molecule mark.
//
// Draws the mark in grey with the exact geometry the tracer used laid over it:
// node circles, bar axes and sides, every fillet circle, the notch vertices at
// the hidden hub, the bounding square and the enclosing circle. Nothing here is
// decorative guesswork — every guide comes out of molecule.mjs, so if the
// parameters change, the sheet stays truthful.
//
//   node src/construction.mjs --out renders/molecule/construction-ref.svg
//   node src/construction.mjs --year 2026 --out x.svg

import { renderMolecule, MOLECULE_DEFAULTS } from './molecule.mjs';

const f2 = (v) => +v.toFixed(2);

const PALETTE = {
  paper: '#ebebe8',
  ink: '#1a1a1a',
  fill: '#8c8c8c',
};

// Greedy word wrap — the sheet uses a fixed text size, so a char budget is enough.
function wrap(text, maxChars) {
  const lines = [];
  let line = '';
  for (const w of text.split(/\s+/)) {
    if (line && (line + ' ' + w).length > maxChars) { lines.push(line); line = w; }
    else line = line ? line + ' ' + w : w;
  }
  if (line) lines.push(line);
  return lines;
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

export function renderConstruction({ title = 'Rhizz', subtitle = 'Molecule mark', year = '2026' } = {}) {
  const { d, guides, graph, bounds } = renderMolecule({ preset: 'reference' });
  const S = 1000;          // sheet size
  const M = 30;            // outer margin to the frame
  const HEAD = 75;         // header row height
  const box = { x: 720, y: 690, w: S - M - 720, h: S - M - 690 }; // final-mark box
  const body = { x: M, y: M + HEAD, w: S - 2 * M, h: box.y - M - HEAD };

  // Mark (512 box) -> drawing area: centred on the ink, scaled to fit the body.
  const scale = 1.14;
  const cx = bounds.x + bounds.w / 2, cy = bounds.y + bounds.h / 2;
  const tx = body.x + body.w / 2 - cx * scale;
  const ty = body.y + body.h / 2 + 10 - cy * scale;
  const sw = (px) => f2(px / scale); // stroke widths in sheet px

  const out = [];
  const g = (s) => out.push(s);
  const circle = (c, r, w, extra = '') =>
    g(`<circle cx="${f2(c[0])}" cy="${f2(c[1])}" r="${f2(r)}" stroke-width="${sw(w)}"${extra}/>`);
  const line = (a, b, w, extra = '') =>
    g(`<line x1="${f2(a[0])}" y1="${f2(a[1])}" x2="${f2(b[0])}" y2="${f2(b[1])}" stroke-width="${sw(w)}"${extra}/>`);

  const nodes = graph.nodes;
  const P = (n) => [n.x, n.y];
  const hub = nodes.find((n) => n.kind === 'hub');

  // --- construction layer -------------------------------------------------
  // enclosing circle: centred on the ink, just containing every dot
  const ec = [cx, cy];
  let er = 0;
  for (const n of nodes) er = Math.max(er, Math.hypot(n.x - cx, n.y - cy) + n.r);
  circle(ec, er, 1.1);

  // bounding square of the ink
  const side = Math.max(bounds.w, bounds.h);
  g(`<rect x="${f2(cx - side / 2)}" y="${f2(cy - side / 2)}" width="${f2(side)}" height="${f2(side)}" stroke-width="${sw(1.1)}"/>`);

  // bar axes, extended past both nodes as dashed construction lines
  for (const e of graph.edges) {
    const a = P(nodes[e.a]), b = P(nodes[e.b]);
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    const ext = 70;
    line([a[0] - u[0] * ext, a[1] - u[1] * ext], [b[0] + u[0] * ext, b[1] + u[1] * ext], 0.6, ` stroke-dasharray="${sw(4)} ${sw(4)}"`);
    // bar sides (the constant width), only where they are not inside a dot
    const h = e.w / 2;
    const s = [u[1] * h, -u[0] * h];
    const trim = (n) => (n.kind === 'hub' ? 0 : Math.sqrt(Math.max(n.r * n.r - h * h, 0)));
    const t0 = trim(nodes[e.a]), t1 = L - trim(nodes[e.b]);
    for (const k of [1, -1]) {
      const p0 = [a[0] + u[0] * t0 + k * s[0], a[1] + u[1] * t0 + k * s[1]];
      const p1 = [a[0] + u[0] * t1 + k * s[0], a[1] + u[1] * t1 + k * s[1]];
      line(p0, p1, 0.7);
    }
  }

  // terminal dots
  for (const n of nodes) if (n.kind !== 'hub') circle(P(n), n.r, 1.2);

  // fillets: dot joints and hub notches
  for (const f of guides) circle(f.c, f.r, 0.8);

  // hub: notch vertices + crosshair
  for (const f of guides) if (f.kind === 'notch') circle(f.x, 1.8, 0, ` fill="${PALETTE.ink}" stroke="none"`);
  const ch = 14;
  line([hub.x - ch, hub.y], [hub.x + ch, hub.y], 0.9);
  line([hub.x, hub.y - ch], [hub.x, hub.y + ch], 0.9);

  // node centres
  for (const n of nodes) if (n.kind !== 'hub') {
    line([n.x - 4, n.y], [n.x + 4, n.y], 0.7);
    line([n.x, n.y - 4], [n.x, n.y + 4], 0.7);
  }

  // --- reference text -----------------------------------------------------
  const D = MOLECULE_DEFAULTS;
  const terminals = nodes.filter((n) => n.kind !== 'hub').length;
  const arms = graph.edges.filter((e) => nodes[e.a].kind === 'hub' || nodes[e.b].kind === 'hub').length;
  const ref =
    `The Rhizz mark is a tree, not a drawing: ${terminals} dots joined by ${graph.edges.length} bars of ` +
    `constant width. ${arms} bars converge on a hub that has no dot of its own. Dot radius ${D.dotR}, ` +
    `bar width ${D.barW} (${(D.barW / (2 * D.dotR)).toFixed(3)} of a dot's diameter). ` +
    `Every concave corner is filleted: r ${D.fillet} where a bar runs into a dot, and a fixed ` +
    `${D.jointTangent}-unit tangent where two bars notch at the hub. The silhouette is traced as one ` +
    `closed curve of lines and arcs by logo/src/molecule.mjs.`;
  const refLines = wrap(ref, 78);

  const font = `font-family="Roboto, Inter, Helvetica, Arial, sans-serif"`;
  const svg = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}">`,
    `<defs><clipPath id="body"><rect x="${body.x}" y="${body.y}" width="${body.w}" height="${body.h}"/></clipPath></defs>`,
    `<rect width="${S}" height="${S}" fill="${PALETTE.paper}"/>`,
    // frame + header + final-mark box
    `<g fill="none" stroke="${PALETTE.ink}" stroke-width="2">`,
    `<rect x="${M}" y="${M}" width="${S - 2 * M}" height="${S - 2 * M}"/>`,
    `<line x1="${M}" y1="${M + HEAD}" x2="${S - M}" y2="${M + HEAD}"/>`,
    `<line x1="370" y1="${M}" x2="370" y2="${M + HEAD}"/>`,
    `<line x1="720" y1="${M}" x2="720" y2="${M + HEAD}"/>`,
    `<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" stroke-width="1.5"/>`,
    `</g>`,
    `<g ${font} font-size="17" fill="${PALETTE.ink}" letter-spacing="0.4">`,
    `<text x="${M + 32}" y="${M + HEAD / 2 + 6}">${esc(title)}</text>`,
    `<text x="${370 + 32}" y="${M + HEAD / 2 + 6}">${esc(subtitle)}</text>`,
    `<text x="${720 + 32}" y="${M + HEAD / 2 + 6}">${esc(String(year))}</text>`,
    `</g>`,
    // drawing
    `<g clip-path="url(#body)">`,
    `<g transform="translate(${f2(tx)} ${f2(ty)}) scale(${scale})">`,
    `<path d="${d}" fill="${PALETTE.fill}"/>`,
    `<g fill="none" stroke="${PALETTE.ink}">`,
    ...out,
    `</g>`,
    `</g>`,
    `</g>`,
    // reference
    `<g ${font} fill="${PALETTE.ink}">`,
    `<text x="${M + 32}" y="${box.y + 40}" font-size="15" letter-spacing="1.2">REFERENCE</text>`,
    `<text x="${M + 32}" y="${box.y + 80}" font-size="15">`,
    ...refLines.map((l, i) => `<tspan x="${M + 32}" dy="${i ? 22 : 0}">${esc(l)}</tspan>`),
    `</text>`,
    `</g>`,
    // final mark
    `<g transform="translate(${f2(box.x + box.w / 2 - 256 * 0.42)} ${f2(box.y + box.h / 2 - 256 * 0.42)}) scale(0.42)">`,
    `<path d="${d}" fill="${PALETTE.ink}"/>`,
    `</g>`,
    `</svg>`,
    ``,
  ].join('\n');
  return { svg };
}

// ------------------------------------------------------------------ CLI ---
const isCLI = typeof process !== 'undefined' && process.argv && import.meta.url === `file://${process.argv[1]}`;
if (isCLI) {
  const args = process.argv.slice(2);
  const get = (k, d) => {
    const i = args.indexOf(`--${k}`);
    return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d;
  };
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { svg } = renderConstruction({ title: get('title', 'Rhizz'), subtitle: get('subtitle', 'Molecule mark'), year: get('year', '2026') });
  const file = get('out', null);
  if (!file) { process.stdout.write(svg); process.exit(0); }
  fs.mkdirSync(path.dirname(file) || '.', { recursive: true });
  fs.writeFileSync(file, svg);
  console.log(`wrote ${file}`);
}
