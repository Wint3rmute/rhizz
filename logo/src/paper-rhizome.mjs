// paper-rhizome.mjs — rhizome mark built with paper.js primitives + boolean ops.
// Same seedable spirit as generate.mjs, but the node cluster is a TRUE single
// silhouette (unite) with an optional punched hub hole (subtract) — the kind of
// thing that's painful with hand-templated SVG strings.
//
//   node src/paper-rhizome.mjs --seed 1 --seed-end 4 --outdir renders
//
// Primitives demoed for future carving: Path.Circle, Path.Line (round caps),
// unite(), subtract(), smooth(), simplify(), exportSVG().

import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
try {
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
} catch { /* node24 already provides navigator */ }
if (typeof globalThis.self === 'undefined') globalThis.self = globalThis;

const { default: paper } = await import('paper');

const TAU = Math.PI * 2;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// v002 refinement: uniform terminals, slotted angles, tapered branches.
// Randomness now only moves things that don't hurt balance.
export const PAPER_DEFAULTS = {
  size: 512,
  branches: 5,
  depth: 2, // 1 = hub + terminals only, 2 = one mid-joint level (like the ChatGPT ref)
  baseLen: 110,
  decay: 0.62,
  spread: 1.1,
  stroke: 22, // branch width at the hub end
  taperStep: 0.72, // width multiplier per level outward
  nodeR: 26, // ALL terminals exactly this — size variety read as accidental
  hubR: 32, // single step up from terminals (~1.23x)
  hubHoleR: 0, // >0 punches a hole via subtract() — distinctive donut-hub variant
  midNodeP: 0, // random mid-branch dots removed — noise at small sizes
  minSep: 0.5, // min radians between top-level branches (~28.6°)
  subSep: 0.55, // min radians between the two sub-branches (~31°) — tight Vs web up
};

function circleAt(center, r) {
  const p = new paper.Path.Circle({ center, radius: r });
  p.fillColor = new paper.Color(0, 0, 0);
  return p;
}

// tapered branch segment as a filled shape with round caps (strokes can't taper)
function taperedSeg(p0, p1, w0, w1) {
  const dir = p1.subtract(p0);
  const len = dir.length;
  if (len < 1e-6) return null;
  const u = dir.divide(len);
  const n = u.rotate(90);
  const a = p0.add(n.multiply(w0 / 2));
  const b = p1.add(n.multiply(w1 / 2));
  const c = p1.subtract(n.multiply(w1 / 2));
  const d = p0.subtract(n.multiply(w0 / 2));
  const path = new paper.Path();
  path.add(a);
  path.lineTo(b);
  path.arcTo(p1.add(u.multiply(w1 / 2)), c);
  path.lineTo(d);
  path.arcTo(p0.subtract(u.multiply(w0 / 2)), a);
  path.closePath();
  path.fillColor = new paper.Color(0, 0, 0);
  return path;
}

function walk(rng, origin, angle, len, width, depth, cfg, shapes) {
  const vec = new paper.Point(Math.cos(angle) * len, Math.sin(angle) * len);
  const end = origin.add(vec);
  const wEnd = width * cfg.taperStep;
  const quad = taperedSeg(origin, end, width, wEnd);
  if (quad) shapes.push(quad);
  if (depth <= 0) {
    shapes.push(circleAt(end, cfg.nodeR));
    return;
  }
  for (let i = 0; i < 2; i++) { // bifurcate with guaranteed separation
    const half = cfg.subSep / 2 + rng() * Math.max(0.05, cfg.spread / 2 - cfg.subSep / 2);
    const na = angle + (i === 0 ? -half : half) + (rng() - 0.5) * 0.12;
    walk(rng, end, na, len * cfg.decay * (0.85 + rng() * 0.3), wEnd, depth - 1, cfg, shapes);
  }
  if (rng() < cfg.midNodeP) shapes.push(circleAt(end, cfg.nodeR * 0.7));
}

export function renderPaper({ seed = 1, size = 512, ...overrides } = {}) {
  const cfg = { ...PAPER_DEFAULTS, size, ...overrides };
  const rng = mulberry32(seed);
  paper.setup(new paper.Size(size, size));
  paper.project.clear();

  const c = new paper.Point(size / 2, size / 2);
  const shapes = [circleAt(c, cfg.hubR)];
  const startAngle = rng() * TAU;
  // slotted fan: even slots ± bounded jitter guarantees minSep without resampling
  const slot = TAU / cfg.branches;
  const maxJit = Math.max(0, slot / 2 - cfg.minSep / 2);
  for (let i = 0; i < cfg.branches; i++) {
    const a = startAngle + i * slot + (rng() * 2 - 1) * maxJit;
    // start branches at the hub perimeter, not the center — keeps hub (and hub hole) clean
    const origin = c.add(new paper.Point(Math.cos(a) * cfg.hubR * 0.9, Math.sin(a) * cfg.hubR * 0.9));
    walk(rng, origin, a, cfg.baseLen * (0.8 + rng() * 0.4), cfg.stroke, cfg.depth - 1, cfg, shapes);
  }

  // — boolean ops: unite EVERYTHING (tapered branches + nodes) into ONE path —
  let silhouette = shapes[0];
  for (let i = 1; i < shapes.length; i++) {
    const united = silhouette.unite(shapes[i], { insert: false });
    silhouette.remove();
    shapes[i].remove();
    silhouette = united;
  }
  // NOTE: no simplify() — it deforms united arcs into lumps. unite() keeps exact curves.
  silhouette.fillRule = 'evenodd'; // so subtract() holes punch through under nonzero renderers

  // — optional hub cut-out: subtract() a hole (donut-hub variant) —
  if (cfg.hubHoleR > 0) {
    const hole = new paper.Path.Circle({ center: c, radius: cfg.hubHoleR });
    const cut = silhouette.subtract(hole, { insert: false });
    silhouette.remove();
    hole.remove();
    silhouette = cut;
  }
  silhouette.fillRule = 'evenodd'; // re-assert AFTER subtract: new path resets to nonzero
  silhouette.fillColor = new paper.Color(0, 0, 0);

  // single united silhouette (branches already merged in) — hub hole stays visible
  // because branches start at the hub perimeter, not the center
  paper.project.activeLayer.addChild(silhouette);

  // auto-fit: any seed may bleed past the box — scale + recenter to fit with margin
  {
    const layer = paper.project.activeLayer;
    const margin = 24;
    const b = layer.strokeBounds;
    const fit = Math.min(1, (size - 2 * margin) / Math.max(b.width, b.height));
    const ctr = new paper.Point(size / 2, size / 2);
    if (fit < 1) layer.scale(fit, b.center);
    const nb = layer.strokeBounds;
    layer.translate(ctr.subtract(nb.center));
  }

  const svgEl = paper.project.exportSVG({ asString: false });
  svgEl.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svgEl.setAttribute('width', String(size));
  svgEl.setAttribute('height', String(size));
  const out = new dom.window.XMLSerializer().serializeToString(svgEl);
  // visual content bounds (incl. stroke widths) — lockup.mjs uses these, no guessing
  const b = paper.project.activeLayer.strokeBounds;
  const bounds = { x: +b.x.toFixed(2), y: +b.y.toFixed(2), w: +b.width.toFixed(2), h: +b.height.toFixed(2) };
  paper.project.clear();
  return { svg: '<?xml version="1.0" encoding="UTF-8"?>\n' + out + '\n', bounds };
}

export function generatePaper(opts = {}) {
  return renderPaper(opts).svg;
}

// --- CLI (mirrors generate.mjs) ---
const args = process.argv.slice(2);
if (import.meta.url === `file://${process.argv[1]}`) {
  const { default: fs } = await import('node:fs');
  const { default: path } = await import('node:path');
  const get = (k, d) => {
    const i = args.indexOf(`--${k}`);
    return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d;
  };
  const seedEnd = parseInt(get('seed-end', get('seed', '1')), 10);
  const seedStart = args.includes('--seed-end') ? parseInt(get('seed', '1'), 10) : seedEnd;
  const hubHoleR = parseFloat(get('hub-hole', '0'));
  const outdir = get('outdir', null);
  const single = get('out', null);
  const jobs = [];
  if (outdir) {
    for (let s = seedStart; s <= seedEnd; s++) jobs.push([s, `${outdir}/paper-rhizome-${String(s).padStart(3, '0')}.svg`]);
  } else if (single) {
    jobs.push([seedEnd, single]);
  } else {
    process.stdout.write(generatePaper({ seed: seedEnd, hubHoleR }));
    process.exit(0);
  }
  for (const [s, f] of jobs) {
    fs.mkdirSync(path.dirname(f) || '.', { recursive: true });
    const { svg, bounds } = renderPaper({ seed: s, hubHoleR });
    fs.writeFileSync(f, svg);
    fs.writeFileSync(f.replace(/\.svg$/, '.bounds.json'), JSON.stringify({ seed: s, hubHoleR, bounds }) + '\n');
    console.log(`wrote ${f} (seed ${s}, hubHole ${hubHoleR})`);
  }
}
