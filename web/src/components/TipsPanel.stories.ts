import type { Meta, StoryObj } from "@storybook/svelte";
import { expect, within } from "storybook/test";
import TipsPanel from "./TipsPanel.svelte";

const meta = {
  title: "Components/TipsPanel",
  component: TipsPanel,
  parameters: {
    layout: "padded",
  },
} satisfies Meta<typeof TipsPanel>;

export default meta;

type Story = StoryObj<typeof meta>;

// The index is pinned so VRT baselines stay deterministic — the app itself
// passes no index and gets a random tip per mount.
export const FirstTip: Story = {
  args: {
    index: 0,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("heading", { name: "Tips" }),
    ).toBeInTheDocument();
    await expect(canvas.getByText(/single search box/)).toBeInTheDocument();
  },
};

export const SecondTip: Story = {
  args: {
    index: 1,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("heading", { name: "Tips" }),
    ).toBeInTheDocument();
    // Plain fragment: Markdown splits the tip across strong/em elements.
    await expect(
      canvas.getByText(/still find correct matches/),
    ).toBeInTheDocument();
  },
};
