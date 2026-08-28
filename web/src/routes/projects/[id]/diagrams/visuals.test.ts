import { describe, expect, it } from "vitest";
import {
  borderStyleToDasharray,
  borderStyleToSvg,
  COLOR_OPTIONS,
  colorToSvgStroke,
  fontStyleToSvg,
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
  it("uses a 50% transparent dotted outline", () => {
    expect(SELECTION_OUTLINE_OPACITY).toBe(0.5);
    expect(SELECTION_OUTLINE_DASHARRAY).toBe("1.5 3");
  });

  it("expands the outline by the scale constant, centered on the box", () => {
    const rect = selectionOutlineRect(200, 100);
    const dx = 200 * SELECTION_OUTLINE_SCALE;
    const dy = 100 * SELECTION_OUTLINE_SCALE;
    expect(rect).toEqual({
      x: -dx / 2,
      y: -dy / 2,
      width: 200 + dx,
      height: 100 + dy,
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
});
