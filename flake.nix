{
  description = "rhizz dev environment";
  inputs.nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
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
          # realizes only the Rust toolchain. See nix/tasks.nix. `shellInputs`
          # is the union of all task toolchains, for the devshell below.
          tasks = import ./nix/tasks.nix { inherit pkgs; };
        in
        {
          inherit rhizz-wasm-pkg rhizz-frontend rhizz-server;
        }
        // tasks.scripts
        // pkgs.lib.optionalAttrs pkgs.stdenv.hostPlatform.isLinux {
          inherit rhizz-docker;
        });

      devShells = forAllSystems (system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          # Pinned font set for visual regression tests, shared with the
          # `vrt` task scripts (see nix/tasks.nix).
          vrtFontsConf = pkgs.callPackage ./nix/vrt-fonts.nix { };
          # Union of every task script's toolchain (see `taskInputs` in
          # nix/tasks.nix): the single source of truth for shared packages.
          # Only devshell-only extras (no task uses them) are listed below.
          tasks = import ./nix/tasks.nix { inherit pkgs; };
        in
        {
          default = pkgs.mkShell {
            packages = tasks.shellInputs ++ (with pkgs; [
              # The task runner itself (`just <recipe>` delegates to
              # `nix run .#<task>`); the toolchains come from shellInputs.
              just
              # Interactive-only helpers with no task equivalent (`wasm-pack`
              # lives in nix/wasm.nix, coverage LLVM in the `coverage`
              # shell below — nothing else here needs a toolchain).
              flyctl
              gh

              # Commented out, not used often enough: verifies `.#rhizz-docker`
              # without a Docker daemon: `podman load -i result` then
              # `podman run`. Daemonless and runs in a user namespace, so it
              # needs no privileged service. Note the published port is
              # forwarded over IPv4 only — probe 127.0.0.1, not localhost.
              # podman
            ]);

            # Point Playwright at the Nix-provided browsers instead of
            # ~/.cache/ms-playwright (for manual `npm run` invocations; the
            # task scripts carry their own env).
            shellHook = ''
              export PLAYWRIGHT_BROWSERS_PATH="${pkgs.playwright-driver.browsers}"
              export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
              export RHIZZ_VRT_FONTCONFIG_FILE="${vrtFontsConf}"
            '';
          };
        });
    };
}
