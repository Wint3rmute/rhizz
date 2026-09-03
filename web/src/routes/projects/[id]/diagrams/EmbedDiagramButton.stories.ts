import type { Meta, StoryObj } from "@storybook/svelte";
import { expect, userEvent, within } from "storybook/test";
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

export const PinnedBaseUrl: Story = {
  args: {
    baseUrl: "https://rhizz.example.dev",
  },
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole("button", { name: /embed diagram/i });
    await userEvent.click(button);
    const input = canvas.getByDisplayValue(
      "https://rhizz.example.dev/projects/demo-project/diagrams/embed/overview.hcl",
    );
    await step("pinned origin stays stable", async () => {
      await expect(input).toHaveValue(
        "https://rhizz.example.dev/projects/demo-project/diagrams/embed/overview.hcl",
      );
    });
  },
};
