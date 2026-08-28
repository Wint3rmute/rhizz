// Pure helpers mapping a component's model-level visual attributes (color,
// border, font) to concrete SVG presentation values. Kept dependency-free so
// the interactive canvas and the static/embed renderer share one source of
// truth, and so each mapping is unit-testable in isolation.

export type BorderStyle = "solid" | "dashed" | "dotted";
export type FontStyle = "bold" | "italic" | "underline";

// The limited set of color choices offered by the inspector. Each maps to a
// daisyUI theme token, so the rendered color follows the active theme (and
// automatically adapts to dark mode) instead of being a fixed CSS color.
export const COLOR_OPTIONS = [
  "primary",
  "secondary",
  "accent",
  "success",
  "warning",
  "error",
  "info",
] as const;

export type ColorOption = (typeof COLOR_OPTIONS)[number];

export interface ComponentVisuals {
  color?: string;
  border?: string;
  font?: string;
}

export interface SvgBorder {
  /** SVG `stroke-dasharray` value, or undefined for a solid border. */
  dasharray?: string;
  /** Stroke color; falls back to the default base-content grey when unset. */
  stroke?: string;
}

export interface SvgFont {
  fontWeight?: string;
  fontStyle?: string;
  textDecoration?: string;
}

// Presentation of the selection outline drawn on top of a selected node.
// A 50%-transparent dotted outline (rather than a solid bold border) so the
// node's own border style stays visible and isn't obscured by the selection
// indicator.
export const SELECTION_OUTLINE_OPACITY = 0.5;
export const SELECTION_OUTLINE_DASHARRAY = "1.5 3";

// Fraction by which the selection outline is enlarged beyond the node's own
// box (applied to both width and height), so the outline sits slightly
// outside the node's border while staying centered on the same place. Tweak
// this in a dev build to tune the visual gap.
export const SELECTION_OUTLINE_SCALE = 0.05;

// Returns the selection outline's rect for a node of the given size, expanded
// by SELECTION_OUTLINE_SCALE on each axis and centered on the node's origin.
// Coordinates are relative to the node's top-left corner (the caller renders
// this inside a `translate(x, y)` group).
export function selectionOutlineRect(
  width: number,
  height: number,
): { x: number; y: number; width: number; height: number } {
  const dx = width * SELECTION_OUTLINE_SCALE;
  const dy = height * SELECTION_OUTLINE_SCALE;
  return {
    x: -dx / 2,
    y: -dy / 2,
    width: width + dx,
    height: height + dy,
  };
}

function isColorOption(c: string): c is ColorOption {
  return (COLOR_OPTIONS as readonly string[]).includes(c);
}

// Maps a stored color to an SVG stroke value. daisyUI tokens become CSS
// variables (so they follow the theme / dark mode); anything else is passed
// through as-is (hex or named CSS color).
export function colorToSvgStroke(color?: string): string | undefined {
  if (!color) return undefined;
  return isColorOption(color) ? `var(--color-${color})` : color;
}

// Maps a border style to an SVG stroke dash-array. Solid (and any unknown
// value) returns undefined so the renderer keeps its default solid stroke.
export function borderStyleToDasharray(border?: string): string | undefined {
  switch (border) {
    case "dashed":
      return "6 4";
    case "dotted":
      return "1.5 3";
    default:
      return undefined;
  }
}

// Maps a single-word font token to SVG text-presentation values.
export function fontStyleToSvg(font?: string): SvgFont {
  switch (font) {
    case "bold":
      return { fontWeight: "bold" };
    case "italic":
      return { fontStyle: "italic" };
    case "underline":
      return { textDecoration: "underline" };
    default:
      return {};
  }
}

/** Convenience union of the border mappings for a component's visuals. */
export function borderStyleToSvg(visuals: ComponentVisuals): SvgBorder {
  return {
    dasharray: borderStyleToDasharray(visuals.border),
    stroke: colorToSvgStroke(visuals.color),
  };
}
