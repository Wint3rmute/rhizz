import type { Meta, StoryObj } from "@storybook/svelte";
import { type ToastLevel, ToastState } from "../ToastState.svelte";
import ToastContainer from "./ToastContainer.svelte";

const STORY_TIMEOUT_MS = 3_600_000;

function stateWith(message: string, level: ToastLevel): ToastState {
  const state = new ToastState();
  state.show(message, level, STORY_TIMEOUT_MS);
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

export const Info: Story = {
  args: {
    state: stateWith("Diagram view loaded", "info"),
  },
};

export const Warning: Story = {
  args: {
    state: stateWith("No detailed view for engine created", "warning"),
  },
};

export const Error: Story = {
  args: {
    state: stateWith("Could not save project", "error"),
  },
};

export const Success: Story = {
  args: {
    state: stateWith("Project saved", "success"),
  },
};
