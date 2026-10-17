# Phase 3 — Analysis (updated as data arrives)

## Failure classes found so far

### Class A — Monaco overview-ruler canvas captured blank (CI, ~25%)
- **Tests:** `pages-code--default light` (763 px diff, ratio 0.01).
  Historical: 15/100 CI runs; baseline matrix: 5/20 runs (25%).
- **Signature:** failing runs' test duration 6.7–7.1 s vs 1.5–1.9 s when passing —
  the 5 s `waitForMonacoChrome` timeout is always hit. The actual/expected
  attachments are byte-identical *between* failing runs (md5
  `2b14542b…`, 5/5) — the bad state is deterministic, not noise.
- **Diff shape:** exactly the ruler canvas box: `x=1266 y=45 w=14 h=755`.
  Baseline content (decoded from the expected PNG):
  - a 1 px full-height vertical line at x=1266 = the overview-ruler **border**
    (`editorOverviewRulerBorder`, `renderBorder` default on) — monaco
    `decorationsOverviewRuler.js` `_render()` strokes it;
  - a 13×2 px block at the top = the **cursor zone** of the ruler
    (`cursorHeight = 2*pixelRatio`, `cursorW = Full lane width`).
  In the failing capture both are absent → the canvas was never painted.
- **Mechanism (from monaco source):** `DecorationsOverviewRuler._render()`
  early-returns while `_actualShouldRender === Maybe` and neither the overview
  -ruler decorations nor the cursor positions changed; the canvas then stays
  transparent. The canvas is painted by the first render that *does* have a
  change — normally the editor gaining a cursor position (focus) or ruler
  decorations. Under load in CI the paint lands after the spec's 5 s wait has
  already given up (`.catch(() => {})`), and the capture happens before it.
- Why only *light*: in the dark theme the same missing border/cursor pixels
  apparently stay under the per-pixel tolerance (border colour on dark
  background), so dark captures pass despite the identical blank state.
  (Unverified for dark — see probe data below.)

### Class B — Monaco text-cursor blink (local ~35%, rare in CI history)
- **Tests:** `pages-inventory--documentation-editor-open {dark,light}`
  (37/32 px over a 2×19 px cursor at the editor caret line). Historical CI:
  run 38609565930 (32 px). Local: 7/20 `--repeat-each` executions failed;
  3/8 whole-suite runs pre-fix.
- **Mechanism (from monaco source + probe):** the editor auto-focuses
  (`activeElement` becomes `DIV.native-edit-context`), and `ViewCursors`
  toggles the cursor DOM node's visibility with a **JS interval**
  (`_cursorFlatBlinkInterval`, ~500 ms). Neither Playwright guard covers it:
  `caret: "hide"` only sets `caret-color` (Monaco's cursor is a styled div) and
  `animations: "disabled"` only finishes CSS animations/transitions.
  Probe timeline (`probe-series.mjs`): focus at +0.5 s, `cursorVis` flipping
  visible/hidden every ~500 ms for the rest of the page's life.
- **Symptom:** either an unstable screenshot (Playwright: "Failed to take two
  consecutive stable screenshots", 5 s screenshot timeout — local run-3) or a
  capture that lands with the cursor visible vs a baseline captured unfocused.

### Class C — induced, not a real flake: CPU contention during a run
- Two overlapping local suite runs (2+2 workers on 4 CPUs) produced ~60
  simultaneous small diffs (tour pulse 32×32, status-bar bands, modal inputs).
  Not counted in any baseline; recorded only to document that contention alone
  can synthesize "flakes". Kept out of all aggregates.

## Baseline numbers

| source | runs | failing runs | failing tests |
|---|---|---|---|
| CI history (last 100 frontend.yml runs, free API) | 99 | 26 (26%) | mixed: pages-code light (15), missing baselines (24), real UI changes, e2e (out of scope) |
| CI baseline matrix `39015804883` (workers=2, SHA 9f0bbbe) | 20 | 5 (25%) | pages-code--default light ×5 (763 px each) |
| local baseline (pre-fix, workers=default=2, clean runs 1–4) | 4 | 4 (100%) | docs-editor-open dark ×2, light ×1 (cursor) |
| local `--repeat-each=10` docs-editor story (pre-fix) | 20 exec | 7 (35%) | same cursor diffs |
| local with class-B fix, `--repeat-each=20` | 40 exec | 0 | — |
| local with class-B fix, whole suite ×5 | 5 | 0 | — |

(`pages-code--default light` did not flake in any local run so far — see
hypotheses; the CI probe matrix 20×10 loads will show whether the paint can be
delayed at all outside a loaded 2-worker suite.)

## Hypotheses ranked

1. **Class A root cause = overview-ruler paint lands after the 5 s wait**
   (evidence: timeout signature, blank-canvas diff, monaco early-return path).
   Prediction: a CI-side timeline probe shows `painted` flipping 0→1 *after*
   the capture (or the canvas never created); suite-load dependent.
   Confirming experiment: `probe-series.mjs` in the CI matrix (20 runners × 10
   loads per story), run 39017910750.
2. **Class B root cause = JS cursor blink while focused** — *confirmed locally*
   (probe + repeat-each before/after). Fix committed (blur), CI verification in
   run 39017789814.
3. Class A and B may share the same fix: blur changes `_cursorPositions`, which
   forces a `DecorationsOverviewRuler` render (border repaint) even if the
   waited-for paint was missed. Prediction for the CI experiment: if the blur
   run's `pages-code--default light` failures drop to 0/20, the forced render
   covers class A too; if failures stay ~25%, class A needs its own fix.
4. Remaining (to check with probe data): whether the dark-theme ruler is blank
   in the same CI runs (i.e. class A is a threshold artefact of light only).

## Not yet done
- CI probe timelines (run 39017910750, in flight).
- workers=1 local baseline (10 runs) after the default-worker baseline finishes.
- CI verification of the class-B fix (run 39017789814, in flight).
