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

          rhizz-web = pkgs.callPackage ./nix/frontend.nix {
            src = ./web;
            inherit rhizz-wasm-pkg;
          };

          rhizz = pkgs.callPackage ./nix/backend.nix {
            src = rustSrc;
            inherit rhizz-web;
            # `shortRev` exists only for a clean git tree; `dirtyShortRev`
            # marks a dirty one. Neither exists for a non-git source.
            gitSha = self.shortRev or self.dirtyShortRev or "unknown";
          };

          # A container image is inherently Linux: on Darwin the same
          # derivation would pack a Mach-O binary into an image that cannot
          # run it, so the attribute is only defined where it means something.
          docker-image = pkgs.callPackage ./nix/docker.nix {
            inherit rhizz;
            examples = examplesSrc;
          };
        in
        {
          inherit rhizz-wasm-pkg rhizz-web rhizz;
        }
        // pkgs.lib.optionalAttrs pkgs.stdenv.hostPlatform.isLinux {
          inherit docker-image;
        });

      devShells = forAllSystems (system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          # Pinned font set for visual regression tests (web/vrt): the VRT
          # browser sees only these fonts, so text renders identically on
          # every machine instead of depending on host-installed fonts.
          # Hand-written (not makeFontsConf, which also pulls in /usr/share/fonts
          # and /etc/fonts/conf.d) and with rendering pinned, so host fontconfig
          # settings (hinting, subpixel AA) cannot leak in either.
          vrtFontsConf = pkgs.writeText "rhizz-vrt-fonts.conf" ''
            <?xml version="1.0"?>
            <!DOCTYPE fontconfig SYSTEM "fonts.dtd">
            <fontconfig>
              <dir>${pkgs.dejavu_fonts}/share/fonts</dir>
              <dir>${pkgs.liberation_ttf}/share/fonts</dir>
              <dir>${pkgs.noto-fonts-color-emoji}/share/fonts</dir>
              <cachedir>/tmp/rhizz-vrt-fontcache</cachedir>
              <alias binding="strong"><family>sans-serif</family><prefer><family>DejaVu Sans</family></prefer></alias>
              <alias binding="strong"><family>system-ui</family><prefer><family>DejaVu Sans</family></prefer></alias>
              <alias binding="strong"><family>serif</family><prefer><family>DejaVu Serif</family></prefer></alias>
              <alias binding="strong"><family>monospace</family><prefer><family>DejaVu Sans Mono</family></prefer></alias>
              <alias binding="strong"><family>emoji</family><prefer><family>Noto Color Emoji</family></prefer></alias>
              <!-- Unknown families (e.g. "Segoe UI") fall back to DejaVu Sans. -->
              <match target="pattern">
                <edit name="family" mode="append_last"><string>DejaVu Sans</string></edit>
              </match>
              <match target="font">
                <edit name="antialias" mode="assign"><bool>true</bool></edit>
                <edit name="hinting" mode="assign"><bool>true</bool></edit>
                <edit name="hintstyle" mode="assign"><const>hintslight</const></edit>
                <edit name="rgba" mode="assign"><const>none</const></edit>
                <edit name="lcdfilter" mode="assign"><const>lcdnone</const></edit>
                <edit name="autohint" mode="assign"><bool>false</bool></edit>
                <edit name="embeddedbitmap" mode="assign"><bool>false</bool></edit>
              </match>
            </fontconfig>
          '';
        in
        {
          default = pkgs.mkShell {
            packages = with pkgs; [
              rustc
              cargo
              cargo-audit
              cargo-llvm-cov
              clippy
              mdbook
              rustfmt
              wasm-pack
              nodejs
              just
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
              # 1.63.0), because Playwright looks up browsers by revision
              # directory name (chromium-1243).
              # After bumping either side, rerun `npm ci` so node_modules
              # resolves the new driver; a stale tree keeps resolving the old
              # driver (e.g. 1228 lookups against 1243 browsers) with no
              # warning.
              playwright-driver.browsers
              flyctl
              gh
              # Rootless container runtime for verifying `.#docker-image`
              # without a Docker daemon: `podman load -i result` then
              # `podman run`. Daemonless and runs in a user namespace, so it
              # needs no privileged service. Note the published port is
              # forwarded over IPv4 only — probe 127.0.0.1, not localhost.
              podman
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
        });
    };
}
