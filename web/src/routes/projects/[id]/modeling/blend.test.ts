import { describe, expect, it } from "vitest";
import {
  advance,
  blendCamera,
  blendScenes,
  type Camera,
  easeInOutCubic,
  FIT_FRACTION,
  fitCamera,
  frameAt,
  sceneBounds,
  TRANSITION_MS,
} from "./blend";
import type { DiagramScene } from "./scene";

function node(
  id: string,
  x: number,
  y: number,
  extra: Partial<DiagramScene["nodes"][number]> = {},
): DiagramScene["nodes"][number] {
  return {
    id,
    index: extra.index ?? 0,
    label: extra.label ?? id,
    box: { x, y, width: 100, height: 40, textAlign: "center" },
    selected: false,
    dimmed: false,
    reparentTarget: false,
    ports: [],
    handles: "none",
    ...extra,
  };
}

function scene(partial: Partial<DiagramScene> = {}): DiagramScene {
  return {
    nodes: partial.nodes ?? [],
    edges: partial.edges ?? [],
    notes: partial.notes ?? [],
    overlays: partial.overlays ?? [],
  };
}

const camera: Camera = { x: 0, y: 0, zoom: 1 };

describe("blendScenes", () => {
  it("moves and resizes a node that exists in both scenes", () => {
    const from = scene({ nodes: [node("a", 0, 0)] });
    const to = scene({
      nodes: [
        node("a", 100, 40, {
          box: { x: 100, y: 40, width: 200, height: 80, textAlign: "center" },
        }),
      ],
    });
    const mid = blendScenes(from, to, 0.5);
    expect(mid.nodes).toHaveLength(1);
    expect(mid.nodes[0]?.box).toEqual({
      x: 50,
      y: 20,
      width: 150,
      height: 60,
      textAlign: "center",
    });
    expect(mid.nodes[0]?.opacity).toBe(1);
  });

  it("fades a new node in at its target box", () => {
    const mid = blendScenes(
      scene(),
      scene({ nodes: [node("new", 10, 20)] }),
      0.5,
    );
    expect(mid.nodes[0]?.box).toMatchObject({ x: 10, y: 20 });
    expect(mid.nodes[0]?.opacity).toBe(0.5);
  });

  it("fades a leaving node out at its last box", () => {
    const mid = blendScenes(
      scene({ nodes: [node("old", 4, 8)] }),
      scene(),
      0.25,
    );
    expect(mid.nodes).toHaveLength(1);
    expect(mid.nodes[0]?.opacity).toBeCloseTo(0.75);
  });

  it("keeps ports on matched nodes and lerps same-side offsets", () => {
    const from = scene({
      nodes: [
        node("a", 0, 0, {
          ports: [
            {
              label: "p",
              role: "provider",
              spot: { side: "right", offset: 0.2 },
            },
          ],
        }),
      ],
    });
    const to = scene({
      nodes: [
        node("a", 100, 40, {
          ports: [
            {
              label: "p",
              role: "provider",
              spot: { side: "right", offset: 0.8 },
            },
          ],
        }),
      ],
    });
    const mid = blendScenes(from, to, 0.5);
    expect(mid.nodes[0]?.ports).toEqual([
      { label: "p", role: "provider", spot: { side: "right", offset: 0.5 } },
    ]);
  });

  it("keeps shown ports shown mid-tween on matched nodes", () => {
    // homelab → laptop: the laptop node stays, its `visible` ports slide,
    // and the edges naming them leave. Dropping `visible` mid-tween made the
    // labels fade with the leaving edges and pop back in at t = 1.
    const port = (offset: number) => ({
      label: "wifi",
      role: "peer" as const,
      roleRaw: "peer",
      protocol: "data",
      spot: { side: "right" as const, offset },
      visible: true,
    });
    const from = scene({
      nodes: [node("laptop", 0, 0, { ports: [port(0.9)] })],
    });
    const to = scene({ nodes: [node("laptop", 0, 0, { ports: [port(0.8)] })] });
    const mid = blendScenes(from, to, 0.5);
    expect(mid.nodes[0]?.ports).toEqual([port(0.85)]);
  });

  it("drops the shown flag mid-tween when the target view hides the port", () => {
    const shown = { label: "p", role: "peer" as const, visible: true };
    const hidden = { label: "p", role: "peer" as const };
    const from = scene({ nodes: [node("a", 0, 0, { ports: [shown] })] });
    const to = scene({ nodes: [node("a", 0, 0, { ports: [hidden] })] });
    const mid = blendScenes(from, to, 0.5);
    expect(mid.nodes[0]?.ports[0]?.visible).toBeUndefined();
  });

  it("slides a port back to its role default on undo", () => {
    // Dragged right/0.8, undone to no-spot: the midpoint rides the outline
    // between the dragged dot and the provider default (right middle).
    const from = scene({
      nodes: [
        node("a", 0, 0, {
          ports: [
            {
              label: "p",
              role: "provider",
              spot: { side: "right", offset: 0.8 },
            },
          ],
        }),
      ],
    });
    const to = scene({
      nodes: [node("a", 0, 0, { ports: [{ label: "p", role: "provider" }] })],
    });
    const mid = blendScenes(from, to, 0.5);
    const spot = mid.nodes[0]?.ports[0]?.spot;
    expect(spot?.side).toBe("right");
    // Dragged y = 0.8 * 40 = 32, default y = 20 → midpoint 26 → offset 0.65.
    expect(spot?.offset).toBeCloseTo(0.65, 5);
  });

  it("slides a port along the outline when its side changes", () => {
    const from = scene({
      nodes: [
        node("a", 0, 0, {
          ports: [
            {
              label: "p",
              role: "peer",
              spot: { side: "left", offset: 0.5 },
            },
          ],
        }),
      ],
    });
    const to = scene({
      nodes: [
        node("a", 0, 0, {
          ports: [
            {
              label: "p",
              role: "peer",
              spot: { side: "right", offset: 0.5 },
            },
          ],
        }),
      ],
    });
    const mid = blendScenes(from, to, 0.5);
    // Straight-line midpoint (50, 20) projects onto the nearest side — the
    // dot travels the outline instead of cutting through the node.
    const spot = mid.nodes[0]?.ports[0]?.spot;
    expect(["top", "bottom"]).toContain(spot?.side);
  });

  it("keeps edge port refs so anchored routing survives the tween", () => {
    const edge = {
      id: "e:0:1",
      label: "e",
      from: 0,
      to: 1,
      fromPort: "p",
      toPort: "q",
      selected: false,
    };
    const nodes = [node("a", 0, 0), node("b", 200, 0)];
    const mid = blendScenes(
      scene({ nodes, edges: [edge] }),
      scene({ nodes, edges: [edge] }),
      0.5,
    );
    expect(mid.edges[0]).toMatchObject({ fromPort: "p", toPort: "q" });
  });

  it("paints an arriving container behind the children it already holds", () => {
    // Switching from a view without the parent (`main`) to one that places it
    // (`drone-overview`): the arriving container must not cover its children.
    const from = scene({
      nodes: [
        node("drone/fc", 100, 100, { index: 1, parentIndex: 0 }),
        node("drone/fc/mcu", 120, 120, { index: 2, parentIndex: 1 }),
      ],
    });
    const to = scene({
      nodes: [
        node("drone", 0, 0, { index: 0 }),
        node("drone/fc", 100, 100, { index: 1, parentIndex: 0 }),
      ],
    });
    const mid = blendScenes(from, to, 0.5);
    expect(mid.nodes.map((n) => n.id)).toEqual([
      "drone",
      "drone/fc",
      "drone/fc/mcu",
    ]);
  });

  it("hands a changed text alignment to the renderer to slide", () => {
    const from = scene({ nodes: [node("fc", 0, 0)] });
    const to = scene({
      nodes: [
        node("fc", 0, 0, {
          box: { x: 0, y: 0, width: 100, height: 40, textAlign: "top-left" },
        }),
      ],
    });
    const mid = blendScenes(from, to, 0.25);
    expect(mid.nodes[0]?.box.textAlign).toBe("top-left");
    expect(mid.nodes[0]?.labelTween).toEqual({ from: "center", t: 0.25 });
  });

  it("leaves the label alone when the alignment does not change", () => {
    const from = scene({ nodes: [node("fc", 0, 0)] });
    const to = scene({ nodes: [node("fc", 50, 0)] });
    expect(blendScenes(from, to, 0.5).nodes[0]?.labelTween).toBeUndefined();
  });

  it("returns the destination scene unchanged at t = 1", () => {
    const to = scene({
      nodes: [node("a", 1, 2, { selected: true, handles: "both" })],
    });
    expect(blendScenes(scene(), to, 1)).toBe(to);
  });

  it("strips selection chrome while a tween is in flight", () => {
    const mid = blendScenes(
      scene({
        nodes: [node("a", 0, 0, { selected: true, handles: "resize" })],
      }),
      scene({ nodes: [node("a", 10, 0, { selected: true, handles: "both" })] }),
      0.5,
    );
    expect(mid.nodes[0]?.selected).toBe(false);
    expect(mid.nodes[0]?.handles).toBe("none");
    expect(mid.overlays).toEqual([]);
  });

  it("fades every note out and in, even when both views use note-0", () => {
    const from = scene({
      notes: [
        {
          id: "note-0",
          index: 0,
          text: "old",
          x: 0,
          y: 0,
          scale: 1,
          selected: false,
        },
      ],
    });
    const to = scene({
      notes: [
        {
          id: "note-0",
          index: 0,
          text: "new",
          x: 40,
          y: 10,
          scale: 1,
          selected: false,
        },
      ],
    });
    const mid = blendScenes(from, to, 0.5);
    expect(mid.notes.map((note) => note.id)).toEqual([
      "out:note-0",
      "in:note-0",
    ]);
    expect(mid.notes[0]).toMatchObject({ text: "old", x: 0, opacity: 0.5 });
    expect(mid.notes[1]).toMatchObject({ text: "new", x: 40, opacity: 0.5 });
  });
});

describe("camera", () => {
  it("fits a diagram the way the modeling canvas zoom-to-fill does", () => {
    const fitted = fitCamera(
      { x: 0, y: 0, width: 200, height: 100 },
      { width: 400, height: 400 },
    );
    expect(fitted.zoom).toBeCloseTo(FIT_FRACTION * 2);
    expect(fitted.x).toBeCloseTo(100 - 400 / fitted.zoom / 2);
    expect(fitted.y).toBeCloseTo(50 - 400 / fitted.zoom / 2);
  });

  it("lerps the camera", () => {
    expect(
      blendCamera({ x: 0, y: 0, zoom: 1 }, { x: 100, y: 40, zoom: 2 }, 0.5),
    ).toEqual({ x: 50, y: 20, zoom: 1.5 });
  });

  it("bounds include notes as well as nodes", () => {
    const bounds = sceneBounds(
      scene({
        nodes: [node("a", 0, 0)],
        notes: [
          {
            id: "n",
            index: 0,
            text: "far",
            x: 500,
            y: 0,
            scale: 1,
            selected: false,
          },
        ],
      }),
    );
    expect(bounds?.x).toBeLessThanOrEqual(0);
    expect(bounds?.width).toBeGreaterThan(400);
  });
});

describe("advance", () => {
  const from = scene({ nodes: [node("a", 0, 0)] });
  const to = scene({ nodes: [node("a", 0, 100)] });

  it("cuts immediately when reduced motion is on", () => {
    const next = advance(
      { scene: from, camera },
      { scene: to, camera: { x: 10, y: 0, zoom: 1 } },
      {
        transition: true,
        moveCamera: true,
        reducedMotion: true,
        now: 0,
        tween: null,
      },
    );
    expect(next.scene).toBe(to);
    expect(next.camera).toEqual({ x: 10, y: 0, zoom: 1 });
    expect(next.settling).toBe(false);
    expect(next.tween).toBeNull();
  });

  it("does not move the camera when asked not to", () => {
    const next = advance(
      { scene: from, camera: { x: 5, y: 6, zoom: 1 } },
      { scene: to, camera: { x: 90, y: 0, zoom: 2 } },
      {
        transition: false,
        moveCamera: false,
        reducedMotion: false,
        now: 0,
        tween: null,
      },
    );
    expect(next.camera).toEqual({ x: 5, y: 6, zoom: 1 });
  });

  it("retargets an in-flight tween from the current frame", () => {
    const started = advance(
      { scene: from, camera },
      { scene: to, camera },
      {
        transition: true,
        moveCamera: false,
        reducedMotion: false,
        now: 0,
        tween: null,
      },
    );
    const tween = started.tween;
    if (!tween) throw new Error("expected a tween to be in flight");
    const mid = frameAt(tween, TRANSITION_MS / 2);
    const third = scene({ nodes: [node("a", 0, 80)] });
    const retargeted = advance(
      { scene: mid.scene, camera: mid.camera },
      { scene: third, camera },
      {
        transition: true,
        moveCamera: false,
        reducedMotion: false,
        now: 500,
        tween,
      },
    );
    expect(retargeted.tween?.fromScene.nodes[0]?.box.y).toBeGreaterThan(0);
    expect(retargeted.tween?.toScene).toBe(third);
    expect(retargeted.tween?.startedAt).toBe(500);
  });

  it("eases in and out: slow at both ends, symmetric around the middle", () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBe(0.5);
    // Gentle start and gentle finish, rather than an abrupt one.
    expect(easeInOutCubic(0.1)).toBeLessThan(0.1);
    expect(easeInOutCubic(0.9)).toBeGreaterThan(0.9);
    expect(easeInOutCubic(0.25) + easeInOutCubic(0.75)).toBeCloseTo(1);
    // Out-of-range progress clamps instead of overshooting.
    expect(easeInOutCubic(-1)).toBe(0);
    expect(easeInOutCubic(2)).toBe(1);
  });

  it("starts a tween slowly instead of jumping ahead", () => {
    const started = advance(
      { scene: from, camera },
      { scene: to, camera },
      {
        transition: true,
        moveCamera: false,
        reducedMotion: false,
        now: 0,
        tween: null,
        durationMs: 1000,
      },
    );
    if (!started.tween) throw new Error("expected a tween to be in flight");
    const early = frameAt(started.tween, 100).scene.nodes[0]?.box.y ?? 0;
    const fromY = from.nodes[0]?.box.y ?? 0;
    const toY = to.nodes[0]?.box.y ?? 0;
    // 10% of the time in covers less than 10% of the distance.
    expect(Math.abs(early - fromY)).toBeLessThan(Math.abs(toY - fromY) * 0.1);
  });

  it("uses a custom duration when provided", () => {
    const next = advance(
      { scene: from, camera },
      { scene: to, camera },
      {
        transition: true,
        moveCamera: false,
        reducedMotion: false,
        now: 0,
        tween: null,
        durationMs: 1200,
      },
    );
    expect(next.tween?.duration).toBe(1200);
  });

  it("cuts immediately when the duration is zero", () => {
    const next = advance(
      { scene: from, camera },
      { scene: to, camera: { x: 10, y: 0, zoom: 1 } },
      {
        transition: true,
        moveCamera: true,
        reducedMotion: false,
        now: 0,
        tween: null,
        durationMs: 0,
      },
    );
    expect(next.scene).toBe(to);
    expect(next.settling).toBe(false);
    expect(next.tween).toBeNull();
  });
});
