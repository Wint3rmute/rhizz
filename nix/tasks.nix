# Runnable scripts for every `just` recipe (see Justfile). Each script
# declares exactly the binaries it needs via absolute store paths (e.g.
# `{pkgs.cargo}/bin/cargo`), so `nix run .#lint-rust` realizes only the Rust
# toolchain — never Node, browsers, or mdbook. Scripts execute in the
# caller's working tree (like `nix develop`, unlike `nix build`, which
# snapshots the git tree), so dirty edits and incremental `target/` /
# `node_modules/` keep working. `wasm` / `web-build` stay as `nix build`
# derivations (see wasm.nix / frontend.nix).
#
# Toolchain packages are declared once in `taskInputs` below: each script
# uses its entry for `runtimeInputs`, and the union is exported as
# `shellInputs` for the interactive devshell in flake.nix (which adds only
# devshell-only extras like `just`, `gh`, `flyctl`). When adding a task, add
# its inputs to `taskInputs` — never inline a new `runtimeInputs` list.
{ pkgs }:

let
  write = pkgs.writeShellApplication;
  browsers = pkgs.playwright-driver.browsers;
  fontsConf = pkgs.callPackage ./vrt-fonts.nix { };
  # Browser-mode web tasks (vitest browser project, e2e, VRT) need Nix's
  # browsers instead of ~/.cache/ms-playwright, plus the pinned VRT fonts.
  # Nixpkgs' playwright-driver version must match the `playwright` version
  # pinned in web/package.json.
  playwrightEnv = ''
    export PLAYWRIGHT_BROWSERS_PATH="${browsers}"
    export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
    export RHIZOME_VRT_FONTCONFIG_FILE="${fontsConf}"
  '';

  # Legacy `favicon.ico` (16/32/48 px) for browsers without SVG favicon
  # support: the black mark on a white rounded square, matching favicon.svg. Defines `render_favicon_ico <out.ico>`;
  # shared by `assets` and `assets-check`. Root-relative paths.
  faviconIcoLib = ''
    render_favicon_ico() {
      local out="$1" tmp s inner
      local -a frames=()
      tmp=$(mktemp -d)
      for s in 16 32 48; do
        inner=$((s * 84 / 100))
        # white rounded square (radius 9.4% of the side, as the original
        # favicon), the black mark centred on it
        magick -size "''${s}x''${s}" xc:none -fill white \
          -draw "roundrectangle 0,0 $((s - 1)),$((s - 1)) $((s * 94 / 1000)),$((s * 94 / 1000))" "$tmp/bg$s.png"
        magick -background none -density 1200 logo/renders/molecule/molecule-ref.svg \
          -trim +repage -resize "''${inner}x''${inner}" "$tmp/mark$s.png"
        magick "$tmp/bg$s.png" "$tmp/mark$s.png" -gravity center -composite "$tmp/$s.png"
        frames+=("$tmp/$s.png")
      done
      magick "''${frames[@]}" "$out"
      rm -rf "$tmp"
    }
  '';

  # Shared body of the landing-hero pipeline (`assets` + the tail of
  # `vrt-accept`): perspective + drop shadow + gradient background via
  # ImageMagick. Callers set INPUT (source screenshot), BG (gradient
  # background) and OUTPUT (hero png); kept as one definition so the two
  # entry points cannot drift apart. Runs in the repo root (paths below are
  # root-relative).
  landingLib = ''
    # Framing tunables — edit the numbers directly.
    SHOT_W=1900  # screenshot width in px; higher = more zoomed in
    Y_OFF=0    # vertical offset in px; negative lifts the shot up

    if ! command -v magick >/dev/null 2>&1; then
      echo "error: 'magick' (ImageMagick 7) not found on PATH" >&2
      echo "  run via 'nix run .#assets', which provides it." >&2
      exit 1
    fi

    for f in "$INPUT" "$BG"; do
      if [ ! -f "$f" ]; then
        echo "error: file not found: $f" >&2
        exit 1
      fi
    done

    W=$(magick identify -format "%w" "$INPUT")
    H=$(magick identify -format "%h" "$INPUT")
    # Perspective inset scales with width (tuned for 1920px VRT screenshots).
    INSET=$((W * 80 / 1920))
    TOP=40
    RADIUS=24
    OUT_W=1920
    OUT_H=1280

    TMPDIR=$(mktemp -d)
    trap 'rm -rf "$TMPDIR"' EXIT

    # 1. Rounded corners (mask keeps it resolution-independent).
    magick -size "''${W}x''${H}" xc:none -fill white \
      -draw "roundrectangle 0,0 $W,$H $RADIUS,$RADIUS" \
      "$TMPDIR/mask.png"
    magick "$INPUT" "$TMPDIR/mask.png" \
      -alpha off -compose CopyOpacity -composite \
      "$TMPDIR/rounded.png"

    # 2. Fake 3D tilt: narrow the top edge, keep the bottom full-width.
    # 3. Soft drop shadow (50% opacity — v1 used 80% and looked muddy).
    magick "$TMPDIR/rounded.png" \
      -alpha set -virtual-pixel transparent \
      -distort Perspective "0,0 $INSET,$TOP  $W,0 $((W - INSET)),$TOP  $W,$H $W,$H  0,$H 0,$H" \
      +repage \
      \( +clone -background black -shadow "50x30+0+40" \) \
      +swap -background none -layers merge +repage \
      "$TMPDIR/tilted.png"

    # 4. Composite centered (lifted slightly) over the gradient.
    magick "$BG" -resize "''${OUT_W}x''${OUT_H}!" "$TMPDIR/bg.png"
    magick "$TMPDIR/tilted.png" -resize "''${SHOT_W}x" "$TMPDIR/tilted-small.png"
    magick "$TMPDIR/bg.png" "$TMPDIR/tilted-small.png" \
      -gravity center -geometry "$(printf '+0%+d' "$Y_OFF")" -composite \
      "$OUTPUT"

    echo "wrote $OUTPUT ($(magick identify -format '%wx%h' "$OUTPUT")) from $INPUT"
  '';

  # Single source of truth for toolchain packages (see header).
  taskInputs = with pkgs; {
    bump = [ commitizen git coreutils bash ];
    changelog = [ commitizen git coreutils bash ];
    format = [ cargo rustfmt nodejs coreutils bash ];
    "lint-rust" = [ cargo rustc rustfmt clippy lld coreutils bash ];
    doc = [ cargo rustc lld coreutils bash ];
    "lint-frontend" = [ nodejs coreutils bash ];
    "lint-commit" = [ commitizen git coreutils bash ];
    audit = [ cargo cargo-audit coreutils bash ];
    "install-web" = [ nodejs coreutils bash ];
    "test-rust" = [ cargo rustc lld coreutils bash ];
    "test-web" = [ nodejs playwright-driver.browsers coreutils bash ];
    "test-e2e" = [ nodejs playwright-driver.browsers python3 coreutils bash ];
    coverage = [ rustc cargo cargo-llvm-cov llvmPackages_23.llvm coreutils bash ];
    build = [ cargo rustc lld nodejs coreutils bash ];
    book = [ cargo rustc mdbook lld coreutils bash ];
    "book-accept" = [ cargo rustc mdbook lld coreutils bash ];
    "book-serve" = [ cargo rustc mdbook lld coreutils bash ];
    vrt = [ nodejs playwright-driver.browsers coreutils bash ];
    "vrt-quick" = [ nodejs playwright-driver.browsers coreutils bash ];
    "vrt-accept" = [ nodejs playwright-driver.browsers imagemagick coreutils bash ];
    assets = [ imagemagick nodejs playwright-driver.browsers coreutils bash ];
    "assets-check" = [ imagemagick nodejs diffutils coreutils bash ];
    "assets-verify" = [ imagemagick git coreutils bash ];
    "logo-video" = [ nodejs playwright-driver.browsers ffmpeg coreutils bash ];
    "logo-intro" = [ nodejs playwright-driver.browsers ffmpeg coreutils bash ];
    "logo-social-shots" = [ nodejs playwright-driver.browsers curl coreutils bash ];
    dev = [ nodejs coreutils bash ];
    storybook = [ nodejs coreutils bash ];
    serve = [ cargo rustc lld coreutils bash ];
  };

  scripts = rec {
    bump = write {
      name = "bump";
      runtimeInputs = taskInputs.bump;
      text = ''
        headline="$1"
        shift
        exec ${pkgs.commitizen}/bin/cz bump --annotated-tag-message "$headline" "$@"
      '';
    };

    changelog = write {
      name = "changelog";
      runtimeInputs = taskInputs.changelog;
      text = ''
        exec ${pkgs.commitizen}/bin/cz changelog "$@"
      '';
    };

    format = write {
      name = "format";
      runtimeInputs = taskInputs.format;
      text = ''
        set -euo pipefail
        ${pkgs.cargo}/bin/cargo fmt --all
        cd web || exit 1
        ${pkgs.nodejs}/bin/npm run format
      '';
    };

    lint-rust = write {
      name = "lint-rust";
      runtimeInputs = taskInputs."lint-rust";
      text = ''
        set -euo pipefail
        ${pkgs.cargo}/bin/cargo fmt --all -- --check
        ${pkgs.cargo}/bin/cargo clippy --all-targets --all-features -- -D warnings
        ${pkgs.cargo}/bin/cargo doc --no-deps --all
      '';
    };

    # API reference only (`cargo doc`); `lint-rust` also builds docs, plus
    # fmt + clippy. Used by docs.yml, which uploads target/doc for Pages.
    doc = write {
      name = "doc";
      runtimeInputs = taskInputs.doc;
      text = ''
        set -euo pipefail
        exec ${pkgs.cargo}/bin/cargo doc --no-deps --all
      '';
    };

    lint-frontend = write {
      name = "lint-frontend";
      runtimeInputs = taskInputs."lint-frontend";
      text = ''
        set -euo pipefail
        cd web || exit 1
        ${pkgs.nodejs}/bin/npm run sync
        ${pkgs.nodejs}/bin/npm run format:check
        ${pkgs.nodejs}/bin/npm run eslint
        exec ${pkgs.nodejs}/bin/npm run check-only
      '';
    };

    lint-commit = write {
      name = "lint-commit";
      runtimeInputs = taskInputs."lint-commit";
      text = ''
        set -euo pipefail
        base="''${1:-origin/main}"
        if [ -z "$(${pkgs.git}/bin/git rev-list "$base"..HEAD)" ]; then
          echo "No commits since $base, nothing to check."
        else
          exec ${pkgs.commitizen}/bin/cz check --rev-range "$base"..HEAD
        fi
      '';
    };

    # Advisory scan of Cargo.lock (audit.yml): `cargo audit` exits non-zero on
    # real vulnerabilities but allows informational warnings, which is the
    # intended gate.
    audit = write {
      name = "audit";
      runtimeInputs = taskInputs.audit;
      text = ''
        set -euo pipefail
        exec ${pkgs.cargo}/bin/cargo audit
      '';
    };

    # Installs web/ dependencies (`npm ci`). CI glue: the other web tasks
    # assume node_modules exists (locally provided by `just dev`/manual runs),
    # and `just` itself lives in the devshell, so CI cannot reach `npm` except
    # through a task script.
    install-web = write {
      name = "install-web";
      runtimeInputs = taskInputs."install-web";
      text = ''
        set -euo pipefail
        cd web || exit 1
        exec ${pkgs.nodejs}/bin/npm ci
      '';
    };

    test-rust = write {
      name = "test-rust";
      runtimeInputs = taskInputs."test-rust";
      text = ''
        exec ${pkgs.cargo}/bin/cargo test --quiet --all
      '';
    };

    test-web = write {
      name = "test-web";
      runtimeInputs = taskInputs."test-web";
      text = ''
        set -euo pipefail
      '' + playwrightEnv + ''
        cd web || exit 1
        exec ${pkgs.nodejs}/bin/npm run test
      '';
    };

    test-e2e = write {
      name = "test-e2e";
      runtimeInputs = taskInputs."test-e2e";
      text = ''
        set -euo pipefail
      '' + playwrightEnv + ''
        cd web || exit 1
        # Fail fast when the installed Playwright driver expects browser
        # revisions absent from the Nix-provided browsers (see flake.nix).
        # Catches both a package.json/flake.lock pin mismatch and a stale
        # web/node_modules resolving an old driver.
        ${pkgs.python3}/bin/python3 -c '
        import glob, json, os, sys
        match = glob.glob("node_modules/playwright-core/browsers.json")
        expected = set()
        for path in match:
            for b in json.load(open(path))["browsers"]:
                if b["name"] in ("chromium", "chromium-headless-shell"):
                    expected.add(b["name"].replace("-", "_") + "-" + b["revision"])
        missing = expected - set(os.listdir(os.environ["PLAYWRIGHT_BROWSERS_PATH"]))
        if missing:
            sys.exit("playwright/nix browser mismatch, missing: " + ", ".join(sorted(missing)))
        print("playwright browsers match: " + ", ".join(sorted(expected)))
        '
        exec ${pkgs.nodejs}/bin/npm run test:e2e
      '';
    };

    # NOTE: rustc's coverage profiles require matching LLVM tools — rustc 1.99
    # links LLVM 23, so this pairs it with `llvmPackages_23` (an older llvm-cov
    # cannot read the new profile format). Keep the two in step on toolchain
    # bumps.
    coverage = write {
      name = "coverage";
      runtimeInputs = taskInputs.coverage;
      text = ''
        set -euo pipefail
        mkdir -p target/coverage
        export RUSTC_BOOTSTRAP=1
        export LLVM_COV="${pkgs.llvmPackages_23.llvm}/bin/llvm-cov"
        export LLVM_PROFDATA="${pkgs.llvmPackages_23.llvm}/bin/llvm-profdata"
        ${pkgs.cargo}/bin/cargo llvm-cov --workspace --all-features --exclude rhizome-wasm --ignore-filename-regex "crates/.*/tests/" --doctests --fail-under-lines 80 --lcov --output-path target/coverage/lcov.info
        exec ${pkgs.cargo}/bin/cargo llvm-cov report -p rhizome-core -p rhizome-cli -p rhizome-server -p rhizome-book --ignore-filename-regex "crates/.*/tests/" --cobertura --output-path target/coverage/cobertura.xml
      '';
    };

    build = write {
      name = "build";
      runtimeInputs = taskInputs.build;
      text = ''
        set -euo pipefail
        (
          cd web || exit 1
          ${pkgs.nodejs}/bin/npm run build-storybook
        )
        exec ${pkgs.cargo}/bin/cargo build --release --all-targets
      '';
    };

    book = write {
      name = "book";
      runtimeInputs = taskInputs.book;
      text = ''
        set -euo pipefail
        ${pkgs.cargo}/bin/cargo build --quiet --bin rhizome-book
        exec ${pkgs.mdbook}/bin/mdbook build book
      '';
    };

    book-accept = write {
      name = "book-accept";
      runtimeInputs = taskInputs."book-accept";
      text = ''
        set -euo pipefail
        ${pkgs.cargo}/bin/cargo build --quiet --bin rhizome-book
        export BOOKLOCK_ACCEPT_CHANGES=1
        exec ${pkgs.mdbook}/bin/mdbook build book
      '';
    };

    book-serve = write {
      name = "book-serve";
      runtimeInputs = taskInputs."book-serve";
      text = ''
        set -euo pipefail
        ${pkgs.cargo}/bin/cargo build --release --quiet --bin rhizome-book
        exec ${pkgs.mdbook}/bin/mdbook serve book
      '';
    };

    vrt = write {
      name = "vrt";
      runtimeInputs = taskInputs.vrt;
      text = ''
        set -euo pipefail
      '' + playwrightEnv + ''
        (
          cd web || exit 1
          ${pkgs.nodejs}/bin/npm run build-storybook -- --quiet
        )
        cd web || exit 1
        exec ${pkgs.nodejs}/bin/npm run test:vrt -- "$@"
      '';
    };

    vrt-quick = write {
      name = "vrt-quick";
      runtimeInputs = taskInputs."vrt-quick";
      text = ''
        set -euo pipefail
      '' + playwrightEnv + ''
        cd web || exit 1
        exec ${pkgs.nodejs}/bin/npm run test:vrt -- "$@"
      '';
    };

    vrt-accept = write {
      name = "vrt-accept";
      runtimeInputs = taskInputs."vrt-accept";
      text = ''
        set -euo pipefail
      '' + playwrightEnv + ''
        (
          cd web || exit 1
          ${pkgs.nodejs}/bin/npm run test:vrt:accept -- "$@"
        )
        ${pkgs.coreutils}/bin/cp web/vrt/__screenshots__/backgrounds-background-1--light.png web/src/screenshots/background_1.png
        ${pkgs.coreutils}/bin/cp web/vrt/__screenshots__/backgrounds-background-2--light.png web/src/screenshots/background_2.png
        ${pkgs.coreutils}/bin/cp web/vrt/__screenshots__/backgrounds-background-3--light.png web/src/screenshots/background_3.png
        ${pkgs.coreutils}/bin/cp web/vrt/__screenshots__/backgrounds-background-4--light.png web/src/screenshots/background_4.png
        INPUT="web/vrt/__screenshots__/pages-landing--no-projects--light.png"
        BG="web/assets/landing-gradient.jpg"
        OUTPUT="logo/renders/landing/rhizome_landing.png"
      '' + landingLib;
    };

    # Regenerates every declaratively generated graphic:
    #   - the README/book landing hero (logo/renders/landing/rhizome_landing.png), from a
    #     screenshot (defaults to the VRT landing capture; pass another one as
    #     the first argument: `nix run .#assets -- my-shot.png`)
    #   - the logo SVGs (logo/renders/molecule/: mark, lockup and construction
    #     drawing, each with a dark-background variant, plus the navbar's copy of the
    #     mark at web/assets/logo-mark.svg, and the favicon at
    #     web/static/favicon.svg and its legacy favicon.ico), with Roboto Bold from nixpkgs
    #     (pinned by flake.lock) via ROBOTO_BOLD. `assets-check` is the CI guard.
    #   - the GitHub social preview (logo/renders/social/social-preview.png),
    #     composed by headless Chromium from the committed shots. Chromium
    #     output is not byte-stable, so `assets-check` cannot cover it.
    assets = write {
      name = "assets";
      runtimeInputs = taskInputs.assets;
      text = ''
        set -euo pipefail

        echo "== landing hero"
        INPUT="''${1:-web/vrt/__screenshots__/pages-landing--no-projects--light.png}"
        BG="web/assets/landing-gradient.jpg"
        OUTPUT="logo/renders/landing/rhizome_landing.png"
      '' + landingLib + ''

        echo "== logo"
        export ROBOTO_BOLD="${pkgs.roboto}/share/fonts/truetype/Roboto-Bold.ttf"
        npm ci --prefix logo --ignore-scripts --no-audit --no-fund
        (cd logo && npm run -s gen:mark && npm run -s gen:lockup && npm run -s gen:construction)
        # The web build (nix `src = ./web`) cannot see logo/, so the navbar's
        # copy of the mark lives under web/assets.
        cp logo/renders/molecule/molecule-ref.svg web/assets/logo-mark.svg
        # Browser-tab favicon (served from web/static), same reason.
        (cd logo && npm run -s gen:favicon)
      '' + faviconIcoLib + ''
        render_favicon_ico web/static/favicon.ico

        echo "== social preview"
      '' + playwrightEnv + ''
        if [ ! -d web/node_modules/playwright ]; then
          npm ci --prefix web --no-audit --no-fund
        fi
        (cd logo && node src/social.mjs)
      '';
    };

    # Freshness check for everything `assets` generates: regenerates the landing
    # hero and the logo SVGs into temp dirs (the working tree is left
    # untouched) and fails if any differs from the committed file. The hero is
    # compared by pixel count (`magick compare -metric AE`), not bytes, so PNG
    # metadata cannot cause false alarms. CI runs this in the VRT job, which
    # already has the LFS screenshots the hero is built from.
    assets-check = write {
      name = "assets-check";
      runtimeInputs = taskInputs."assets-check";
      text = ''
        set -euo pipefail
        stale=0

        echo "== landing hero"
        OUTDIR=$(mktemp -d)
        INPUT="web/vrt/__screenshots__/pages-landing--no-projects--light.png"
        BG="web/assets/landing-gradient.jpg"
        OUTPUT="$OUTDIR/rhizome_landing.png"
      '' + landingLib + faviconIcoLib + ''
        # landingLib installed its own EXIT trap; replace it with one for both dirs.
        trap 'rm -rf "$TMPDIR" "$OUTDIR"' EXIT
        # ImageMagick 7 prints "<count> (<fraction>)", e.g. "0 (0)"; keep the count.
        diff_px=$(magick compare -metric AE "$OUTPUT" logo/renders/landing/rhizome_landing.png null: 2>&1 || true)
        diff_px=''${diff_px%% *}
        if [ "$diff_px" != "0" ]; then
          echo "logo/renders/landing/rhizome_landing.png is out of date ($diff_px differing pixels)" >&2
          stale=1
        fi

        echo "== logo"
        export ROBOTO_BOLD="${pkgs.roboto}/share/fonts/truetype/Roboto-Bold.ttf"
        npm ci --prefix logo --ignore-scripts --no-audit --no-fund
        node logo/src/molecule.mjs --preset reference --out "$OUTDIR/molecule-ref.svg"
        node logo/src/lockup.mjs --mark "$OUTDIR/molecule-ref.svg" --out "$OUTDIR/lockup-ref.svg"
        node logo/src/construction.mjs --out "$OUTDIR/construction-ref.svg"
        # dark-background variants (the brandbook swaps them in for dark themes)
        node logo/src/molecule.mjs --preset reference --fill '#fff' --out "$OUTDIR/molecule-ref-white.svg"
        node logo/src/lockup.mjs --mark "$OUTDIR/molecule-ref-white.svg" --fill '#fff' --out "$OUTDIR/lockup-ref-white.svg"
        node logo/src/construction.mjs --theme dark --out "$OUTDIR/construction-ref-dark.svg"
        for f in molecule-ref.svg molecule-ref.bounds.json lockup-ref.svg construction-ref.svg \
                 molecule-ref-white.svg molecule-ref-white.bounds.json lockup-ref-white.svg construction-ref-dark.svg; do
          if ! cmp -s "$OUTDIR/$f" "logo/renders/molecule/$f"; then
            echo "logo/renders/molecule/$f is out of date" >&2
            stale=1
          fi
        done
        if ! cmp -s "$OUTDIR/molecule-ref.svg" web/assets/logo-mark.svg; then
          echo "web/assets/logo-mark.svg is out of date" >&2
          stale=1
        fi
        node logo/src/favicon.mjs --mark "$OUTDIR/molecule-ref.svg" --out "$OUTDIR/favicon.svg"
        if ! cmp -s "$OUTDIR/favicon.svg" web/static/favicon.svg; then
          echo "web/static/favicon.svg is out of date" >&2
          stale=1
        fi
        render_favicon_ico "$OUTDIR/favicon.ico"
        # Compared per frame, by pixels, so ICO container metadata cannot cause false alarms.
        for i in 0 1 2; do
          diff_px=$(magick compare -metric AE "$OUTDIR/favicon.ico[$i]" "web/static/favicon.ico[$i]" null: 2>&1 || true)
          diff_px=''${diff_px%% *}
          if [ "$diff_px" != "0" ]; then
            echo "web/static/favicon.ico is out of date (frame $i, $diff_px differing pixels)" >&2
            stale=1
          fi
        done

        if [ "$stale" -ne 0 ]; then
          echo "Run \`just assets\` and commit the regenerated files." >&2
          exit 1
        fi
        echo "generated assets are up to date"
      '';
    };

    # CI guard: runs `assets`, then fails if anything in the working tree
    # changed. The two PNGs are the exception: `assets` rewrites them with
    # different bytes on every run (PNG metadata for the hero, Chromium
    # rendering for the social preview), so they are compared by pixels with a
    # small tolerance against the committed copy, then restored. The downloaded
    # wasm package (crates/rhizome-wasm/pkg/) is ignored.
    assets-verify = write {
      name = "assets-verify";
      runtimeInputs = taskInputs."assets-verify";
      text = ''
        set -euo pipefail
        pngs=(logo/renders/landing/rhizome_landing.png logo/renders/social/social-preview.png)
        saved=$(mktemp -d)
        trap 'rm -rf "$saved"' EXIT
        for f in "''${pngs[@]}"; do
          cp "$f" "$saved/$(basename "$f")"
        done

        ${scripts.assets}/bin/assets

        stale=0
        for f in "''${pngs[@]}"; do
          # ImageMagick 7 prints "<count> (<fraction>)"; keep the count.
          diff_px=$(magick compare -metric AE -fuzz 1% "$f" "$saved/$(basename "$f")" null: 2>&1 || true)
          diff_px=''${diff_px%% *}
          if [ "$diff_px" != "0" ]; then
            echo "$f is out of date ($diff_px differing pixels)" >&2
            stale=1
          fi
          cp "$saved/$(basename "$f")" "$f"
        done

        changes=$(git status --porcelain -- . ':!crates/rhizome-wasm/pkg')
        if [ -n "$changes" ]; then
          echo "$changes" >&2
          stale=1
        fi
        if [ "$stale" -ne 0 ]; then
          echo "Run \`just assets\` and commit the regenerated files." >&2
          exit 1
        fi
        echo "generated assets are up to date"
      '';
    };

    # Renders the animated-gradient logo videos (logo/renders/video/, Full HD
    # H.264, light + dark) with headless Chromium and ffmpeg. Not part of
    # `assets`: video encodes aren't byte-reproducible, so they can't be
    # freshness-checked like the SVGs. Extra args go to logo/src/gradient.mjs,
    # e.g. `nix run .#logo-video -- --variant dark --seconds 4`.
    logo-video = write {
      name = "logo-video";
      runtimeInputs = taskInputs."logo-video";
      text = ''
        set -euo pipefail
      '' + playwrightEnv + ''
        # gradient.mjs loads Playwright from web/ (pinned to the nix browsers).
        if [ ! -d web/node_modules/playwright ]; then
          npm ci --prefix web --no-audit --no-fund
        fi
        cd logo
        node src/gradient.mjs --outdir renders/video "$@"
      '';
    };

    # Renders the logo intro (logo/renders/video/rhizome-intro-*.mp4): the
    # network sprouts, breathes and settles into the mark, then the wordmark
    # appears and the lockup holds. Full HD, 5 s, light + dark. Same toolchain
    # and same caveat as `logo-video`: not part of `assets`.
    logo-intro = write {
      name = "logo-intro";
      runtimeInputs = taskInputs."logo-intro";
      text = ''
        set -euo pipefail
      '' + playwrightEnv + ''
        if [ ! -d web/node_modules/playwright ]; then
          npm ci --prefix web --no-audit --no-fund
        fi
        cd logo
        node src/intro.mjs --outdir renders/video "$@"
      '';
    };

    # Re-captures the screenshots `assets` composes: starts the web dev
    # server, drives the Quadcopter Drone example in real Chromium and saves
    # logo/renders/social/shots/*.png. Needs the wasm package (`just wasm`).
    logo-social-shots = write {
      name = "logo-social-shots";
      runtimeInputs = taskInputs."logo-social-shots";
      text = ''
        set -euo pipefail
      '' + playwrightEnv + ''
        if [ ! -d web/node_modules/playwright ]; then
          npm ci --prefix web --no-audit --no-fund
        fi
        PORT=5198
        (cd web && npm run dev -- --port "$PORT" >/dev/null 2>&1) &
        DEV_PID=$!
        trap 'kill "$DEV_PID" 2>/dev/null || true; pkill -P "$DEV_PID" 2>/dev/null || true' EXIT
        for _ in $(seq 1 60); do
          curl -sf "http://localhost:$PORT" >/dev/null && break
          sleep 1
        done
        cd logo
        node src/social-shots.mjs --url "http://localhost:$PORT" "$@"
      '';
    };

    dev = write {
      name = "dev";
      runtimeInputs = taskInputs.dev;
      text = ''
        set -euo pipefail
        cd web || exit 1
        ${pkgs.nodejs}/bin/npm ci
        exec ${pkgs.nodejs}/bin/npm run dev
      '';
    };

    storybook = write {
      name = "storybook";
      runtimeInputs = taskInputs.storybook;
      text = ''
        set -euo pipefail
        cd web || exit 1
        ${pkgs.nodejs}/bin/npm run sync
        exec ${pkgs.nodejs}/bin/npm run storybook
      '';
    };

    serve = write {
      name = "serve";
      runtimeInputs = taskInputs.serve;
      text = ''
        set -euo pipefail
        ${pkgs.cargo}/bin/cargo build --release -p rhizome-cli
        RHIZOME_DATA_DIR=examples exec ${pkgs.cargo}/bin/cargo run --release -p rhizome-cli -- web
      '';
    };
  };

  # Union of every task's toolchain, for the interactive devshell in flake.nix.
  shellInputs =
    pkgs.lib.unique (pkgs.lib.flatten (pkgs.lib.attrValues taskInputs));
in
{
  inherit scripts shellInputs;
}
