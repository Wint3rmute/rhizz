#!/usr/bin/env bash
# Cool 3D README hero: perspective + drop shadow + gradient background.
#
# Usage:
#   scripts/make-landing.sh [input.png] [background.jpg] [output.png]
#
# Tunables: see the framing block below (SHOT_W, Y_OFF).
#
# Defaults wire into the existing pipeline:
#   input      = Playwright/VRT screenshot (1920x1080)
#   background = assets/landing-gradient.jpg (1920x1280 pastel gradient)
#   output     = book/src/rhizz_landing.png (embedded by README.md + book intro)
#
# Requires: ImageMagick 7 (`magick` on PATH).
set -euo pipefail

# ---------------------------------------------------------------------------
# Framing tunables — edit the numbers directly, then re-run the script.
# ---------------------------------------------------------------------------
SHOT_W=1900  # screenshot width in px; higher = more zoomed in
Y_OFF=0    # vertical offset in px; negative lifts the shot up

INPUT="${1:-web/vrt/__screenshots__/pages-projects--empty-landing--light.png}"
BG="${2:-assets/landing-gradient.jpg}"
OUTPUT="${3:-book/src/rhizz_landing.png}"

if ! command -v magick >/dev/null 2>&1; then
  echo "error: 'magick' (ImageMagick 7) not found on PATH" >&2
  echo "  nix: add 'imagemagick' to flake.nix devShell packages (already done)," >&2
  echo "  then re-enter the dev shell." >&2
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
magick -size "${W}x${H}" xc:none -fill white \
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
magick "$BG" -resize "${OUT_W}x${OUT_H}!" "$TMPDIR/bg.png"
magick "$TMPDIR/tilted.png" -resize "${SHOT_W}x" "$TMPDIR/tilted-small.png"
magick "$TMPDIR/bg.png" "$TMPDIR/tilted-small.png" \
  -gravity center -geometry "$(printf '+0%+d' "$Y_OFF")" -composite \
  "$OUTPUT"

echo "wrote $OUTPUT ($(magick identify -format '%wx%h' "$OUTPUT")) from $INPUT"
