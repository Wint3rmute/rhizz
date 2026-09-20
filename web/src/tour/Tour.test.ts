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

  it("walks navbar -> overview -> modeling -> inventory -> explore -> code", () => {
    const hrefs = steps.map((step) => {
      if (step.href === undefined) {
        throw new Error(`step ${step.id} has no href`);
      }
      return step.href;
    });
    const order = [
      "overview",
      "modeling",
      "inventory",
      "explore",
      "code",
    ].map((page) => hrefs.findIndex((href) => href.endsWith(`/${page}`)));
    for (const index of order) expect(index).toBeGreaterThanOrEqual(0);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("opens and closes with centered dialogs", () => {
    expect(steps[0]?.target).toBeUndefined();
    expect(steps[steps.length - 1]?.target).toBeUndefined();
  });

  it("previews each page on the navbar before showing it", () => {
    // Preview stops spotlight a navbar link while staying on the current
    // page (same href as the previous stop), so the tour never jumps
    // pages abruptly — the following content stop does the navigating.
    const previews = steps.filter((step) => step.id.endsWith("-preview"));
    expect(previews.map((step) => step.target)).toEqual([
      "navOverview",
      "navModeling",
      "navInventory",
      "navExplore",
      "navCode",
    ]);
    for (const preview of previews) {
      const index = steps.indexOf(preview);
      expect(index).toBeGreaterThan(0);
      expect(steps[index - 1]?.href).toBe(preview.href);
    }
  });
});
