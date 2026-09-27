import type { Meta, StoryObj } from "@storybook/svelte";
import { expect, within } from "storybook/test";
import DiagramEmbedView from "./DiagramEmbedView.svelte";
import { storyScene } from "./storyScene";
import type { SceneBoxInput } from "./diagramScene";

const meta = {
  title: "Diagrams/DiagramEmbedView",
  component: DiagramEmbedView,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof DiagramEmbedView>;

export default meta;

type Story = StoryObj<typeof meta>;

const sampleComponents = [
  { label: "sensor" },
  { label: "controller" },
  { label: "broker" },
];

const sampleConnections = [
  { from: "sensor", to: "controller", label: "i2c" },
  { from: "controller", to: "broker", label: "mqtt" },
];

const sampleBoxes: Record<string, SceneBoxInput> = {
  sensor: { x: 40, y: 60, width: 150, height: 90 },
  controller: { x: 260, y: 40, width: 220, height: 160, textAlign: "top-left" },
  broker: { x: 560, y: 60, width: 180, height: 90 },
};

const sampleScene = storyScene(
  sampleComponents,
  sampleBoxes,
  sampleConnections,
);

export const Default: Story = {
  args: {
    scene: sampleScene,
    projectId: "demo-project",
    diagramPath: "overview.hcl",
  },
};

// Same diagram with a couple of nodes selected, exercising the selection
// outline in the embed viewport.
export const Selected: Story = {
  args: {
    scene: sampleScene,
    projectId: "demo-project",
    diagramPath: "overview.hcl",
    selected: new Set(["sensor", "broker"]),
  },
};

// Linked nodes (with a detail view) vs unlinked ones: clicking a linked
// node fires onnodeclick, unlinked nodes stay inert — the embed page wires
// this to in-embed drill-down navigation with a toast fallback.
export const LinkedNavigation: Story = {
  args: {
    scene: sampleScene,
    projectId: "demo-project",
    diagramPath: "overview.hcl",
    linked: new Set(["controller"]),
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
    scene: storyScene(sampleComponents, sampleBoxes, sampleConnections, [
      { text: "**far above**", x: 300, y: -400, scale: 2 },
      { text: "far below", x: 300, y: 700 },
    ]),
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
