import { describe, expect, it } from "vitest";
import {
  borderStyleToDasharray,
  borderStyleToSvg,
  COLOR_OPTIONS,
  colorToSvgStroke,
  DEFAULT_COLOR,
  DEFAULT_FONT,
  fontStyleToSvg,
  isColorOption,
  isFontStyle,
  SELECTION_OUTLINE_DASHARRAY,
  SELECTION_OUTLINE_OPACITY,
  SELECTION_OUTLINE_SCALE,
  selectionOutlineRect,
} from "./visuals";

describe("colorToSvgStroke", () => {
  it("maps daisyUI theme tokens to CSS variables", () => {
    expect(colorToSvgStroke("primary")).toBe("var(--color-primary)");
    expect(colorToSvgStroke("success")).toBe("var(--color-success)");
    expect(colorToSvgStroke("info")).toBe("var(--color-info)");
  });

  it("exposes the limited curatved color set", () => {
    expect(COLOR_OPTIONS).toContain("primary");
    expect(COLOR_OPTIONS.length).toBeGreaterThanOrEqual(5);
    expect(COLOR_OPTIONS.length).toBeLessThanOrEqual(7);
  });

  it("passes through raw CSS colors unchanged", () => {
    expect(colorToSvgStroke("#ff0000")).toBe("#ff0000");
    expect(colorToSvgStroke("red")).toBe("red");
  });

  it("returns undefined for no color", () => {
    expect(colorToSvgStroke(undefined)).toBeUndefined();
    expect(colorToSvgStroke("")).toBeUndefined();
  });

  it("maps the explicit default to no stroke", () => {
    expect(colorToSvgStroke(DEFAULT_COLOR)).toBeUndefined();
  });

  it("guards theme tokens and font styles", () => {
    expect(isColorOption("warning")).toBe(true);
    expect(isColorOption(DEFAULT_COLOR)).toBe(false);
    expect(isColorOption("#ff0000")).toBe(false);
    expect(isFontStyle("bold")).toBe(true);
    expect(isFontStyle(DEFAULT_FONT)).toBe(false);
    expect(isFontStyle("fancy")).toBe(false);
  });
});

// Maps a border style to an SVG stroke dash-array.
describe("borderStyleToDasharray", () => {
  it("maps solid (and unknown values) to no dash array", () => {
    expect(borderStyleToDasharray("solid")).toBeUndefined();
    expect(borderStyleToDasharray(undefined)).toBeUndefined();
    expect(borderStyleToDasharray("blobby")).toBeUndefined();
  });

  it("maps dashed and dotted to dash arrays", () => {
    expect(borderStyleToDasharray("dashed")).toBe("6 4");
    expect(borderStyleToDasharray("dotted")).toBe("1.5 3");
  });
});

describe("fontStyleToSvg", () => {
  it("returns empty presentation for the default / unknown", () => {
    expect(fontStyleToSvg(undefined)).toEqual({});
    expect(fontStyleToSvg(DEFAULT_FONT)).toEqual({});
    expect(fontStyleToSvg("fancy")).toEqual({});
  });

  it("maps bold, italic, and underline", () => {
    expect(fontStyleToSvg("bold")).toEqual({ fontWeight: "bold" });
    expect(fontStyleToSvg("italic")).toEqual({ fontStyle: "italic" });
    expect(fontStyleToSvg("underline")).toEqual({
      textDecoration: "underline",
    });
  });
});

describe("selection outline", () => {
  it("uses a 75% opaque dotted outline", () => {
    expect(SELECTION_OUTLINE_OPACITY).toBe(0.75);
    expect(SELECTION_OUTLINE_DASHARRAY).toBe("1.5 3");
  });

  it("expands uniformly by the scale of the shorter side, centered on the box", () => {
    // Wide-but-short: the shorter side (height) drives the expansion, so the
    // outline clearance is the same on all four sides.
    const rect = selectionOutlineRect(400, 100);
    const expansion = 100 * SELECTION_OUTLINE_SCALE;
    expect(rect).toEqual({
      x: -expansion / 2,
      y: -expansion / 2,
      width: 400 + expansion,
      height: 100 + expansion,
    });
  });
});

describe("borderStyleToSvg", () => {
  it("combines a token color and border into stroke + dasharray", () => {
    expect(borderStyleToSvg({ color: "primary", border: "dashed" })).toEqual({
      dasharray: "6 4",
      stroke: "var(--color-primary)",
    });
  });

  it("passes a raw CSS color through as the stroke", () => {
    expect(borderStyleToSvg({ color: "#ff0000", border: "dashed" })).toEqual({
      dasharray: "6 4",
      stroke: "#ff0000",
    });
  });

  it("defaults stroke to undefined when no color is set", () => {
    expect(borderStyleToSvg({ border: "dotted" })).toEqual({
      dasharray: "1.5 3",
      stroke: undefined,
    });
  });

  it("maps explicit defaults to no stroke and no dash array", () => {
    expect(
      borderStyleToSvg({ color: DEFAULT_COLOR, border: "solid" }),
    ).toEqual({
      dasharray: undefined,
      stroke: undefined,
    });
  });
});
