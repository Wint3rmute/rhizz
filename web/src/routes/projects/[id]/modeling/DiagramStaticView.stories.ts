import type { Meta, StoryObj } from "@storybook/svelte";
import { expect, within } from "storybook/test";
import DiagramStaticView from "./DiagramStaticView.svelte";
import { elbowPath, nodeLabelLayout } from "./geometry";
import type {
  DiagramStaticBox,
  DiagramStaticComponent,
  DiagramStaticConnection,
} from "./types";

// Renders "fullscreen" so the auto-fit viewBox has real room to work
// with, matching how the real canvas fills its own flex-1 column.
const meta = {
  title: "Diagrams/DiagramStaticView",
  component: DiagramStaticView,
  parameters: {
    layout: "fullscreen",
  },
  args: {
    portsByIndex: {},
  },
} satisfies Meta<typeof DiagramStaticView>;

export default meta;

type Story = StoryObj<typeof meta>;

// A small, flat pipeline: three top-level components, two connections.
// No WASM/compile_system involved — this is exactly the plain-object
// shape ComponentJS/ConnectionJS instances already satisfy, hand-written
// here instead.
const pipelineComponents: DiagramStaticComponent[] = [
  { label: "Ingest API" },
  { label: "Message Queue" },
  { label: "Worker" },
];
const pipelineConnections: DiagramStaticConnection[] = [
  { from: 0, to: 1, label: "publish" },
  { from: 1, to: 2, label: "consume" },
];
const pipelineBoxes: Record<number, DiagramStaticBox> = {
  0: { x: 0, y: 40, width: 140, height: 80 },
  1: { x: 220, y: 40, width: 140, height: 80 },
  2: { x: 440, y: 40, width: 140, height: 80 },
};

export const Pipeline: Story = {
  args: {
    components: pipelineComponents,
    connections: pipelineConnections,
    boxes: pipelineBoxes,
  },
};

// Same pipeline as `Pipeline`, but with a single node selected — exercising
// the selection outline drawn on top of the node's own border.
export const SingleSelected: Story = {
  args: {
    components: pipelineComponents,
    connections: pipelineConnections,
    boxes: pipelineBoxes,
    selected: new Set([1]),
  },
};

// A nested composite: "Drone" contains "Flight Controller" and "Motor",
// which are drawn on top of (rendered after) their parent thanks to
// DiagramStaticView's depth-based render order — exercising
// `parent_component_index` without any WASM-resolved model behind it.
const nestedComponents: DiagramStaticComponent[] = [
  { label: "Drone" },
  { label: "Flight Controller", parent_component_index: 0 },
  { label: "Motor", parent_component_index: 0 },
  { label: "Ground Station" },
];
const nestedConnections: DiagramStaticConnection[] = [
  { from: 1, to: 2, label: "PWM" },
  { from: 3, to: 1, label: "telemetry" },
];
const nestedBoxes: Record<number, DiagramStaticBox> = {
  0: { x: 0, y: 0, width: 320, height: 220, textAlign: "top-left" },
  1: { x: 30, y: 50, width: 120, height: 70 },
  2: { x: 180, y: 50, width: 100, height: 70 },
  3: { x: 420, y: 90, width: 140, height: 80 },
};

export const NestedComponents: Story = {
  args: {
    components: nestedComponents,
    connections: nestedConnections,
    boxes: nestedBoxes,
  },
};

// No component is placed on the canvas yet — the viewBox falls back to a
// fixed default instead of collapsing/erroring on an empty bounding box.
export const Empty: Story = {
  args: {
    components: pipelineComponents,
    connections: pipelineConnections,
    boxes: {},
  },
};

// The pipeline with free-standing view annotations rendered at absolute
// canvas positions — including a multi-line annotation (newline in text)
// and a Markdown-styled one (**bold** and `code` runs). Each Markdown line
// is its own outer <tspan>; styled runs nest one level deeper, so the two
// lines share a grandparent <text>.
export const WithAnnotations: Story = {
  args: {
    components: pipelineComponents,
    connections: pipelineConnections,
    boxes: pipelineBoxes,
    annotations: [
      { text: "Ingest path", x: 10, y: 10 },
      { text: "Processed here\n(2 workers)", x: 230, y: 140 },
      { text: "**Note** on `queue`", x: 200, y: 190 },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // The multi-line annotation renders one outer <tspan> per line, with
    // the text in a nested run tspan.
    const firstLine = await canvas.findByText("Processed here");
    const secondLine = await canvas.findByText("(2 workers)");
    await expect(firstLine.tagName.toLowerCase()).toBe("tspan");
    await expect(secondLine.tagName.toLowerCase()).toBe("tspan");
    await expect(firstLine.parentElement?.parentElement).toBe(
      secondLine.parentElement?.parentElement,
    );
    // The Markdown annotation renders a bold run, never raw `**` source.
    const bold = await canvas.findByText("Note");
    await expect(bold.getAttribute("font-weight")).toBe("bold");
    await expect(canvas.queryByText("**Note**")).toBeNull();
    // Its `code` run gets a tinted background <rect>, filled from the same
    // `--inline-code-bg` the HTML renderer's `.inline-code` uses (app.css).
    // The marker paints before (under) the text.
    const code = await canvas.findByText("queue");
    await expect(code.tagName.toLowerCase()).toBe("tspan");
    const markers = canvasElement.querySelectorAll(
      'rect[fill="var(--inline-code-bg)"]',
    );
    await expect(markers.length).toBe(1);
    await expect(markers[0]?.nextElementSibling).toBe(code.closest("text"));
  },
};

// The pipeline with an annotation placed far outside the node cluster's
// bounding box and a scaled one — the auto-fit viewBox must extend to
// include them, else the note would be clipped out of the Explore viewport.
export const AnnotationsExtendTheFittedViewport: Story = {
  args: {
    components: pipelineComponents,
    connections: pipelineConnections,
    boxes: pipelineBoxes,
    annotations: [
      { text: "Distant note", x: 1200, y: -300, scale: 1.5 },
      { text: "Below the cluster", x: 100, y: 900 },
    ],
  },
};

// Only annotations, no placed components — the viewBox must still fit them
// (previously fell back to the fixed "0 0 100 100" default).
export const AnnotationsOnly: Story = {
  args: {
    components: pipelineComponents,
    connections: pipelineConnections,
    boxes: {},
    annotations: [{ text: "Just a note", x: 0, y: 0 }],
  },
};

// ---------------------------------------------------------------------------
// DiagramNodeBody — the box + selection outline + icon/label block shared by
// this renderer and the interactive canvas. Exercised through DiagramStaticView
// (its root is a bare <g>, so it only renders inside a host <svg>), with the
// rendered geometry asserted against geometry.nodeLabelLayout so the two
// renderers can never drift apart again.
// ---------------------------------------------------------------------------

const iconComponents: DiagramStaticComponent[] = [
  { label: "top-left", icon: "microchip" },
  { label: "top-center", icon: "server" },
  { label: "center", icon: "wifi" },
  { label: "plain top-left" },
  { label: "plain top-center" },
  { label: "plain center" },
];
// `textAlign` lives on the *box*, not the component — see DiagramStaticBox.
const iconBoxes: Record<number, DiagramStaticBox> = {
  0: { x: 0, y: 0, width: 200, height: 120, textAlign: "top-left" },
  1: { x: 240, y: 0, width: 200, height: 120, textAlign: "top-center" },
  2: { x: 480, y: 0, width: 200, height: 120, textAlign: "center" },
  3: { x: 0, y: 160, width: 200, height: 120, textAlign: "top-left" },
  4: { x: 240, y: 160, width: 200, height: 120, textAlign: "top-center" },
  5: { x: 480, y: 160, width: 200, height: 120, textAlign: "center" },
};

// The three icon-bearing nodes, in render order, with the placement
// nodeLabelLayout says they must get. Spelled out (rather than recomputed
// from the boxes above) so a change to the layout function shows up here as
// a deliberate edit, not a silently-updated expectation.
const expectedIconNodes = [
  { align: "top-left", label: "top-left", width: 200, height: 120 },
  { align: "top-center", label: "top-center", width: 200, height: 120 },
  { align: "center", label: "center", width: 200, height: 120 },
] as const;

export const IconsAndTextAlignments: Story = {
  args: {
    components: iconComponents,
    connections: [],
    boxes: iconBoxes,
  },
  play: async ({ canvasElement }) => {
    // DiagramStaticView -> DiagramElements -> DiagramCanvas -> DiagramNodeBody,
    // whose root is the <g> holding the body rect, the icon glyph and the label.
    const bodies = canvasElement.querySelectorAll("a > g > g");
    await expect(bodies.length).toBe(6);

    // Only the three icon-bearing nodes render a nested <svg> glyph.
    const glyphs = canvasElement.querySelectorAll("a > g > g > svg");
    await expect(glyphs.length).toBe(3);

    for (const [i, node] of expectedIconNodes.entries()) {
      const glyph = glyphs[i];
      const text = bodies[i]?.querySelector("text");
      // The renderer measures the label from the DOM, so the expectation must
      // use the same measured width to match.
      const measured = text?.getComputedTextLength() ?? 0;
      const expected = nodeLabelLayout(
        node.align,
        node.label,
        node.width,
        node.height,
        true,
        measured,
      );
      await expect(glyph?.getAttribute("x")).toBe(String(expected.icon?.x));
      await expect(glyph?.getAttribute("y")).toBe(String(expected.icon?.y));
      await expect(glyph?.getAttribute("width")).toBe(
        String(expected.icon?.size),
      );
      await expect(text?.getAttribute("x")).toBe(String(expected.text.x));
      await expect(text?.getAttribute("y")).toBe(String(expected.text.y));
      await expect(text?.getAttribute("text-anchor")).toBe(
        expected.text.anchor,
      );
      await expect(text?.getAttribute("dominant-baseline")).toBe(
        expected.text.baseline,
      );

      // top-center: the icon+label row, measured as rendered, must be centered
      // on the box (this is the regression the measurement fixes).
      if (node.align === "top-center") {
        const iconX = Number(glyph?.getAttribute("x"));
        const rowLeft = iconX;
        const rowRight = Number(text?.getAttribute("x")) + measured;
        await expect(
          Math.abs((rowLeft + rowRight) / 2 - node.width / 2),
        ).toBeLessThan(0.5);
      }
    }

    // Icon-less nodes fall back to the plain textPosition placement.
    const plain = nodeLabelLayout("center", "plain center", 200, 120, false);
    const plainText = bodies[5]?.querySelector("text");
    await expect(plainText?.getAttribute("x")).toBe(String(plain.text.x));
    await expect(plainText?.getAttribute("y")).toBe(String(plain.text.y));
  },
};

// The model-level visual attributes (color / border / font) reach the shared
// node body: a dashed error-colored border and a bold italic label.
export const NodeVisualStyles: Story = {
  args: {
    components: [
      { label: "styled", color: "error", border: "dashed", font: "bold" },
      { label: "dotted", color: "primary", border: "dotted", font: "italic" },
      { label: "plain" },
    ],
    connections: [],
    boxes: {
      0: { x: 0, y: 0, width: 160, height: 90 },
      1: { x: 200, y: 0, width: 160, height: 90 },
      2: { x: 400, y: 0, width: 160, height: 90 },
    },
    selected: new Set([1]),
  },
  play: async ({ canvasElement }) => {
    const bodies = Array.from(canvasElement.querySelectorAll("a > g > g"));
    await expect(bodies.length).toBe(3);

    // Each body's first rect is the node box itself (the selection outline,
    // when present, is the second one).
    const nodeRects = bodies.map((body) => body.querySelector("rect"));
    const [styled, dotted, plain] = nodeRects;
    await expect(styled?.getAttribute("stroke")).toBe("var(--color-error)");
    await expect(styled?.getAttribute("stroke-dasharray")).toBe("6 4");
    await expect(dotted?.getAttribute("stroke")).toBe("var(--color-primary)");
    await expect(dotted?.getAttribute("stroke-dasharray")).toBe("1.5 3");
    // An unstyled node keeps the default solid base-content border.
    await expect(plain?.getAttribute("stroke")).toBe(
      "var(--color-base-content)",
    );
    await expect(plain?.getAttribute("stroke-dasharray")).toBeNull();

    // The selected node also carries the dotted primary outline on top.
    const outline = bodies[1]?.querySelectorAll("rect")[1];
    await expect(outline?.getAttribute("stroke")).toBe("var(--color-primary)");
    await expect(outline?.getAttribute("fill")).toBe("none");
  },
};

// Port unification: read-only diagrams show the same labels, outline spots,
// and anchored edges as the editor — but never dots (no interactivity).
// Even a selected node keeps labels only; the dot layer needs port handlers
// the static renderer never passes.
export const WithPorts: Story = {
  tags: ["no-vrt"],
  args: {
    components: [
      {
        label: "sensor",
        ports: [{ label: "i2c", role: "provider" }],
      },
      {
        label: "controller",
        ports: [{ label: "i2c-in", role: "consumer" }],
      },
    ],
    connections: [
      {
        from: 0,
        to: 1,
        label: "read-sensor",
        fromPort: "i2c",
        toPort: "i2c-in",
      },
    ],
    boxes: {
      0: { x: 0, y: 40, width: 140, height: 80 },
      1: { x: 220, y: 40, width: 140, height: 80 },
    },
    portsByIndex: {
      1: [
        {
          label: "i2c-in",
          role: "consumer",
          spot: { side: "left", offset: 0.25 },
        },
      ],
    },
    selected: new Set([0]),
  },
  play: async ({ canvasElement }) => {
    const ports = canvasElement.querySelectorAll(
      "[data-testid='diagram-port']",
    );
    await expect(ports.length).toBe(2);
    const labels = Array.from(ports).map(
      (port) => port.querySelector("text")?.textContent,
    );
    await expect(labels).toEqual(["i2c", "i2c-in"]);
    // Labels only: no dots (and no hit areas) without port handlers.
    await expect(
      canvasElement.querySelectorAll("[data-testid='diagram-port'] circle")
        .length,
    ).toBe(0);
    // The edge anchors to the dragged spot, not the box midpoint.
    const edge = canvasElement.querySelector("[data-testid='diagram-edge']");
    await expect(edge?.querySelector("text")?.textContent).toBe("read-sensor");
  },
};

// Unused-port hiding: labels render only for ports a drawn edge names (or on
// a selected node). The sensor's `idle` port has no edge, so only `i2c` and
// `i2c-in` appear — the same rule the editor canvas applies, which keeps
// views like homelab's `main` (lan/wifi unused there) free of clutter.
// No VRT: the play assertions pin the rule; screenshots add nothing.
export const HidesPortsUnusedByDrawnEdges: Story = {
  tags: ["no-vrt"],
  args: {
    components: [
      {
        label: "sensor",
        ports: [
          { label: "i2c", role: "provider" },
          { label: "idle", role: "peer" },
        ],
      },
      {
        label: "controller",
        ports: [{ label: "i2c-in", role: "consumer" }],
      },
    ],
    connections: [
      {
        from: 0,
        to: 1,
        label: "read-sensor",
        fromPort: "i2c",
        toPort: "i2c-in",
      },
    ],
    boxes: {
      0: { x: 0, y: 40, width: 140, height: 80 },
      1: { x: 220, y: 40, width: 140, height: 80 },
    },
  },
  play: async ({ canvasElement }) => {
    const ports = canvasElement.querySelectorAll(
      "[data-testid='diagram-port']",
    );
    await expect(ports.length).toBe(2);
    const labels = Array.from(ports).map(
      (port) => port.querySelector("text")?.textContent,
    );
    await expect(labels).toEqual(["i2c", "i2c-in"]);
  },
};

// Single-knee routing: a right-edge port into a top-edge port draws one
// corner and arrives vertically. Pixel-covered here (static view); the
// interaction-level assertions live in DiagramCanvas.stories.ts.
export const SingleKnee: Story = {
  args: {
    components: [
      {
        label: "a",
        ports: [{ label: "out", role: "provider" }],
      },
      {
        label: "b",
        ports: [{ label: "in", role: "consumer" }],
      },
    ],
    connections: [
      { from: 0, to: 1, label: "wire", fromPort: "out", toPort: "in" },
    ],
    boxes: {
      0: { x: 0, y: 0, width: 100, height: 60 },
      1: { x: 200, y: 200, width: 100, height: 60 },
    },
    portsByIndex: {
      0: [
        {
          label: "out",
          role: "provider",
          spot: { side: "right", offset: 0.5 },
        },
      ],
      1: [
        { label: "in", role: "consumer", spot: { side: "top", offset: 0.5 } },
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const edge = canvasElement.querySelector("[data-testid='diagram-edge']");
    const path = edge?.querySelector("path:not([stroke='transparent'])");
    await expect(path?.getAttribute("d")).toBe(
      elbowPath(100, 30, 250, 200, "horizontal", 10, "vertical"),
    );
    await expect(edge?.querySelector("polygon")?.getAttribute("points")).toBe(
      "250,200 247,192 253,192",
    );
  },
};

// Double-knee routing: same-axis ports keep the H-V-H jog.
export const DoubleKnee: Story = {
  args: {
    components: [
      {
        label: "a",
        ports: [{ label: "out", role: "provider" }],
      },
      {
        label: "b",
        ports: [{ label: "in", role: "consumer" }],
      },
    ],
    connections: [
      { from: 0, to: 1, label: "wire", fromPort: "out", toPort: "in" },
    ],
    boxes: {
      0: { x: 0, y: 0, width: 100, height: 60 },
      1: { x: 200, y: 0, width: 100, height: 60 },
    },
    portsByIndex: {
      0: [
        {
          label: "out",
          role: "provider",
          spot: { side: "right", offset: 0.5 },
        },
      ],
      1: [
        { label: "in", role: "consumer", spot: { side: "left", offset: 0.75 } },
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const edge = canvasElement.querySelector("[data-testid='diagram-edge']");
    const path = edge?.querySelector("path:not([stroke='transparent'])");
    await expect(path?.getAttribute("d")).toBe(
      elbowPath(100, 30, 200, 45, "horizontal", 10, "horizontal"),
    );
    await expect(edge?.querySelector("polygon")?.getAttribute("points")).toBe(
      "200,45 192,48 192,42",
    );
  },
};
