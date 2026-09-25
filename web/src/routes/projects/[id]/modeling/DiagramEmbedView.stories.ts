import type { Meta, StoryObj } from "@storybook/svelte";
import { expect, within } from "storybook/test";
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

// Linked nodes (with a detail view) vs unlinked ones: clicking a linked
// node fires onnodeclick, unlinked nodes stay inert — the embed page wires
// this to in-embed drill-down navigation with a toast fallback.
export const LinkedNavigation: Story = {
  args: {
    components: sampleComponents,
    connections: sampleConnections,
    boxes: sampleBoxes,
    projectId: "demo-project",
    diagramPath: "overview.hcl",
    linked: new Set([1]),
    onnodeclick: () => {},
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("link", { name: /controller, open detailed view/i }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("link", { name: /sensor, no detailed view/i }),
    ).toBeInTheDocument();
  },
};

// Annotations far outside the node cluster: the zoom-to-fill bounds must
// extend to cover them (and they must actually be rendered), mirroring
// DiagramStaticView's fitted viewport behavior in the interactive embed.
// The far-above note carries Markdown (**bold**) so this storybook also
// exercises styled annotation runs.
export const WithDistantAnnotations: Story = {
  args: {
    components: sampleComponents,
    connections: sampleConnections,
    boxes: sampleBoxes,
    annotations: [
      { text: "**far above**", x: 300, y: -400, scale: 2 },
      { text: "far below", x: 300, y: 700 },
    ],
    projectId: "demo-project",
    diagramPath: "overview.hcl",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const bold = await canvas.findByText("far above");
    await expect(bold.getAttribute("font-weight")).toBe("bold");
    await expect(canvas.queryByText("**far above**")).toBeNull();
    await canvas.findByText("far below");
  },
};
