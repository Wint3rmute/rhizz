import { describe, expect, it } from "vitest";
import { nodeTopLeftAt, pickSpawnAnchor } from "./spawnPlacement";

describe("pickSpawnAnchor", () => {
  it("anchors on the cursor when the pointer is over the canvas", () => {
    expect(pickSpawnAnchor({ x: 120, y: 340 }, { x: 500, y: 500 })).toEqual({
      x: 120,
      y: 340,
    });
  });

  it("falls back to the viewport center when the pointer is elsewhere", () => {
    expect(pickSpawnAnchor(null, { x: 500, y: 500 })).toEqual({
      x: 500,
      y: 500,
    });
  });

  it("prefers the cursor even at the canvas origin", () => {
    // A falsy-but-valid cursor (0,0) must not be mistaken for "no cursor" —
    // only `null` (pointer not over the canvas) falls back.
    expect(pickSpawnAnchor({ x: 0, y: 0 }, { x: 500, y: 500 })).toEqual({
      x: 0,
      y: 0,
    });
  });
});

describe("nodeTopLeftAt", () => {
  it("centers a node box on the anchor point", () => {
    expect(nodeTopLeftAt({ x: 250, y: 250 }, 100, 50)).toEqual({
      x: 200,
      y: 225,
    });
  });

  it("centers a node box with odd dimensions (no rounding drift)", () => {
    expect(nodeTopLeftAt({ x: 100, y: 100 }, 30, 30)).toEqual({
      x: 85,
      y: 85,
    });
  });
});
