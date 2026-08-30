import type { Meta, StoryObj } from "@storybook/svelte";
import ScrollingBackground from "./ScrollingBackground.svelte";

const meta = {
  title: "Components/ScrollingBackground",
  component: ScrollingBackground,
  parameters: {
    layout: "fullscreen",
  },
  args: {
    images: [
      "background_1.png",
      "background_2.png",
      "background_3.png",
      "background_4.png",
    ],
  },
} satisfies Meta<typeof ScrollingBackground>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

// A lighter overlay so the screenshots show through more clearly.
export const LighterOverlay: Story = {
  args: {
    overlayOpacity: 30,
  },
};

// A wider strip for a faster-feeling scroll across a large area.
export const WideStrip: Story = {
  args: {
    width: "150vw",
  },
};
