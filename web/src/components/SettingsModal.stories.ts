import type { Meta, StoryObj } from "@storybook/svelte";
import { expect, fn, userEvent, within } from "storybook/test";
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

export const EscapeCloses: Story = {
  // VRT duplicate of Open (same open modal): no new pixels. Play still runs
  // in vitest.
  tags: ["no-vrt"],
  args: {
    open: true,
    onclose: fn(),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByTestId("settings-modal"),
    ).toBeInTheDocument();
    // Focus stays on whatever opened the modal, so this also proves the
    // window-level handler: a backdrop-only keydown would never fire.
    await userEvent.keyboard("{Escape}");
    await expect(args.onclose).toHaveBeenCalled();
  },
};
