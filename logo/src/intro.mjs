// intro.mjs — the logo "appear" animation, as Full HD MP4.
//
//   0.0–1.4 s  sprout   bars grow out of a seed at the hub, branch by branch;
//                       decoy branches (not in the logo) sprout alongside
//   1.2–2.8 s  breathe  dots swell and shrink, decoys retract into their
//                       parents, everything drifts toward its true position
//   2.9–3.3 s  settle   the organic shape crossfades into the exact mark
//   3.1–3.8 s  slide    the mark moves into its lockup position
//   3.7–4.5 s  wordmark "Rhizome" rises in letter by letter
//   4.5–5.0 s  hold     the finished lockup
//
// Motion: every dot size, bar length and position is a damped spring chasing
// a target, integrated with a fixed step from a fixed seed, so every render is
// identical. Drawing: during the organic phase, the dots and bars are blended
// in a WebGL signed-distance shader (smooth union, so joints round themselves
// and never break, however degenerate the geometry). The end state is the
// exact traced outline from molecule.mjs, and the wordmark glyphs come from
// the committed lockup SVG, so the last frame is the lockup itself.
//
// Run through `just logo-intro` (provides Chromium and ffmpeg).
//
//   node src/intro.mjs --outdir renders/video
//   node src/intro.mjs --variant dark --fps 30 --outdir /tmp/x

import { renderMolecule, mulberry32 } from './molecule.mjs';
import { encodeVideo } from './video.mjs';
import fs from 'node:fs';
import path from 'node:path';

export const VARIANTS = {
  light: { bg: '#ffffff', ink: '#000000' },
  dark: { bg: '#0d1117', ink: '#ffffff' },
};

const T = {
  dur: 5.0,
  sproutEnd: 1.4,
  breatheEnd: 2.8,
  fadeStart: 2.9, fadeEnd: 3.3,
  slideStart: 3.1, slideEnd: 3.8,
  textStart: 3.7, letterDur: 0.45, letterStagger: 0.06,
};
const SEED = 7;
const DECOYS = 7;

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
const easeOut = (x) => 1 - (1 - x) ** 3;

// ---------------------------------------------------------------- lockup ---
// Pull the composition straight out of the committed lockup SVG: its viewBox,
// the mark's transform and the wordmark path, split into per-letter glyphs.
function readLockup(file) {
  const svg = fs.readFileSync(file, 'utf8');
  const vb = svg.match(/viewBox="([^"]+)"/)[1].split(/\s+/).map(Number);
  const m = svg.match(/<g transform="translate\(([-\d.]+) ([-\d.]+)\) scale\(([\d.]+)\)"/);
  const t = svg.match(/<g transform="translate\(([-\d.]+) 0\)"><path d="([^"]+)"/);
  const sub = t[2].split(/(?=M)/).filter(Boolean).map((d) => {
    const nums = d.match(/-?\d+(?:\.\d+)?/g).map(Number);
    let x0 = Infinity, x1 = -Infinity;
    for (let i = 0; i < nums.length; i += 2) { x0 = Math.min(x0, nums[i]); x1 = Math.max(x1, nums[i]); }
    return { d, x0, x1 };
  }).sort((a, b) => a.x0 - b.x0);
  // A glyph = subpaths that overlap a lot in x (outline + counters, i + its dot).
  const glyphs = [];
  for (const s of sub) {
    const g = glyphs[glyphs.length - 1];
    const ov = g ? Math.min(g.x1, s.x1) - Math.max(g.x0, s.x0) : -1;
    if (g && ov > 0.3 * Math.min(g.x1 - g.x0, s.x1 - s.x0)) { g.d += s.d; g.x0 = Math.min(g.x0, s.x0); g.x1 = Math.max(g.x1, s.x1); }
    else glyphs.push({ ...s });
  }
  return {
    viewBox: { x: vb[0], y: vb[1], w: vb[2], h: vb[3] },
    mark: { tx: +m[1], ty: +m[2], s: +m[3] },
    textX: +t[1],
    glyphs: glyphs.map((g) => g.d),
  };
}

// -------------------------------------------------------------- simulate ---
function spring(f, zeta) {
  const w = 2 * Math.PI * f;
  return { x: 0, v: 0, k: w * w, c: 2 * zeta * w };
}
function step(s, target, dt) {
  s.v += (s.k * (target - s.x) - s.c * s.v) * dt;
  s.x += s.v * dt;
}

export function simulate({ fps }) {
  const { d, graph, bounds, cfg } = renderMolecule({ preset: 'reference' });
  const rng = mulberry32(SEED);
  const nodes = graph.nodes;
  const hubId = nodes.findIndex((n) => n.kind === 'hub');
  const hub = nodes[hubId];
  const cx = bounds.x + bounds.w / 2, cy = bounds.y + bounds.h / 2;

  // tree from the hub: parent + width of the bar leading to each node
  const parent = new Map([[hubId, -1]]);
  const barW = new Map();
  const queue = [hubId];
  while (queue.length) {
    const a = queue.shift();
    for (const e of graph.edges) {
      const b = e.a === a ? e.b : e.b === a ? e.a : -1;
      if (b >= 0 && !parent.has(b)) { parent.set(b, a); barW.set(b, e.w); queue.push(b); }
    }
  }

  // growing entities: every real non-hub node, plus decoy branches
  const ents = [];
  const spawnOf = new Map([[hubId, 0.12]]);
  const order = [...parent.keys()].filter((i) => i !== hubId);
  const armOrder = order.filter((i) => parent.get(i) === hubId).sort(() => rng() - 0.5);
  armOrder.forEach((i, k) => spawnOf.set(i, 0.22 + k * 0.13 + rng() * 0.05));
  for (const i of order) if (!spawnOf.has(i)) spawnOf.set(i, spawnOf.get(parent.get(i)) + 0.38 + rng() * 0.12);
  for (const i of order) {
    const n = nodes[i];
    const a = rng() * Math.PI * 2;
    ents.push({
      id: i, parent: parent.get(i), decoy: false,
      fx: n.x, fy: n.y, r: n.r, w: barW.get(i),
      spawn: spawnOf.get(i), retract: Infinity,
      wx: Math.cos(a) * (18 + rng() * 22), wy: Math.sin(a) * (18 + rng() * 22),
      ph: rng() * Math.PI * 2,
    });
  }
  const realIds = order;
  for (let k = 0; k < DECOYS; k++) {
    const p = k < 2 ? hubId : realIds[Math.floor(rng() * realIds.length)];
    const pn = nodes[p];
    const out = p === hubId ? rng() * Math.PI * 2 : Math.atan2(pn.y - cy, pn.x - cx);
    const a = out + (rng() - 0.5) * 1.9;
    const len = 55 + rng() * 60;
    ents.push({
      id: -1, parent: p, decoy: true,
      fx: pn.x + Math.cos(a) * len, fy: pn.y + Math.sin(a) * len,
      r: 15 + rng() * 15, w: cfg.barW * (0.6 + rng() * 0.25),
      spawn: (p === hubId ? 0.3 + rng() * 0.4 : spawnOf.get(p) + 0.25 + rng() * 0.5),
      retract: 1.55 + rng() * 0.9,
      wx: 0, wy: 0, ph: rng() * Math.PI * 2,
    });
  }
  for (const e of ents) {
    e.g = spring(1.5, 0.5);      // growth 0..1 (overshoots)
    e.rho = spring(2.2, 0.35);   // radius multiplier
    e.rho.x = 1;
    e.ox = spring(1.2, 0.7); e.oy = spring(1.2, 0.7);
    e.ox.x = e.wx; e.oy.x = e.wy;
  }
  const seed = spring(2.0, 0.55); // the dot the network germinates from

  // state of a node's current centre (hub stays put)
  const pos = new Map([[hubId, [hub.x, hub.y]]]);
  const byId = new Map(ents.filter((e) => !e.decoy).map((e) => [e.id, e]));
  const posOf = (id) => {
    if (pos.has(id)) return pos.get(id);
    const e = byId.get(id);
    const pp = posOf(e.parent), pf = nodes[e.parent];
    const g = Math.max(0, e.g.x);
    const p = [pp[0] + g * (e.fx + e.ox.x - pf.x), pp[1] + g * (e.fy + e.oy.x - pf.y)];
    pos.set(id, p);
    return p;
  };

  const frames = Math.round(T.dur * fps);
  const SUB = 10, dt = 1 / (fps * SUB);
  const out = [];
  let t = 0;
  for (let k = 0; k < frames; k++) {
    for (let s = 0; s < SUB; s++, t += dt) {
      step(seed, t < 0.42 ? 34 : 0, dt);
      for (const e of ents) {
        const live = t >= e.spawn;
        step(e.g, live && t < e.retract ? 1 : 0, dt);
        const env = smooth(e.spawn + 0.25, e.spawn + 0.6, t) * (1 - smooth(2.1, T.breatheEnd, t));
        step(e.rho, 1 + env * 0.42 * Math.sin(2 * Math.PI * 1.15 * t + e.ph), dt);
        const drift = 1 - smooth(1.5, T.breatheEnd, t);
        step(e.ox, e.wx * drift, dt);
        step(e.oy, e.wy * drift, dt);
      }
    }
    pos.clear(); pos.set(hubId, [hub.x, hub.y]);
    const circles = [], caps = [];
    if (seed.x > 0.5) circles.push([hub.x, hub.y, seed.x]);
    for (const e of ents) {
      if (t < e.spawn) continue;
      const g = Math.max(0, e.g.x);
      if (g < 0.003) continue;
      const pp = posOf(e.parent);
      const pf = nodes[e.parent];
      const tip = e.decoy
        ? [pp[0] + g * (e.fx - pf.x), pp[1] + g * (e.fy - pf.y)]
        : posOf(e.id);
      caps.push([pp[0], pp[1], tip[0], tip[1], (e.w / 2) * clamp(g * 3)]);
      const r = e.r * Math.max(0, e.rho.x) * g ** 1.2;
      if (r > 0.5) circles.push([tip[0], tip[1], r]);
    }
    out.push({ t, circles, caps });
  }
  return { d, bounds, frames: out };
}

// ------------------------------------------------------------------ page ---
// Runs once in the page: WebGL SDF renderer + 2D compositing canvases.
function setupPage({ W, H }) {
  const MAXC = 32, MAXK = 32;
  const gl = document.createElement('canvas');
  gl.width = W; gl.height = H;
  const g = gl.getContext('webgl', { premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false });
  const vs = 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }';
  const fs = `precision highp float;
    uniform vec3 C[${MAXC}]; uniform vec4 K[${MAXK}]; uniform float KW[${MAXK}];
    uniform int nc; uniform int nk; uniform vec3 X; uniform float H; uniform float sk;
    float smin(float a, float b, float k){ float h = max(k - abs(a - b), 0.0) / k; return min(a, b) - h * h * k * 0.25; }
    void main(){
      vec2 px = vec2(gl_FragCoord.x, H - gl_FragCoord.y);
      vec2 p = (px - X.yz) / X.x;          // screen px -> mark units
      float d = 1e5;
      for (int i = 0; i < ${MAXC}; i++) { if (i >= nc) break;
        d = smin(d, length(p - C[i].xy) - C[i].z, sk); }
      for (int i = 0; i < ${MAXK}; i++) { if (i >= nk) break;
        vec2 a = K[i].xy, b = K[i].zw, pa = p - a, ba = b - a;
        float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
        d = smin(d, length(pa - ba * h) - KW[i], sk); }
      float cov = clamp(0.5 - d * X.x, 0.0, 1.0);   // 1px anti-aliased edge
      gl_FragColor = vec4(cov, cov, cov, cov);
    }`;
  const sh = (type, src) => { const s = g.createShader(type); g.shaderSource(s, src); g.compileShader(s);
    if (!g.getShaderParameter(s, g.COMPILE_STATUS)) throw new Error(g.getShaderInfoLog(s)); return s; };
  const prog = g.createProgram();
  g.attachShader(prog, sh(g.VERTEX_SHADER, vs)); g.attachShader(prog, sh(g.FRAGMENT_SHADER, fs));
  g.linkProgram(prog); g.useProgram(prog);
  const buf = g.createBuffer(); g.bindBuffer(g.ARRAY_BUFFER, buf);
  g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), g.STATIC_DRAW);
  const loc = g.getAttribLocation(prog, 'p'); g.enableVertexAttribArray(loc); g.vertexAttribPointer(loc, 2, g.FLOAT, false, 0, 0);
  const U = (n) => g.getUniformLocation(prog, n);
  const u = { C: U('C'), K: U('K'), KW: U('KW'), nc: U('nc'), nk: U('nk'), X: U('X'), H: U('H'), sk: U('sk') };

  const main = document.createElement('canvas'); main.width = W; main.height = H;
  const layer = document.createElement('canvas'); layer.width = W; layer.height = H;
  window.__intro = {
    W, H, gl, g, u, MAXC, MAXK,
    main: main.getContext('2d'), layer: layer.getContext('2d'), mainEl: main, layerEl: layer,
    paths: new Map(),
  };
}

// Runs per frame: composes the mark (SDF and/or exact path) and the wordmark.
function drawPage(f) {
  const S = window.__intro;
  const P = (d) => { if (!S.paths.has(d)) S.paths.set(d, new Path2D(d)); return S.paths.get(d); };
  const { W, H } = S;
  const L = S.layer;

  // mark coverage on `layer` (white, alpha = coverage), summed with 'lighter'
  L.setTransform(1, 0, 0, 1, 0, 0);
  L.globalCompositeOperation = 'source-over';
  L.globalAlpha = 1;
  L.clearRect(0, 0, W, H);
  L.globalCompositeOperation = 'lighter';
  if (f.sdfAlpha > 0) {
    const { g, u } = S;
    g.viewport(0, 0, W, H);
    g.clearColor(0, 0, 0, 0); g.clear(g.COLOR_BUFFER_BIT);
    const C = new Float32Array(S.MAXC * 3), K = new Float32Array(S.MAXK * 4), KW = new Float32Array(S.MAXK);
    f.circles.slice(0, S.MAXC).forEach((c, i) => C.set(c, i * 3));
    f.caps.slice(0, S.MAXK).forEach((c, i) => { K.set(c.slice(0, 4), i * 4); KW[i] = c[4]; });
    g.uniform3fv(u.C, C); g.uniform4fv(u.K, K); g.uniform1fv(u.KW, KW);
    g.uniform1i(u.nc, Math.min(f.circles.length, S.MAXC)); g.uniform1i(u.nk, Math.min(f.caps.length, S.MAXK));
    g.uniform3f(u.X, f.mark.s, f.mark.tx, f.mark.ty); g.uniform1f(u.H, H); g.uniform1f(u.sk, f.smoothK);
    g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
    L.globalAlpha = f.sdfAlpha;
    L.drawImage(S.gl, 0, 0);
  }
  if (f.exactAlpha > 0) {
    L.globalAlpha = f.exactAlpha;
    L.fillStyle = '#fff';
    L.setTransform(f.mark.s, 0, 0, f.mark.s, f.mark.tx, f.mark.ty);
    L.fill(P(f.d));
    L.setTransform(1, 0, 0, 1, 0, 0);
  }
  // wordmark glyphs (coverage too, so the ink colour is applied once)
  L.fillStyle = '#fff';
  for (const gl of f.glyphs) {
    if (gl.alpha <= 0) continue;
    L.globalAlpha = gl.alpha;
    L.setTransform(f.text.s, 0, 0, f.text.s, f.text.tx, f.text.ty + gl.dy);
    L.fill(P(gl.d));
  }
  L.setTransform(1, 0, 0, 1, 0, 0);
  L.globalAlpha = 1;
  L.globalCompositeOperation = 'source-in';
  L.fillStyle = f.ink;
  L.fillRect(0, 0, W, H);

  const M = S.main;
  M.fillStyle = f.bg;
  M.fillRect(0, 0, W, H);
  M.drawImage(S.layerEl, 0, 0);
  return S.mainEl.toDataURL('image/png');
}

// ---------------------------------------------------------------- render ---
export async function renderIntro({ variant, out, width = 1920, height = 1080, fps = 60, lockupFile }) {
  const v = VARIANTS[variant];
  if (!v) throw new Error(`unknown variant ${variant} (use ${Object.keys(VARIANTS).join(', ')})`);
  const sim = simulate({ fps });
  const lk = readLockup(lockupFile);
  const { bounds } = sim;

  // start: the mark alone, centred, half the frame tall
  const s0 = (0.5 * height) / bounds.h;
  const start = { s: s0, tx: width / 2 - (bounds.x + bounds.w / 2) * s0, ty: height / 2 - (bounds.y + bounds.h / 2) * s0 };
  // end: the lockup, centred, 60% of the frame wide
  const Ls = (0.6 * width) / lk.viewBox.w;
  const ox = (width - lk.viewBox.w * Ls) / 2 - lk.viewBox.x * Ls;
  const oy = (height - lk.viewBox.h * Ls) / 2 - lk.viewBox.y * Ls;
  const end = { s: lk.mark.s * Ls, tx: lk.mark.tx * Ls + ox, ty: lk.mark.ty * Ls + oy };
  const text = { s: Ls, tx: lk.textX * Ls + ox, ty: oy };

  const frameArg = (k) => {
    const f = sim.frames[k];
    const t = f.t;
    const fade = clamp((t - T.fadeStart) / (T.fadeEnd - T.fadeStart));
    const sl = easeInOut(clamp((t - T.slideStart) / (T.slideEnd - T.slideStart)));
    const mark = {
      s: start.s + (end.s - start.s) * sl,
      tx: start.tx + (end.tx - start.tx) * sl,
      ty: start.ty + (end.ty - start.ty) * sl,
    };
    const glyphs = lk.glyphs.map((d, i) => {
      const p = clamp((t - T.textStart - i * T.letterStagger) / T.letterDur);
      return { d, alpha: easeOut(p), dy: (1 - easeOut(p)) * 0.35 * 142 * Ls };
    });
    return {
      bg: v.bg, ink: v.ink, d: sim.d, mark,
      circles: f.circles, caps: f.caps, smoothK: 14,
      sdfAlpha: 1 - fade, exactAlpha: fade,
      glyphs, text,
    };
  };
  await encodeVideo({
    out, width, height, fps, frames: sim.frames.length,
    setup: setupPage, setupArg: { W: width, H: height },
    draw: drawPage, frameArg,
    poster: 1.8, // mid-growth: the chaotic network, before it settles
  });
}

// ------------------------------------------------------------------ CLI ---
const isCLI = typeof process !== 'undefined' && process.argv && import.meta.url === `file://${process.argv[1]}`;
if (isCLI) {
  const args = process.argv.slice(2);
  const get = (k, d) => {
    const i = args.indexOf(`--${k}`);
    return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d;
  };
  const outdir = get('outdir', 'renders/video');
  const variants = get('variant', null) ? [get('variant')] : Object.keys(VARIANTS);
  fs.mkdirSync(outdir, { recursive: true });
  for (const variant of variants) {
    const out = path.join(outdir, `rhizome-intro-${variant}.mp4`);
    await renderIntro({
      variant, out,
      width: +get('width', 1920), height: +get('height', 1080), fps: +get('fps', 60),
      lockupFile: get('lockup', new URL('../renders/molecule/lockup-ref.svg', import.meta.url).pathname),
    });
    console.log(`wrote ${out} (${(fs.statSync(out).size / 1024 / 1024).toFixed(1)} MB)`);
  }
}
