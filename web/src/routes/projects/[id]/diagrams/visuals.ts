// Pure helpers mapping a component's model-level visual attributes (color,
// border, font) to concrete SVG presentation values. Kept dependency-free so
// the interactive canvas and the static/embed renderer share one source of
// truth, and so each mapping is unit-testable in isolation.

export type BorderStyle = "solid" | "dashed" | "dotted";
export type FontStyle = "bold" | "italic" | "underline";

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
    stroke: visuals.color || undefined,
  };
}
