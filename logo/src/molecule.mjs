// molecule.mjs — the reference mark as exact parametric geometry.
//
// Measured from references/logo_suggestion_chatgpt.png via src/measure-ref.mjs
// (distance transform -> dot centers + bar width). Findings that invalidated the
// older generators:
//   * there is NO hub dot — four bars simply converge at a point
//   * bars are CONSTANT width round-capped, not tapered
//   * bar width / dot diameter = 0.365  (27px vs 74px)
//   * every concave corner carries a visible fillet — this is what reads as
//     "organic", and it is the whole point of the tracer below
//
// The mark is a TREE of circles (nodes) joined by constant-width capsules
// (edges), so its silhouette is a single closed curve that can be traced
// exactly with arcs and lines. No marching squares (polyline soup), no boolean
// ops (sharp corners), no filters.
//
//   node src/molecule.mjs --preset reference --out renders/molecule-ref.svg
//   node src/molecule.mjs --seed 1 --seed-end 6 --outdir renders/molecule
//   node src/molecule.mjs --set dotR=44,barW=24,fillet=8,jointFillet=18 --out x.svg

export const MOLECULE_DEFAULTS = {
  size: 512,
  dotR: 39.6,       // terminal radius in a 512 box (measured 38.6, IoU-refined)
  barW: 28.2,       // bar width, constant (measured)
  hubR: 15.0,       // junction node radius; bars converge, no visible dot
  fillet: 9.0,      // DOT-JOINT fillet: where a bar side runs into a node circle
  jointFillet: 16.0, // NOTCH fillet: where two converging bar sides cross
  margin: 24,       // auto-fit padding inside the box
  // --- generative knobs (ignored when --preset reference) ---
  arms: 4,          // bars leaving the junction
  chains: 2,        // how many arms carry a second, chained terminal
  armLen: 150,      // junction -> terminal distance
  chainLen: 128,    // terminal -> chained terminal distance
  spread: 0.55,     // angular jitter within each arm's slot (radians)
  chainTurn: 1.0,   // how far a chained bar bends off its parent direction (rad)
  minSep: 0.95,     // minimum angular separation between arms (radians)
  clearance: 1.15,  // min centre distance between unrelated dots, x (r_a + r_b)
};

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TAU = Math.PI * 2;

// ---------------------------------------------------------------- presets ---
// Literal transcription of the measured reference (512 box, uniform dot radius).
// Hub position: the distance-transform centroid (295.1, 248.0) is pulled off by
// the four bars' own ink; IoU fitting puts the true confluence at +18, -15.
export function referenceGraph(cfg) {
  const nodes = [
    { x: 313.1, y: 233.0, r: cfg.hubR, kind: 'hub' },
    { x: 326.4, y: 109.0, r: cfg.dotR, kind: 'terminal' }, // top
    { x: 168.9, y: 200.7, r: cfg.dotR, kind: 'terminal' }, // upper-left
    { x: 62.6, y: 269.6, r: cfg.dotR, kind: 'terminal' },  // far left (chained)
    { x: 166.8, y: 367.6, r: cfg.dotR, kind: 'terminal' }, // lower-left
    { x: 447.3, y: 302.9, r: cfg.dotR, kind: 'terminal' }, // right
    { x: 324.3, y: 404.1, r: cfg.dotR, kind: 'terminal' }, // bottom (chained)
  ];
  const edges = [
    { a: 0, b: 1 }, { a: 0, b: 2 }, { a: 2, b: 3 },
    { a: 0, b: 4 }, { a: 0, b: 5 }, { a: 5, b: 6 },
  ].map((e) => ({ ...e, w: cfg.barW }));
  return { nodes, edges };
}

// Seeded graph in the reference's structural language: a hub fan of `arms`,
// `chains` of which continue into a second terminal.
export function generateGraph(rng, cfg) {
  const c = cfg.size / 2;
  const nodes = [{ x: c, y: c, r: cfg.hubR, kind: 'hub' }];
  const edges = [];
  const slot = TAU / cfg.arms;
  const jit = Math.max(0, Math.min(cfg.spread, slot - cfg.minSep) / 2);
  const start = rng() * TAU;
  const armIds = [];
  const armAngles = [];
  for (let i = 0; i < cfg.arms; i++) {
    const a = start + i * slot + (rng() * 2 - 1) * jit;
    const len = cfg.armLen * (0.88 + rng() * 0.24);
    const id = nodes.length;
    nodes.push({ x: c + Math.cos(a) * len, y: c + Math.sin(a) * len, r: cfg.dotR, kind: 'terminal' });
    edges.push({ a: 0, b: id, w: cfg.barW });
    armIds.push(id); armAngles.push(a);
  }
  // pick which arms chain: spread them out so the mark stays lopsided but balanced
  const order = armIds.map((_, i) => i).sort(() => rng() - 0.5).slice(0, Math.min(cfg.chains, cfg.arms));

  // A chained dot that drifts back toward the cluster makes the silhouette
  // enclose negative space (seed 4 closed a ring before this guard) — the walk
  // assumes a TREE, so any near-collision is a layout bug, not a tracer bug.
  const clears = (x, y, skipId) => {
    let worst = Infinity;
    for (let k = 0; k < nodes.length; k++) {
      if (k === skipId || nodes[k].kind === 'hub') continue;
      const need = (nodes[k].r + cfg.dotR) * cfg.clearance;
      worst = Math.min(worst, Math.hypot(nodes[k].x - x, nodes[k].y - y) - need);
    }
    worst = Math.min(worst, Math.hypot(nodes[0].x - x, nodes[0].y - y) - (cfg.dotR + cfg.barW) * cfg.clearance);
    return worst;
  };
  for (const i of order) {
    const pid = armIds[i];
    const parent = nodes[pid];
    let bestPt = null, bestClear = -Infinity;
    for (let attempt = 0; attempt < 24; attempt++) {
      const sign = attempt % 2 === 0 ? 1 : -1;
      const mag = cfg.chainTurn * (0.55 + (attempt / 24) * 0.9);
      const a = armAngles[i] + sign * mag + (rng() - 0.5) * 0.25;
      const len = cfg.chainLen * (0.85 + rng() * 0.3);
      const x = parent.x + Math.cos(a) * len, y = parent.y + Math.sin(a) * len;
      const c2 = clears(x, y, pid);
      if (c2 > bestClear) { bestClear = c2; bestPt = { x, y }; }
      if (c2 > 0) break;
    }
    const id = nodes.length;
    nodes.push({ x: bestPt.x, y: bestPt.y, r: cfg.dotR, kind: 'terminal' });
    edges.push({ a: pid, b: id, w: cfg.barW });
  }
  return { nodes, edges };
}

// ------------------------------------------------------------- outline ---
const sub = (p, q) => [p[0] - q[0], p[1] - q[1]];
const add = (p, q) => [p[0] + q[0], p[1] + q[1]];
const mul = (p, k) => [p[0] * k, p[1] * k];
const dot = (p, q) => p[0] * q[0] + p[1] * q[1];
const len = (p) => Math.hypot(p[0], p[1]);
const norm = (p) => { const l = len(p) || 1; return [p[0] / l, p[1] / l]; };
const cw90 = (u) => [u[1], -u[0]];
const ang = (p) => Math.atan2(p[1], p[0]);
const wrap = (a) => { let x = a % TAU; if (x < 0) x += TAU; return x; };

const f2 = (v) => +v.toFixed(2);
const fx = (p) => `${f2(p[0])} ${f2(p[1])}`;
const arcCmd = (r, from, to, sweep, large = false) => {
  if (len(sub(to, from)) < 1e-4) return '';
  return `A${f2(r)} ${f2(r)} 0 ${large ? 1 : 0} ${sweep} ${fx(to)}`;
};

// intersection of lines p1+t*d1 and p2+t*d2; null if near-parallel
function lineX(p1, d1, p2, d2) {
  const den = d1[0] * d2[1] - d1[1] * d2[0];
  if (Math.abs(den) < 1e-9) return null;
  const dp = sub(p2, p1);
  return add(p1, mul(d1, (dp[0] * d2[1] - dp[1] * d2[0]) / den));
}

/**
 * Trace the exact silhouette of a tree of circles joined by constant-width
 * capsules, filleting every concave corner.
 *
 * THE FILLET SYSTEM. Two structurally different concave corners occur, and
 * conflating them is what produced sharp V-spikes in the first version:
 *
 *   A. DOT JOINT — the node circle pokes out past the bar, so the bar's side
 *      line runs into the circle at an angle. The fillet is tangent to a LINE
 *      and a CIRCLE: its centre sits at distance r+f from the node centre and
 *      h+f from the bar axis, which pins it exactly.
 *
 *   B. NOTCH — two bars converge steeply enough that their facing sides cross
 *      BEFORE reaching the circle (the circle is swallowed). This is every
 *      corner of the reference's hub, since that hub has no dot. The fillet is
 *      the classic circle inscribed in the angle between TWO LINES.
 *
 * v003 inflated the node radius until case B degenerated into case A, then
 * bridged the remainder with a straight line — a hard corner exactly where the
 * reference is softest. Handling B natively is what restores the organic look.
 *
 * Returns an SVG path `d` string (single closed loop).
 */
export function traceOutline(graph, cfg) {
  const { nodes, edges } = graph;
  if (!edges.length) return '';
  const adj = nodes.map(() => []);
  for (const e of edges) {
    adj[e.a].push({ to: e.b, w: e.w });
    adj[e.b].push({ to: e.a, w: e.w });
  }
  // neighbours sorted CCW so we can find the successor edge of the walk
  for (let i = 0; i < nodes.length; i++) {
    adj[i].sort((p, q) =>
      ang(sub([nodes[p.to].x, nodes[p.to].y], [nodes[i].x, nodes[i].y])) -
      ang(sub([nodes[q.to].x, nodes[q.to].y], [nodes[i].x, nodes[i].y])));
  }
  const nextNeighbour = (at, from) => {
    const list = adj[at];
    const k = list.findIndex((n) => n.to === from);
    return list[(k + 1) % list.length];
  };

  const P = (i) => [nodes[i].x, nodes[i].y];
  // A node only needs to contain its widest bar. No inflation: converging bars
  // are resolved by the notch fillet, not by growing the circle to meet them.
  const radii = nodes.map((nd, i) => {
    let h = 0;
    for (const n of adj[i]) h = Math.max(h, n.w / 2);
    return Math.max(nd.r, h * 1.02);
  });

  // --- boundary walk: directed edges, interior kept on the left ---
  const walk = [];
  {
    let a = edges[0].a, b = edges[0].b, w = edges[0].w;
    const seen = new Set();
    let guard = edges.length * 4 + 8;
    while (guard-- > 0) {
      const k = a + '>' + b;
      if (seen.has(k)) break;
      seen.add(k);
      walk.push({ from: a, to: b, w });
      const nxt = nextNeighbour(b, a);
      a = b; b = nxt.to; w = nxt.w;
    }
  }

  // side line of a directed edge, offset onto the walking side
  const sideLine = (e) => {
    const n = P(e.from), m = P(e.to);
    const u = norm(sub(m, n));
    const s = cw90(u);
    const h = e.w / 2;
    return { u, s, h, n, m, p: add(n, mul(s, h)), L: len(sub(m, n)) };
  };

  const fDot = Math.max(0, cfg.fillet);
  const fJoint = Math.max(0, cfg.jointFillet > 0 ? cfg.jointFillet : cfg.fillet);

  // Corner between consecutive directed edges e1 (arriving at node) and e2
  // (leaving it). Returns the point where the boundary leaves e1's side line
  // (`in`), the arc commands, and where it rejoins e2's side line (`out`).
  const corner = (e1, e2) => {
    const A = sideLine(e1), B = sideLine(e2);
    const m = P(e1.to);
    const r = radii[e1.to];

    // does the case-A (line/circle) fillet even exist on both sides?
    const okA =
      r > A.h + 1e-6 && r > B.h + 1e-6 &&
      (r + fDot) ** 2 - (A.h + fDot) ** 2 > 0 &&
      (r + fDot) ** 2 - (B.h + fDot) ** 2 > 0;

    // case B test: facing side lines cross outside the node circle
    const X = lineX(A.p, A.u, B.p, B.u);
    const notch = !okA || (X && len(sub(X, m)) > r + 1e-6);

    if (notch && X) {
      // circle inscribed in the angle between ray(X,-A.u) and ray(X,+B.u)
      const back = mul(A.u, -1);
      const cosPhi = Math.max(-1, Math.min(1, dot(back, B.u)));
      const phi = Math.acos(cosPhi);
      if (phi > 1e-3 && Math.PI - phi > 1e-3) {
        const half = phi / 2;
        // keep tangent points on the bars, and never cut past the node centre
        const room = Math.min(A.L, B.L) * 0.42;
        const t = Math.min(fJoint / Math.tan(half), room);
        const rf = t * Math.tan(half);
        const pIn = add(X, mul(A.u, -t));
        const pOut = add(X, mul(B.u, t));
        return { in: pIn, out: pOut, cmds: [arcCmd(rf, pIn, pOut, 0)] };
      }
      return { in: X, out: X, cmds: [] }; // collinear bars: no corner at all
    }

    // --- case A: fillet -> node arc -> fillet ---
    // arrival side: line hits the circle at m - u*off + s*h
    const offA = Math.sqrt(Math.max(r * r - A.h * A.h, 0));
    const tA = Math.sqrt(Math.max((r + fDot) ** 2 - (A.h + fDot) ** 2, 0));
    const inPt = fDot > 0
      ? add(add(m, mul(A.s, A.h)), mul(A.u, -tA))
      : add(add(m, mul(A.s, A.h)), mul(A.u, -offA));
    const cA = add(add(m, mul(A.s, A.h + fDot)), mul(A.u, -tA));
    const tanA = fDot > 0 ? add(m, mul(norm(sub(cA, m)), r))
                          : inPt;

    const offB = Math.sqrt(Math.max(r * r - B.h * B.h, 0));
    const tB = Math.sqrt(Math.max((r + fDot) ** 2 - (B.h + fDot) ** 2, 0));
    const outPt = fDot > 0
      ? add(add(m, mul(B.s, B.h)), mul(B.u, tB))
      : add(add(m, mul(B.s, B.h)), mul(B.u, offB));
    const cB = add(add(m, mul(B.s, B.h + fDot)), mul(B.u, tB));
    const tanB = fDot > 0 ? add(m, mul(norm(sub(cB, m)), r))
                          : outPt;

    const delta = wrap(ang(sub(tanB, m)) - ang(sub(tanA, m)));
    const cmds = [];
    if (fDot > 0) cmds.push(arcCmd(fDot, inPt, tanA, 0));
    cmds.push(arcCmd(r, tanA, tanB, 1, delta > Math.PI));
    if (fDot > 0) cmds.push(arcCmd(fDot, tanB, outPt, 0));
    return { in: inPt, out: outPt, cmds };
  };

  const n = walk.length;
  const corners = walk.map((e, i) => corner(e, walk[(i + 1) % n]));

  // start on edge 0's side line, at the point the previous corner handed over
  const cmds = [`M${fx(corners[n - 1].out)}`];
  for (let i = 0; i < n; i++) {
    cmds.push(`L${fx(corners[i].in)}`);
    for (const c of corners[i].cmds) if (c) cmds.push(c);
  }
  cmds.push('Z');
  return cmds.join('');
}

// --------------------------------------------------------------- render ---
export function renderMolecule({ seed = 1, preset = null, ...overrides } = {}) {
  const cfg = { ...MOLECULE_DEFAULTS, ...overrides };
  const graph = preset === 'reference'
    ? referenceGraph(cfg)
    : generateGraph(mulberry32(seed), cfg);

  // auto-fit the ink into the box (seeds can overflow; the lockup needs bounds)
  {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const nd of graph.nodes) {
      const r = Math.max(nd.r, cfg.barW / 2);
      minX = Math.min(minX, nd.x - r); maxX = Math.max(maxX, nd.x + r);
      minY = Math.min(minY, nd.y - r); maxY = Math.max(maxY, nd.y + r);
    }
    const span = Math.max(maxX - minX, maxY - minY);
    const fit = (cfg.size - 2 * cfg.margin) / span;
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    for (const nd of graph.nodes) {
      nd.x = (nd.x - cx) * fit + cfg.size / 2;
      nd.y = (nd.y - cy) * fit + cfg.size / 2;
      nd.r *= fit;
    }
    for (const e of graph.edges) e.w *= fit;
    cfg.fillet *= fit; cfg.jointFillet *= fit; cfg.hubR *= fit; cfg.barW *= fit;
  }

  const d = traceOutline(graph, cfg);

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const nd of graph.nodes) {
    const r = Math.max(nd.r, cfg.barW / 2);
    minX = Math.min(minX, nd.x - r); maxX = Math.max(maxX, nd.x + r);
    minY = Math.min(minY, nd.y - r); maxY = Math.max(maxY, nd.y + r);
  }
  const bounds = { x: f2(minX), y: f2(minY), w: f2(maxX - minX), h: f2(maxY - minY) };

  const svg =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${cfg.size} ${cfg.size}">\n` +
    `<path d="${d}" fill="#000"/>\n</svg>\n`;
  return { svg, bounds, graph, cfg };
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
  const overrides = {};
  for (const kv of get('set', '').split(',').filter(Boolean)) {
    const [k, v] = kv.split('=');
    if (k && v !== undefined && k in MOLECULE_DEFAULTS) overrides[k] = parseFloat(v);
  }
  const preset = get('preset', null);
  const seedEnd = parseInt(get('seed-end', get('seed', '1')), 10);
  const seedStart = args.includes('--seed-end') ? parseInt(get('seed', '1'), 10) : seedEnd;
  const outdir = get('outdir', null);
  const single = get('out', null);

  const jobs = [];
  if (outdir) for (let s = seedStart; s <= seedEnd; s++) jobs.push([s, `${outdir}/molecule-${String(s).padStart(3, '0')}.svg`]);
  else if (single) jobs.push([seedEnd, single]);
  else { process.stdout.write(renderMolecule({ seed: seedEnd, preset, ...overrides }).svg); process.exit(0); }

  for (const [s, file] of jobs) {
    fs.mkdirSync(path.dirname(file) || '.', { recursive: true });
    const { svg, bounds } = renderMolecule({ seed: s, preset, ...overrides });
    fs.writeFileSync(file, svg);
    fs.writeFileSync(file.replace(/\.svg$/, '.bounds.json'), JSON.stringify({ seed: s, preset, ...overrides, bounds }) + '\n');
    console.log(`wrote ${file} (seed ${s}${preset ? ', preset ' + preset : ''})`);
  }
}
