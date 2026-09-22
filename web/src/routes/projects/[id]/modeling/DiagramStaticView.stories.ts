import type { Meta, StoryObj } from "@storybook/svelte";
import { expect, within } from "storybook/test";
import DiagramStaticView from "./DiagramStaticView.svelte";
import { nodeLabelLayout } from "./geometry";
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
// canvas positions — including a multi-line annotation (newline in text).
// SVG collapses "\n" inside <text>, so each line must be its own <tspan>.
export const WithAnnotations: Story = {
  args: {
    components: pipelineComponents,
    connections: pipelineConnections,
    boxes: pipelineBoxes,
    annotations: [
      { text: "Ingest path", x: 10, y: 10 },
      { text: "Processed here\n(2 workers)", x: 230, y: 140 },
      { text: "Note on queue", x: 200, y: 160 },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // The multi-line annotation renders one <tspan> per line.
    const firstLine = await canvas.findByText("Processed here");
    const secondLine = await canvas.findByText("(2 workers)");
    await expect(firstLine.tagName.toLowerCase()).toBe("tspan");
    await expect(secondLine.tagName.toLowerCase()).toBe("tspan");
    await expect(firstLine.parentElement).toBe(secondLine.parentElement);
  },
};

// The pipeline with Markdown annotations — headings, bold/italic/code/link,
// lists, quote and fenced code render as styled SVG <tspan> runs (pure SVG,
// no foreignObject), sharing the interactive canvas renderer.
export const WithMarkdownAnnotations: Story = {
  args: {
    components: pipelineComponents,
    connections: pipelineConnections,
    boxes: pipelineBoxes,
    annotations: [
      { text: "# Ingest path\n\nCarries **raw** events", x: 10, y: 10 },
      { text: "- fast\n- `durable`\n- [docs](https://example.com)", x: 230, y: 140 },
      { text: "> watch the lag\n\n```\nqps > 9000\n```", x: 200, y: 260 },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Heading + bold body render as text runs.
    await canvas.findByText("Ingest path");
    await canvas.findByText("raw");
    // List bullets, inline code and link labels render.
    await canvas.findByText("•");
    await canvas.findByText("durable");
    await canvas.findByText("docs");
    // Quote + code fence render.
    await canvas.findByText("watch the lag");
    await canvas.findByText("qps > 9000");
    // Bold run carries a font-weight.
    const bold = await canvas.findByText("raw");
    await expect(bold.getAttribute("font-weight")).toBe("bold");
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
    // DiagramStaticView -> DiagramElements -> DiagramNodeBody, whose root is
    // the <g> holding the body rect, the icon glyph and the label.
    const bodies = canvasElement.querySelectorAll("a > g > g");
    await expect(bodies.length).toBe(6);

    // Only the three icon-bearing nodes render a nested <svg> glyph.
    const glyphs = canvasElement.querySelectorAll("a > g > g > svg");
    await expect(glyphs.length).toBe(3);

    for (const [i, node] of expectedIconNodes.entries()) {
      const expected = nodeLabelLayout(
        node.align,
        node.label,
        node.width,
        node.height,
        true,
      );
      const glyph = glyphs[i];
      const text = bodies[i]?.querySelector("text");
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
