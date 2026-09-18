import { describe, expect, it } from "vitest";
import { TOUR_TARGETS, tourSelector, type TourTargetKey } from "./tourTargets";

describe("TOUR_TARGETS", () => {
  it("covers every stop of the drone tutorial", () => {
    const keys = Object.keys(TOUR_TARGETS) as TourTargetKey[];
    for (
      const key of [
        "navbar",
        "overview",
        "diagramCanvas",
        "diagramSidebar",
        "inventory",
        "explore",
        "editor",
      ] as const
    ) {
      expect(keys).toContain(key);
    }
  });

  it("uses unique kebab-case values usable as data-tour attributes", () => {
    const values = Object.values(TOUR_TARGETS);
    expect(new Set(values).size).toBe(values.length);
    for (const value of values) {
      expect(value).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("builds a data-tour selector for a typed key", () => {
    expect(tourSelector("diagramCanvas")).toBe(
      '[data-tour="diagrams-canvas"]',
    );
  });
});
