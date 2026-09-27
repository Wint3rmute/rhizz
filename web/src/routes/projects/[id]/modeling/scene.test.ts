import { describe, expect, it } from "vitest";
import { buildEditorScene, buildReadOnlyScene, diagramEdgeId } from "./scene";

const box = (x: number, y: number) => ({
  x,
  y,
  width: 100,
  height: 60,
});

describe("buildReadOnlyScene", () => {
  const components = [
    { label: "root", icon: "microchip", color: "error" },
    { label: "mid", parent_component_index: 0 },
    { label: "leaf", parent_component_index: 1, border: "dashed" },
    { label: "unplaced" },
  ];

  it("omits components that are not placed, and boxes with no component", () => {
    const scene = buildReadOnlyScene({
      components,
      connections: [],
      boxes: {
        0: box(0, 0),
        2: { ...box(40, 40), textAlign: "top-left" },
        9: box(80, 80),
      },
    });

    expect(scene.nodes.map((node) => node.label)).toEqual(["root", "leaf"]);
    expect(scene.nodes.map((node) => node.id)).toEqual(["0", "2"]);
    expect(scene.nodes[0]).toMatchObject({
      index: 0,
      icon: "microchip",
      color: "error",
      selected: false,
      dimmed: false,
      reparentTarget: false,
      handles: "none",
      ports: [],
      box: { textAlign: "center" },
    });
    expect(scene.nodes[1]?.box.textAlign).toBe("top-left");
    expect(scene.nodes[1]?.border).toBe("dashed");
    expect(scene.nodes[1]?.parentIndex).toBe(1);
  });

  it("paints children after ancestors even when an intermediate parent is not placed", () => {
    const scene = buildReadOnlyScene({
      components,
      connections: [],
      boxes: {
        2: box(40, 40),
        0: box(0, 0),
      },
    });

    expect(scene.nodes.map((node) => node.label)).toEqual(["root", "leaf"]);
  });

  it("dims unlinked nodes only when the host asked for interactive dimming", () => {
    const input = {
      components: [{ label: "linked" }, { label: "plain" }],
      connections: [],
      boxes: { 0: box(0, 0), 1: box(20, 0) },
      selected: new Set([1]),
      linked: new Set([0]),
    };

    expect(
      buildReadOnlyScene(input).nodes.map((node) => node.dimmed),
    ).toEqual([false, false]);
    expect(
      buildReadOnlyScene({ ...input, dimUnlinked: true }).nodes.map((node) => ({
        label: node.label,
        selected: node.selected,
        dimmed: node.dimmed,
      })),
    ).toEqual([
      { label: "linked", selected: false, dimmed: false },
      { label: "plain", selected: true, dimmed: true },
    ]);
  });

  it("keeps logical edges and notes without treating them as selected", () => {
    const scene = buildReadOnlyScene({
      components: [{ label: "a" }, { label: "b" }],
      connections: [{ from: 0, to: 1, label: "bus", startSide: "right" }],
      boxes: { 0: box(0, 0) },
      annotations: [{ text: "hi", x: 4, y: 8 }, {
        text: "scaled",
        x: 1,
        y: 2,
        scale: 2,
      }],
    });

    expect(scene.edges).toEqual([{
      id: diagramEdgeId("bus", 0, 1),
      label: "bus",
      from: 0,
      to: 1,
      startSide: "right",
      selected: false,
    }]);
    expect(scene.notes).toEqual([
      {
        id: "note-0",
        index: 0,
        text: "hi",
        x: 4,
        y: 8,
        scale: 1,
        selected: false,
      },
      {
        id: "note-1",
        index: 1,
        text: "scaled",
        x: 1,
        y: 2,
        scale: 2,
        selected: false,
      },
    ]);
    expect(scene.overlays).toEqual([]);
  });
});

describe("buildEditorScene", () => {
  const nodes = [
    {
      id: "sys/a",
      index: 3,
      label: "a",
      box: box(0, 0),
      ports: [{ label: "out", role: "provider" as const, protocol: "spi" }],
    },
    {
      id: "sys/b",
      index: 4,
      label: "b",
      box: { ...box(200, 0), textAlign: "top-center" as const },
      parentIndex: 3,
    },
  ];

  it("preserves paint order and applies editor chrome from the host's sets", () => {
    const scene = buildEditorScene({
      nodes,
      edges: [{ label: "bus", from: 3, to: 4, endSide: "left" }],
      notes: [{ text: "keep", x: 1, y: 2 }],
      selectedNodeIndexes: new Set([4]),
      connectHandles: new Set([3]),
      selectedNoteIndexes: new Set([0]),
      reparentTargetIndex: 4,
      selectedEdgeLabel: "bus",
      marquee: { x: 1, y: 2, width: 3, height: 4 },
      rubberBand: { from: { x: 0, y: 0 }, to: { x: 8, y: 9 } },
    });

    expect(scene.nodes.map((node) => node.id)).toEqual(["sys/a", "sys/b"]);
    expect(scene.nodes[0]).toMatchObject({
      handles: "both",
      selected: false,
      reparentTarget: false,
      ports: [{ label: "out", role: "provider", protocol: "spi" }],
      box: { textAlign: "center" },
    });
    expect(scene.nodes[1]).toMatchObject({
      handles: "resize",
      selected: true,
      reparentTarget: true,
      parentIndex: 3,
      box: { textAlign: "top-center" },
    });
    expect(scene.edges[0]).toMatchObject({
      id: diagramEdgeId("bus", 3, 4),
      selected: true,
      endSide: "left",
    });
    expect(scene.notes[0]).toMatchObject({
      id: "note-0",
      index: 0,
      selected: true,
      scale: 1,
    });
    expect(scene.overlays).toEqual([
      { type: "marquee", box: { x: 1, y: 2, width: 3, height: 4 } },
      {
        type: "rubber-band",
        from: { x: 0, y: 0 },
        to: { x: 8, y: 9 },
        orientation: "horizontal",
      },
    ]);
  });

  it("shows connect handles on every node while a connection drag is active", () => {
    const scene = buildEditorScene({
      nodes,
      edges: [],
      notes: [],
      selectedNodeIndexes: new Set(),
      connectHandles: "all",
      selectedNoteIndexes: new Set(),
      reparentTargetIndex: null,
      selectedEdgeLabel: null,
    });

    expect(scene.nodes.map((node) => node.handles)).toEqual(["both", "both"]);
    expect(scene.overlays).toEqual([]);
  });
});
