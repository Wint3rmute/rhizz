import { describe, expect, it } from "vitest";
import {
  type Box,
  boxBoundaryPoint,
  boxCenter,
  boxContains,
  clampResizeWithin,
  clampWithin,
  computePortPositions,
  computeRenderOrder,
  computeVisibleConnections,
  depthOf,
  elbowPath,
  findConnectTarget,
  findReparentTarget,
  MIN_NODE_SIZE,
  TEXT_ALIGN_PADDING,
  textPosition,
  unionBox,
} from "./geometry";

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

  it("reserves extra space at the top when topMargin is given", () => {
    const child: Box = { x: 20, y: 5, width: 50, height: 50 };
    const topMargin = 30;
    expect(clampWithin(child, parent, margin, topMargin)).toEqual({
      x: 20,
      y: 30, // pushed down past topMargin, not just margin
      width: 50,
      height: 50,
    });
  });

  it("shrinks height (not just repositions) when topMargin leaves no room", () => {
    const child: Box = { x: 20, y: 20, width: 50, height: 185 };
    const topMargin = 30;
    expect(clampWithin(child, parent, margin, topMargin)).toEqual({
      x: 20,
      y: 30,
      width: 50,
      height: 160, // parent.height(200) - margin(10) - topMargin(30)
    });
  });

  it("defaults topMargin to margin, matching the old symmetric behavior", () => {
    const child: Box = { x: -50, y: -50, width: 50, height: 50 };
    expect(clampWithin(child, parent, margin)).toEqual(
      clampWithin(child, parent, margin, margin),
    );
  });
});

describe("clampResizeWithin", () => {
  const parent: Box = { x: 0, y: 0, width: 200, height: 200 };
  const margin = 10;

  it("leaves width/height unchanged when the box already fits", () => {
    const box: Box = { x: 20, y: 20, width: 50, height: 50 };
    expect(clampResizeWithin(box, parent, margin)).toEqual({
      width: 50,
      height: 50,
    });
  });

  it("caps width when it would grow past the parent's right edge", () => {
    const box: Box = { x: 150, y: 20, width: 100, height: 30 };
    // Available space to the right: parent.width - margin - box.x = 200 - 10 - 150 = 40
    expect(clampResizeWithin(box, parent, margin)).toEqual({
      width: 40,
      height: 30,
    });
  });

  it("caps height when it would grow past the parent's bottom edge", () => {
    const box: Box = { x: 20, y: 150, width: 30, height: 100 };
    expect(clampResizeWithin(box, parent, margin)).toEqual({
      width: 30,
      height: 40,
    });
  });

  it("never caps below MIN_NODE_SIZE, even if the box's position leaves less room than that", () => {
    // Available space to the right: 200 - 10 - 185 = 5, well under MIN_NODE_SIZE.
    const box: Box = { x: 185, y: 20, width: 50, height: 30 };
    expect(clampResizeWithin(box, parent, margin)).toEqual({
      width: MIN_NODE_SIZE,
      height: 30,
    });
  });
});

describe("unionBox", () => {
  it("returns the same box for a single box", () => {
    const box: Box = { x: 10, y: 10, width: 50, height: 50 };
    expect(unionBox([box])).toEqual(box);
  });

  it("returns the bounding box of multiple scattered boxes", () => {
    const a: Box = { x: 0, y: 0, width: 10, height: 10 };
    const b: Box = { x: 100, y: -20, width: 10, height: 10 };
    const c: Box = { x: 50, y: 50, width: 20, height: 5 };
    expect(unionBox([a, b, c])).toEqual({
      x: 0,
      y: -20,
      width: 110, // rightmost edge (b: 100+10) minus leftmost (0)
      height: 75, // bottommost edge (c: 50+5=55) minus topmost (-20)
    });
  });

  it("throws instead of silently returning Infinity/NaN geometry for an empty array", () => {
    expect(() => unionBox([])).toThrow();
  });
});

describe("textPosition", () => {
  it('centers text for "center" alignment', () => {
    expect(textPosition("center", 100, 60)).toEqual({
      x: 50,
      y: 30,
      anchor: "middle",
      baseline: "middle",
    });
  });

  it('top-centers text (inset by TEXT_ALIGN_PADDING) for "top-center"', () => {
    expect(textPosition("top-center", 100, 60)).toEqual({
      x: 50,
      y: TEXT_ALIGN_PADDING,
      anchor: "middle",
      baseline: "hanging",
    });
  });

  it('top-left-aligns text (inset by TEXT_ALIGN_PADDING) for "top-left"', () => {
    expect(textPosition("top-left", 100, 60)).toEqual({
      x: TEXT_ALIGN_PADDING,
      y: TEXT_ALIGN_PADDING,
      anchor: "start",
      baseline: "hanging",
    });
  });
});

describe("boxBoundaryPoint", () => {
  // Center at (50, 25).
  const box: Box = { x: 0, y: 0, width: 100, height: 50 };

  it("returns the right-centre point when horizontal and towards is to the right", () => {
    expect(boxBoundaryPoint(box, { x: 200, y: 25 }, "horizontal")).toEqual({
      x: 100,
      y: 25,
    });
  });

  it("returns the left-centre point when horizontal and towards is to the left", () => {
    expect(boxBoundaryPoint(box, { x: -200, y: 25 }, "horizontal")).toEqual({
      x: 0,
      y: 25,
    });
  });

  it("returns the bottom-centre point when vertical and towards is below", () => {
    expect(boxBoundaryPoint(box, { x: 50, y: 200 }, "vertical")).toEqual({
      x: 50,
      y: 50,
    });
  });

  it("returns the top-centre point when vertical and towards is above", () => {
    expect(boxBoundaryPoint(box, { x: 50, y: -200 }, "vertical")).toEqual({
      x: 50,
      y: 0,
    });
  });

  it("never lands on a corner regardless of the angle to towards (always a side midpoint)", () => {
    // A shallow diagonal, still resolved as horizontal since that's the
    // orientation passed in explicitly.
    const point = boxBoundaryPoint(box, { x: 60, y: 26 }, "horizontal");
    expect(point).toEqual({ x: 100, y: 25 });
  });

  it("defaults to the positive side when towards is exactly at the centre", () => {
    expect(boxBoundaryPoint(box, { x: 50, y: 25 }, "horizontal")).toEqual({
      x: 100,
      y: 25,
    });
  });
});

// Extracts the ordered list of waypoints (the x,y at the end of each M/L/A
// command) from a path built by elbowPath. Not a general SVG path parser —
// relies on knowing exactly how elbowPath formats its output (a fixed
// "M x,y L x,y" for the straight-line case, or "M x,y L x,y A r,r 0 0,f x,y
// L x,y A r,r 0 0,f x,y L x,y" for the elbow case).
function waypoints(d: string): { x: number; y: number }[] {
  const tokens = d.split(/\s+/);
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === "M" || tokens[i] === "L") {
      const [x, y] = tokens[i + 1].split(",").map(Number);
      points.push({ x, y });
      i += 1;
    } else if (tokens[i] === "A") {
      // "A rx,ry rotation large-arc,sweep x,y" — the point is the 4th token
      // after "A".
      const [x, y] = tokens[i + 4].split(",").map(Number);
      points.push({ x, y });
      i += 4;
    }
  }
  return points;
}

describe("elbowPath", () => {
  it("draws a straight line when horizontal and the two points are already y-aligned", () => {
    const d = elbowPath(0, 50, 300, 50, "horizontal");
    expect(waypoints(d)).toEqual([{ x: 0, y: 50 }, { x: 300, y: 50 }]);
  });

  it("draws a straight line when vertical and the two points are already x-aligned", () => {
    const d = elbowPath(50, 0, 50, 300, "vertical");
    expect(waypoints(d)).toEqual([{ x: 50, y: 0 }, { x: 50, y: 300 }]);
  });

  it("horizontal orientation always starts and ends travelling horizontally (H-V-H)", () => {
    const d = elbowPath(0, 0, 200, 100, "horizontal");
    const points = waypoints(d);
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points.at(-1)).toEqual({ x: 200, y: 100 });
    // First leg stays at the starting y (still travelling horizontally);
    // last leg is already at the target y (travelling horizontally again).
    expect(points[1].y).toBe(0);
    expect(points.at(-2)!.y).toBe(100);
  });

  it("vertical orientation always starts and ends travelling vertically (V-H-V)", () => {
    const d = elbowPath(0, 0, 200, 100, "vertical");
    const points = waypoints(d);
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points.at(-1)).toEqual({ x: 200, y: 100 });
    // First leg stays at the starting x; last leg is already at the target x.
    expect(points[1].x).toBe(0);
    expect(points.at(-2)!.x).toBe(200);
  });

  it("produces a different shape than horizontal for the same coordinates (orientation actually matters)", () => {
    const horizontal = elbowPath(0, 0, 200, 100, "horizontal");
    const vertical = elbowPath(0, 0, 200, 100, "vertical");
    expect(horizontal).not.toBe(vertical);
  });

  it("still starts/ends at the given points when the target is up-and-left (negative deltas)", () => {
    const d = elbowPath(200, 100, 0, 0, "horizontal");
    const points = waypoints(d);
    expect(points[0]).toEqual({ x: 200, y: 100 });
    expect(points.at(-1)).toEqual({ x: 0, y: 0 });
    expect(points[1].y).toBe(100);
    expect(points.at(-2)!.y).toBe(0);
  });
});

describe("depthOf", () => {
  // A small parent chain for testing: 0 and 3 are roots; 1's parent is 0;
  // 2's parent is 1.
  const parents: Record<number, number | undefined> = {
    0: undefined,
    1: 0,
    2: 1,
    3: undefined,
  };
  const parentOf = (index: number) => parents[index];

  it("is 0 for a component with no parent", () => {
    expect(depthOf(0, parentOf)).toBe(0);
    expect(depthOf(3, parentOf)).toBe(0);
  });

  it("counts hops up the parent chain", () => {
    expect(depthOf(1, parentOf)).toBe(1);
    expect(depthOf(2, parentOf)).toBe(2);
  });
});

describe("findReparentTarget", () => {
  const containerA: Box = { x: 0, y: 0, width: 300, height: 300 };
  const containerB: Box = { x: 50, y: 50, width: 200, height: 200 }; // inside containerA
  const candidates = [
    { index: 0, box: containerA, depth: 0 },
    { index: 1, box: containerB, depth: 1 },
  ];

  it("finds deepest container enclosing the center of the dragged node", () => {
    const dragged: Box = { x: 60, y: 60, width: 50, height: 50 }; // center at (85, 85)
    expect(findReparentTarget(dragged, candidates)).toBe(1);
  });

  it("finds outer container when outside the inner container", () => {
    const dragged: Box = { x: 10, y: 10, width: 30, height: 30 }; // center at (25, 25)
    expect(findReparentTarget(dragged, candidates)).toBe(0);
  });

  it("returns null when center is outside all containers", () => {
    const dragged: Box = { x: 400, y: 400, width: 50, height: 50 };
    expect(findReparentTarget(dragged, candidates)).toBeNull();
  });
});

describe("computeRenderOrder", () => {
  const parents: Record<number, number | undefined> = {
    0: undefined,
    1: 0,
    2: 1,
    3: undefined,
  };
  const parentOf = (index: number) => parents[index];

  it("sorts indices shallowest first", () => {
    expect(computeRenderOrder([2, 1, 0, 3], parentOf)).toEqual([0, 3, 1, 2]);
  });
});

describe("computeVisibleConnections", () => {
  const boxes: Record<number, Box> = {
    0: { x: 0, y: 0, width: 100, height: 50 },
    1: { x: 200, y: 0, width: 100, height: 50 },
    2: { x: 0, y: 200, width: 100, height: 50 },
  };

  it("computes horizontal connection endpoints between side-by-side boxes", () => {
    const connections = [{ from: 0, to: 1, label: "bus" }];
    const visible = computeVisibleConnections(connections, (i) => boxes[i]);

    expect(visible).toHaveLength(1);
    expect(visible[0].orientation).toBe("horizontal");
    expect(visible[0].a).toEqual({ x: 100, y: 25 });
    expect(visible[0].b).toEqual({ x: 200, y: 25 });
  });

  it("computes vertical connection endpoints between vertically stacked boxes", () => {
    const connections = [{ from: 0, to: 2, label: "power" }];
    const visible = computeVisibleConnections(connections, (i) => boxes[i]);

    expect(visible).toHaveLength(1);
    expect(visible[0].orientation).toBe("vertical");
    expect(visible[0].a).toEqual({ x: 50, y: 50 });
    expect(visible[0].b).toEqual({ x: 50, y: 200 });
  });

  it("filters out connections when either endpoint box is not placed", () => {
    const connections = [
      { from: 0, to: 99, label: "missing" },
      { from: 0, to: 1, label: "valid" },
    ];
    const visible = computeVisibleConnections(connections, (i) => boxes[i]);

    expect(visible).toHaveLength(1);
    expect(visible[0].conn.label).toBe("valid");
  });
});

describe("computePortPositions", () => {
  it("computes positions for consumer on left, provider on right, peer on bottom", () => {
    const ports = [
      { label: "in", role: "consumer" as const, protocol: "spi" },
      { label: "out", role: "provider" as const, protocol: "spi" },
      { label: "bus", role: "peer" as const, protocol: "can" },
    ];

    const positions = computePortPositions(120, 80, ports);
    expect(positions).toHaveLength(3);

    const consumer = positions.find((p) => p.label === "in");
    expect(consumer?.x).toBe(0);
    expect(consumer?.y).toBe(40);

    const provider = positions.find((p) => p.label === "out");
    expect(provider?.x).toBe(120);
    expect(provider?.y).toBe(40);

    const peer = positions.find((p) => p.label === "bus");
    expect(peer?.x).toBe(60);
    expect(peer?.y).toBe(80);
  });
});

describe("findConnectTarget", () => {
  const parentBox: Box = { x: 0, y: 0, width: 400, height: 400 };
  const child1Box: Box = { x: 20, y: 50, width: 100, height: 80 };
  const child2Box: Box = { x: 200, y: 50, width: 100, height: 80 };

  const candidates = [
    {
      index: 0, // Parent
      box: parentBox,
      depth: 0,
      ports: [],
    },
    {
      index: 1, // Child 1 (Source)
      box: child1Box,
      depth: 1,
      ports: [{ label: "out", x: 100, y: 40 }],
    },
    {
      index: 2, // Child 2 (Target)
      box: child2Box,
      depth: 1,
      ports: [{ label: "in", x: 0, y: 40 }],
    },
  ];

  it("prioritizes child component over parent container when hovering inside child", () => {
    // Point at (250, 90) is inside both Parent (index 0, depth 0) and Child 2 (index 2, depth 1)
    const target = findConnectTarget({ x: 250, y: 90 }, 1, candidates);
    expect(target).toEqual({ compIndex: 2, portLabel: null });
  });

  it("snaps to port when hovering near port handle of child", () => {
    // Child 2 port "in" is at world (200 + 0, 50 + 40) = (200, 90)
    const target = findConnectTarget({ x: 205, y: 92 }, 1, candidates);
    expect(target).toEqual({ compIndex: 2, portLabel: "in" });
  });

  it("targets parent only when hovering outside all children", () => {
    // Point at (350, 350) is inside Parent but outside both children
    const target = findConnectTarget({ x: 350, y: 350 }, 1, candidates);
    expect(target).toEqual({ compIndex: 0, portLabel: null });
  });

  it("returns null when hovering outside all nodes", () => {
    const target = findConnectTarget({ x: 500, y: 500 }, 1, candidates);
    expect(target).toBeNull();
  });
});
