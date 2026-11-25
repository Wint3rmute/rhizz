# AGENTS.md — working in `rhizz-logo`

Generative SVG logo for **Rhizz**. Every artifact is code-generated
(`params + seed → .svg`), never hand-drawn. If you find yourself nudging path
coordinates by hand, stop: change a parameter or the generator instead.

The current deliverable is **`src/molecule.mjs`** — an exact-outline replication of
`references/logo_suggestion_chatgpt.png`, scoring **93.07% IoU** against it.
Everything else in `src/` is superseded exploration, kept for comparison (see
[Repo map](#repo-map)).

---

## 1. Environment

Everything runs inside the Nix dev shell. **`python3`, `resvg`, `magick` and `svgo` do
not exist outside it** — that is the single most common way to waste a turn here.

```sh
nix develop                                   # interactive
nix develop --command <cmd>                   # one-shot (preferred for agents)
nix develop --command sh -c 'a && b && c'     # multi-step
```

Node deps (`paper`, `jsdom`, `canvas`, `opentype.js`) come from `package.json` via
`npm install`; `node_modules/` is gitignored. `canvas` needs `pkg-config/cairo/pango`,
which the flake already pins.

---

## 2. The core loop: generate → rasterize → **look at it**

This repo is built around the agent reviewing its own output with vision. Do not
report a visual result you have not actually looked at.

```sh
# 1. generate
node src/molecule.mjs --preset reference --out renders/molecule/molecule-ref.svg

# 2. rasterize  (ALWAYS --background white: black-on-transparent is invisible
#    in the vision viewer and you will "see" a blank image and misreport it)
resvg --background white renders/molecule/molecule-ref.svg renders/png/molecule-ref.png

# 3. read the PNG back with the image-read tool, then judge.
```

Useful variants:

```sh
resvg --background white --zoom 4 in.svg big.png       # inspect a joint up close
resvg --background white --width 16 in.svg tiny.png    # small-size legibility
magick tiny.png -scale 800% zoom.png                   # 16px is too small to see raw — upscale it
magick montage a.png b.png -tile 2x1 -geometry +8+8 -background white sheet.png
```

### Score it, don't eyeball fidelity

```sh
node src/diff-ref.mjs renders/png/molecule-ref.png renders/png/diff-molecule.png
# → IoU = 93.07%   and a red/blue/black overlay:
#   black = agreement, red = reference only, blue = render only
```

Both masks are trimmed to their ink bbox and letterboxed into 512², so the score is
**shape-only** (position/scale neutral). Always re-run this after touching
`molecule.mjs` to prove you didn't drift the geometry.

> **IoU guards fidelity, never taste.** It only rewards filled area, so it will happily
> push any "make it fatter" knob past the point of looking good. See
> [§5 fillets](#5-the-fillet-system-read-before-touching-corners) for the concrete trap.
> For anything aesthetic, render a sweep and look at it.

### Browser check

```sh
# setsid, or the server dies with the shell and you get ERR_CONNECTION_REFUSED
nix develop --command sh -c 'setsid python3 -m http.server 8000 >/tmp/h.log 2>&1 < /dev/null &'
# then navigate to http://127.0.0.1:8000/gallery.html   (127.0.0.1, not localhost)
```

Verify nothing is broken before claiming the gallery is fine:

```js
[...document.images].filter(i => !i.complete || i.naturalWidth === 0).map(i => i.src)
```

---

## 3. Repo map

| Path | Status | What |
|---|---|---|
| `src/molecule.mjs` | **current** | Exact-outline generator + fillet system. The deliverable. |
| `src/measure-ref.mjs` | tool | Distance transform over the reference bitmap → dot centres, radii, bar width, arm angles. |
| `src/diff-ref.mjs` | tool | IoU score + red/blue/black overlay for any rendered PNG. |
| `src/fit-ref.mjs` | tool | Coordinate descent on IoU. Rasterizes via resvg (~50ms/trial). |
| `src/lockup.mjs` | current | `<mark> Rhizome` lockup; Roboto Bold → outlines via opentype.js. Mark-agnostic. |
| `src/metaball.mjs` | superseded | Analytic metaballs + marching squares. 26.95% IoU. Still imported by `editor/`. |
| `src/paper-rhizome.mjs` | superseded | paper.js booleans, united silhouette. 29.66% IoU. |
| `src/generate.mjs` | superseded | Zero-dep original; `rhizome`/`plateau`/`mesh` variants. |
| `src/hybrid.mjs` | exploration | Rhizome walked over a warped mesh. Different metaphor. |
| `editor/` | **stale** | paper.js parametric editor, still on the metaball tracer. Does not know about `molecule.mjs`. |
| `gallery.html` | current | Review surface. §0 is the pick; §1 and §5 are marked superseded. |
| `references/` | input | Source images. `logo_suggestion_chatgpt.png` is the target. |

`renders/png/` **is gitignored** (see [§7](#7-gotchas-that-have-already-cost-time)).

---

## 4. `molecule.mjs` — the model

The mark is a **tree of circles (nodes) joined by constant-width capsules (edges)**.
That silhouette is a single closed curve, so it is traced *exactly*: node-circle arcs,
capsule side lines, and a tangent fillet arc at every concave corner. One path of real
`A`/`L` commands — **no marching squares, no boolean ops, no SVG filters, no deps.**

These facts were measured, not guessed, and each one invalidated an earlier generator:

1. **There is no hub dot.** Four bars simply converge. (`editor/models/reference.json`
   still carries an invented `r: 38` hub — that file is wrong, don't trust it.)
2. **Bars are constant width**, not tapered. `taperStep` in the old generators modelled
   nothing real.
3. **Bar width / dot diameter = 0.365** (27px / 74px).
4. Hub-arm angles are **−77° / 20° / 79° / 137° / −160°** — deliberately *not* evenly
   slotted. Any generator that fans arms on uniform slots will look like a snowflake.

### CLI

```sh
node src/molecule.mjs --preset reference --out out.svg   # the measured reference
node src/molecule.mjs --seed 1 --seed-end 6 --outdir dir/ # seeded variants
node src/molecule.mjs --set dotR=44,barW=24,jointFillet=20 --out out.svg
node src/molecule.mjs --seed 3                           # no --out → stdout
```

`--set k=v,...` overrides any key in `MOLECULE_DEFAULTS`; unknown keys are ignored.
There is **no `--help`** — unknown flags are silently ignored and it just renders.
Each run also writes a sibling `.bounds.json` (measured ink bounds), which
`lockup.mjs` consumes so it never has to guess.

### Parameters

*Geometry:* `size, dotR, barW, hubR, fillet, jointFillet, margin`
*Topology (ignored by `--preset reference`):* `arms, chains, armLen, chainLen, spread,
chainTurn, minSep, clearance`

---

## 5. The fillet system (read before touching corners)

The organic feel comes entirely from the concave corners. There are **two structurally
different corner types**, and conflating them is what produced sharp V-spikes in v003:

- **A · Dot joint** — the node circle pokes out past the bar, so the bar's side line
  runs into the circle. Fillet is tangent to a **line and a circle**: centre at `r+f`
  from the node centre and `h+f` from the bar axis, which pins it exactly.
  Radius = `fillet` (default 9).
- **B · Notch** — two bars converge steeply enough that their facing sides cross
  *before* reaching the circle, which gets swallowed. This is **every corner of the
  reference's hub**, since that hub has no dot. Fillet is the circle inscribed in the
  angle between **two lines**: `t = f/tan(φ/2)` back along each side, clamped to 0.42×
  the shorter bar so tangent points stay on the bars. Radius = `jointFillet` (default 16).

v003 grew the node radius until B degenerated into A (`h/sin(t/2)`), then bridged the
remainder with a straight `L` — a hard corner exactly where the reference is softest.
Handling B natively removed the need to inflate radii at all, so `hubR` is now honest
geometry rather than a fudge factor.

**The IoU trap, concretely.** Sweeping `jointFillet` gives 93.0% at 16 → 93.5% at 70,
monotonically increasing. Following that metric is wrong: by ~48 the fillets web across
the bars, which is precisely the metaball-goo failure the project already abandoned.
**16 was chosen by eye**, from:

```sh
for j in 0 16 30 48 70; do
  node src/molecule.mjs --preset reference --set jointFillet=$j --out /tmp/j$j.svg
  resvg --background white --zoom 4 /tmp/j$j.svg /tmp/jb$j.png
  magick /tmp/jb$j.png -crop 620x560+940+720 +repage /tmp/jc$j.png
done
magick montage /tmp/jc*.png -tile 5x1 -geometry +6+6 -background white \
  renders/png/molecule-fillet-sweep.png
```

---

## 6. Rebuilding every gallery asset

`renders/png/` is gitignored, so after a fresh clone the gallery has broken images
until you run this. Run it from the repo root inside `nix develop`.

```sh
mkdir -p renders/png/molecule

# marks
node src/molecule.mjs --preset reference --out renders/molecule/molecule-ref.svg
node src/molecule.mjs --seed 1 --seed-end 6 --outdir renders/molecule
node src/molecule.mjs --seed 2 \
  --set arms=3,chains=1,dotR=58,barW=38,fillet=10,jointFillet=20,armLen=150,chainLen=120 \
  --out renders/molecule/molecule-favicon.svg

# lockups
node src/lockup.mjs --mark renders/molecule/molecule-ref.svg --out renders/molecule/lockup-ref.svg
node src/lockup.mjs --mark renders/molecule/molecule-001.svg --out renders/molecule/lockup-001.svg

# review rasters
for f in renders/molecule/molecule-00*.svg; do
  resvg --background white "$f" "renders/png/molecule/$(basename "$f" .svg).png"
done
magick montage renders/png/molecule/molecule-00*.png -tile 3x2 -geometry +6+6 \
  -background white renders/png/sheet-molecule.png
resvg --background white renders/molecule/molecule-ref.svg renders/png/molecule-ref.png
resvg --background white renders/molecule/lockup-ref.svg renders/png/molecule-lockup-ref.png
resvg --background white renders/molecule/molecule-favicon.svg renders/png/molecule-favicon.png

# fidelity overlay
node src/diff-ref.mjs renders/png/molecule-ref.png renders/png/diff-molecule.png

# small sizes (16px is unreadable un-zoomed — upscale before looking)
resvg --background white --width 32 renders/molecule/molecule-ref.svg /tmp/m32.png
resvg --background white --width 16 renders/molecule/molecule-ref.svg /tmp/m16.png
magick /tmp/m32.png -scale 400% /tmp/z32.png
magick /tmp/m16.png -scale 800% /tmp/z16.png
magick montage /tmp/z32.png /tmp/z16.png -tile 2x1 -geometry +8+8 -background white \
  renders/png/molecule-small.png
resvg --background white --width 32 renders/molecule/molecule-favicon.svg /tmp/f32.png
resvg --background white --width 16 renders/molecule/molecule-favicon.svg /tmp/f16.png
magick /tmp/f32.png -scale 400% /tmp/zf32.png
magick /tmp/f16.png -scale 800% /tmp/zf16.png
magick montage /tmp/zf32.png /tmp/zf16.png -tile 2x1 -geometry +8+8 -background white \
  renders/png/molecule-favicon-small.png

# fillet before/after  (the "before" panel is jointFillet=0, i.e. the notch fillet
# switched off — reproducible from current code, and it shows the same sharp corner
# the original v003 straight-line bridge produced)
resvg --background white --zoom 4 renders/molecule/molecule-ref.svg /tmp/big.png
magick /tmp/big.png -crop 700x600+900+700 +repage renders/png/molecule-junction-after.png
node src/molecule.mjs --preset reference --set jointFillet=0 --out /tmp/j0.svg
resvg --background white --zoom 4 /tmp/j0.svg /tmp/jb0.png
magick /tmp/jb0.png -crop 700x600+900+700 +repage renders/png/molecule-junction-before.png
magick montage renders/png/molecule-junction-before.png renders/png/molecule-junction-after.png \
  -tile 2x1 -geometry +8+8 -background '#ccc' renders/png/molecule-fillet-compare.png
```

Plus the `jointFillet` sweep in [§5](#5-the-fillet-system-read-before-touching-corners).

> The `-crop WxH+X+Y` offsets above are tuned to the reference preset's hub at
> `--zoom 4`. Change the geometry and you must re-aim the crop, or you will be
> inspecting empty whitespace and concluding the mark is broken.

---

## 7. Gotchas that have already cost time

- **`renders/png/` is gitignored, but `gallery.html` references 5 files inside it**
  (`diff-molecule`, `molecule-small`, `molecule-favicon-small`, `molecule-fillet-compare`,
  `molecule-fillet-sweep`). A fresh clone renders them broken. Either run §6, or decide
  to commit those specific PNGs / move them to a tracked `docs/` dir. **Unresolved.**
- **`resvg` without `--background white`** → black art on transparent → looks blank in
  the vision viewer → you misreport it as broken.
- **`python3 -m http.server` without `setsid`** dies with the shell; the next navigate
  gives `ERR_CONNECTION_REFUSED`. Use `127.0.0.1`, not `localhost`.
- **`canvas` is CJS and ships no `Path2D`** in this build. Use `import pkg from 'canvas'`,
  and rasterize via resvg rather than in-process Path2D (this is why `fit-ref.mjs` shells out).
- **`opentype.js` is CJS too**, and `font.getPath()` crashes on Roboto's ccmp table —
  `lockup.mjs` does manual per-glyph layout to avoid shaping. Don't "simplify" that.
- **A tracer bug and a layout bug look identical.** Seed 4 once enclosed negative space;
  that was a chained dot drifting back into the cluster and breaking the tree assumption,
  not a tracer fault. Guarded by `clearance`. If the outline self-intersects, suspect the
  graph first.
- **Never `simplify()` united arcs** (paper.js legacy note) — it deforms circles into lumps.
- `editor/models/reference.json` encodes the **old, wrong** hand-measured model
  (invented hub dot, tapered edges). `referenceGraph()` in `molecule.mjs` is the truth.

---

## 8. Fidelity scoreboard

| generator | IoU vs reference |
|---|---|
| `molecule.mjs --preset reference` | **93.07%** |
| `renders/reference-mark.svg` (correct geometry, metaball tracer) | 50.08% |
| `v002/paper-rhizome-001.svg` | 29.66% |
| `metaball-chunky/metaball-002.svg` | 26.95% |

The 50% row is the instructive one: correct measured geometry run through the *wrong
tracer* still loses half its score. The primitive matters more than the parameters.

---

## 9. Suggested next steps

1. **Port `editor/` to `molecule.mjs`** (biggest win). It still imports `blobsToSvg` from
   the metaball tracer, so the interactive editor and the shipping generator disagree.
   Dragging nodes against the exact arc outline would make `fillet`/`jointFillet` tunable
   by hand instead of by CLI sweep.
2. **Resolve the gitignored-PNG issue** in §7 so the gallery survives a clone.
3. **Colour / dark-mode variants** — generator is single-path black fill; the README
   promises light/dark/mono from one source. Currently `gallery.html` fakes dark mode
   with a CSS `filter: invert(1)`.
4. **`svgo` pass at hand-off only** — never during exploration, it destroys diff readability.
5. Possibly retire `renders/v002/`, `renders/metaball*/`, `renders/hybrid/` once nobody
   needs the comparison.

---

## 10. Conventions

- Output SVGs: single `<path>`, `fill="#000"`, `viewBox="0 0 512 512"`, no filters, no fonts.
  Text is always converted to outlines.
- Legibility targets: 16, 32, 128, 512px. Rasterize and *look* before claiming a size works.
  The full 6-dot mark holds at 32px; 16px needs the reduced favicon preset.
- Seeded RNG is `mulberry32`. Keep calls in order — reordering them silently changes every
  existing seed's output.
- Commit generated SVGs under `renders/`; they are the reviewable artifact.
- Don't commit or branch unless asked.
