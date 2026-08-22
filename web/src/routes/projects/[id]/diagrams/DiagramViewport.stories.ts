import type { Meta, StoryObj } from "@storybook/svelte";
import DiagramViewport from "./DiagramViewport.svelte";

const meta = {
  title: "Diagrams/DiagramViewport",
  component: DiagramViewport,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof DiagramViewport>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    bounds: { x: 0, y: 0, width: 400, height: 300 },
  },
};
