import type { Meta, StoryObj } from "@storybook/svelte";
import { expect } from "storybook/test";
import DiagramCanvasHost from "./DiagramCanvasHost.svelte";
import {
  computeDirectionalHandles,
  computePortPositions,
  computeResizeHandles,
  computeVisibleConnections,
  elbowPath,
} from "./geometry";
import { buildReadOnlyScene, type DiagramScene } from "./scene";

// Contract for the shared canvas: editor chrome (handles, marquee, rubber-band,
// selected edge) and the read-only link DOM. Asserted in the play function
// rather than a screenshot — the rubber-band pulses, and the interesting
// question is whether the path `d` is the same elbow the geometry module emits.
const meta = {
  title: "Diagrams/DiagramCanvas",
  component: DiagramCanvasHost,
  tags: ["no-vrt"],
} satisfies Meta<typeof DiagramCanvasHost>;

export default meta;

type Story = StoryObj<typeof meta>;

const editorScene: DiagramScene = {
  nodes: [
    {
      id: "sys/a",
      index: 0,
      label: "Ingest",
      box: { x: 0, y: 0, width: 100, height: 60, textAlign: "center" },
      selected: false,
      dimmed: false,
      reparentTarget: false,
      ports: [{ label: "out", role: "provider" }],
      handles: "both",
    },
    {
      id: "sys/b",
      index: 1,
      label: "Worker",
      box: { x: 200, y: 0, width: 100, height: 60, textAlign: "center" },
      selected: true,
      dimmed: false,
      reparentTarget: true,
      ports: [],
      handles: "resize",
    },
  ],
  edges: [{
    id: "wire:0:1",
    label: "wire",
    from: 0,
    to: 1,
    selected: true,
  }],
  notes: [{
    id: "note-0",
    index: 0,
    text: "hello",
    x: 10,
    y: 90,
    scale: 1,
    selected: true,
  }],
  overlays: [
    { type: "marquee", box: { x: 5, y: 5, width: 40, height: 20 } },
    {
      type: "rubber-band",
      from: { x: 0, y: 0 },
      to: { x: 50, y: 10 },
      orientation: "horizontal",
    },
  ],
};

export const EditorChrome: Story = {
  args: { scene: editorScene },
  play: async ({ canvasElement }) => {
    const visible = computeVisibleConnections(
      editorScene.edges,
      (index) => editorScene.nodes.find((node) => node.index === index)?.box,
    );
    const edge = visible[0];
    if (!edge) throw new Error("expected a visible edge");
    const selectedPath = canvasElement.querySelector(
      'path[marker-end="url(#arrow-selected)"]',
    );
    await expect(selectedPath?.getAttribute("d")).toBe(
      elbowPath(edge.a.x, edge.a.y, edge.b.x, edge.b.y, edge.orientation),
    );

    const rubber = canvasElement.querySelector(
      "[data-testid='diagram-rubber-band']",
    );
    await expect(rubber?.getAttribute("d")).toBe(
      elbowPath(0, 0, 50, 10, "horizontal"),
    );
    await expect(rubber?.getAttribute("marker-end")).toBe("url(#arrow)");

    const marquee = canvasElement.querySelector(
      "[data-testid='diagram-marquee']",
    );
    await expect(marquee?.getAttribute("width")).toBe("40");

    const ports = canvasElement.querySelectorAll(
      "[data-testid='diagram-port']",
    );
    await expect(ports.length).toBe(1);
    const expectedPort = computePortPositions(100, 60, [{
      label: "out",
      role: "provider",
    }])[0];
    if (!expectedPort) throw new Error("expected a port position");
    await expect(ports[0]?.getAttribute("transform")).toBe(
      `translate(${String(expectedPort.x)}, ${String(expectedPort.y)})`,
    );
    await expect(ports[0]?.querySelector("title")?.textContent).toBe(
      "out (provider, untyped)",
    );

    const side = computeDirectionalHandles(100, 60)[0];
    if (!side) throw new Error("expected a side handle");
    const sideHandles = canvasElement.querySelectorAll(
      "[data-testid='diagram-side-handle']",
    );
    await expect(sideHandles.length).toBe(4);
    await expect(sideHandles[0]?.getAttribute("transform")).toBe(
      `translate(${String(side.x)}, ${String(side.y)})`,
    );

    const resize = computeResizeHandles(100, 60, 10, 6)[0];
    if (!resize) throw new Error("expected a resize handle");
    const resizeHandles = canvasElement.querySelectorAll(
      "[data-testid='diagram-resize-handle']",
    );
    await expect(resizeHandles.length).toBe(16);
    await expect(resizeHandles[0]?.getAttribute("x")).toBe(String(resize.x));

    await expect(
      canvasElement.querySelectorAll("[data-testid='diagram-reparent-target']")
        .length,
    ).toBe(1);
    await expect(
      canvasElement.querySelector("[data-testid='diagram-note-frame']"),
    )
      .toBeTruthy();
    await expect(canvasElement.textContent).toContain("hello");
  },
};

const readOnlyScene = buildReadOnlyScene({
  components: [
    { label: "goggles" },
    { label: "radio", parent_component_index: 0 },
    { label: "unplaced" },
  ],
  connections: [],
  boxes: {
    0: { x: 0, y: 0, width: 80, height: 40 },
    1: { x: 120, y: 10, width: 80, height: 40 },
  },
  linked: new Set([1]),
  dimUnlinked: true,
});

export const ReadOnlyLinks: Story = {
  args: {
    scene: readOnlyScene,
    linkNodes: true,
    onNodeClick: () => {},
  },
  play: async ({ canvasElement }) => {
    const bodies = canvasElement.querySelectorAll("a > g > g");
    await expect(bodies.length).toBe(2);

    const links = canvasElement.querySelectorAll("a");
    await expect(links[0]?.getAttribute("aria-label")).toBe(
      "goggles, no detailed view",
    );
    await expect(links[1]?.getAttribute("aria-label")).toBe(
      "radio, open detailed view",
    );
    await expect(links[0]?.querySelector("g")?.classList.contains("opacity-90"))
      .toBe(true);
    await expect(links[1]?.querySelector("g")?.classList.contains("opacity-90"))
      .toBe(false);
  },
};
