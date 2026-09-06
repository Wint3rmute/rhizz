import type { Meta, StoryObj } from "@storybook/svelte";
import { userEvent, within } from "storybook/test";
import BookExampleView from "./BookExampleView.svelte";
import { DEMO_FILES } from "./demo";

const meta = {
  title: "Book/BookExampleView",
  component: BookExampleView,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof BookExampleView>;

export default meta;

type Story = StoryObj<typeof meta>;

// The fallback demo project: diagram tab with two placed nodes.
export const DiagramTab: Story = {
  args: {
    files: DEMO_FILES,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText("sensor");
    await canvas.findByText("hub");
  },
};

// Switching to the Code tab shows the raw HCL with a file selector.
export const CodeTab: Story = {
  args: {
    files: DEMO_FILES,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("tab", { name: "Code" }));
    await canvas.findByText(/protocol "temp-bus"/);
  },
};

// The clean demo project reports no diagnostics.
export const DiagnosticsTab: Story = {
  args: {
    files: DEMO_FILES,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      await canvas.findByRole("tab", { name: /Errors \/ Warnings/ }),
    );
    await canvas.findByText(/Well Done!/);
  },
};
