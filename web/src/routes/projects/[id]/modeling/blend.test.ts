import { describe, expect, it } from "vitest";
import {
  advance,
  blendCamera,
  blendScenes,
  type Camera,
  easeOutCubic,
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
      nodes: [node("a", 100, 40, {
        box: { x: 100, y: 40, width: 200, height: 80, textAlign: "center" },
      })],
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
    expect(mid.nodes[0]?.box).toMatchObject({ x: 4, y: 8 });
    expect(mid.nodes[0]?.opacity).toBe(0.75);
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

  it("matches notes by text, in order when the text repeats", () => {
    const from = scene({
      notes: [
        {
          id: "n0",
          index: 0,
          text: "same",
          x: 0,
          y: 0,
          scale: 1,
          selected: false,
        },
        {
          id: "n1",
          index: 1,
          text: "same",
          x: 0,
          y: 10,
          scale: 1,
          selected: false,
        },
      ],
    });
    const to = scene({
      notes: [
        {
          id: "m0",
          index: 0,
          text: "same",
          x: 100,
          y: 0,
          scale: 1,
          selected: false,
        },
        {
          id: "m1",
          index: 1,
          text: "gone",
          x: 5,
          y: 5,
          scale: 1,
          selected: false,
        },
      ],
    });
    const mid = blendScenes(from, to, 0.5);
    const staying = mid.notes.find((note) => note.x === 50);
    const leaving = mid.notes.find((note) =>
      note.text === "same" && note.y === 10
    );
    const entering = mid.notes.find((note) => note.text === "gone");
    expect(staying?.opacity).toBe(1);
    expect(leaving?.opacity).toBe(0.5);
    expect(entering?.opacity).toBe(0.5);
    expect(entering).toMatchObject({ x: 5, y: 5 });
  });
});

describe("camera", () => {
  it("fits a diagram the way the modeling canvas zoom-to-fill does", () => {
    const fitted = fitCamera(
      { x: 0, y: 0, width: 200, height: 100 },
      { width: 400, height: 400 },
    );
    expect(fitted.zoom).toBeCloseTo(1.6);
    expect(fitted.x).toBeCloseTo(100 - 400 / 1.6 / 2);
    expect(fitted.y).toBeCloseTo(50 - 400 / 1.6 / 2);
  });

  it("lerps the camera", () => {
    expect(blendCamera(
      { x: 0, y: 0, zoom: 1 },
      { x: 100, y: 40, zoom: 2 },
      0.5,
    )).toEqual({ x: 50, y: 20, zoom: 1.5 });
  });

  it("bounds include notes as well as nodes", () => {
    const bounds = sceneBounds(scene({
      nodes: [node("a", 0, 0)],
      notes: [{
        id: "n",
        index: 0,
        text: "far",
        x: 500,
        y: 0,
        scale: 1,
        selected: false,
      }],
    }));
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

  it("eases rather than jumping halfway", () => {
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
  });
});
