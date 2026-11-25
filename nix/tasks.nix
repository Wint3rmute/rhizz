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
    export RHIZZ_VRT_FONTCONFIG_FILE="${fontsConf}"
  '';

  # Shared body of the landing-hero pipeline (`landing` + the tail of
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
      echo "  run via 'nix run .#landing', which provides it." >&2
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
    "book-serve" = [ mdbook coreutils bash ];
    vrt = [ nodejs playwright-driver.browsers coreutils bash ];
    "vrt-quick" = [ nodejs playwright-driver.browsers coreutils bash ];
    "vrt-accept" = [ nodejs playwright-driver.browsers imagemagick coreutils bash ];
    landing = [ imagemagick coreutils bash ];
    logo = [ nodejs coreutils bash ];
    "logo-check" = [ nodejs diffutils coreutils bash ];
    dev = [ nodejs coreutils bash ];
    storybook = [ nodejs coreutils bash ];
    serve = [ cargo rustc lld coreutils bash ];
  };

  scripts = {
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
        ${pkgs.cargo}/bin/cargo llvm-cov --workspace --all-features --exclude rhizz-wasm --ignore-filename-regex "crates/.*/tests/" --doctests --fail-under-lines 80 --lcov --output-path target/coverage/lcov.info
        exec ${pkgs.cargo}/bin/cargo llvm-cov report -p rhizz-core -p rhizz-cli -p rhizz-server -p rhizz-book --ignore-filename-regex "crates/.*/tests/" --cobertura --output-path target/coverage/cobertura.xml
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
        ${pkgs.cargo}/bin/cargo build --quiet --bin rhizz-book
        exec ${pkgs.mdbook}/bin/mdbook build book
      '';
    };

    book-accept = write {
      name = "book-accept";
      runtimeInputs = taskInputs."book-accept";
      text = ''
        set -euo pipefail
        ${pkgs.cargo}/bin/cargo build --quiet --bin rhizz-book
        export BOOKLOCK_ACCEPT_CHANGES=1
        exec ${pkgs.mdbook}/bin/mdbook build book
      '';
    };

    book-serve = write {
      name = "book-serve";
      runtimeInputs = taskInputs."book-serve";
      text = ''
        set -euo pipefail
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
        INPUT="web/vrt/__screenshots__/pages-projects--empty-landing--light.png"
        BG="web/assets/landing-gradient.jpg"
        OUTPUT="book/src/rhizz_landing.png"
      '' + landingLib;
    };

    # Regenerates the README/book hero from a screenshot (defaults to the VRT
    # landing capture): `nix run .#landing -- my-shot.png`.
    landing = write {
      name = "landing";
      runtimeInputs = taskInputs.landing;
      text = ''
        set -euo pipefail
        INPUT="''${1:-web/vrt/__screenshots__/pages-projects--empty-landing--light.png}"
        BG="web/assets/landing-gradient.jpg"
        OUTPUT="book/src/rhizz_landing.png"
      '' + landingLib;
    };

    # Regenerates the committed logo SVGs (logo/renders/molecule/) in place.
    # Roboto Bold comes from nixpkgs (pinned by flake.lock) via ROBOTO_BOLD.
    logo = write {
      name = "logo";
      runtimeInputs = taskInputs.logo;
      text = ''
        set -euo pipefail
        export ROBOTO_BOLD="${pkgs.roboto}/share/fonts/truetype/Roboto-Bold.ttf"
        npm ci --prefix logo --ignore-scripts --no-audit --no-fund
        cd logo
        npm run -s gen:mark
        npm run -s gen:lockup
      '';
    };

    # Freshness check for the committed logo SVGs: regenerates them into a
    # temp dir (the working tree is left untouched) and fails if any differs.
    logo-check = write {
      name = "logo-check";
      runtimeInputs = taskInputs."logo-check";
      text = ''
        set -euo pipefail
        export ROBOTO_BOLD="${pkgs.roboto}/share/fonts/truetype/Roboto-Bold.ttf"
        npm ci --prefix logo --ignore-scripts --no-audit --no-fund
        OUT=$(mktemp -d)
        trap 'rm -rf "$OUT"' EXIT
        node logo/src/molecule.mjs --preset reference --out "$OUT/molecule-ref.svg"
        node logo/src/lockup.mjs --mark "$OUT/molecule-ref.svg" --out "$OUT/lockup-ref.svg"
        stale=0
        for f in molecule-ref.svg molecule-ref.bounds.json lockup-ref.svg; do
          if ! cmp -s "$OUT/$f" "logo/renders/molecule/$f"; then
            echo "logo/renders/molecule/$f is out of date" >&2
            stale=1
          fi
        done
        if [ "$stale" -ne 0 ]; then
          echo "Run \`just logo\` and commit the regenerated files." >&2
          exit 1
        fi
        echo "logo renders are up to date"
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
        ${pkgs.cargo}/bin/cargo build --release -p rhizz-cli
        RHIZZ_DATA_DIR=examples exec ${pkgs.cargo}/bin/cargo run --release -p rhizz-cli -- web
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
