// hybrid.mjs — mesh × rhizome merge: the rhizome grows ON the warped grid.
// Branches walk grid-node to grid-node (faceted mesh-like paths), terminals are
// dots, and the torn grid shows through faintly underneath.
//
//   node src/hybrid.mjs --seed 1 --seed-end 4 --outdir renders/hybrid

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

export const HYBRID_DEFAULTS = {
  size: 512,
  grid: 9, // grid nodes per side (odd → true center node for the hub)
  gridSize: 360,
  warp: 40,
  dropP: 0.28, // torn grid: fraction of mesh edges omitted
  branches: 5,
  steps: 3, // grid steps per branch
  walkStroke: 16,
  gridStroke: 2,
  gridOpacity: 0.22,
  nodeR: 20,
  hubR: 26,
  bifurcateP: 0.6, // chance of one child fork per branch
};

function buildGrid(rng, cfg, c) {
  const n = cfg.grid, half = cfg.gridSize / 2;
  const P = [];
  for (let i = 0; i < n; i++) {
    P[i] = [];
    for (let j = 0; j < n; j++) {
      P[i][j] = [
        c - half + (i / (n - 1)) * cfg.gridSize + (rng() - 0.5) * cfg.warp,
        c - half + (j / (n - 1)) * cfg.gridSize + (rng() - 0.5) * cfg.warp,
      ];
    }
  }
  return P;
}

const key = (i, j) => i + ',' + j;

// grid walk with momentum + outward bias; returns list of [x, y] points
function walk(rng, P, n, si, sj, heading, steps, visited, outwardW = 0.9) {
  let ci = si, cj = sj;
  const pts = [P[ci][cj]];
  visited.add(key(ci, cj));
  for (let s = 0; s < steps; s++) {
    let best = null, bestScore = -Infinity, bestAngle = heading;
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      if (!di && !dj) continue;
      const ni = ci + di, nj = cj + dj;
      if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
      if (visited.has(key(ni, nj))) continue;
      const [x1, y1] = P[ci][cj], [x2, y2] = P[ni][nj];
      const ang = Math.atan2(y2 - y1, x2 - x1);
      const outward = Math.atan2(y1 - 256, x1 - 256); // from canvas center
      const score = Math.cos(ang - heading) * 1.5 + Math.cos(ang - outward) * outwardW + rng() * 0.9;
      if (score > bestScore) { bestScore = score; best = [ni, nj]; bestAngle = ang; }
    }
    if (!best) break; // boxed in — end the walk
    [ci, cj] = best;
    heading = bestAngle;
    visited.add(key(ci, cj));
    pts.push(P[ci][cj]);
  }
  return { pts, heading };
}

export function generateHybrid({ seed = 1, size = 512, ...overrides } = {}) {
  const cfg = { ...HYBRID_DEFAULTS, size, ...overrides };
  const rng = mulberry32(seed);
  const c = size / 2, n = cfg.grid;
  const P = buildGrid(rng, cfg, c);
  const ctr = (n - 1) / 2; // center node indices (grid is odd)

  // — faint torn mesh underneath —
  let mesh = '';
  const seg = (a, b) => `<line x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}"/>`;
  for (let i = 0; i < n; i++) for (let j = 0; j < n - 1; j++) {
    if (rng() < cfg.dropP) continue;
    mesh += seg(P[i][j], P[i][j + 1]);
  }
  for (let j = 0; j < n; j++) for (let i = 0; i < n - 1; i++) {
    if (rng() < cfg.dropP) continue;
    mesh += seg(P[i][j], P[i + 1][j]);
  }

  // — rhizome walks on top —
  const visited = new Set();
  const walks = [];
  const terminals = [];
  const startAngle = rng() * TAU;
  const slot = TAU / cfg.branches;
  const maxJit = Math.max(0, slot / 2 - 0.25);
  for (let b = 0; b < cfg.branches; b++) {
    const heading = startAngle + b * slot + (rng() * 2 - 1) * maxJit;
    const { pts, heading: endH } = walk(rng, P, n, ctr, ctr, heading, cfg.steps, visited);
    if (pts.length > 1) walks.push(pts);
    // one child fork, like the rhizome's bifurcation
    if (pts.length > 2 && rng() < cfg.bifurcateP) {
      const at = pts[Math.min(2, pts.length - 1)];
      // find nearest grid node to fork from
      let bi = ctr, bj = ctr, bd = Infinity;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        const d = (P[i][j][0] - at[0]) ** 2 + (P[i][j][1] - at[1]) ** 2;
        if (d < bd) { bd = d; bi = i; bj = j; }
      }
      const side = rng() < 0.5 ? -1 : 1;
      const child = walk(rng, P, n, bi, bj, endH + side * (0.6 + rng() * 0.5), Math.max(1, cfg.steps - 2), visited, 0.3);
      if (child.pts.length > 1) walks.push(child.pts);
      const le = child.pts[child.pts.length - 1];
      terminals.push(le);
    }
    terminals.push(pts[pts.length - 1]);
  }

  const poly = (pts) => `<polyline points="${pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')}"/>`;
  const dots = [`<circle cx="${c}" cy="${c}" r="${cfg.hubR}"/>`]
    .concat(terminals.map(p => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${(cfg.nodeR * (0.9 + rng() * 0.2)).toFixed(1)}"/>`))
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">\n` +
    `<g stroke="#000" stroke-width="${cfg.gridStroke}" opacity="${cfg.gridOpacity}">${mesh}</g>\n` +
    `<g stroke="#000" stroke-width="${cfg.walkStroke}" stroke-linecap="round" stroke-linejoin="round" fill="none">${walks.map(poly).join('')}</g>\n` +
    `<g fill="#000">${dots}</g>\n</svg>\n`;
}

// --- CLI ---
const args = process.argv.slice(2);
if (import.meta.url === `file://${process.argv[1]}`) {
  const get = (k, d) => {
    const i = args.indexOf(`--${k}`);
    return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d;
  };
  const fs = await import('node:fs');
  const path = await import('node:path');
  const seedEnd = parseInt(get('seed-end', get('seed', '1')), 10);
  const seedStart = args.includes('--seed-end') ? parseInt(get('seed', '1'), 10) : seedEnd;
  const outdir = get('outdir', null);
  const single = get('out', null);
  const jobs = [];
  if (outdir) for (let s = seedStart; s <= seedEnd; s++) jobs.push([s, `${outdir}/hybrid-${String(s).padStart(3, '0')}.svg`]);
  else if (single) jobs.push([seedEnd, single]);
  else { console.log(generateHybrid({ seed: seedEnd })); process.exit(0); }
  for (const [s, f] of jobs) {
    fs.mkdirSync(path.dirname(f) || '.', { recursive: true });
    fs.writeFileSync(f, generateHybrid({ seed: s }));
    console.log(`wrote ${f} (seed ${s})`);
  }
}
