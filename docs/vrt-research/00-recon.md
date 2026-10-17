# Phase 0 — Recon (no changes yet)

Date: 2026-10-17. Branch: `fix/vrt-robustness` @ `3392db97` (main tip, pulled).

## VRT tool and setup

- **Tool:** Playwright Test 1.63.0 (`@playwright/test`), config `web/playwright.vrt.config.ts`,
  test dir `web/vrt` (`stories.spec.ts` + `serve.ts` + `galleryReporter.ts`).
- **Command:** `just vrt-quick` → `cd web && npm run test:vrt` → `playwright test -c
  playwright.vrt.config.ts`. CI's `visual-regressions` job runs `nix develop --command
  just vrt-quick` after `npm ci` + `npm run build-storybook` (the wasm pkg comes from
  the `wasm` job's artifact).
- **Snapshots:** one full-page screenshot per Storybook story per theme
  (`{storyId}--{dark,light}.png`), committed under `web/vrt/__screenshots__/` in
  **Git LFS** (308 files locally at this SHA; 310 tests in a CI run at another SHA).
- **What is served:** a static Storybook build (`storybook-static`) via
  `web/vrt/serve.ts` on `127.0.0.1:6199`, iframe URL per story. No network mocking
  needed (everything local/static); the wasm pkg is baked into the Storybook build.

## Config (playwright.vrt.config.ts)

- `retries: 0`, `fullyParallel: true`, **no explicit `workers`** → Playwright default.
  Observed in CI logs: **"Running 310 tests using 2 workers"** (CI default when
  `process.env.CI` is set).
- `expect.toHaveScreenshot`: `threshold: 0.02`, `animations: "disabled"`,
  `caret: "hide"`, `scale: "css"`; every screenshot is `fullPage: true`.
- Browser context: viewport 1280×800, deviceScaleFactor 1, locale `en-US`,
  timezoneId `UTC`, colorScheme `dark`, reducedMotion `reduce`.
- Chromium launch args (determinism): `--disable-gpu`, `--disable-gpu-compositing`,
  `--use-gl=swiftshader`, `--force-color-profile=srgb`, `--font-render-hinting=none`,
  `--disable-font-subpixel-positioning`, `--disable-lcd-text`,
  `--disable-partial-raster`, `--disable-skia-runtime-opts`.
- **Fonts:** the config *requires* `RHIZZ_VRT_FONTCONFIG_FILE` (exported by the Nix
  devshell from `flake.nix`); it lists only `dejavu_fonts`, `liberation_ttf`,
  `noto-fonts-color-emoji` with pinned hinting (`hintslight`, `rgba=none`,
  `lcdfilter=lcdnone`, no autohint, no embeddedbitmap), every family aliased to
  DejaVu Sans. Passed to the browser via `FONTCONFIG_FILE` in `launchOptions.env`.
  Host fonts cannot leak in by design.
- Spec stabilization (all in `web/vrt/stories.spec.ts`, added piecemeal by past
  flakiness fixes — `git log`): wait for story render phase `finished`
  (+ `document.fonts.ready`), pin `html/body/#storybook-root` height (fixed a
  fullPage self-referential resize race), wait for two identical samples of
  scroll size + first `<svg>` box, wait for Monaco scrollbars `.invisible` and
  every `canvas.decorationsOverviewRuler` painted (commit `bd8f016`), optional
  hover before capture (`parameters.vrtHoverText`).

## Browser and Nix

- Browser comes **from Nix**, not downloaded by Playwright:
  `playwright-driver.browsers` (flake packages), exported as
  `PLAYWRIGHT_BROWSERS_PATH` + `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`.
- Local browsers present: `chromium-1243`, `chromium_headless_shell-1243`
  (`/nix/store/9ibf73nllmrcqx4w7x5jayfxanv2gyfq-playwright-browsers`).
  Same flake.lock is checked out in CI → **same browser build** (verified same
  nixpkgs rev in both environments — see diagnostics below).
- flake.lock: nixpkgs `6510408d147d8c5e6d76043e899e9251756f6a75` (nixos-unstable,
  narHash `sha256-XK4KceonkwD8LuMAt/vNrz982mXJM5jeHAxMwsUXXAQ=`).
- CI uses `DeterminateSystems/nix-installer-action@main` (`determinate: false`) +
  `magic-nix-cache-action@main`; jobs run `nix develop --command npm ...`.
  Local Nix: 2.34.9 (devshell identical by lock).

## CI workflows

- `frontend.yml` (file `frontend.yml`): `push` to main/master, `pull_request`,
  `workflow_dispatch` (no inputs). Jobs: `wasm`, `build`, `lint`, `test`, `e2e`,
  **`visual-regressions`** — the VRT job. `concurrency` cancels in progress per ref.
- VRT job: `runs-on: ubuntu-latest`, `needs: wasm`, checkout with `lfs: true`,
  `npm ci`, `npm run build-storybook`, `nix develop --command just vrt-quick`,
  uploads `web/vrt-report/` (`if: always`). No retries, no shard/matrix, no
  explicit timeout, no `--workers` flag (Playwright's CI default = 2).
- Runner facts from run logs: hosted Azure agent, `ubuntu-24.04` image, runner
  version 2.337.0, image `20261012.334.1`.

## Machine facts

| | local (NixOS) | CI (ubuntu-latest) |
|---|---|---|
| CPUs | 4 (`nproc`) | 4 vCPU (GitHub standard runner; to be confirmed in diag step) |
| RAM | 16 GB total / ~4.4 GB available | to be measured |
| /dev/shm | 7.8 G tmpfs | to be measured |
| GPU | none (`lspci` has no VGA) | none (browser runs with `--disable-gpu`/SwiftShader anyway) |
| TZ / LANG | unset / `en_US.UTF-8` | to be measured |
| nixpkgs | `6510408d…` | same lock |
| chromium | `chromium-1243` (nix store) | same lock |

The experiment workflow (`vrt-experiment.yml`) prints all of the right-hand column
(nproc, meminfo, `df -h /dev/shm`, TZ/LANG, `nix --version`, nixpkgs rev+narHash,
`fc-list | sort | md5sum`, `fc-match`, runner name/image, `chrome --version`) as a
diagnostic step; local equivalents were collected with the same commands.

## Flakiness history (git)

`git log -- web/vrt web/playwright.vrt.config.ts` shows a long tail of
flakiness-driven fixes (`bd8f016 fix(vrt): settle Monaco chrome before capturing
screenshots`, several `re-baseline` commits). The most recent VRT-adjacent commits:
`ab4728d`, `67f77e7` (Oct 17), `f7703b7`, `f5b7291`, `987209e`, `130c50e9`.
`pages-code--default--light.png`'s baseline dates from `e4f0d52` (2026-10-13,
"re-baseline VRT after pane border removal"); the `pages-code--default light`
flake starts appearing in CI failures on 2026-10-14.

## Historical CI signal (free data, no runs triggered)

`scripts/vrt-research/fetch-job-history.sh` pulled the last 100 `frontend.yml`
runs (`.vrt-research/vrt-job-history.tsv`) and `scripts/vrt-research/extract-failures.sh`
parsed failing steps out of each failed run's log
(`.vrt-research/vrt-failures.tsv`). Summary (2026-10-14 → 10-17):

- 100 completed runs: 55 success, **26 failure (26%)**, 18 cancelled
  (superseded pushes), 1 no-data. Per day: 9/34, 14/46, 3/17, 0/2.
- Failing tests are dominated by:
  - `pages-code--default light` — **15 runs, always exactly 763 diff pixels**
    (identical count across all runs/SHAs);
  - `pages-projects--with-projects {dark,light}` — 5 runs each, **always exactly
    41335 / 41255 px** (only on the `feat/build-info-footer` PR branch, alongside
    20 missing-baseline failures for the new buildinfo stories — probably a stale
    baseline rather than a flake, to be verified);
  - `components-monacoeditor--markdown-unwrapped-overflows {dark,light}` — 4 runs,
    8400 px, only on Oct-14/15 branches;
  - a 20-test cluster (`pages-diagrams-*`, `tour-walk--modeling-*`) on
    `feature/view-connection-hidden` (Oct 14) — likely a real UI change;
  - `components-buildinfo-*` missing baselines — real new-story failures.
- e2e job failures (`command-palette.spec.ts`) are a separate, non-VRT suite and
  out of scope.

First artifact inspected: run `38971454005` (`pages-code--default light`). The diff
is **not** anti-aliasing noise: it is a single 14×755 px strip at the right edge of
the Monaco editor (`x=1266..1279`, full editor height) — a 1px vertical line at
x=1266 plus a 13×2 purple block at the top (the scrollbar/overview-ruler area) is
present in the baseline and absent in the failing capture (region is pure white).
Class: **Monaco chrome captured in a different settle state** (scrollbar /
overview-ruler region), not a layout shift (everything left of x=1266 is identical).

Helpers committed: `scripts/vrt-research/fetch-job-history.sh`,
`extract-failures.sh`, `pngdiff.mjs`, `run-local.sh`, and the experiment workflow.
