import { describe, expect, it } from "vitest";
import {
  createForceLayout,
  groupBySiblings,
  type LayoutEdge,
  type LayoutNode,
  runForceLayout,
} from "./forceLayout";

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function center(node: LayoutNode) {
  return {
    x: node.box.x + node.box.width / 2,
    y: node.box.y + node.box.height / 2,
  };
}

describe("runForceLayout", () => {
  it("returns an empty result for no nodes", () => {
    expect(runForceLayout([], [])).toEqual([]);
  });

  it("pulls two connected, far-apart nodes closer together", () => {
    const nodes: LayoutNode[] = [
      { index: 0, box: { x: 0, y: 0, width: 100, height: 100 } },
      { index: 1, box: { x: 2000, y: 0, width: 100, height: 100 } },
    ];
    const edges: LayoutEdge[] = [{ from: 0, to: 1 }];

    const initialDistance = distance(center(nodes[0]), center(nodes[1]));
    const result = runForceLayout(nodes, edges);
    const finalDistance = distance(
      { x: result[0].x + 50, y: result[0].y + 50 },
      { x: result[1].x + 50, y: result[1].y + 50 },
    );

    expect(finalDistance).toBeLessThan(initialDistance);
  });

  it("doesn't collapse connected nodes fully on top of each other", () => {
    const nodes: LayoutNode[] = [
      { index: 0, box: { x: 0, y: 0, width: 100, height: 100 } },
      { index: 1, box: { x: 50, y: 0, width: 100, height: 100 } },
    ];
    const edges: LayoutEdge[] = [{ from: 0, to: 1 }];

    const result = runForceLayout(nodes, edges);
    const finalDistance = distance(
      { x: result[0].x + 50, y: result[0].y + 50 },
      { x: result[1].x + 50, y: result[1].y + 50 },
    );

    // Circumscribing radius of a 100x100 box is 50*sqrt(2) ≈ 70.7; two
    // such circles shouldn't end up centred less than ~2x that apart.
    expect(finalDistance).toBeGreaterThan(100);
  });

  it("pushes two overlapping, disconnected nodes apart", () => {
    const nodes: LayoutNode[] = [
      { index: 0, box: { x: 0, y: 0, width: 100, height: 100 } },
      { index: 1, box: { x: 10, y: 10, width: 100, height: 100 } },
    ];

    const initialDistance = distance(center(nodes[0]), center(nodes[1]));
    const result = runForceLayout(nodes, []);
    const finalDistance = distance(
      { x: result[0].x + 50, y: result[0].y + 50 },
      { x: result[1].x + 50, y: result[1].y + 50 },
    );

    expect(finalDistance).toBeGreaterThan(initialDistance);
  });

  it("never moves a node marked fixed", () => {
    const nodes: LayoutNode[] = [
      { index: 0, box: { x: 0, y: 0, width: 100, height: 100 }, fixed: true },
      { index: 1, box: { x: 10, y: 10, width: 100, height: 100 } },
    ];

    const result = runForceLayout(nodes, [{ from: 0, to: 1 }]);
    const fixedResult = result.find((r) => r.index === 0);

    expect(fixedResult).toEqual({ index: 0, x: 0, y: 0 });
  });

  it("ignores edges referencing an index not present in nodes", () => {
    const nodes: LayoutNode[] = [
      { index: 0, box: { x: 0, y: 0, width: 100, height: 100 } },
    ];
    // Should not throw despite index 99 not existing.
    expect(() => runForceLayout(nodes, [{ from: 0, to: 99 }])).not.toThrow();
  });

  it("round-trips every input node's index in the result", () => {
    const nodes: LayoutNode[] = [
      { index: 5, box: { x: 0, y: 0, width: 100, height: 100 } },
      { index: 12, box: { x: 200, y: 0, width: 100, height: 100 } },
    ];
    const result = runForceLayout(nodes, []);
    expect(result.map((r) => r.index).sort((a, b) => a - b)).toEqual([
      5,
      12,
    ]);
  });
});

describe("createForceLayout", () => {
  it("can be driven tick-by-tick, converging alpha towards 0", () => {
    const nodes: LayoutNode[] = [
      { index: 0, box: { x: 0, y: 0, width: 100, height: 100 } },
      { index: 1, box: { x: 500, y: 0, width: 100, height: 100 } },
    ];
    const layout = createForceLayout(nodes, [{ from: 0, to: 1 }]);

    const initialAlpha = layout.alpha();
    for (let i = 0; i < 50; i++) layout.tick();
    const laterAlpha = layout.alpha();

    expect(laterAlpha).toBeLessThan(initialAlpha);
  });

  it("returns fresh positions from every tick() call", () => {
    const nodes: LayoutNode[] = [
      { index: 0, box: { x: 0, y: 0, width: 100, height: 100 } },
      { index: 1, box: { x: 500, y: 0, width: 100, height: 100 } },
    ];
    const layout = createForceLayout(nodes, [{ from: 0, to: 1 }]);

    const first = layout.tick();
    const second = layout.tick();

    // Simulation is still active (alpha hasn't decayed to 0 in 2 ticks),
    // so positions should keep changing tick over tick.
    expect(second).not.toEqual(first);
  });
});

describe("groupBySiblings", () => {
  it("puts every top-level node (no parent) into one group keyed by undefined", () => {
    const nodes = [{ index: 0 }, { index: 1 }, { index: 2 }];
    const groups = groupBySiblings(nodes, () => undefined);

    expect(groups.size).toBe(1);
    expect(groups.get(undefined)).toEqual(nodes);
  });

  it("splits nodes with different parents into separate groups", () => {
    const nodes = [{ index: 0 }, { index: 1 }, { index: 2 }, { index: 3 }];
    const parents: Record<number, number | undefined> = {
      0: 10,
      1: 10,
      2: 20,
      3: undefined,
    };
    const groups = groupBySiblings(nodes, (index) => parents[index]);

    expect(groups.size).toBe(3);
    expect(groups.get(10)).toEqual([{ index: 0 }, { index: 1 }]);
    expect(groups.get(20)).toEqual([{ index: 2 }]);
    expect(groups.get(undefined)).toEqual([{ index: 3 }]);
  });

  it("preserves each node's original data, not just its index", () => {
    const nodes = [
      { index: 0, box: { x: 1, y: 2, width: 3, height: 4 } },
      { index: 1, box: { x: 5, y: 6, width: 7, height: 8 } },
    ];
    const groups = groupBySiblings(nodes, () => undefined);

    expect(groups.get(undefined)).toEqual(nodes);
  });

  it("returns an empty map for an empty input", () => {
    const groups = groupBySiblings([], () => undefined);
    expect(groups.size).toBe(0);
  });
});
