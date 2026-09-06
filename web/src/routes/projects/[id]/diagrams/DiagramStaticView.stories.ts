import type { Meta, StoryObj } from "@storybook/svelte";
import { expect, within } from "storybook/test";
import DiagramStaticView from "./DiagramStaticView.svelte";
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

// The same pipeline with two nodes selected at once, as a multi-selection
// (e.g. after a marquee drag) would look.
export const MultiSelected: Story = {
  args: {
    components: pipelineComponents,
    connections: pipelineConnections,
    boxes: pipelineBoxes,
    selected: new Set([0, 2]),
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
