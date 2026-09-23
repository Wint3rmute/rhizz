{
  description = "rhizz dev environment";
  inputs.nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f system);
    in
    {
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
            packages = [
              pkgs.rustc
              pkgs.cargo
              pkgs.cargo-audit
              pkgs.cargo-llvm-cov
              pkgs.clippy
              pkgs.mdbook
              pkgs.rustfmt
              pkgs.wasm-pack
              pkgs.deno
              pkgs.just
              pkgs.lld
              pkgs.flyctl
              pkgs.gh
              # LLVM tools matching rustc's LLVM (21.1.8), required by
              # cargo-llvm-cov (NixOS equivalent of rustup's
              # llvm-tools-preview component).
              pkgs.llvmPackages_21.llvm
              # Playwright browsers for the web browser-mode tests
              # (`deno run test --project=storybook`, also covered by
              # `just test`). Nixpkgs' playwright-driver version must match the
              # `playwright` version resolved under web/ (currently 1.63.0),
              # because Playwright looks up browsers by revision directory
              # name (chromium-1243).
              # After bumping either side, delete web/node_modules and rerun
              # `deno install`: deno.json sets nodeModulesDir=manual, so a
              # stale tree keeps resolving the old driver (e.g. 1228 lookups
              # against 1243 browsers) with no warning.
              pkgs.playwright-driver.browsers
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

            # LLMs often want to use a Python environment with some popular
            # libraries for running one-off validation/exploration commands
            buildInputs = [
              (pkgs.python3.withPackages (python: [
                python.pyyaml
              ]))
            ];
          };
        });
    };
}
