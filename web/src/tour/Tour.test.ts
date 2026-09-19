import { describe, expect, it } from "vitest";
import { tourSteps } from "./Tour";
import { TOUR_TARGETS } from "./tourTargets";

describe("tourSteps", () => {
  const steps = tourSteps("demo-id");

  it("has unique step ids", () => {
    const ids = steps.map((step) => step.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("points every targeted step at a known TOUR_TARGETS key", () => {
    const known = new Set(Object.keys(TOUR_TARGETS));
    const targeted = steps.filter((step) => step.target !== undefined);
    expect(targeted.length).toBeGreaterThan(0);
    for (const step of targeted) {
      if (step.target === undefined) {
        throw new Error(`step ${step.id} lost its target`);
      }
      expect(known.has(step.target)).toBe(true);
    }
  });

  it("routes each stop at the given project", () => {
    for (const step of steps) {
      if (step.href === undefined) {
        throw new Error(`step ${step.id} has no href`);
      }
      expect(step.href).toContain("/projects/demo-id/");
    }
  });

  it("walks navbar -> overview -> diagrams -> inventory -> explore -> editor", () => {
    const hrefs = steps.map((step) => {
      if (step.href === undefined) {
        throw new Error(`step ${step.id} has no href`);
      }
      return step.href;
    });
    const order = [
      "overview",
      "diagrams",
      "inventory",
      "explore",
      "editor",
    ].map((page) => hrefs.findIndex((href) => href.endsWith(`/${page}`)));
    for (const index of order) expect(index).toBeGreaterThanOrEqual(0);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("opens and closes with centered dialogs", () => {
    expect(steps[0]?.target).toBeUndefined();
    expect(steps[steps.length - 1]?.target).toBeUndefined();
  });
});
