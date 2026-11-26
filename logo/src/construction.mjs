// construction.mjs — a construction drawing of the molecule mark.
//
// Draws the mark in grey with the exact geometry the tracer used laid over it:
// node circles, bar axes and sides, every fillet circle, the notch vertices at
// the hidden hub, the bounding square and the enclosing circle. Nothing here is
// decorative guesswork — every guide comes out of molecule.mjs, so if the
// parameters change, the drawing stays truthful. Plain white background, no
// frame or text: just the mark and its geometry.
//
//   node src/construction.mjs --out renders/molecule/construction-ref.svg

import { renderMolecule } from './molecule.mjs';

const f2 = (v) => +v.toFixed(2);

const PALETTE = {
  paper: '#ffffff',
  ink: '#1a1a1a',
  fill: '#8c8c8c',
};

export function renderConstruction() {
  const { d, guides, graph, bounds } = renderMolecule({ preset: 'reference' });
  const PAD = 48; // white space around the enclosing circle

  // Enclosing circle: centred on the ink, just containing every dot. It sets
  // the canvas, so the drawing is centred with even padding on all sides.
  const cx = bounds.x + bounds.w / 2, cy = bounds.y + bounds.h / 2;
  let er = 0;
  for (const n of graph.nodes) er = Math.max(er, Math.hypot(n.x - cx, n.y - cy) + n.r);
  const S = Math.ceil(2 * (er + PAD));
  const tx = S / 2 - cx, ty = S / 2 - cy;
  const sw = (px) => f2(px);

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
  circle([cx, cy], er, 1.1);

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

  const svg = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}">`,
    `<rect width="${S}" height="${S}" fill="${PALETTE.paper}"/>`,
    `<g transform="translate(${f2(tx)} ${f2(ty)})">`,
    `<path d="${d}" fill="${PALETTE.fill}"/>`,
    `<g fill="none" stroke="${PALETTE.ink}">`,
    ...out,
    `</g>`,
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
  const { svg } = renderConstruction();
  const file = get('out', null);
  if (!file) { process.stdout.write(svg); process.exit(0); }
  fs.mkdirSync(path.dirname(file) || '.', { recursive: true });
  fs.writeFileSync(file, svg);
  console.log(`wrote ${file}`);
}
