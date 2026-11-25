{
  description = "rhizz-logo — generative, LLM-drivable SVG logo playground";

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
            # — generator runtime: Node ESM, zero-dep SVG builders —
            nodejs_24

            # TS for when the generator grows up (optional, plain .mjs works too)
            typescript

            # — SVG rasterize / inspect loop (how I see my own output) —
            resvg              # primary: resvg input.svg output.png (fast, accurate)
            librsvg            # fallback: rsvg-convert -w 1024 in.svg -o out.png
            imagemagick        # montage / compare sizes / contact sheets

            # — SVG optimizer for final hand-off —
            svgo

            # — preview server + little scripting —
            python3

            # — brand font (Roboto Bold for the wordmark; converted to outlines) —
            roboto

            # — paper.js / node-canvas system libs (cairo chain for future raster needs) —
            pkg-config
            cairo
            pango
          ];

          shellHook = ''
            export ROBOTO_BOLD="${pkgs.roboto}/share/fonts/truetype/Roboto-Bold.ttf"
            echo "◆ rhizz-logo shell"
            echo "  node $(node --version) | resvg $(resvg --version 2>/dev/null || echo ok) | $(python3 --version)"
            echo ""
            echo "  generate : node src/generate.mjs --seed 1 --out renders/v001.svg"
            echo "  raster   : resvg renders/v001.svg renders/v001.png"
            echo "  optimize : svgo renders/v001.svg -o renders/v001.min.svg"
            echo "  preview  : python3 -m http.server 8000   # then open preview.html"
            echo "  sheet    : montage renders/*.png -tile 4x -geometry +4+4 sheet.png"
            echo ""
            mkdir -p renders src references
          '';
        };
      });
    };
}
