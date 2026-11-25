// concepts.mjs — second-round logo concepts (refined plateau + mesh, plus new ideas).
// Pure (params -> SVG string), zero deps, 512 box, single colour (`currentColor`-style #000).
// Strokes are used for speed of exploration; outline them (e.g. paper.js strokeToPath)
// before hand-off, per AGENTS.md conventions.
//
//   node src/concepts.mjs --outdir renders/concepts

import { mulberry32, referenceGraph, MOLECULE_DEFAULTS } from './molecule.mjs';

const f = (n) => +n.toFixed(2);
const svg = (body, defs = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${defs}${body}</svg>\n`;
const circ = (x, y, r) => `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}"/>`;
const line = (a, b) => `M${f(a[0])} ${f(a[1])}L${f(b[0])} ${f(b[1])}`;
const poly = (pts) => 'M' + pts.map((p) => `${f(p[0])} ${f(p[1])}`).join('L');
const G = (attrs, inner) => `<g ${attrs}>${inner}</g>`;
const ink = 'fill="none" stroke="#000" stroke-linecap="round" stroke-linejoin="round"';

// ------------------------------------------------------------ A. plateaus ---
// Layered isometric plates. A1: classic stack (solid top plate, chevron slabs).
// Rhombus vertices for centre (cx,cy), half-width w, half-height h.
const rhombus = (cx, cy, w, h) => [[cx, cy - h], [cx + w, cy], [cx, cy + h], [cx - w, cy]];

export function plateauStack() {
  const w = 190, h = 95, step = 78, cx = 256;
  const ys = [150, 150 + step, 150 + 2 * step];
  const top = rhombus(cx, ys[0], w, h);
  const chev = (cy) => poly([[cx - w, cy], [cx, cy + h], [cx + w, cy]]);
  // slabs: stroked chevrons under a solid top plate; a hub-hole punches the top plate
  const body =
    `<path d="${poly(top)}Z" fill="#000" stroke="#000" stroke-width="22" stroke-linejoin="round"/>` +
    G(`${ink} stroke-width="26"`, `<path d="${chev(ys[1])}"/><path d="${chev(ys[2])}"/>`) +
    `<circle cx="${cx}" cy="${ys[0]}" r="26" fill="#fff"/>`;
  return svg(body);
}

// A2: three plates offset diagonally so they intersect (a *plateau* of plateaus),
// with one rhizome node on each plate's right corner, joined by a bar.
export function plateauNodes() {
  const w = 150, h = 75, cx = 220;
  const plates = [[cx + 40, 150], [cx, 238], [cx - 40, 326]];
  let g = '';
  // bottom plate first; white fill lets each upper plate occlude the one beneath it
  [...plates].reverse().forEach(([x, y]) => (g += `<path d="${poly(rhombus(x, y, w, h))}Z" fill="#fff"/>`));
  const tips = plates.map(([x, y]) => [x + w, y]);
  const rail = `<path d="${poly(tips.map(([x, y]) => [x + 40, y]))}"/>`;
  const dots = tips.map(([x, y]) => circ(x + 40, y, 30)).join('');
  return svg(
    G(`${ink} stroke-width="18"`, g) +
      G(`${ink} stroke-width="22"`, rail) +
      `<g fill="#000">${dots}</g>`,
  );
}

// -------------------------------------------------------------- B. mesh ----
// Warped grid with thick, deliberate strokes; surviving crossings become nodes.
// Jitter once per node, drop edges, then drop any dangling single-edge stubs.
export function warpedMesh({ seed = 3, n = 4, size = 330, warp = 70, drop = 0.14, stroke = 20, nodeR = 28 } = {}) {
  const rng = mulberry32(seed);
  const c = 256, half = size / 2;
  const P = [];
  for (let i = 0; i < n; i++) {
    P[i] = [];
    for (let j = 0; j < n; j++) {
      // warp grows toward one corner: tidy top-left, torn bottom-right (cover #2)
      const k = ((i + j) / (2 * (n - 1))) ** 1.2;
      P[i][j] = [
        c - half + (i / (n - 1)) * size + (rng() - 0.5) * warp * (0.25 + k),
        c - half + (j / (n - 1)) * size + (rng() - 0.5) * warp * (0.25 + k),
      ];
    }
  }
  const edges = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const k = ((i + j) / (2 * (n - 1)));
    if (i < n - 1 && rng() > drop * k * 2) edges.push([[i, j], [i + 1, j]]);
    if (j < n - 1 && rng() > drop * k * 2) edges.push([[i, j], [i, j + 1]]);
  }
  const deg = new Map();
  const key = ([i, j]) => `${i},${j}`;
  edges.forEach(([a, b]) => { deg.set(key(a), (deg.get(key(a)) || 0) + 1); deg.set(key(b), (deg.get(key(b)) || 0) + 1); });
  let d = '';
  edges.forEach(([a, b]) => { d += line(P[a[0]][a[1]], P[b[0]][b[1]]); });
  // nodes where >=3 edges meet (real junctions), so the dots mean something
  let dots = '';
  deg.forEach((v, k) => { if (v >= 3) { const [i, j] = k.split(',').map(Number); dots += circ(...P[i][j], nodeR); } });
  return svg(G(`${ink} stroke-width="${stroke}"`, `<path d="${d}"/>`) + `<g fill="#000">${dots}</g>`);
}

// ------------------------------------------------------------ C. R graph ---
// Monogram "R" drawn as a node-and-bar graph (bars thick, dots at terminals).
export function monogramR() {
  const bar = 40, dotR = 40;
  const stem = [[170, 100], [170, 412]];
  const bowl = [[170, 100], [300, 100], [356, 168], [300, 250], [170, 250]];
  const leg = [[250, 250], [370, 412]];
  const dots = [stem[0], stem[1], leg[1], bowl[2]].map((p) => circ(...p, dotR)).join('');
  return svg(
    G(`${ink} stroke-width="${bar}"`, `<path d="${poly(stem)}"/><path d="${poly(bowl)}"/><path d="${poly(leg)}"/>`) +
      `<g fill="#000">${dots}</g>`,
  );
}

// ---------------------------------------------------------- D. zz network ---
// "Rhizz": a Z drawn as a network, with one shoot growing off the diagonal.
export function zigzagNet() {
  const pts = [[128, 128], [384, 128], [128, 384], [384, 384]];
  const mid = [256, 256];
  const shoot = [[256, 256], [404, 256]];
  const dots = [...pts, shoot[1]].map((p, i) => circ(...p, i === 4 ? 30 : 38)).join('');
  return svg(
    G(`${ink} stroke-width="34"`, `<path d="${poly(pts)}"/>`) +
      G(`${ink} stroke-width="24"`, `<path d="${poly(shoot)}"/>`) +
      `<g fill="#000">${dots}${circ(...mid, 0)}</g>`,
  );
}

// ------------------------------------------------------ E. nested systems ---
// system -> subsystem -> component as nested rounded squares, stepped toward the
// bottom-right, with one edge from the inner node breaking out through all
// boundaries (gaps are masked so it reads as an edge, not a scribble).
export function nestedSystems() {
  const rects = [[56, 56, 400, 56], [136, 136, 270, 40], [216, 216, 140, 26]];
  const node = [286, 286], out = [96, 96];
  const mask = `<mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="512" height="512">` +
    `<rect width="512" height="512" fill="#fff"/>` +
    `<path d="${line(node, out)}" stroke="#000" stroke-width="46" stroke-linecap="butt" fill="none"/></mask>`;
  const rs = rects.map(([x, y, s, r]) => `<rect x="${x}" y="${y}" width="${s}" height="${s}" rx="${r}"/>`).join('');
  return svg(
    `<g mask="url(#m)">${G(`${ink} stroke-width="16"`, rs)}</g>` +
      G(`${ink} stroke-width="16"`, `<path d="${line(node, out)}"/>`) +
      `<g fill="#000">${circ(...node, 30)}${circ(...out, 30)}</g>`,
    `<defs>${mask}</defs>`,
  );
}

// ------------------------------------------------------------- F. rhizome ---
// A literal rhizome: a creeping stem with swollen nodes, shoots up, roots down.
export function rhizomeStem() {
  const B = (t) => { // cubic bezier
    const [p0, p1, p2, p3] = [[44, 318], [170, 250], [290, 390], [468, 262]];
    const u = 1 - t;
    return [0, 1].map((k) => u ** 3 * p0[k] + 3 * u * u * t * p1[k] + 3 * u * t * t * p2[k] + t ** 3 * p3[k]);
  };
  const stem = `<path d="M44 318C170 250 290 390 468 262"/>`;
  const nodes = [0.24, 0.52, 0.8].map(B);
  const shoots = [[-22, -118], [34, -150], [-6, -96]];
  const roots = [[-28, 66], [30, 84], [-20, 56]];
  let up = '', dn = '', dots = '';
  nodes.forEach(([x, y], i) => {
    up += `<path d="${line([x, y], [x + shoots[i][0], y + shoots[i][1]])}"/>`;
    dn += `<path d="${line([x, y], [x + roots[i][0], y + roots[i][1]])}"/>`;
    dots += circ(x, y, 38) + circ(x + shoots[i][0], y + shoots[i][1], 32);
  });
  return svg(
    G(`${ink} stroke-width="34"`, stem) + G(`${ink} stroke-width="26"`, up) + `<g fill="#000">${dots}</g>`,
  );
}

export const CONCEPTS = {
  'plateau-stack': plateauStack,
  'plateau-nodes': plateauNodes,
  'mesh-warp-1': () => warpedMesh({ seed: 3 }),
  'mesh-warp-2': () => warpedMesh({ seed: 5 }),
  'monogram-r': monogramR,
  'zigzag-net': zigzagNet,
  'nested-systems': nestedSystems,
  'rhizome-stem': rhizomeStem,
};


// ============================================================ LIGHT SET ====
// Hairline-weight redraws after the two Thousand Plateaus covers: architectural
// wireframe (thin parallel line families, slender posts, scratchy overshoot) and
// a few accent weights. Nodes become small rings / pin dots instead of fat discs.
const ring = (x, y, r, w) => `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="#fff" stroke="#000" stroke-width="${w}"/>`;
const thin = (w) => `fill="none" stroke="#000" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;

// L1. rhizome, hairline: the measured molecule tree with thin bars and ring nodes,
// plus a few overshooting "scratch" lines like the cover's stray wireframe.
export function lightRhizome() {
  const { nodes, edges } = referenceGraph({ ...MOLECULE_DEFAULTS });
  const bars = edges.map((e) => `<path d="${line([nodes[e.a].x, nodes[e.a].y], [nodes[e.b].x, nodes[e.b].y])}"/>`).join('');
  // overshoot: extend each bar beyond its far node by a short, thinner stroke
  const over = edges.map((e) => {
    const a = nodes[e.a], b = nodes[e.b];
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
    return `<path d="${line([b.x + (dx / L) * 40, b.y + (dy / L) * 40], [b.x + (dx / L) * 78, b.y + (dy / L) * 78])}"/>`;
  }).join('');
  const rings = nodes.filter((n) => n.kind === 'terminal').map((n) => ring(n.x, n.y, 25, 4)).join('');
  const hub = circ(nodes[0].x, nodes[0].y, 7);
  return svg(G(thin(4), bars) + G(thin(1.4), over) + rings + `<g fill="#000">${hub}</g>`);
}

// L2. plateau slats (cover with the mustard field): stacked iso plates, each a thin
// outline with a family of parallel slat lines, joined by slender posts.
export function lightPlateauSlats() {
  const w = 190, h = 92, cx = 256, ys = [330, 250, 170]; // draw bottom-up, white fill occludes
  let g = '';
  ys.forEach((cy, k) => {
    const [T, R, B, L] = rhombus(cx, cy, w, h);
    let slats = '';
    for (let i = 1; i <= 7; i++) {
      const s = i / 8;
      const a = [L[0] + (T[0] - L[0]) * s, L[1] + (T[1] - L[1]) * s];
      const b = [B[0] + (R[0] - B[0]) * s, B[1] + (R[1] - B[1]) * s];
      slats += `<path d="${line(a, b)}"/>`;
    }
    g += `<path d="${poly([T, R, B, L])}Z" fill="#fff" stroke="none"/>` +
      G(thin(1.6), slats) + G(thin(3.2), `<path d="${poly([T, R, B, L])}Z"/>`);
    if (k < 2) { // posts: left & right tips down to the plate below (drawn before the upper plate on top)
      g = `<g ${thin(2)}><path d="${line(L, [L[0], L[1] + 80])}"/><path d="${line(R, [R[0], R[1] + 80])}"/></g>` + g;
    }
  });
  // two stray overshooting rods, like the cover's loose structural members
  g += G(thin(1.4), `<path d="${line([cx - 40, 70], [cx - 40, 196])}"/><path d="${line([cx + 110, 140], [cx + 110, 250])}"/>`);
  return svg(g);
}

// L3. sail (dark cover): a fan of ribs from one root, arched cross-ribs, terminal pins.
export function lightSail() {
  const root = [120, 440], n = 9;
  const ribs = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const ang = (-84 + t * 70) * Math.PI / 180; // up -> right
    const len = 330 - Math.abs(t - 0.35) * 150 + (i === 0 ? 40 : 0);
    ribs.push([root[0] + Math.cos(ang) * len, root[1] + Math.sin(ang) * len * 1.05]);
  }
  let rib = '', cross = '', pins = '';
  ribs.forEach((e) => { rib += `<path d="${line(root, e)}"/>`; pins += circ(e[0], e[1], 6.5); });
  for (const k of [0.3, 0.45, 0.6, 0.75, 0.9]) {
    cross += `<path d="${poly(ribs.map((e) => [root[0] + (e[0] - root[0]) * k, root[1] + (e[1] - root[1]) * k]))}"/>`;
  }
  return svg(G(thin(3), rib) + G(thin(1.5), cross) + `<g fill="#000">${pins}${circ(...root, 8)}</g>`);
}

// L4. fine mesh: warped hairline grid, torn toward the bottom-right, with one rhizome
// walking the grid in a heavier stroke and terminating in a ring.
export function lightMesh({ seed = 4, n = 8, size = 380, warp = 56 } = {}) {
  const rng = mulberry32(seed);
  const c = 256, half = size / 2;
  const P = [];
  for (let i = 0; i < n; i++) { P[i] = []; for (let j = 0; j < n; j++) {
    const k = ((i + j) / (2 * (n - 1))) ** 1.3;
    P[i][j] = [c - half + (i / (n - 1)) * size + (rng() - 0.5) * warp * (0.2 + k),
               c - half + (j / (n - 1)) * size + (rng() - 0.5) * warp * (0.2 + k)];
  } }
  const keep = new Map(); // edge key -> [a,b]
  const ek = (a, b) => [a, b].map((p) => p.join(',')).sort().join('|');
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const k = (i + j) / (2 * (n - 1));
    if (i < n - 1 && rng() > k * 0.9) keep.set(ek([i, j], [i + 1, j]), [[i, j], [i + 1, j]]);
    if (j < n - 1 && rng() > k * 0.9) keep.set(ek([i, j], [i, j + 1]), [[i, j], [i, j + 1]]);
  }
  let d = '';
  keep.forEach(([a, b]) => { d += line(P[a[0]][a[1]], P[b[0]][b[1]]); });
  // the walker: from top-left, prefer moving right/down along surviving edges
  let cur = [0, 0], visited = new Set(['0,0']), walk = [P[0][0]];
  for (let s = 0; s < 9; s++) {
    const opts = [[1, 0], [0, 1], [1, 1], [-1, 0], [0, -1]].map(([di, dj]) => [cur[0] + di, cur[1] + dj])
      .filter(([i, j]) => i >= 0 && j >= 0 && i < n && j < n && !visited.has(`${i},${j}`) && keep.has(ek(cur, [i, j])));
    if (!opts.length) break;
    cur = opts[Math.floor(rng() * Math.min(2, opts.length))];
    visited.add(cur.join(',')); walk.push(P[cur[0]][cur[1]]);
  }
  return svg(
    G(thin(1.8), `<path d="${d}"/>`) + G(thin(6), `<path d="${poly(walk)}"/>`) +
      ring(...walk[0], 11, 4) + ring(...walk[walk.length - 1], 16, 4.5),
  );
}

// L5. offset plates joined by one thin spine with ring nodes.
export function lightPlateauNodes() {
  const w = 150, h = 75, cx = 220;
  const plates = [[cx - 40, 326], [cx, 238], [cx + 40, 150]];
  let g = '';
  plates.forEach(([x, y]) => { g += `<path d="${poly(rhombus(x, y, w, h))}Z" fill="#fff" stroke="#000" stroke-width="3.2" stroke-linejoin="round"/>`; });
  const tips = plates.map(([x, y]) => [x + w + 36, y]);
  return svg(g + G(thin(3.2), `<path d="${poly(tips)}"/>` + plates.map(([x, y], i) => `<path d="${line([x + w, y], tips[i])}"/>`).join('')) +
    tips.map((t) => ring(...t, 17, 4)).join(''));
}

// L6. nested systems, hairline, with ring nodes on the broken-out edge.
export function lightNested() {
  const rects = [[56, 56, 400, 52], [128, 128, 272, 38], [200, 200, 144, 24]];
  const node = [272, 272], out = [92, 92];
  const mask = `<mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="512" height="512"><rect width="512" height="512" fill="#fff"/>` +
    `<path d="${line(node, out)}" stroke="#000" stroke-width="30" fill="none"/></mask>`;
  const rs = rects.map(([x, y, s, r]) => `<rect x="${x}" y="${y}" width="${s}" height="${s}" rx="${r}"/>`).join('');
  return svg(`<g mask="url(#m)">${G(thin(3.2), rs)}</g>` + G(thin(3.2), `<path d="${line(node, out)}"/>`) +
    ring(...node, 15, 4) + `<circle cx="${node[0]}" cy="${node[1]}" r="4"/>` + ring(...out, 15, 4), `<defs>${mask}</defs>`);
}

// L7. zz: a double-line Z (architectural parallel) with ring corners.
export function lightZigzag() {
  const pts = [[128, 128], [384, 128], [128, 384], [384, 384]];
  const off = (dx, dy) => pts.map(([x, y]) => [x + dx, y + dy]);
  return svg(
    G(thin(4.5), `<path d="${poly(pts)}"/>`) + G(thin(1.6), `<path d="${poly(off(16, 16))}"/><path d="${poly(off(-16, -16))}"/>`) +
      pts.map((p) => ring(...p, 20, 4.5)).join('') + `<g fill="#000">${circ(256, 256, 7)}</g>`,
  );
}

export const LIGHT = {
  'light-rhizome': lightRhizome,
  'light-plateau-slats': lightPlateauSlats,
  'light-sail': lightSail,
  'light-mesh-1': () => lightMesh({ seed: 4 }),
  'light-mesh-2': () => lightMesh({ seed: 11 }),
  'light-plateau-nodes': lightPlateauNodes,
  'light-nested': lightNested,
  'light-zigzag': lightZigzag,
};

const isCLI = typeof process !== 'undefined' && process.argv && import.meta.url === `file://${process.argv[1]}`;
if (isCLI) {
  const fs = await import('node:fs');
  const i = process.argv.indexOf('--outdir');
  const outdir = i >= 0 ? process.argv[i + 1] : 'renders/concepts';
  fs.mkdirSync(outdir, { recursive: true });
  for (const [name, fn] of Object.entries({ ...CONCEPTS, ...LIGHT })) {
    fs.writeFileSync(`${outdir}/${name}.svg`, fn());
    console.log(`wrote ${outdir}/${name}.svg`);
  }
}
