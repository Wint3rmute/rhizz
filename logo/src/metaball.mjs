// metaball.mjs — the ChatGPT reference, faithfully: nodes that melt into their
// branches with smooth gooey fillets instead of boolean sharp corners.
//
// Method: analytic metaballs. Every blob (hub, terminals, branch discs) is a
// circle SDF; all are combined with a smooth-minimum (smin) so unions blend
// like liquid. The d=0 contour is traced with marching squares + Chaikin
// smoothing and emitted as ONE pure path — no SVG filters, no font, no deps
// at render time. Deterministic per seed, same layout language as v002.
//
//   node src/metaball.mjs --seed 1 --seed-end 4 --outdir renders/metaball
//   node src/metaball.mjs --seed 1 --smooth 22 --out renders/metaball-soft.svg

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

// same layout language as paper-rhizome v002 so seeds stay comparable
export const META_DEFAULTS = {
  size: 512,
  branches: 5,
  depth: 2,
  baseLen: 110,
  decay: 0.62,
  spread: 1.1,
  stroke: 22,
  taperStep: 0.72,
  nodeR: 26,
  hubR: 32,
  minSep: 0.5,
  subSep: 0.55,
  discsPerSeg: 8, // interpolated discs per tapered segment (cone approx — must be dense enough for smin to bridge)
  smooth: 16, // smin radius — the gooeyness. ref has modest fillets: 12–20
  grid: 384, // marching-squares resolution over the 512 box (fine enough that near-kisses resolve cleanly)
  chaikin: 2, // smoothing passes on the traced contour
};

function smin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

// layout only: circles + tapered segments (mirrors v002's RNG order exactly)
// emit(seg) hook lets buildModel record nodes/edges without touching RNG order.
function layout(rng, cfg, c, emit) {
  const circles = [{ x: c, y: c, r: cfg.hubR }];
  const segs = [];
  const walk = (ox, oy, angle, len, width, depth) => {
    const ex = ox + Math.cos(angle) * len, ey = oy + Math.sin(angle) * len;
    const wEnd = width * cfg.taperStep;
    const seg = { x0: ox, y0: oy, x1: ex, y1: ey, w0: width, w1: wEnd, terminal: depth <= 0 };
    segs.push(seg);
    if (emit) emit(seg);
    if (depth <= 0) { circles.push({ x: ex, y: ey, r: cfg.nodeR }); return; }
    for (let i = 0; i < 2; i++) {
      const half = cfg.subSep / 2 + rng() * Math.max(0.05, cfg.spread / 2 - cfg.subSep / 2);
      const na = angle + (i === 0 ? -half : half) + (rng() - 0.5) * 0.12;
      walk(ex, ey, na, len * cfg.decay * (0.85 + rng() * 0.3), wEnd, depth - 1);
    }
  };
  const startAngle = rng() * TAU;
  const slot = TAU / cfg.branches;
  const maxJit = Math.max(0, slot / 2 - cfg.minSep / 2);
  for (let i = 0; i < cfg.branches; i++) {
    const a = startAngle + i * slot + (rng() * 2 - 1) * maxJit;
    const ox = c + Math.cos(a) * cfg.hubR * 0.9, oy = c + Math.sin(a) * cfg.hubR * 0.9;
    walk(ox, oy, a, cfg.baseLen * (0.8 + rng() * 0.4), cfg.stroke, cfg.depth - 1);
  }
  return { circles, segs };
}

// editable node/edge model of a seed layout for the browser editor.
// nodes: hub + joints (r=0 handles) + terminals; edges carry taper widths.
export function buildModel({ seed = 1, size = 512, ...overrides } = {}) {
  const cfg = { ...META_DEFAULTS, size, ...overrides };
  const rng = mulberry32(seed);
  const c = size / 2;
  const nodes = [{ id: 0, x: +c.toFixed(2), y: +c.toFixed(2), r: cfg.hubR, kind: 'hub' }];
  const edges = [];
  const byKey = new Map([[Math.round(c * 100) + ',' + Math.round(c * 100), 0]]);
  const getNode = (x, y, r, kind) => {
    const k = Math.round(x * 100) + ',' + Math.round(y * 100);
    if (byKey.has(k)) return byKey.get(k);
    const id = nodes.length;
    nodes.push({ id, x: +x.toFixed(2), y: +y.toFixed(2), r, kind });
    byKey.set(k, id);
    return id;
  };
  layout(rng, cfg, c, (s) => {
    const a = getNode(s.x0, s.y0, 0, 'joint');
    const b = s.terminal ? getNode(s.x1, s.y1, cfg.nodeR, 'terminal') : getNode(s.x1, s.y1, 0, 'joint');
    edges.push({ a, b, w0: +s.w0.toFixed(2), w1: +s.w1.toFixed(2) });
  });
  return { params: { seed, ...cfg }, nodes, edges };
}

// expand segments into interpolated discs (tapered cone ≈ stacked spheres)
function discs(cfg, segs) {
  const out = [];
  for (const s of segs) {
    for (let k = 0; k < cfg.discsPerSeg; k++) {
      const t = cfg.discsPerSeg === 1 ? 0 : k / (cfg.discsPerSeg - 1);
      out.push({
        x: s.x0 + (s.x1 - s.x0) * t,
        y: s.y0 + (s.y1 - s.y0) * t,
        r: (s.w0 + (s.w1 - s.w0) * t) / 2,
      });
    }
  }
  return out;
}

function fieldAt(blobs, k, x, y) {
  let d = Infinity;
  for (const b of blobs) {
    // cheap bbox cull
    const m = b.r + k;
    if (x < b.x - m || x > b.x + m || y < b.y - m || y > b.y + m) continue;
    const cd = Math.hypot(x - b.x, y - b.y) - b.r;
    d = d === Infinity ? cd : smin(d, cd, k);
  }
  return d;
}

// marching squares over (N+1)^2 corner samples; saddle resolved by center avg
export { traceContour, joinLoops, fieldAt, layout, discs };
function traceContour(field, N, cell) {
  const idx = (i, j) => j * (N + 1) + i;
  const segs = [];
  const lerpT = (a, b) => a / (a - b); // level 0 crossing between values a,b
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = field[idx(i, j)], b = field[idx(i + 1, j)];
    const c = field[idx(i + 1, j + 1)], d = field[idx(i, j + 1)];
    let code = 0;
    if (a < 0) code |= 1; if (b < 0) code |= 2; if (c < 0) code |= 4; if (d < 0) code |= 8;
    if (code === 0 || code === 15) continue;
    const x0 = i * cell, y0 = j * cell;
    const T = [x0 + lerpT(a, b) * cell, y0]; // top edge
    const R = [x0 + cell, y0 + lerpT(b, c) * cell]; // right edge
    const B = [x0 + lerpT(d, c) * cell, y0 + cell]; // bottom edge
    const L = [x0, y0 + lerpT(a, d) * cell]; // left edge
    const ctr = (a + b + c + d) / 4 < 0;
    const emit = (p, q) => segs.push([p[0], p[1], q[0], q[1]]);
    // NOTE: every case keeps the interior on the LEFT of travel; complementary
    // cases emit REVERSED directions or loops fragment (learned the hard way).
    switch (code) {
      case 1: emit(L, T); break;
      case 2: emit(T, R); break;
      case 3: emit(L, R); break;
      case 4: emit(R, B); break;
      case 6: emit(T, B); break;
      case 7: emit(L, B); break;
      case 8: emit(B, L); break;
      case 9: emit(B, T); break;
      case 11: emit(B, R); break;
      case 12: emit(R, L); break;
      case 13: emit(R, T); break;
      case 14: emit(T, L); break;
      case 5: if (ctr) { emit(T, R); emit(B, L); } else { emit(L, T); emit(R, B); } break;
      case 10: if (ctr) { emit(L, T); emit(R, B); } else { emit(T, R); emit(B, L); } break;
    }
  }
  return segs;
}

// join segments into closed loops via quantized endpoints
function joinLoops(segs) {
  const q = (v) => Math.round(v * 100);
  const startMap = new Map();
  segs.forEach((s, n) => {
    const k = q(s[0]) + ',' + q(s[1]);
    if (!startMap.has(k)) startMap.set(k, []);
    startMap.get(k).push(n);
  });
  const used = new Array(segs.length).fill(false);
  const loops = [];
  for (let n = 0; n < segs.length; n++) {
    if (used[n]) continue;
    used[n] = true;
    const loop = [[segs[n][0], segs[n][1]], [segs[n][2], segs[n][3]]];
    let guard = segs.length + 1;
    while (guard-- > 0) {
      const tip = loop[loop.length - 1];
      const cand = startMap.get(q(tip[0]) + ',' + q(tip[1])) || [];
      const m = cand.find((k) => !used[k]);
      if (m === undefined) break;
      used[m] = true;
      loop.push([segs[m][2], segs[m][3]]);
      const first = loop[0], last = loop[loop.length - 1];
      if (Math.abs(first[0] - last[0]) < 0.015 && Math.abs(first[1] - last[1]) < 0.015) {
        loop.pop(); // drop duplicated closing point
        break;
      }
    }
    if (loop.length > 8) loops.push(loop);
  }
  return loops;
}

function chaikinClosed(pts, iters) {
  let p = pts;
  for (let k = 0; k < iters; k++) {
    const out = [];
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    p = out;
  }
  return p;
}

export function renderMetaball({ seed = 1, size = 512, ...overrides } = {}) {
  const cfg = { ...META_DEFAULTS, size, ...overrides };
  const rng = mulberry32(seed);
  const c = size / 2;
  const { circles, segs } = layout(rng, cfg, c);
  const blobs = circles.concat(discs(cfg, segs));

  // auto-fit: raw layout can bleed past the box (seed 3 exits at the bottom edge →
  // open contours → chord artifacts). Mirror of paper-rhizome's layer fit.
  {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const b of blobs) {
      if (b.x - b.r < minX) minX = b.x - b.r; if (b.x + b.r > maxX) maxX = b.x + b.r;
      if (b.y - b.r < minY) minY = b.y - b.r; if (b.y + b.r > maxY) maxY = b.y + b.r;
    }
    const margin = 24;
    const fit = Math.min(1, (size - 2 * margin) / Math.max(maxX - minX, maxY - minY));
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    for (const b of blobs) {
      b.x = (b.x - cx) * fit + size / 2;
      b.y = (b.y - cy) * fit + size / 2;
      b.r *= fit;
    }
  }

  return blobsToSvg(blobs, cfg, size, { recenter: true });
}

// trace a blob list to a single-path SVG. Pure math — reused by the browser editor.
// opts.recenter shifts ink to canvas center (pipeline use); the editor passes false
// so dragged nodes stay where you put them.
export function blobsToSvg(blobs, cfg, size, opts = {}) {
  const { recenter = true } = opts;
  const c = size / 2;
  const N = cfg.grid, cell = size / N;
  const field = new Float64Array((N + 1) * (N + 1));
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    field[j * (N + 1) + i] = fieldAt(blobs, cfg.smooth, i * cell, j * cell);
  }
  const raw = traceContour(field, N, cell);
  const area = (l) => {
    let a = 0;
    for (let i = 0; i < l.length; i++) {
      const p = l[i], q = l[(i + 1) % l.length];
      a += p[0] * q[1] - q[0] * p[1];
    }
    return a / 2;
  };
  // drop dust: tiny loops are tracing artifacts (pinholes), never design
  const loops = joinLoops(raw)
    .filter((l) => Math.abs(area(l)) > 100)
    .map((l) => chaikinClosed(l, cfg.chaikin));

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const l of loops) for (const p of l) {
    if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
  }
  const dx = recenter ? c - (minX + maxX) / 2 : 0;
  const dy = recenter ? c - (minY + maxY) / 2 : 0;
  const f = (v) => +v.toFixed(2);
  const d = loops.map((l) =>
    'M' + l.map((p) => f(p[0] + dx) + ' ' + f(p[1] + dy)).join('L') + 'Z'
  ).join('');
  const bounds = { x: f(minX + dx), y: f(minY + dy), w: f(maxX - minX), h: f(maxY - minY) };
  const svg =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">\n` +
    `<path d="${d}" fill="#000" fill-rule="evenodd"/>\n</svg>\n`;
  return { svg, bounds, loops: loops.length };
}

// --- CLI (guarded: this module is also imported by the browser editor) ---
const isCLI = typeof process !== 'undefined' && process.argv && import.meta.url === `file://${process.argv[1]}`;
const args = isCLI ? process.argv.slice(2) : [];
if (isCLI) {
  const get = (k, d) => {
    const i = args.indexOf(`--${k}`);
    return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d;
  };
  const fs = await import('node:fs');
  const path = await import('node:path');
  const seedEnd = parseInt(get('seed-end', get('seed', '1')), 10);
  const seedStart = args.includes('--seed-end') ? parseInt(get('seed', '1'), 10) : seedEnd;
  const smooth = parseFloat(get('smooth', String(META_DEFAULTS.smooth)));
  const overrides = { smooth };
  for (const kv of get('set', '').split(',').filter(Boolean)) {
    const [k, v] = kv.split('=');
    if (k && v !== undefined && k in META_DEFAULTS) overrides[k] = parseFloat(v);
  }
  const outdir = get('outdir', null);
  const single = get('out', null);
  const modelOut = get('model', null);
  if (modelOut) {
    const model = buildModel({ seed: seedEnd, ...Object.fromEntries(Object.entries(overrides).filter(([k]) => k !== 'smooth' && k !== 'grid' && k !== 'chaikin')) });
    fs.mkdirSync(path.dirname(modelOut) || '.', { recursive: true });
    fs.writeFileSync(modelOut, JSON.stringify(model, null, 1) + '\n');
    console.log(`wrote ${modelOut} (${model.nodes.length} nodes, ${model.edges.length} edges)`);
    process.exit(0);
  }
  const jobs = [];
  if (outdir) for (let s = seedStart; s <= seedEnd; s++) jobs.push([s, `${outdir}/metaball-${String(s).padStart(3, '0')}.svg`]);
  else if (single) jobs.push([seedEnd, single]);
  else { process.stdout.write(renderMetaball({ seed: seedEnd, ...overrides }).svg); process.exit(0); }
  for (const [s, f] of jobs) {
    fs.mkdirSync(path.dirname(f) || '.', { recursive: true });
    const { svg, bounds } = renderMetaball({ seed: s, ...overrides });
    fs.writeFileSync(f, svg);
    fs.writeFileSync(f.replace(/\.svg$/, '.bounds.json'), JSON.stringify({ seed: s, ...overrides, bounds }) + '\n');
    console.log(`wrote ${f} (seed ${s}, ${JSON.stringify(overrides)})`);
  }
}
