import type { Meta, StoryObj } from "@storybook/svelte";
import { expect, within } from "storybook/test";
import ScoreBadge from "./ScoreBadge.svelte";

// The score badge as the diagnostics bar shows it. Two stories, because the
// empty case is half the component: only Modeling publishes a score, so on
// every other project page the bar's left end has nothing in it, and a badge
// that rendered "0%" there would be a claim nobody made.

const meta = {
  title: "Components/ScoreBadge",
  component: ScoreBadge,
  parameters: {
    layout: "centered",
  },
  args: {
    score: { overall_percentage: 72.5 },
  },
} satisfies Meta<typeof ScoreBadge>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A published score: the rounded figure, and the exact one on hover. */
export const WithScore: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const badge = await canvas.findByText("Score: 73%");
    // The bar shows the rounded figure; the tooltip carries the exact one, so
    // hovering never disagrees with what the bar says.
    await expect(badge).toHaveAttribute(
      "title",
      "Architecture maturity / completion score: 72.5%",
    );
  },
};

/** No score yet: the badge renders nothing at all, rather than a zero. */
export const NoScore: Story = {
  args: {
    score: null,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByText(/Score:/)).toBeNull();
  },
};
