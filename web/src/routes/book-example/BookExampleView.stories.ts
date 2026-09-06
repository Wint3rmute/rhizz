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

// The verdict footer reports a clean compile at the bottom of the embed,
// with the book-style completion stats underneath.
// (Alert text runs together across <br/> elements, so assertions use regex.)
export const VerdictFooter: Story = {
  args: {
    files: DEMO_FILES,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText(/No errors, no warnings/);
    await canvas.findByText("Components");
    await canvas.findByText(/100\.0%/);
  },
};

// Clicking the footer expands the full diagnostics outline.
export const VerdictExpanded: Story = {
  args: {
    files: DEMO_FILES,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      await canvas.findByText(/No errors, no warnings/),
    );
    await canvas.findByText(/Well Done!/);
  },
};
