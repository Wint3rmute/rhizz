# Rhizz logo

The Rhizz logotype, generated from code rather than drawn by hand.

The goal is a declarative, reproducible source of truth for the project's
branding: the mark is described by a small set of parameters (node radius, bar
width, fillets, …) and the lockup is composed from the mark plus a wordmark.
The SVGs in `renders/` are build outputs. To change the logo, change the
generators in `src/` and regenerate. Don't edit the SVGs.

- `src/molecule.mjs` builds the mark, a tree of circles joined by
  constant-width bars, traced as a single closed outline.
- `src/lockup.mjs` builds the "mark + Rhizome" lockup. The wordmark (Roboto
  Bold) is converted to outlines, so the SVG needs no webfont.
- `src/construction.mjs` builds a construction sheet: the mark in grey with the
  tracer's real geometry over it (dot circles, bar axes and sides, every fillet
  circle, hub notch vertices, bounding square and enclosing circle).
- `renders/molecule/` holds the committed SVGs.

## Regenerating

```bash
just assets
```

This also regenerates the landing hero image. The font comes from nixpkgs, so
run it through `just`/nix rather than calling the scripts directly.

CI runs `just assets-check` and fails if the committed SVGs differ from what the
generators produce.
