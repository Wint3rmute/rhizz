// Parametric logo editor: paper.js skeleton (draggable nodes/edges) +
// live analytic-metaball fill (same tracer as src/metaball.mjs, low-res).
// No build step. Serve the repo root, open /editor/.

import { blobsToSvg } from '../src/metaball.mjs';

const SIZE = 512;
const LIVE_GRID = 160, LIVE_DISCS = 6;
const EXPORT_GRID = 384, EXPORT_DISCS = 10;
const SEEDS = ['chunky-001', 'chunky-002', 'chunky-003', 'chunky-004'];

paper.setup('stage');
const blobLayer = new paper.Layer();
const skelLayer = new paper.Layer();
let blobPath = null;

let model = null, modelName = '';
let sel = null; // {type:'node',id} | {type:'edge',index}
let smooth = 16, widthMul = 1, showSkel = true;

const $ = (id) => document.getElementById(id);
const byId = (id) => model.nodes.find((n) => n.id === id);

function modelBlobs(discsPer) {
  const by = new Map(model.nodes.map((n) => [n.id, n]));
  const blobs = [];
  for (const n of model.nodes) if (n.r > 0) blobs.push({ x: n.x, y: n.y, r: n.r });
  for (const e of model.edges) {
    const a = by.get(e.a), b = by.get(e.b);
    if (!a || !b) continue;
    for (let k = 0; k < discsPer; k++) {
      const t = discsPer === 1 ? 0 : k / (discsPer - 1);
      blobs.push({
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        r: widthMul * (e.w0 + (e.w1 - e.w0) * t) / 2,
      });
    }
  }
  return blobs;
}

let rafQueued = false;
function requestRender() {
  if (rafQueued) return;
  rafQueued = true;
  requestAnimationFrame(() => { rafQueued = false; renderNow(); });
}

function renderNow() {
  const { svg } = blobsToSvg(modelBlobs(LIVE_DISCS), { smooth, grid: LIVE_GRID, chaikin: 2 }, SIZE, { recenter: false });
  const m = svg.match(/<path d="([^"]*)"/);
  const d = m ? m[1] : '';
  if (!d) { if (blobPath) { blobPath.remove(); blobPath = null; } }
  else if (!blobPath) { blobPath = new paper.Path(d); blobPath.fillColor = 'black'; blobLayer.addChild(blobPath); }
  else blobPath.pathData = d;
  drawSkeleton();
  updatePanel();
}

function drawSkeleton() {
  skelLayer.removeChildren();
  if (!showSkel) return;
  const by = new Map(model.nodes.map((n) => [n.id, n]));
  model.edges.forEach((e, i) => {
    const a = by.get(e.a), b = by.get(e.b);
    if (!a || !b) return;
    const line = new paper.Path.Line(new paper.Point(a.x, a.y), new paper.Point(b.x, b.y));
    const isSel = sel && sel.type === 'edge' && sel.index === i;
    line.strokeColor = isSel ? '#e08000' : '#999';
    line.strokeWidth = isSel ? 4 : 2;
    line.data = { kind: 'edge', index: i };
    skelLayer.addChild(line);
  });
  for (const n of model.nodes) {
    if (n.r > 0) {
      const halo = new paper.Path.Circle(new paper.Point(n.x, n.y), n.r);
      halo.strokeColor = '#bbb';
      halo.dashArray = [3, 3];
      skelLayer.addChild(halo);
    }
    const isSel = sel && sel.type === 'node' && sel.id === n.id;
    const h = new paper.Path.Circle(new paper.Point(n.x, n.y), n.kind === 'hub' ? 9 : 7);
    h.fillColor = isSel ? '#00d1a1' : 'white';
    h.strokeColor = isSel ? '#007a5e' : 'black';
    h.strokeWidth = 1.5;
    h.data = { kind: 'node', id: n.id };
    skelLayer.addChild(h);
  }
}

function select(s) { sel = s; drawSkeleton(); updatePanel(); }

function updatePanel() {
  const ro = $('readout');
  const sR = $('sR'), sW0 = $('sW0'), sW1 = $('sW1');
  sR.disabled = sW0.disabled = sW1.disabled = true;
  if (!model) { ro.textContent = 'loading…'; return; }
  ro.textContent = `${model.nodes.length} nodes · ${model.edges.length} edges · ${modelName}`;
  if (sel && sel.type === 'node') {
    const n = byId(sel.id);
    if (!n) { sel = null; return; }
    ro.textContent += ` · ${n.kind} #${n.id}`;
    sR.disabled = false; sR.value = n.r; $('oR').textContent = n.r;
  } else $('oR').textContent = '';
  if (sel && sel.type === 'edge') {
    const e = model.edges[sel.index];
    if (!e) { sel = null; return; }
    ro.textContent += ` · edge #${sel.index} (${e.a}→${e.b})`;
    sW0.disabled = sW1.disabled = false;
    sW0.value = e.w0; sW1.value = e.w1;
    $('oW0').textContent = e.w0; $('oW1').textContent = e.w1;
  } else { $('oW0').textContent = ''; $('oW1').textContent = ''; }
  $('oG').textContent = smooth;
  $('oW').textContent = '×' + widthMul.toFixed(2);
}

// --- pointer: drag nodes, click select, double-click grow/connect ---
const tool = new paper.Tool();
let dragId = null, moved = false;
tool.onMouseDown = (e) => {
  const hit = skelLayer.hitTest(e.point, { stroke: true, fill: true, tolerance: 8 });
  if (hit && hit.item.data && hit.item.data.kind) {
    const k = hit.item.data.kind;
    if (k === 'node') { dragId = hit.item.data.id; moved = false; }
    else select({ type: 'edge', index: hit.item.data.index });
  } else select(null);
};
tool.onMouseDrag = (e) => {
  if (dragId == null) return;
  const n = byId(dragId);
  if (!n) return;
  n.x = Math.round((n.x + e.delta.x) * 100) / 100;
  n.y = Math.round((n.y + e.delta.y) * 100) / 100;
  moved = true;
  requestRender();
};
tool.onMouseUp = () => {
  if (dragId != null && !moved) select({ type: 'node', id: dragId });
  dragId = null;
};
tool.onDoubleClick = (e) => {
  if (!model) return;
  const hit = skelLayer.hitTest(e.point, { fill: true, tolerance: 8 });
  if (hit && hit.item.data && hit.item.data.kind === 'node' && sel && sel.type === 'node' && sel.id !== hit.item.data.id) {
    // connect selected node to the double-clicked one
    model.edges.push({ a: sel.id, b: hit.item.data.id, w0: model.params.stroke * 0.8, w1: model.params.stroke * 0.6 });
    select({ type: 'edge', index: model.edges.length - 1 });
  } else {
    // grow: new terminal joined to the nearest node
    let best = null, bd = Infinity;
    for (const n of model.nodes) {
      const d = (n.x - e.point.x) ** 2 + (n.y - e.point.y) ** 2;
      if (d < bd) { bd = d; best = n; }
    }
    const id = Math.max(...model.nodes.map((n) => n.id)) + 1;
    model.nodes.push({ id, x: Math.round(e.point.x * 100) / 100, y: Math.round(e.point.y * 100) / 100, r: model.params.nodeR, kind: 'terminal' });
    model.edges.push({ a: best.id, b: id, w0: model.params.stroke * 0.8, w1: model.params.stroke * 0.6 });
    select({ type: 'node', id });
  }
  requestRender();
};
document.addEventListener('keydown', (e) => {
  if ((e.key !== 'Delete' && e.key !== 'Backspace') || !sel) return;
  if (/INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
  e.preventDefault();
  if (sel.type === 'node') {
    const n = byId(sel.id);
    if (!n || n.kind === 'hub') return;
    model.nodes = model.nodes.filter((m) => m.id !== sel.id);
    model.edges = model.edges.filter((x) => x.a !== sel.id && x.b !== sel.id);
  } else {
    model.edges.splice(sel.index, 1);
  }
  sel = null;
  requestRender();
});

// --- panel wiring ---
$('sR').addEventListener('input', (e) => {
  if (!sel || sel.type !== 'node') return;
  byId(sel.id).r = +e.target.value;
  requestRender();
});
$('sW0').addEventListener('input', (e) => {
  if (!sel || sel.type !== 'edge') return;
  model.edges[sel.index].w0 = +e.target.value;
  requestRender();
});
$('sW1').addEventListener('input', (e) => {
  if (!sel || sel.type !== 'edge') return;
  model.edges[sel.index].w1 = +e.target.value;
  requestRender();
});
$('sG').addEventListener('input', (e) => { smooth = +e.target.value; requestRender(); });
$('sW').addEventListener('input', (e) => { widthMul = +e.target.value; requestRender(); });
$('skel').addEventListener('change', (e) => { showSkel = e.target.checked; drawSkeleton(); });
$('addNode').addEventListener('click', () => {
  if (!model) return;
  const from = sel && sel.type === 'node' ? byId(sel.id) : byId(0);
  const ang = Math.atan2(from.y - SIZE / 2, from.x - SIZE / 2) || 0;
  const id = Math.max(...model.nodes.map((n) => n.id)) + 1;
  model.nodes.push({ id, x: Math.round((from.x + Math.cos(ang) * 90) * 100) / 100, y: Math.round((from.y + Math.sin(ang) * 90) * 100) / 100, r: model.params.nodeR, kind: 'terminal' });
  model.edges.push({ a: from.id, b: id, w0: model.params.stroke * 0.8, w1: model.params.stroke * 0.6 });
  select({ type: 'node', id });
  requestRender();
});
$('delSel').addEventListener('click', () => {
  if (!sel) return;
  if (sel.type === 'node') {
    if (byId(sel.id).kind === 'hub') return;
    model.nodes = model.nodes.filter((m) => m.id !== sel.id);
    model.edges = model.edges.filter((x) => x.a !== sel.id && x.b !== sel.id);
  } else model.edges.splice(sel.index, 1);
  sel = null;
  requestRender();
});
$('reset').addEventListener('click', () => loadModel(modelName));

async function loadModel(name) {
  modelName = name;
  document.querySelectorAll('#seeds button').forEach((b) => b.classList.toggle('primary', b.dataset.seed === name));
  model = await fetch('models/' + name + '.json').then((r) => r.json());
  sel = null;
  requestRender();
}
for (const s of SEEDS) {
  const b = document.createElement('button');
  b.textContent = s.replace('chunky-', 'seed ');
  b.dataset.seed = s;
  b.addEventListener('click', () => loadModel(s));
  $('seeds').appendChild(b);
}

function download(name, text, mime) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: mime }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
$('exportSvg').addEventListener('click', () => {
  const { svg } = blobsToSvg(modelBlobs(EXPORT_DISCS), { smooth, grid: EXPORT_GRID, chaikin: 2 }, SIZE, { recenter: false });
  download('parametric-logo.svg', svg, 'image/svg+xml');
});
$('exportPng').addEventListener('click', () => {
  const { svg } = blobsToSvg(modelBlobs(EXPORT_DISCS), { smooth, grid: EXPORT_GRID, chaikin: 2 }, SIZE, { recenter: false });
  const img = new Image();
  img.onload = () => {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 1024;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 1024, 1024);
    ctx.drawImage(img, 0, 0, 1024, 1024);
    const a = document.createElement('a');
    a.href = cv.toDataURL('image/png');
    a.download = 'parametric-logo.png';
    a.click();
  };
  img.src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
});

loadModel('chunky-002');

// console/test hook: window.__editor.model, .select(), .exportSVGString()
window.__editor = {
  get model() { return model; },
  get selection() { return sel; },
  select, loadModel, requestRender,
  moveNode(id, x, y) { const n = byId(id); n.x = x; n.y = y; requestRender(); },
  exportSVGString() {
    return blobsToSvg(modelBlobs(EXPORT_DISCS), { smooth, grid: EXPORT_GRID, chaikin: 2 }, SIZE, { recenter: false }).svg;
  },
};
