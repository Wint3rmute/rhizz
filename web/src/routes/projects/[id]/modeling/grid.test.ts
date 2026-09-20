import { describe, expect, it } from "vitest";
import {
  buildGraduatedGridPatterns,
  GRID_BASE_SPACING,
  GRID_GRADUATIONS,
  type GridGraduation,
} from "./grid";

describe("GRID_GRADUATIONS", () => {
  it("covers the 10/100 scales in increasing order", () => {
    expect(GRID_GRADUATIONS.map((g) => g.multiple)).toEqual([10, 100]);
  });

  it("makes each level more visible than the previous one", () => {
    let previous: GridGraduation | undefined;
    for (const g of GRID_GRADUATIONS) {
      if (previous !== undefined) {
        expect(g.strokeWidth).toBeGreaterThan(previous.strokeWidth);
        expect(g.strokeOpacity).toBeGreaterThan(previous.strokeOpacity);
      }
      previous = g;
    }
  });

  it("keeps every multiple aligned with the base spacing", () => {
    for (const g of GRID_GRADUATIONS) {
      expect(g.multiple % GRID_BASE_SPACING).toBe(0);
    }
  });
});

describe("buildGraduatedGridPatterns", () => {
  it("returns one pattern per graduation, finest first", () => {
    const patterns = buildGraduatedGridPatterns();
    expect(patterns.map((p) => p.size)).toEqual([10, 100]);
  });

  it("gives every pattern a unique prefixed id", () => {
    const patterns = buildGraduatedGridPatterns(
      GRID_GRADUATIONS,
      GRID_BASE_SPACING,
      "Demo",
    );
    expect(patterns.map((p) => p.id)).toEqual(["Demo-g10", "Demo-g100"]);
    expect(new Set(patterns.map((p) => p.id)).size).toBe(patterns.length);
  });

  it("chains each level's fill to the next-finest level", () => {
    const patterns = buildGraduatedGridPatterns();
    const [fine, mid] = patterns;
    expect(fine?.fill).toBeUndefined();
    expect(mid?.fill).toBe("Grid-g10");
  });

  it("converts theme-token strokes to CSS variables and passes raw colors through", () => {
    const patterns = buildGraduatedGridPatterns([
      { multiple: 10, strokeWidth: 1, strokeOpacity: 0.1, stroke: "primary" },
      { multiple: 20, strokeWidth: 1, strokeOpacity: 0.1, stroke: "#ff0000" },
      { multiple: 40, strokeWidth: 1, strokeOpacity: 0.1 },
    ]);
    const [p10, p20, p40] = patterns;
    expect(p10?.stroke).toBe("var(--color-primary)");
    expect(p20?.stroke).toBe("#ff0000");
    expect(p40?.stroke).toBeUndefined();
  });

  it("sorts and deduplicates unsorted input", () => {
    const patterns = buildGraduatedGridPatterns([
      { multiple: 100, strokeWidth: 1, strokeOpacity: 0.2 },
      { multiple: 10, strokeWidth: 1, strokeOpacity: 0.05 },
      { multiple: 100, strokeWidth: 1, strokeOpacity: 0.2 },
      { multiple: 50, strokeWidth: 1, strokeOpacity: 0.1 },
    ]);
    expect(patterns.map((p) => p.size)).toEqual([10, 50, 100]);
  });

  it("rejects multiples that do not align with the base spacing", () => {
    expect(() =>
      buildGraduatedGridPatterns([
        { multiple: 10, strokeWidth: 1, strokeOpacity: 0.1 },
        { multiple: 25, strokeWidth: 1, strokeOpacity: 0.1 },
      ])
    ).toThrow(/not a multiple of the base spacing/);
  });

  it("defaults the stroke fallback to base-content only at render time", () => {
    const patterns = buildGraduatedGridPatterns();
    // Levels without a configured stroke leave it undefined; the renderer
    // substitutes `var(--color-base-content)`.
    expect(
      patterns.every(
        (p) => p.stroke === undefined || p.stroke.startsWith("var("),
      ),
    ).toBe(true);
  });
});
