# Phase 1 — Local baseline (pre-fix)

Runner: `scripts/vrt-research/run-local.sh` (fresh dir per run, JSON reporter,
artifacts kept, meta.json with exit code/duration/SHA). Aggregate with
`scripts/vrt-research/summarize.mjs`. Raw data: `.vrt-research/runs/local/*`.

## Clean whole-suite runs at default workers (2)

4 uncontaminated runs (`baseline-w2` runs 1–4, SHA 3392db97, before any fix
was in the tree; later runs of that batch were discarded after concurrent
local runs contaminated them):

| run | result |
|---|---|
| 1 | pass (308/308, 249 s) |
| 2 | pass (242 s) |
| 3 | **fail**: `pages-inventory--documentation-editor-open dark` (37 px) |
| 4 | **fail**: `pages-inventory--documentation-editor-open dark` (37 px) |

Cursor-class failures: 3 of 8 story executions of the docs-editor story
(dark ×2, light ×1). `pages-code--default light` never failed locally (the
ruler race is timing-dependent on CI runners — see 02-ci.md).

## Targeted `--repeat-each=10` of the flaky story (pre-fix, SHA 3392db97)

`.vrt-research/runs/local/repeat-docs` — 20 executions
(`documentation-editor-open` dark+light):

- **7/20 failed (35%)**, all 32/37 px cursor diffs, durations 2.0–11.1 s.
- Failure modes: either a "stable screenshot" timeout ("Failed to take two
  consecutive stable screenshots") or a capture with the cursor visible vs a
  baseline captured with it hidden.

## workers=1 comparison

Not run pre-fix (the suite is ~8–10 min serial and the class-B flake is
worker-count-independent: it is a per-capture blink race). Post-fix
verification at default workers is running (`verify-fix` label); if it comes
back clean, a workers=1 run adds no signal beyond what the CI verification
provides. Documented as a gap in REPORT.md if it stays unrun.

## Class C (induced): concurrent local runs

Two overlapping suite runs (2+2 workers on 4 CPUs) produced ~60 simultaneous
small deterministic diffs (tour pulse 32×32, status-bar bands, modal input
rings). Excluded from every aggregate; recorded in `.vrt-research/NOTES.md`
so a future reader does not mistake it for a new flake class.

## With the class-B fix (CSS cursor hide, SHA 4929203)

- `--repeat-each=20` of the docs-editor story: **40/40 pass** (before: 7/20).
- 5 whole-suite runs of the same story filter: 5/5 pass.
- Full-suite verification (20 runs) is running in the background
  (`verify-fix` label).

## With the class-A fix (theme settled before mount, SHA fe8ff99)

- `pages-code--default` (both themes): 8/8 runs byte-identical
  (md5 `d5782ffd…` for the light actual), deterministic after the single
  justified re-baseline (`pages-code--default--light.png`).
- Full-suite verification: part of the same `verify-fix` batch.
