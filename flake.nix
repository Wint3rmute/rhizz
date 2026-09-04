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
              pkgs.lld
              pkgs.flyctl
              pkgs.gh
              # LLVM tools matching rustc's LLVM (21.1.8), required by
              # cargo-llvm-cov (NixOS equivalent of rustup's
              # llvm-tools-preview component).
              pkgs.llvmPackages_21.llvm
            ];

            # Point cargo-llvm-cov at the Nix-managed LLVM tools.
            shellHook = ''
              export LLVM_COV="${pkgs.llvmPackages_21.llvm}/bin/llvm-cov"
              export LLVM_PROFDATA="${pkgs.llvmPackages_21.llvm}/bin/llvm-profdata"
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
