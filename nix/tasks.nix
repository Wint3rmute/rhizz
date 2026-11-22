# Runnable scripts for every `just` recipe (see Justfile). Each script
# declares exactly the binaries it needs via absolute store paths (e.g.
# `{pkgs.cargo}/bin/cargo`), so `nix run .#lint-rust` realizes only the Rust
# toolchain — never Node, browsers, or mdbook. Scripts execute in the
# caller's working tree (like `nix develop`, unlike `nix build`, which
# snapshots the git tree), so dirty edits and incremental `target/` /
# `node_modules/` keep working. `wasm` / `web-build` stay as `nix build`
# derivations (see wasm.nix / frontend.nix).
{ pkgs, pkgsCoverage }:

let
  write = pkgs.writeShellApplication;
  writeOld = pkgsCoverage.writeShellApplication;
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
in
{
  bump = write {
    name = "bump";
    runtimeInputs = with pkgs; [ commitizen git coreutils bash ];
    text = ''
      headline="$1"
      shift
      exec ${pkgs.commitizen}/bin/cz bump --annotated-tag-message "$headline" "$@"
    '';
  };

  changelog = write {
    name = "changelog";
    runtimeInputs = with pkgs; [ commitizen git coreutils bash ];
    text = ''
      exec ${pkgs.commitizen}/bin/cz changelog "$@"
    '';
  };

  format = write {
    name = "format";
    runtimeInputs = with pkgs; [ cargo rustfmt nodejs coreutils bash ];
    text = ''
      set -euo pipefail
      ${pkgs.cargo}/bin/cargo fmt --all
      cd web || exit 1
      ${pkgs.nodejs}/bin/npm run format
    '';
  };

  lint-rust = write {
    name = "lint-rust";
    runtimeInputs = with pkgs; [ cargo rustc clippy lld coreutils bash ];
    text = ''
      set -euo pipefail
      ${pkgs.cargo}/bin/cargo clippy --all-targets --all-features -- -D warnings
      ${pkgs.cargo}/bin/cargo doc --no-deps --all
    '';
  };

  lint-frontend = write {
    name = "lint-frontend";
    runtimeInputs = with pkgs; [ nodejs coreutils bash ];
    text = ''
      set -euo pipefail
      cd web || exit 1
      ${pkgs.nodejs}/bin/npm run sync
      ${pkgs.nodejs}/bin/npm run eslint
      exec ${pkgs.nodejs}/bin/npm run check-only
    '';
  };

  lint-commit = write {
    name = "lint-commit";
    runtimeInputs = with pkgs; [ commitizen git coreutils bash ];
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

  test-rust = write {
    name = "test-rust";
    runtimeInputs = with pkgs; [ cargo rustc lld coreutils bash ];
    text = ''
      exec ${pkgs.cargo}/bin/cargo test --quiet --all
    '';
  };

  test-web = write {
    name = "test-web";
    runtimeInputs = with pkgs; [ nodejs playwright-driver.browsers coreutils bash ];
    text = ''
      set -euo pipefail
    '' + playwrightEnv + ''
      cd web || exit 1
      exec ${pkgs.nodejs}/bin/npm run test
    '';
  };

  test-e2e = write {
    name = "test-e2e";
    runtimeInputs = with pkgs; [ nodejs playwright-driver.browsers coreutils bash ];
    text = ''
      set -euo pipefail
    '' + playwrightEnv + ''
      cd web || exit 1
      exec ${pkgs.nodejs}/bin/npm run test:e2e
    '';
  };

  # TEMPORARY (Rust 1.99 regression, see flake.nix): Rust 1.99.0 generates
  # empty coverage profiles and segfaults instrumented build scripts, so
  # coverage uses the pinned Rust 1.98.1 toolchain instead of the main one.
  coverage = writeOld {
    name = "coverage";
    runtimeInputs = with pkgsCoverage; [ rustc cargo cargo-llvm-cov llvmPackages_21.llvm coreutils bash ];
    text = ''
      set -euo pipefail
      mkdir -p target/coverage
      export RUSTC_BOOTSTRAP=1
      export LLVM_COV="${pkgsCoverage.llvmPackages_21.llvm}/bin/llvm-cov"
      export LLVM_PROFDATA="${pkgsCoverage.llvmPackages_21.llvm}/bin/llvm-profdata"
      ${pkgsCoverage.cargo}/bin/cargo llvm-cov --workspace --all-features --exclude rhizz-wasm --ignore-filename-regex "crates/.*/tests/" --doctests --fail-under-lines 80 --lcov --output-path target/coverage/lcov.info
      exec ${pkgsCoverage.cargo}/bin/cargo llvm-cov report -p rhizz-core -p rhizz-cli -p rhizz-server -p rhizz-book --ignore-filename-regex "crates/.*/tests/" --cobertura --output-path target/coverage/cobertura.xml
    '';
  };

  build = write {
    name = "build";
    runtimeInputs = with pkgs; [ cargo rustc lld nodejs coreutils bash ];
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
    runtimeInputs = with pkgs; [ cargo rustc mdbook lld coreutils bash ];
    text = ''
      set -euo pipefail
      ${pkgs.cargo}/bin/cargo build --quiet --bin rhizz-book
      exec ${pkgs.mdbook}/bin/mdbook build book
    '';
  };

  book-accept = write {
    name = "book-accept";
    runtimeInputs = with pkgs; [ cargo rustc mdbook lld coreutils bash ];
    text = ''
      set -euo pipefail
      ${pkgs.cargo}/bin/cargo build --quiet --bin rhizz-book
      export BOOKLOCK_ACCEPT_CHANGES=1
      exec ${pkgs.mdbook}/bin/mdbook build book
    '';
  };

  book-serve = write {
    name = "book-serve";
    runtimeInputs = with pkgs; [ mdbook coreutils bash ];
    text = ''
      exec ${pkgs.mdbook}/bin/mdbook serve book
    '';
  };

  vrt = write {
    name = "vrt";
    runtimeInputs = with pkgs; [ nodejs playwright-driver.browsers coreutils bash ];
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
    runtimeInputs = with pkgs; [ nodejs playwright-driver.browsers coreutils bash ];
    text = ''
      set -euo pipefail
    '' + playwrightEnv + ''
      cd web || exit 1
      exec ${pkgs.nodejs}/bin/npm run test:vrt -- "$@"
    '';
  };

  vrt-accept = write {
    name = "vrt-accept";
    runtimeInputs = with pkgs; [ nodejs playwright-driver.browsers imagemagick coreutils bash ];
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
      exec ./scripts/make-landing.sh
    '';
  };

  landing = write {
    name = "landing";
    runtimeInputs = with pkgs; [ imagemagick coreutils bash ];
    text = ''
      exec ./scripts/make-landing.sh "$1" assets/landing-gradient.jpg book/src/rhizz_landing.png
    '';
  };

  dev = write {
    name = "dev";
    runtimeInputs = with pkgs; [ nodejs coreutils bash ];
    text = ''
      set -euo pipefail
      cd web || exit 1
      ${pkgs.nodejs}/bin/npm ci
      exec ${pkgs.nodejs}/bin/npm run dev
    '';
  };

  storybook = write {
    name = "storybook";
    runtimeInputs = with pkgs; [ nodejs coreutils bash ];
    text = ''
      set -euo pipefail
      cd web || exit 1
      ${pkgs.nodejs}/bin/npm run sync
      exec ${pkgs.nodejs}/bin/npm run storybook
    '';
  };

  serve = write {
    name = "serve";
    runtimeInputs = with pkgs; [ cargo rustc lld coreutils bash ];
    text = ''
      set -euo pipefail
      ${pkgs.cargo}/bin/cargo build --release -p rhizz-cli
      RHIZZ_DATA_DIR=examples exec ${pkgs.cargo}/bin/cargo run --release -p rhizz-cli -- web
    '';
  };
}
