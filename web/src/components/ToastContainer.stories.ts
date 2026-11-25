import type { Meta, StoryObj } from "@storybook/svelte";
import { expect, within } from "storybook/test";
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

function stateWithMarkdown(): ToastState {
  const state = new ToastState();
  state.show(
    "Change refused: circular protocol encapsulation: `uart` -> `usb` -> `uart`",
    "error",
    STORY_TIMEOUT_MS,
  );
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

// A refusal message carries inline Markdown (the Rust diagnostics wrap protocol
// labels in backticks), so the toast renders it as code rather than plain text.
export const MarkdownMessage: Story = {
  args: {
    state: stateWithMarkdown(),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const toast = await canvas.findByRole("alert");
    await expect(toast).toHaveTextContent(
      "Change refused: circular protocol encapsulation: uart -> usb -> uart",
    );
    // The protocol labels render as inline code, not literal backticks.
    await expect(toast.querySelector("code")?.textContent).toBe("uart");
    await expect(toast.textContent).not.toContain("`");
  },
};
