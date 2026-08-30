import type { Meta, StoryObj } from "@storybook/svelte";
import { expect, userEvent, within } from "storybook/test";
import DiagramEmbedView from "./DiagramEmbedView.svelte";
import type {
  DiagramStaticBox,
  DiagramStaticComponent,
  DiagramStaticConnection,
} from "./types";

const meta = {
  title: "Diagrams/DiagramEmbedView",
  component: DiagramEmbedView,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof DiagramEmbedView>;

export default meta;

type Story = StoryObj<typeof meta>;

const sampleComponents: DiagramStaticComponent[] = [
  { label: "sensor" },
  { label: "controller" },
  { label: "broker" },
];

const sampleConnections: DiagramStaticConnection[] = [
  { from: 0, to: 1, label: "i2c" },
  { from: 1, to: 2, label: "mqtt" },
];

const sampleBoxes: Record<number, DiagramStaticBox> = {
  0: { x: 40, y: 60, width: 150, height: 90 },
  1: { x: 260, y: 40, width: 220, height: 160, textAlign: "top-left" },
  2: { x: 560, y: 60, width: 180, height: 90 },
};

export const Default: Story = {
  args: {
    components: sampleComponents,
    connections: sampleConnections,
    boxes: sampleBoxes,
    projectId: "demo-project",
    diagramPath: "overview.hcl",
  },
};

// Same diagram with a couple of nodes selected, exercising the selection
// outline in the embed viewport.
export const Selected: Story = {
  args: {
    components: sampleComponents,
    connections: sampleConnections,
    boxes: sampleBoxes,
    projectId: "demo-project",
    diagramPath: "overview.hcl",
    selected: new Set([0, 2]),
  },
};

export const Mobile: Story = {
  globals: {
    viewport: { value: "mobile1" },
  },
  parameters: {
    viewport: { defaultViewport: "mobile1" },
  },
  args: {
    components: sampleComponents,
    connections: sampleConnections,
    boxes: sampleBoxes,
    projectId: "demo-project",
    diagramPath: "overview.hcl",
  },
};

// The embed view forwards an optional onnodehover callback to the rendered
// nodes (used by the embed page to show the component docs popup). This story
// verifies the callback fires with the hovered component index. The callback
// is captured at story-definition time (reassigning args.onnodehover after
// mount would not update the already-rendered component).
const hoveredIndices: (number | null)[] = [];
export const HoverCallback: Story = {
  args: {
    components: sampleComponents,
    connections: sampleConnections,
    boxes: sampleBoxes,
    projectId: "demo-project",
    diagramPath: "overview.hcl",
    onnodehover: (index: number | null) => {
      hoveredIndices.push(index);
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // The label <text> has pointer-events: none; the hover handler lives on
    // the wrapping <a>, so hover that instead.
    const text = await canvas.findByText("sensor");
    const anchor = text.closest("a");
    await expect(anchor).not.toBeNull();
    await userEvent.hover(anchor as Element);
    await expect(hoveredIndices).toContain(0);
  },
};
