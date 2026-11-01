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
  edges: [
    {
      id: "wire:0:1",
      label: "wire",
      from: 0,
      to: 1,
      fromPort: "out",
      selected: true,
    },
  ],
  notes: [
    {
      id: "note-0",
      index: 0,
      text: "hello",
      x: 10,
      y: 90,
      scale: 1,
      selected: true,
    },
  ],
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
  args: { scene: editorScene, onPortPointerDown: () => {} },
  play: async ({ canvasElement }) => {
    const visible = computeVisibleConnections(
      editorScene.edges,
      (index) => editorScene.nodes.find((node) => node.index === index)?.box,
    );
    const edge = visible[0];
    if (!edge) throw new Error("expected a visible edge");
    // The arrowhead is a polygon in the edge group, not an SVG marker, so it
    // fades with the line. The selected edge is the primary stroke.
    const selectedEdge = canvasElement.querySelector(
      "[data-testid='diagram-edge']",
    );
    const selectedPath = selectedEdge?.querySelector(
      'path[stroke-width="2.5"]',
    );
    await expect(selectedPath?.getAttribute("d")).toBe(
      elbowPath(edge.a.x, edge.a.y, edge.b.x, edge.b.y, edge.orientation),
    );
    await expect(
      selectedEdge?.querySelector("polygon")?.getAttribute("fill"),
    ).toBe("var(--color-primary)");

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
    const expectedPort = computePortPositions(100, 60, [
      {
        label: "out",
        role: "provider",
      },
    ])[0];
    if (!expectedPort) throw new Error("expected a port position");
    await expect(ports[0]?.getAttribute("transform")).toBe(
      `translate(${String(expectedPort.x)}, ${String(expectedPort.y)})`,
    );
    await expect(ports[0]?.querySelector("title")?.textContent).toBe(
      "out (provider, untyped) — drag to move, Alt+drag to connect",
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
    ).toBeTruthy();
    await expect(canvasElement.textContent).toContain("hello");
  },
};

// Routing cases: a right-edge port into a top-edge port takes one knee;
// same-axis ports keep the double knee. Both pin the path to the dots and
// point the arrowhead along the arrival axis.
const kneeScene = (toSpot: {
  side: "top" | "left";
  offset: number;
}): DiagramScene => ({
  nodes: [
    {
      id: "sys/a",
      index: 0,
      label: "A",
      box: { x: 0, y: 0, width: 100, height: 60, textAlign: "center" },
      selected: false,
      dimmed: false,
      reparentTarget: false,
      ports: [
        {
          label: "out",
          role: "provider",
          spot: { side: "right", offset: 0.5 },
        },
      ],
      handles: "none",
    },
    {
      id: "sys/b",
      index: 1,
      label: "B",
      box: { x: 200, y: 200, width: 100, height: 60, textAlign: "center" },
      selected: false,
      dimmed: false,
      reparentTarget: false,
      ports: [{ label: "in", role: "consumer", spot: toSpot }],
      handles: "none",
    },
  ],
  edges: [
    {
      id: "wire:0:1",
      label: "wire",
      from: 0,
      to: 1,
      fromPort: "out",
      toPort: "in",
      selected: false,
    },
  ],
  notes: [],
  overlays: [],
});

export const SingleKnee: Story = {
  args: { scene: kneeScene({ side: "top", offset: 0.5 }) },
  play: async ({ canvasElement }) => {
    // Dots at (100, 30) and (250, 200): leave horizontal, arrive vertical.
    // Corner (250, 30) clears both boxes, so one knee suffices.
    const edge = canvasElement.querySelector("[data-testid='diagram-edge']");
    const path = edge?.querySelector("path:not([stroke='transparent'])");
    await expect(path?.getAttribute("d")).toBe(
      elbowPath(100, 30, 250, 200, "horizontal", 10, "vertical"),
    );
    // Arrowhead arrives pointing down into the top-edge dot.
    await expect(edge?.querySelector("polygon")?.getAttribute("points")).toBe(
      "250,200 247,192 253,192",
    );
  },
};

export const DoubleKnee: Story = {
  args: { scene: kneeScene({ side: "left", offset: 0.75 }) },
  play: async ({ canvasElement }) => {
    // Dots at (100, 30) and (200, 245): same axis, offset — H-V-H jog.
    const edge = canvasElement.querySelector("[data-testid='diagram-edge']");
    const path = edge?.querySelector("path:not([stroke='transparent'])");
    await expect(path?.getAttribute("d")).toBe(
      elbowPath(100, 30, 200, 245, "horizontal", 10, "horizontal"),
    );
    // Arrowhead arrives pointing right into the left-edge dot.
    await expect(edge?.querySelector("polygon")?.getAttribute("points")).toBe(
      "200,245 192,248 192,242",
    );
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
  portsByIndex: {},
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
    await expect(
      links[0]?.querySelector("g")?.classList.contains("opacity-90"),
    ).toBe(true);
    await expect(
      links[1]?.querySelector("g")?.classList.contains("opacity-90"),
    ).toBe(false);
  },
};

// Dots are selection-gated: labels show for drawn edges, dots only when selected.
const dotScene = (opts: {
  selectNode: boolean;
  selectEdge: boolean;
}): DiagramScene => ({
  nodes: [
    {
      id: "sys/a",
      index: 0,
      label: "A",
      box: { x: 0, y: 0, width: 100, height: 60, textAlign: "center" },
      selected: opts.selectNode,
      dimmed: false,
      reparentTarget: false,
      ports: [{ label: "out", role: "provider" }],
      handles: "none",
    },
    {
      id: "sys/b",
      index: 1,
      label: "B",
      box: { x: 200, y: 0, width: 100, height: 60, textAlign: "center" },
      selected: false,
      dimmed: false,
      reparentTarget: false,
      ports: [{ label: "in", role: "consumer" }],
      handles: "none",
    },
  ],
  edges: [
    {
      id: "wire:0:1",
      label: "wire",
      from: 0,
      to: 1,
      fromPort: "out",
      toPort: "in",
      selected: opts.selectEdge,
    },
  ],
  notes: [],
  overlays: [],
});

export const DotsHiddenWhenNothingSelected: Story = {
  args: {
    scene: dotScene({ selectNode: false, selectEdge: false }),
    onPortPointerDown: () => {},
  },
  play: async ({ canvasElement }) => {
    const ports = canvasElement.querySelectorAll("[data-testid=diagram-port]");
    await expect(ports.length).toBe(2);
    await expect(canvasElement.textContent).toContain("out");
    await expect(canvasElement.textContent).toContain("in");
    await expect(
      canvasElement.querySelectorAll("[data-testid=diagram-port] circle")
        .length,
    ).toBe(0);
  },
};

export const DotsShownWhenNodeSelected: Story = {
  args: {
    scene: dotScene({ selectNode: true, selectEdge: false }),
    onPortPointerDown: () => {},
  },
  play: async ({ canvasElement }) => {
    const ports = canvasElement.querySelectorAll("[data-testid=diagram-port]");
    await expect(ports.length).toBe(2);
    await expect(
      canvasElement.querySelectorAll("[data-testid=diagram-port] circle")
        .length,
    ).toBe(2);
  },
};

export const DotsShownWhenEdgeSelected: Story = {
  args: {
    scene: dotScene({ selectNode: false, selectEdge: true }),
    onPortPointerDown: () => {},
  },
  play: async ({ canvasElement }) => {
    const ports = canvasElement.querySelectorAll("[data-testid=diagram-port]");
    await expect(ports.length).toBe(2);
    await expect(
      canvasElement.querySelectorAll("[data-testid=diagram-port] circle")
        .length,
    ).toBe(4);
  },
};
