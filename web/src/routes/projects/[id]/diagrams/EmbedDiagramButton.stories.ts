import type { Meta, StoryObj } from "@storybook/svelte";
import EmbedDiagramButton from "./EmbedDiagramButton.svelte";

const meta = {
  title: "Diagrams/EmbedDiagramButton",
  component: EmbedDiagramButton,
  parameters: {
    layout: "centered",
  },
  args: {
    projectId: "demo-project",
    diagramPath: "overview.hcl",
  },
} satisfies Meta<typeof EmbedDiagramButton>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Disabled: Story = {
  args: {
    disabled: true,
  },
};

export const NoDiagramSelected: Story = {
  args: {
    diagramPath: null,
  },
};
