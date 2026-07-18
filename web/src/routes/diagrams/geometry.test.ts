import { describe, expect, it } from "vitest";
import { boxCenter, boxContains, clampWithin, type Box } from "./geometry";

// First example tests for the geometry module (Task 37). Establishes the
// pattern (describe/it/expect, plain Box literals in/out, no Svelte/DOM
// dependency) for the rest of the module's functions to follow. See
// TASKS.md for the remaining functions still to cover (elbowPath,
// boxBoundaryPoint, clampResizeWithin, unionBox edge cases, depthOf).

describe("boxCenter", () => {
  it("returns the midpoint of a box", () => {
    const box: Box = { x: 10, y: 20, width: 100, height: 50 };
    expect(boxCenter(box)).toEqual({ x: 60, y: 45 });
  });

  it("handles a zero-sized box (its own top-left corner)", () => {
    const box: Box = { x: 5, y: 5, width: 0, height: 0 };
    expect(boxCenter(box)).toEqual({ x: 5, y: 5 });
  });
});

describe("boxContains", () => {
  const outer: Box = { x: 0, y: 0, width: 100, height: 100 };

  it("is true when inner is fully inside outer", () => {
    const inner: Box = { x: 10, y: 10, width: 20, height: 20 };
    expect(boxContains(outer, inner)).toBe(true);
  });

  it("is true when inner exactly matches outer's bounds (edge-touching)", () => {
    expect(boxContains(outer, outer)).toBe(true);
  });

  it("is false when inner only partially overlaps outer", () => {
    const inner: Box = { x: 90, y: 90, width: 20, height: 20 };
    expect(boxContains(outer, inner)).toBe(false);
  });

  it("is false when inner is entirely outside outer", () => {
    const inner: Box = { x: 200, y: 200, width: 10, height: 10 };
    expect(boxContains(outer, inner)).toBe(false);
  });
});

describe("clampWithin", () => {
  const parent: Box = { x: 0, y: 0, width: 200, height: 200 };
  const margin = 10;

  it("leaves a child unchanged when it already fits", () => {
    const child: Box = { x: 20, y: 20, width: 50, height: 50 };
    expect(clampWithin(child, parent, margin)).toEqual(child);
  });

  it("repositions a child that's too far past the left/top edge", () => {
    const child: Box = { x: -50, y: -50, width: 50, height: 50 };
    expect(clampWithin(child, parent, margin)).toEqual({
      x: 10,
      y: 10,
      width: 50,
      height: 50,
    });
  });

  it("repositions a child that's too far past the right/bottom edge", () => {
    const child: Box = { x: 500, y: 500, width: 50, height: 50 };
    expect(clampWithin(child, parent, margin)).toEqual({
      x: 140, // 200 - margin(10) - width(50)
      y: 140,
      width: 50,
      height: 50,
    });
  });

  it("shrinks a child too large to fit within the margin-inset area", () => {
    const child: Box = { x: 0, y: 0, width: 1000, height: 1000 };
    expect(clampWithin(child, parent, margin)).toEqual({
      x: 10,
      y: 10,
      width: 180, // parent.width - margin * 2
      height: 180,
    });
  });
});
