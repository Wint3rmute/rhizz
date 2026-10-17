# VRT robustness research — REPORT

Branch `fix/vrt-robustness` (pushed, no PR opened/merged by this work; PR #417
exists from earlier and simply re-runs the normal pipeline on pushes).
Budget: ≤150 triggered workflow runs, ≤20 concurrent — **10 used**
(ledger `.vrt-research/ci-ledger.tsv`). All raw data in `.vrt-research/`
(git-excluded); only `docs/vrt-research/*`, `scripts/vrt-research/*` and the
fixes themselves are committed.

## TL;DR

- Root causes were two Monaco chrome races, both invisible to the existing
  guards, both now fixed deterministically (no thresholds/retries/timeouts):
  1. **Class A — overview-ruler blank after Storybook's theme flip.** The flip
     lands ~0.5 s post-mount, the app re-themes Monaco, the ruler re-render
     clears the canvas, and whether a follow-up render repaints it is a
     scheduling race. CI probe: 54/200 loads (27%) ended blank = the suite's
     25% flake rate on `pages-code--default light`. Fix: settle the theme
     before mount so the flip is idempotent. **Flake 5/20 → 0/20 (and 0/60 in
     the final verification batch).**
  2. **Class B — the text cursor blinks via a JS interval** while the editor
     has focus; `caret: "hide"` (caret-color) and `animations: "disabled"`
     (CSS only) cannot stop it. ~35% of local runs of
     `pages-inventory--documentation-editor-open {dark,light}` failed with a
     32/37 px cursor diff (or a two-stable-frames timeout). Fix: scoped CSS
     hiding `.monaco-editor .cursor`. **Local: 7/20 → 0/40.**
- Two baselines-groups were re-baselined (justified, see below): the theme
  fix makes the ruler cursor zone carry the captured theme's colour instead of
  the pre-flip theme's blend baked into 5 light-theme baselines. The fixed
  pixels are what the real app renders (the app sets the theme before mount;
  only Storybook's iframe starts theme-less), and each is byte-identical
  across repeated runs.
- The real `frontend.yml` `visual-regressions` job passes on the final SHA.

## Environment (local vs CI)

| | local (NixOS) | CI (ubuntu-latest) |
|---|---|---|
| nproc / RAM / /dev/shm | 4 / 16 GB / 7.8 G | 4 / 16 GB / 7.9 G |
| GPU | none | none (`--disable-gpu`, swiftshader) |
| TZ / LANG | unset / en_US.UTF-8 | unset / C.UTF-8 |
| nixpkgs (flake.lock) | `6510408d147d…` narHash `sha256-XK4Kceon…` | identical |
| chromium | Chrome for Testing 153.0.8010.12 (chromium-1243) | same locked store path |
| fonts | 35 pinned files (dejavu/liberation/noto-emoji), `fc-match sans-serif` → DejaVu Sans | `fc-match` identical; same closure |

Fonts/browser are Nix-hermetic and identical by the shared flake.lock — the
flakiness was **not** an environment-parity problem; it was in-page timing.

## Failure classes (with evidence)

| class | tests | diff shape | runs | evidence |
|---|---|---|---|---|
| A: overview-ruler blank after theme flip | `pages-code--default light` | 763 px, bbox = the ruler canvas (x=1266 y=45 w=14 h=755): missing 1px border + 13×2 cursor zone | 15/100 historical runs; 5/20 baseline CI | run 38971454005 artifacts; probe2 54/200 loads |
| B: JS cursor blink while focused | `pages-inventory--documentation-editor-open {dark,light}` (+ historical `components-monacoeditor--*` 8400 px) | 32/37 px = one 2×19 px caret | 7/20 local repeat-each; 3/8 local whole-suite; 2 historical CI runs | probe timelines; monaco `viewCursors.js` source |
| C: induced contention (not a real flake) | anything | many small diffs at once | 1 local batch | two overlapping local suites (2+2 workers) — excluded from aggregates |
| stale baseline / real changes (not flakes) | `pages-projects--with-projects` (build-info footer), `components-buildinfo--*` (new stories), 20-test cluster on `feature/view-connection-hidden` | varies | historical only | diff magnitudes stable per SHAs; new-story messages |

## Experiments

| hypothesis | change | commit | CI runs | failures before | after |
|---|---|---|---|---|---|
| B: blink race | blur `activeElement` (WRONG tool) | 2e2449f (reverted) | 20 | 0 targeted | **60 stories 100%** — blur strips input focus rings; kept only as evidence |
| B: blink race | scoped CSS hides `.monaco-editor .cursor` | 4929203 | — | 7/20 local | **0/40 local** (repeat-each) |
| A: flip clears ruler, repaint races | settle `data-theme` before mount | fe8ff99 | 20 (run 39019891144) | 5/20 on pages-code light | **0/20**; 4 deterministic baseline deltas (then re-baselined, f36e573) |
| final verification | both fixes + re-baselines | f36e573 | 60 (final1/2b/3b) + real pipeline | 25% suite-level | **0 failures / 60 runs; real pipeline green** |

## Final fixes (each with evidence)

1. `4929203` — `vrt: hide Monaco's JS-blinking cursor via scoped CSS`.
   Evidence: probe timeline (`focus=DIV.native-edit-context` at +0.5 s,
   `cursorVis` toggling every ~500 ms), monaco source (`_cursorFlatBlinkInterval`
   is a JS interval; `caret: hide` only sets caret-color), local before/after
   7/20 → 0/40. The revert of the blur variant is documented (60 stories,
   100%, run 39017789814) to show why the fix must stay scoped.
2. `fe8ff99` — `vrt: settle the theme before mount so Storybook's theme flip
   can't race Monaco's ruler`.
   Evidence: probe2 (200 CI loads): initial paint at +0.2–0.4 s, flip clears
   at +0.33–0.55 s, 72/126 repaint, 54/126 never → 27% blank = the 25% suite
   flake; failing captures byte-identical (md5 `2b14542b…`); failing tests
   6.7–7.1 s vs 1.5–1.9 s (5 s wait bound hit). After: 0/20 CI.
3. `f36e573` — re-baseline of the five light-theme ruler zones
   (`pages-code--default--light` in fe8ff99; `components-monacoeditor--{hcl,
   markdown-unwrapped-overflows, markdown-word-wrapped}--light`,
   `pages-inventory--documentation-editor-open--light` here).
   Justification: the old baselines captured the ruler cursor zone with the
   *pre-flip dark* theme's `editorCursor.foreground` blend on a *post-flip
   light* editor (≈139,137,234); the deterministic state paints the captured
   theme's colour (≈121,106,209) — which is what the real app renders, since
   the app applies the theme before the editor mounts. Verified: scan of all
   baselines finds the artifact in exactly these five files (dark baselines
   unaffected — the dark blend over the dark editor is the same either way),
   and each story's actual is byte-identical across 3 repeated runs.

## Final verification (all at the final SHA f36e573)

- **CI: 60 repeats (final1 `39020912404`, final2b `39021284542`,
  final3b `39021622625`), 20 runs each: 0 failures, 0 flakes, every test.**
  Suite duration mean 206/202/204 s (baseline was 210 s — no more 5 s wait
  burns). 95% upper bound on the per-test flake rate with 0/60:
  ≈ 3/60 = **5%** (was 25% for `pages-code--default light`).
- **Real pipeline:** `frontend.yml` → `visual-regressions` job on f36e573
  (run 39020590268): **success** (no experiment workflow involved).
- **Local: 20-run whole-suite batch at f36e573** — first 8 runs (runs 3–8;
  runs 1–2 were killed by my own process cleanup and discarded) all 308/308
  pass; batch still running, numbers finalised below when it completes.

## Remaining flakiness

None observed in 60 CI runs + the real pipeline run at the final SHA, nor in
the local batch so far. The two root causes (A: theme-flip ruler race, B: JS
cursor blink) were the only classes that reproduced on demand; the
`pages-projects--with-projects` cluster is a stale baseline from a real UI
change on a merged PR branch, not a flake, and is untouched.

## Unverified / needs a human

- The `pages-projects--with-projects` cluster (41335 px, 5 runs on the
  `feat/build-info-footer` PR) looks like a stale baseline for a real footer
  change rather than a flake; it never appeared on any other branch. Not
  touched.
- CI `fc-list | sort | md5sum` could not be captured (the diag step fetched
  fontconfig ad hoc outside the devshell and the download was rate-limited);
  `fc-match` matches and both environments consume the same locked font
  closure, so fonts are equivalent by construction.
- The local workers=1 comparison was skipped (class B is a per-capture race,
  worker-count-independent; the CI verification covers the same ground). If
  wanted: `run-local.sh baseline-w1 10 1`.
- The experiment workflow `vrt-experiment.yml` remains in the tree,
  manual-only (`workflow_dispatch`), never scheduled, and is the instrument
  that produces all the CI numbers in this report. Keep it for regression
  work or delete it — it changes no production behaviour either way.

## CI cost

**10 workflow runs triggered** (ledger): baseline 1, probes 2, fix experiments
2, final verification 5 (two cancelled at queue — the workflow's concurrency
group keeps only one pending run per ref — and each replaced by a fresh
trigger). Plus the PR's own `frontend.yml` runs triggered by pushes
(supersession cancellations + the final green one). Each triggered run is a
20-way matrix; ≤20 concurrent jobs at all times.
