import type { Meta, StoryObj } from "@storybook/svelte";
import DiagramEmbedView from "./DiagramEmbedView.svelte";
import type {
  DiagramStaticBox,
  DiagramStaticComponent,
  DiagramStaticConnection,
} from "./DiagramStaticView.svelte";

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
