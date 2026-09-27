import { describe, expect, it } from "vitest";
import {
  buildDiagramScene,
  descendantsOf,
  pickConnectionTarget,
  pickReparentTarget,
  queryRect,
  type SceneComponentInput,
} from "./diagramScene";

// A parent (`drone`) with two children. Components are keyed by the stable
// qualified path, never by arena index — the scene must not need a
// key -> index map in order to exist.
const DRONE: SceneComponentInput = {
  key: "drone",
  label: "drone",
  ports: [{ label: "motor-out", role: "provider", protocol: "dshot" }],
};
const ROTOR: SceneComponentInput = {
  key: "drone/rotor",
  label: "rotor",
  parentKey: "drone",
  ports: [{ label: "motor-in", role: "consumer" }],
};
const IMU: SceneComponentInput = {
  key: "drone/imu",
  label: "imu",
  parentKey: "drone",
};

// rotor (20,20 60x40) and imu (120,20 60x40) both sit inside drone (0,0 200x100).
const BOXES = {
  drone: { x: 0, y: 0, width: 200, height: 100 },
  "drone/rotor": { x: 20, y: 20, width: 60, height: 40 },
  "drone/imu": { x: 120, y: 20, width: 60, height: 40 },
};

function scene(over: Partial<Parameters<typeof buildDiagramScene>[0]> = {}) {
  return buildDiagramScene({
    components: [DRONE, ROTOR, IMU],
    connections: [],
    boxes: BOXES,
    ...over,
  });
}

describe("buildDiagramScene — nodes", () => {
  it("keeps only components that have a box", () => {
    expect(scene().nodes.map((n) => n.key)).toEqual([
      "drone",
      "drone/rotor",
      "drone/imu",
    ]);
  });

  it("omits components with no box", () => {
    const s = scene({
      components: [DRONE, ROTOR, IMU, { key: "ghost", label: "ghost" }],
    });
    expect(s.nodes.map((n) => n.key)).not.toContain("ghost");
  });

  it("orders parents before children regardless of box insertion order", () => {
    const s = scene({
      boxes: {
        "drone/rotor": { x: 0, y: 0 },
        "drone/imu": { x: 100, y: 0 },
        drone: { x: 0, y: 200 },
      },
    });
    expect(s.nodes.map((n) => n.key)).toEqual([
      "drone",
      "drone/rotor",
      "drone/imu",
    ]);
  });

  it("is stable at equal depth (box insertion order wins)", () => {
    const s = scene({
      boxes: {
        "drone/imu": { x: 100, y: 0 },
        "drone/rotor": { x: 0, y: 0 },
        drone: { x: 0, y: 200 },
      },
    });
    expect(s.nodes.map((n) => n.key)).toEqual([
      "drone",
      "drone/imu",
      "drone/rotor",
    ]);
  });

  it("applies size and text-align defaults exactly once", () => {
    const s = buildDiagramScene({
      components: [{ key: "x", label: "x" }],
      connections: [],
      boxes: { x: { x: 5, y: 6 } },
    });
    expect(s.nodes[0]?.box).toEqual({
      x: 5,
      y: 6,
      width: 100,
      height: 100,
      textAlign: "center",
    });
  });

  it("honours explicit per-node size and text align over the defaults", () => {
    const s = buildDiagramScene({
      components: [{ key: "x", label: "x" }],
      connections: [],
      boxes: {
        x: { x: 0, y: 0, width: 42, height: 43, textAlign: "top-left" },
      },
    });
    expect(s.nodes[0]?.box).toEqual({
      x: 0,
      y: 0,
      width: 42,
      height: 43,
      textAlign: "top-left",
    });
  });

  it("computes depth from parent keys", () => {
    const s = scene();
    expect(s.byKey.get("drone")?.depth).toBe(0);
    expect(s.byKey.get("drone/rotor")?.depth).toBe(1);
  });

  it("precomputes port positions in node-local coordinates", () => {
    // rotor is 60x40 with a single consumer port: left border, vertical middle.
    const rotor = scene().byKey.get("drone/rotor");
    expect(rotor?.ports).toEqual([
      { label: "motor-in", role: "consumer", x: 0, y: 20 },
    ]);
  });

  it("gives a node with no ports an empty list, not undefined", () => {
    expect(scene().byKey.get("drone/imu")?.ports).toEqual([]);
  });

  it("filters by the include predicate", () => {
    const s = scene({ include: (key) => key === "drone" });
    expect(s.nodes.map((n) => n.key)).toEqual(["drone"]);
  });
});

describe("buildDiagramScene — edges", () => {
  it("routes each edge to an SVG path so hosts never re-derive it", () => {
    const s = scene({
      connections: [{
        label: "bus",
        fromKey: "drone/rotor",
        toKey: "drone/imu",
      }],
    });
    expect(s.edges[0]?.d).toMatch(/^M /);
  });

  it("drops edges whose endpoints are unplaced or filtered out", () => {
    const s = scene({
      connections: [
        { label: "kept", fromKey: "drone/rotor", toKey: "drone/imu" },
        { label: "dangling", fromKey: "drone/rotor", toKey: "nope" },
      ],
    });
    expect(s.edges.map((e) => e.label)).toEqual(["kept"]);
  });

  it("drops edges with an endpoint excluded by the include predicate", () => {
    const s = scene({
      include: (key) => key !== "drone/imu",
      connections: [{
        label: "bus",
        fromKey: "drone/rotor",
        toKey: "drone/imu",
      }],
    });
    expect(s.edges).toEqual([]);
  });

  it("keeps a self-edge (the compiler decides that, not the renderer)", () => {
    const s = scene({
      connections: [{
        label: "loop",
        fromKey: "drone/rotor",
        toKey: "drone/rotor",
      }],
    });
    expect(s.edges.map((e) => e.label)).toEqual(["loop"]);
  });

  it("resolves endpoints to the sides the old host code would have picked", () => {
    const s = scene({
      connections: [
        {
          label: "bus",
          fromKey: "drone/rotor",
          toKey: "drone/imu",
          startSide: "right",
        },
      ],
    });
    // rotor right edge = (20+60, 20+20) = (80, 40).
    // imu is to the right, so its left edge = (120, 40).
    expect(s.edges[0]?.a).toEqual({ x: 80, y: 40 });
    expect(s.edges[0]?.b).toEqual({ x: 120, y: 40 });
    expect(s.edges[0]?.orientation).toBe("horizontal");
  });
});

describe("buildDiagramScene — annotations and bounds", () => {
  it("carries annotations through with precomputed bounds", () => {
    const s = scene({ annotations: [{ text: "hi", x: 10, y: 20, scale: 2 }] });
    expect(s.annotations).toHaveLength(1);
    expect(s.annotations[0]?.scale).toBe(2);
    expect(s.annotations[0]?.bounds.width).toBeGreaterThan(0);
  });

  it("defaults an annotation scale to 1", () => {
    const s = scene({ annotations: [{ text: "hi", x: 0, y: 0 }] });
    expect(s.annotations[0]?.scale).toBe(1);
  });

  it("computes bounds over nodes and annotations together", () => {
    const s = scene({ annotations: [{ text: "far", x: 900, y: 900 }] });
    const bounds = s.bounds;
    expect(bounds?.x).toBe(0);
    expect(bounds?.y).toBe(0);
    // The far annotation must widen the bounds — zoom-to-fill depends on it.
    expect(bounds && bounds.x + bounds.width).toBeGreaterThan(900);
  });

  it("returns null bounds for an empty scene", () => {
    expect(
      buildDiagramScene({ components: [], connections: [], boxes: {} }).bounds,
    )
      .toBeNull();
  });
});

describe("queryRect", () => {
  it("returns nodes fully enclosed by the rect", () => {
    // rotor fits in (0,0 100x100); imu starts at x=120 and does not.
    expect(queryRect(scene(), { x: 0, y: 0, width: 100, height: 100 }).nodes)
      .toEqual(["drone/rotor"]);
  });

  it("does not include a node that merely overlaps", () => {
    expect(queryRect(scene(), { x: 0, y: 0, width: 25, height: 25 }).nodes)
      .toEqual([]);
  });

  it("returns the indices of enclosed annotations", () => {
    // An annotation's box sits *above* its anchor (see annotationBounds), so
    // an anchor at y=50 yields bounds starting at y=34 — inside the rect.
    const s = scene({
      annotations: [{ text: "a", x: 50, y: 50 }, { text: "b", x: 800, y: 800 }],
    });
    expect(queryRect(s, { x: 0, y: 0, width: 200, height: 200 }).annotations)
      .toEqual([0]);
  });
});

describe("pickConnectionTarget", () => {
  it("snaps to a port within the snap radius", () => {
    expect(pickConnectionTarget(scene(), { x: 21, y: 40 }, "drone", 15))
      .toEqual({
        key: "drone/rotor",
        port: "motor-in",
      });
  });

  it("falls back to the containing node when no port is near", () => {
    expect(pickConnectionTarget(scene(), { x: 45, y: 30 }, "drone", 15))
      .toEqual({
        key: "drone/rotor",
        port: null,
      });
  });

  it("returns null outside every node", () => {
    expect(pickConnectionTarget(scene(), { x: 900, y: 900 }, "drone", 15))
      .toBeNull();
  });

  it("never returns the source node", () => {
    expect(pickConnectionTarget(scene(), { x: 100, y: 50 }, "drone", 15))
      .toBeNull();
  });

  it("prefers the deepest node when boxes are nested", () => {
    // (45,30) is inside both drone and drone/rotor.
    expect(
      pickConnectionTarget(scene(), { x: 45, y: 30 }, "drone/imu", 15)?.key,
    )
      .toBe("drone/rotor");
  });
});

describe("pickReparentTarget", () => {
  it("returns the deepest container holding the dragged centre", () => {
    // centre (35,35) is inside both drone and drone/rotor.
    const hit = pickReparentTarget(scene(), {
      x: 30,
      y: 30,
      width: 10,
      height: 10,
    });
    expect(hit).toBe("drone/rotor");
  });

  it("returns the parent when the centre is outside every child", () => {
    expect(pickReparentTarget(scene(), { x: 190, y: 90, width: 5, height: 5 }))
      .toBe("drone");
  });

  it("returns null when the centre is in no box", () => {
    expect(
      pickReparentTarget(scene(), { x: 900, y: 900, width: 5, height: 5 }),
    ).toBeNull();
  });

  it("skips explicitly excluded keys", () => {
    const hit = pickReparentTarget(
      scene(),
      { x: 30, y: 30, width: 10, height: 10 },
      { exclude: ["drone/rotor"] },
    );
    expect(hit).toBe("drone");
  });

  it("never targets a descendant of the node being dragged", () => {
    // Dragging `drone` must not make `drone/rotor` its own parent.
    const hit = pickReparentTarget(
      scene(),
      { x: 30, y: 30, width: 10, height: 10 },
      { dragKey: "drone" },
    );
    expect(hit).toBeNull();
  });

  it("never targets a leaf — an atomic component cannot contain a child", () => {
    const s = buildDiagramScene({
      components: [
        { key: "box", label: "box" },
        { key: "box/inner", label: "inner", parentKey: "box", leaf: true },
      ],
      connections: [],
      boxes: {
        box: { x: 0, y: 0, width: 100, height: 100 },
        "box/inner": { x: 40, y: 40, width: 20, height: 20 },
      },
    });
    // (50,50) is inside both box and its leaf child; the leaf is not eligible.
    expect(
      pickReparentTarget(s, { x: 45, y: 45, width: 10, height: 10 }, {
        dragKey: "drone",
      }),
    ).toBe("box");
  });
});

describe("descendantsOf", () => {
  it("returns every transitive descendant, not just direct children", () => {
    const s = buildDiagramScene({
      components: [
        { key: "a", label: "a" },
        { key: "a/b", label: "b", parentKey: "a" },
        { key: "a/b/c", label: "c", parentKey: "a/b" },
        { key: "x", label: "x" },
      ],
      connections: [],
      boxes: {
        a: { x: 0, y: 0 },
        "a/b": { x: 0, y: 0 },
        "a/b/c": { x: 0, y: 0 },
        x: { x: 0, y: 0 },
      },
    });
    expect(descendantsOf(s, "a").sort()).toEqual(["a/b", "a/b/c"]);
  });

  it("returns an empty list for a leaf", () => {
    expect(descendantsOf(scene(), "drone/rotor")).toEqual([]);
  });

  it("returns an empty list for an unknown key", () => {
    expect(descendantsOf(scene(), "nope")).toEqual([]);
  });
});
