import type { Meta, StoryObj } from "@storybook/svelte";
import SettingsModal from "./SettingsModal.svelte";

const meta = {
  title: "Components/SettingsModal",
  component: SettingsModal,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof SettingsModal>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Open: Story = {
  args: {
    open: true,
  },
};
