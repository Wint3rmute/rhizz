import { describe, expect, it } from "vitest";
import {
  borderStyleToDasharray,
  borderStyleToSvg,
  fontStyleToSvg,
} from "./visuals";

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

describe("borderStyleToSvg", () => {
  it("combines color and border into stroke + dasharray", () => {
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
