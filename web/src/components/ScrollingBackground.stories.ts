import type { Meta, StoryObj } from "@storybook/svelte";
import ScrollingBackground from "./ScrollingBackground.svelte";

const meta = {
  title: "Components/ScrollingBackground",
  component: ScrollingBackground,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof ScrollingBackground>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
