{
  description = "rhizz dev environment";
  inputs.nixpkgs.url = "nixpkgs";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f system);
    in
    {
      devShells = forAllSystems (system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        {
          default = pkgs.mkShell {
            packages = [
              pkgs.rustc
              pkgs.cargo
              pkgs.cargo-audit
              pkgs.clippy
              pkgs.mdbook
              pkgs.python3
              pkgs.rustfmt
              pkgs.wasm-pack
              pkgs.deno
              pkgs.lld
              pkgs.playwright-driver
              pkgs.flyctl
              pkgs.gh
            ];

            # Use nixpkgs' patched Playwright browsers instead of downloading
            # generic Linux binaries into ~/.cache/ms-playwright. Keep the
            # web Playwright dependency pinned to playwright-driver.version.
            PLAYWRIGHT_BROWSERS_PATH = pkgs.playwright-driver.browsers;
          };
        });
    };
}
