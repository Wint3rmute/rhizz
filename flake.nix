{
  description = "rhizz dev environment";
  inputs.nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";

  # TEMPORARY (Rust 1.99 regression, TODO: drop this input and the
  # `coverage` devShell below once nixpkgs Rust emits valid profiles
  # again): Rust 1.99.0 generates empty coverage profiles (format
  # version 11, zero counters) and segfaults instrumented build scripts,
  # so `just coverage` cannot use the main toolchain. Pinned to the
  # pre-bump rev (fe13242...) whose Rust 1.98.1 was green on main.
  # Pinned by rev, not branch, so `nix flake update` leaves it alone.
  inputs.nixpkgs-coverage.url = "github:nixos/nixpkgs/fe13242281a67641c0102cdb1087f0ebe586c7df";

  outputs = { self, nixpkgs, nixpkgs-coverage }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f system);
    in
    {
      # Nix build pipeline (see nix/). These are additive: the devshell and the
      # `just` recipes keep working unchanged. Only the inputs each stage needs
      # are included, so a change to (say) web/ does not rebuild the wasm crate.
      packages = forAllSystems (system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          # Build inputs for the Rust stages: the workspace manifests plus
          # everything `rhizz-core`'s build script reads via include_str! and
          # `cargo:rerun-if-changed` (SPEC/diagnostics, examples/).
          rustSrc = pkgs.lib.sourceByRegex ./. [
            "Cargo\\.toml"
            "Cargo\\.lock"
            "crates"
            "crates/.*"
            "SPEC"
            "SPEC/.*"
            "examples"
            "examples/.*"
          ];

          # Seeded into the image's /data: the server treats a directory of
          # HCL projects as its data dir, so these are the example systems a
          # fresh container comes up with. Note this is the `examples`
          # directory itself, not a filter over the repo root — the image
          # copies its *contents* into /data, and one wrapper level would
          # otherwise turn all six systems into a single project named
          # "examples" (the server walks each project directory recursively).
          examplesSrc = ./examples;

          rhizz-wasm-pkg = pkgs.callPackage ./nix/wasm.nix { src = rustSrc; };

          rhizz-frontend = pkgs.callPackage ./nix/frontend.nix {
            src = ./web;
            inherit rhizz-wasm-pkg;
          };

          rhizz-server = pkgs.callPackage ./nix/backend.nix {
            src = rustSrc;
            inherit rhizz-frontend;
            # `shortRev` exists only for a clean git tree; `dirtyShortRev`
            # marks a dirty one. Neither exists for a non-git source.
            gitSha = self.shortRev or self.dirtyShortRev or "unknown";
            # Release tag (e.g. `0.10.0`) for tagged builds, shown in the UI
            # via `/api/version`. Flakes evaluate purely, so the tag cannot
            # be read from git here: CI tag builds pass `RHIZZ_GIT_TAG` with
            # `--impure` (see `.github/workflows/docker.yml`). Empty (and
            # therefore omitted from the payload) in every other build.
            gitTag = builtins.getEnv "RHIZZ_GIT_TAG";
          };

          # A container image is inherently Linux: on Darwin the same
          # derivation would pack a Mach-O binary into an image that cannot
          # run it, so the attribute is only defined where it means something.
          rhizz-docker = pkgs.callPackage ./nix/docker.nix {
            inherit rhizz-server;
            examples = examplesSrc;
          };

          # Runnable scripts for every `just` recipe (see Justfile): each
          # declares exactly the binaries it needs, so `nix run .#lint-rust`
          # realizes only the Rust toolchain. See nix/tasks.nix.
          tasks = import ./nix/tasks.nix {
            inherit pkgs;
            pkgsCoverage = nixpkgs-coverage.legacyPackages.${system};
          };
        in
        {
          inherit rhizz-wasm-pkg rhizz-frontend rhizz-server;
        }
        // tasks
        // pkgs.lib.optionalAttrs pkgs.stdenv.hostPlatform.isLinux {
          inherit rhizz-docker;
        });

      devShells = forAllSystems (system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          # Pinned font set for visual regression tests, shared with the
          # `vrt` task scripts (see nix/tasks.nix).
          vrtFontsConf = pkgs.callPackage ./nix/vrt-fonts.nix { };
        in
        {
          default = pkgs.mkShell {
            packages = with pkgs; [
              rustc
              cargo
              cargo-audit
              # cargo-llvm-cov's own test suite shells out to cargo against
              # fresh registries and fails in the sandbox (no network) as of
              # the f9a75f4 nixpkgs bump — 14 integration tests red while the
              # binary itself builds fine. We only need the binary for
              # `just coverage`, so skip its self-tests.
              (cargo-llvm-cov.overrideAttrs (_old: { doCheck = false; }))
              clippy
              mdbook
              rustfmt
              wasm-pack
              nodejs
              just
              # ImageMagick for `scripts/make-landing.sh` (README hero image).
              imagemagick
              # Conventional-commit tooling (`cz commit`, `cz check`, `cz bump`);
              # config lives in cz.toml. Driven through the `just` recipes.
              commitizen
              lld
              # LLVM tools matching rustc's LLVM (21.1.8), required by
              # cargo-llvm-cov (NixOS equivalent of rustup's
              # llvm-tools-preview component).
              llvmPackages_21.llvm
              # Playwright browsers for the web browser-mode tests
              # (`npm run test`, the storybook Vitest project, also covered by
              # `just test`). Nixpkgs' playwright-driver version must match the
              # `playwright` version pinned in web/package.json (currently
              # 1.64.1), because Playwright looks up browsers by revision
              # directory name (chromium-1248).
              # After bumping either side, rerun `npm ci` so node_modules
              # resolves the new driver; a stale tree keeps resolving the old
              # driver (e.g. 1243 lookups against 1248 browsers) with no
              # warning.
              playwright-driver.browsers
              flyctl
              gh

              # Commented out, not used often enough: verifies `.#rhizz-docker`
              # without a Docker daemon: `podman load -i result` then
              # `podman run`. Daemonless and runs in a user namespace, so it
              # needs no privileged service. Note the published port is
              # forwarded over IPv4 only — probe 127.0.0.1, not localhost.
              # podman
            ];

            # Point cargo-llvm-cov at the Nix-managed LLVM tools, and Playwright
            # at the Nix-provided browsers instead of ~/.cache/ms-playwright.
            shellHook = ''
              export LLVM_COV="${pkgs.llvmPackages_21.llvm}/bin/llvm-cov"
              export LLVM_PROFDATA="${pkgs.llvmPackages_21.llvm}/bin/llvm-profdata"
              export PLAYWRIGHT_BROWSERS_PATH="${pkgs.playwright-driver.browsers}"
              export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
              export RHIZZ_VRT_FONTCONFIG_FILE="${vrtFontsConf}"
            '';
          };

          # Pinned coverage toolchain, see the `nixpkgs-coverage` input
          # above. Minimal on purpose: only what `just coverage` needs
          # (rustc, cargo, cargo-llvm-cov, LLVM tools). Everything else
          # keeps using the main toolchain via the default shell.
          coverage =
            let
              pkgsOld = nixpkgs-coverage.legacyPackages.${system};
            in
            pkgsOld.mkShell {
              packages = with pkgsOld; [
                rustc
                cargo
                # No `doCheck = false` override needed here: unlike the
                # current rev, this cargo-llvm-cov's self-tests passed in
                # the sandbox (main was green on this rev).
                cargo-llvm-cov
                # LLVM tools matching this Rust's LLVM, same role as in
                # the default shell (NixOS equivalent of rustup's
                # llvm-tools-preview component).
                llvmPackages_21.llvm
              ];

              shellHook = ''
                export LLVM_COV="${pkgsOld.llvmPackages_21.llvm}/bin/llvm-cov"
                export LLVM_PROFDATA="${pkgsOld.llvmPackages_21.llvm}/bin/llvm-profdata"
              '';
            };
        });
    };
}
