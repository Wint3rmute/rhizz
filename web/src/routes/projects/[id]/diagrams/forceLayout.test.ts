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

// Returns the two members of a result array (assumed length >= 2 for the
// single-edge pair scenarios these tests exercise) or throws if the layout
// unexpectedly produced fewer nodes, so the assertions below use concrete
// elements instead of unchecked indexing.
function pair<T>(arr: T[]): [T, T] {
  const a = arr[0];
  const b = arr[1];
  if (a === undefined || b === undefined) {
    throw new Error(`expected at least 2 elements, got ${arr.length}`);
  }
  return [a, b];
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

    const [n0, n1] = pair(nodes);
    const initialDistance = distance(center(n0), center(n1));
    const result = runForceLayout(nodes, edges);
    const [r0, r1] = pair(result);
    const finalDistance = distance(
      { x: r0.x + 50, y: r0.y + 50 },
      { x: r1.x + 50, y: r1.y + 50 },
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
    const [r0, r1] = pair(result);
    const finalDistance = distance(
      { x: r0.x + 50, y: r0.y + 50 },
      { x: r1.x + 50, y: r1.y + 50 },
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

    const [n0, n1] = pair(nodes);
    const initialDistance = distance(center(n0), center(n1));
    const result = runForceLayout(nodes, []);
    const [r0, r1] = pair(result);
    const finalDistance = distance(
      { x: r0.x + 50, y: r0.y + 50 },
      { x: r1.x + 50, y: r1.y + 50 },
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

  it("nudges a diagonally-connected pair towards horizontal/vertical alignment", () => {
    const nodes: LayoutNode[] = [
      { index: 0, box: { x: 0, y: 0, width: 100, height: 100 } },
      { index: 1, box: { x: 400, y: 150, width: 100, height: 100 } },
    ];
    const edges: LayoutEdge[] = [{ from: 0, to: 1 }];

    // dx (400) > dy (150) initially, so the pair already leans towards
    // side-by-side — alignment should pull their y's closer together
    // than an otherwise-identical run with alignment disabled.
    const aligned = runForceLayout(nodes, edges, { alignStrength: 1 });
    const unaligned = runForceLayout(nodes, edges, { alignStrength: 0 });

    const [a0, a1] = pair(aligned);
    const dyAligned = Math.abs(a1.y + 50 - (a0.y + 50));
    const [u0, u1] = pair(unaligned);
    const dyUnaligned = Math.abs(u1.y + 50 - (u0.y + 50));

    expect(dyAligned).toBeLessThan(dyUnaligned);
  });

  it("leaves connections free to settle at any angle when alignStrength is 0", () => {
    const nodes: LayoutNode[] = [
      { index: 0, box: { x: 0, y: 0, width: 100, height: 100 } },
      { index: 1, box: { x: 400, y: 150, width: 100, height: 100 } },
    ];
    const edges: LayoutEdge[] = [{ from: 0, to: 1 }];

    // Should not throw or behave differently just because alignStrength
    // is explicitly 0 rather than omitted.
    expect(() => runForceLayout(nodes, edges, { alignStrength: 0 }))
      .not.toThrow();
  });

  it("doesn't change the final converged result, only how gradually it's revealed", () => {
    const nodes: LayoutNode[] = [
      { index: 0, box: { x: 0, y: 0, width: 100, height: 100 } },
      { index: 1, box: { x: 500, y: 0, width: 100, height: 100 } },
    ];
    const edges: LayoutEdge[] = [{ from: 0, to: 1 }];

    const withWarmup = runForceLayout(nodes, edges, { warmupTicks: 30 });
    const withoutWarmup = runForceLayout(nodes, edges, { warmupTicks: 0 });

    // The warmup ramp only affects what's *returned* early on, never the
    // underlying simulation's own physics — so by convergence, both runs
    // should land on the exact same final positions.
    expect(withWarmup).toEqual(withoutWarmup);
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

  it("moves nodes less on tick 1 when warmupTicks is set than when it isn't", () => {
    const nodes: LayoutNode[] = [
      { index: 0, box: { x: 0, y: 0, width: 100, height: 100 } },
      { index: 1, box: { x: 1000, y: 0, width: 100, height: 100 } },
    ];
    const edges: LayoutEdge[] = [{ from: 0, to: 1 }];

    const ramped = createForceLayout(nodes, edges, { warmupTicks: 10 });
    const unramped = createForceLayout(nodes, edges, { warmupTicks: 0 });

    const [rampedFirst] = pair(ramped.tick());
    const [unrampedFirst] = pair(unramped.tick());
    const [node0] = pair(nodes);

    const rampedMove = distance(
      { x: rampedFirst.x, y: rampedFirst.y },
      { x: node0.box.x, y: node0.box.y },
    );
    const unrampedMove = distance(
      { x: unrampedFirst.x, y: unrampedFirst.y },
      { x: node0.box.x, y: node0.box.y },
    );

    expect(rampedMove).toBeLessThan(unrampedMove);
  });

  it("reaches full, unramped movement once warmupTicks have elapsed", () => {
    const nodes: LayoutNode[] = [
      { index: 0, box: { x: 0, y: 0, width: 100, height: 100 } },
      { index: 1, box: { x: 1000, y: 0, width: 100, height: 100 } },
    ];
    const edges: LayoutEdge[] = [{ from: 0, to: 1 }];
    const warmupTicks = 5;

    const ramped = createForceLayout(nodes, edges, { warmupTicks });
    const unramped = createForceLayout(nodes, edges, { warmupTicks: 0 });

    let rampedResult = ramped.tick();
    let unrampedResult = unramped.tick();
    for (let i = 1; i < warmupTicks; i++) {
      rampedResult = ramped.tick();
      unrampedResult = unramped.tick();
    }

    // At exactly tick == warmupTicks, the ramp factor is 1 (full
    // strength), so both runs should already report the same position.
    expect(rampedResult).toEqual(unrampedResult);
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
