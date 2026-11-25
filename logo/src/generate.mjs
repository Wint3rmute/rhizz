// rhizz-logo generator — pure functions: (params + seed) -> SVG string.
// Zero-dep, ESM. LLM-editable: tweak DEFAULTS / variants, keep output deterministic.
//
//   node src/generate.mjs --seed 1 --variant rhizome --out renders/v001.svg
//   node src/generate.mjs --seed 1 --seed-end 6 --variant rhizome --outdir renders
//   resvg renders/v001.svg renders/v001.png   # how I see my own work

// --- seeded RNG (mulberry32) ---
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

function branch(rng, x, y, angle, len, depth, cfg, segs, nodes) {
  const nx = x + Math.cos(angle) * len;
  const ny = y + Math.sin(angle) * len;
  segs.push({ x1: x, y1: y, x2: nx, y2: ny, depth });
  if (depth <= 0) {
    nodes.push({ x: nx, y: ny, r: cfg.nodeR * (0.8 + rng() * 0.5) });
    return;
  }
  const kids = depth === cfg.depth ? cfg.branches : 2;
  for (let i = 0; i < kids; i++) {
    const jitter = (rng() - 0.5) * cfg.spread;
    // bias outward so it doesn't collapse back into itself
    const na = angle + jitter + (i === 0 ? -cfg.spread * 0.5 : cfg.spread * 0.5) * rng();
    branch(rng, nx, ny, na, len * cfg.decay * (0.85 + rng() * 0.3), depth - 1, cfg, segs, nodes);
  }
  // terminal nodes on some mid branches too (rhizome feel, like the ChatGPT ref)
  if (rng() < cfg.midNodeP) nodes.push({ x: nx, y: ny, r: cfg.nodeR * 0.7 });
}

// Variants distilled from README inspirations:
// - rhizome: thick rounded branching + dot terminals (ChatGPT ref) — header/favicon bet
// - plateau: stacked isometric wireframe plates (Thousand Plateaus 1)
// - mesh:    warped grid, torn/distressed (Thousand Plateaus 2)
export const VARIANTS = {
  rhizome: { branches: 5, depth: 2, baseLen: 110, decay: 0.62, spread: 1.1, stroke: 22, nodeR: 26, hubR: 30, midNodeP: 0.25 },
  plateau: { layers: 3, size: 150, tilt: 0.5, gap: 46, stroke: 3 },
  mesh: { grid: 9, size: 380, warp: 60, dropP: 0.25, stroke: 1.6 },
};

export function generate({ seed = 1, variant = "rhizome", size = 512 } = {}) {
  const rng = mulberry32(seed);
  const c = size / 2;

  if (variant === "rhizome") {
    const cfg = VARIANTS.rhizome;
    const segs = [], nodes = [];
    const startAngle = rng() * TAU;
    for (let i = 0; i < cfg.branches; i++) {
      const a = startAngle + (i / cfg.branches) * TAU + (rng() - 0.5) * 0.6;
      branch(rng, c, c, a, cfg.baseLen * (0.8 + rng() * 0.4), cfg.depth - 1, cfg, segs, nodes);
    }
    const paths = segs.map(s =>
      `<line x1="${s.x1.toFixed(1)}" y1="${s.y1.toFixed(1)}" x2="${s.x2.toFixed(1)}" y2="${s.y2.toFixed(1)}"/>`
    ).join("");
    const dots = [`<circle cx="${c}" cy="${c}" r="${cfg.hubR}"/>`]
      .concat(nodes.map(n => `<circle cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="${n.r.toFixed(1)}"/>`))
      .join("");
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">\n` +
      `<g stroke="#000" stroke-width="${cfg.stroke}" stroke-linecap="round" fill="none">${paths}</g>\n` +
      `<g fill="#000">${dots}</g>\n</svg>\n`;
  }

  if (variant === "plateau") {
    const cfg = VARIANTS.plateau;
    // true isometric diamonds, stacked vertically
    const diamond = (cx, cy, w, h) =>
      `${cx.toFixed(1)},${(cy - h / 2).toFixed(1)} ${(cx + w / 2).toFixed(1)},${cy.toFixed(1)} ` +
      `${cx.toFixed(1)},${(cy + h / 2).toFixed(1)} ${(cx - w / 2).toFixed(1)},${cy.toFixed(1)}`;
    let g = "";
    for (let l = 0; l < cfg.layers; l++) {
      const w = cfg.size - l * 12, h = cfg.size * cfg.tilt;
      const cy = c + (l - (cfg.layers - 1) / 2) * cfg.gap;
      const jx = (rng() - 0.5) * 10;
      g += `<polygon points="${diamond(c + jx, cy, w, h)}" fill="none" stroke="#000" stroke-width="${cfg.stroke}"/>` +
        `<polygon points="${diamond(c + jx, cy, w - 44, h - 28)}" fill="none" stroke="#000" stroke-width="${(cfg.stroke * 0.6).toFixed(1)}" opacity="0.65"/>`;
      // vertical connectors at left/right corners to next layer
      if (l < cfg.layers - 1) {
        g += `<line x1="${(c + jx - w / 2).toFixed(1)}" y1="${cy.toFixed(1)}" x2="${(c + jx - w / 2).toFixed(1)}" y2="${(cy + cfg.gap).toFixed(1)}" stroke="#000" stroke-width="${(cfg.stroke * 0.7).toFixed(1)}" opacity="0.8"/>` +
          `<line x1="${(c + jx + w / 2).toFixed(1)}" y1="${cy.toFixed(1)}" x2="${(c + jx + w / 2).toFixed(1)}" y2="${(cy + cfg.gap).toFixed(1)}" stroke="#000" stroke-width="${(cfg.stroke * 0.7).toFixed(1)}" opacity="0.8"/>`;
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">${g}</svg>\n`;
  }

  // mesh: jittered grid with random drops — distressed cover vibe.
  // NOTE: jitter each node ONCE, then connect neighbours (else confetti).
  const cfg = VARIANTS.mesh;
  const n = cfg.grid, half = cfg.size / 2;
  const P = [];
  for (let i = 0; i < n; i++) {
    P[i] = [];
    for (let j = 0; j < n; j++) {
      P[i][j] = [
        c - half + (i / (n - 1)) * cfg.size + (rng() - 0.5) * cfg.warp,
        c - half + (j / (n - 1)) * cfg.size + (rng() - 0.5) * cfg.warp,
      ];
    }
  }
  const seg = (a, b) =>
    `<line x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}"/>`;
  let d = "";
  for (let i = 0; i < n; i++) for (let j = 0; j < n - 1; j++) {
    if (rng() < cfg.dropP) continue;
    d += seg(P[i][j], P[i][j + 1]);
  }
  for (let j = 0; j < n; j++) for (let i = 0; i < n - 1; i++) {
    if (rng() < cfg.dropP) continue;
    d += seg(P[i][j], P[i + 1][j]);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}"><g stroke="#000" stroke-width="${cfg.stroke}" opacity="0.9">${d}</g></svg>\n`;
}

// --- CLI ---
const args = process.argv.slice(2);
if (import.meta.url === `file://${process.argv[1]}`) {
  const get = (k, d) => {
    const i = args.indexOf(`--${k}`);
    return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d;
  };
  const fs = await import("node:fs");
  const variant = get("variant", "rhizome");
  const seedEnd = parseInt(get("seed-end", get("seed", "1")), 10);
  const seedStart = args.includes("--seed-end") ? parseInt(get("seed", "1"), 10) : seedEnd;
  const outdir = get("outdir", null);
  const single = get("out", null);

  const jobs = [];
  if (outdir) {
    for (let s = seedStart; s <= seedEnd; s++)
      jobs.push([s, `${outdir}/${variant}-${String(s).padStart(3, "0")}.svg`]);
  } else if (single) {
    jobs.push([seedEnd, single]);
  } else {
    console.log(generate({ seed: seedEnd, variant }));
    process.exit(0);
  }
  const path = await import("node:path");
  for (const [s, f] of jobs) {
    fs.mkdirSync(path.dirname(f) || ".", { recursive: true });
    fs.writeFileSync(f, generate({ seed: s, variant }));
    console.log(`wrote ${f} (seed ${s}, ${variant})`);
  }
}
