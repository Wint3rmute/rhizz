import type { Meta, StoryObj } from "@storybook/svelte";
import { type ToastLevel, ToastState } from "../ToastState.svelte";
import ToastContainer from "./ToastContainer.svelte";

const STORY_TIMEOUT_MS = 3_600_000;

function stateWithAll(): ToastState {
  const state = new ToastState();
  const levels: [string, ToastLevel][] = [
    ["Diagram view loaded", "info"],
    ["No detailed view for engine created", "warning"],
    ["Could not save project", "error"],
    ["Project saved", "success"],
  ];
  for (const [message, level] of levels) {
    state.show(message, level, STORY_TIMEOUT_MS);
  }
  return state;
}

const meta = {
  title: "Components/ToastContainer",
  component: ToastContainer,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof ToastContainer>;

export default meta;

type Story = StoryObj<typeof meta>;

export const AllLevels: Story = {
  args: {
    state: stateWithAll(),
  },
};
