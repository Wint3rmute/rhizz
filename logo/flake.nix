{
  description = "rhizz-logo — Rhizz logo lockup generator";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forEachSystem = f: builtins.listToAttrs (map (system: {
        name = system;
        value = f (import nixpkgs { inherit system; });
      }) systems);
    in
    {
      devShells = forEachSystem (pkgs: {
        default = pkgs.mkShell {
          name = "rhizz-logo";

          buildInputs = with pkgs; [
            nodejs_24 # runs molecule.mjs / lockup.mjs
            roboto    # wordmark font, converted to outlines by lockup.mjs
          ];

          shellHook = ''
            export ROBOTO_BOLD="${pkgs.roboto}/share/fonts/truetype/Roboto-Bold.ttf"
          '';
        };
      });
    };
}
