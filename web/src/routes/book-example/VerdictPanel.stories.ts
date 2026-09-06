import type { Meta, StoryObj } from "@storybook/svelte";
import { within } from "storybook/test";
import VerdictPanel from "./VerdictPanel.svelte";

const meta = {
  title: "Book/VerdictPanel",
  component: VerdictPanel,
  parameters: {
    layout: "padded",
  },
} satisfies Meta<typeof VerdictPanel>;

export default meta;

type Story = StoryObj<typeof meta>;

const stats = {
  rows: [
    { label: "Components", complete: 3, total: 3 },
    { label: "Ports", complete: 0, total: 0 },
    { label: "Connections", complete: 0, total: 0 },
    { label: "Messages", complete: 0, total: 0 },
  ],
  overall: 100.0,
};

export const Ok: Story = {
  args: {
    status: "ok",
    head: "No errors, no warnings",
    stats,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText(/No errors, no warnings/);
    await canvas.findByText(/100\.0%/);
  },
};

export const Warnings: Story = {
  args: {
    status: "warn",
    head: "2 warnings — model completes at 100.0%",
    warnings: [
      {
        code: "W003",
        message: "component 'front-wheel' is not referenced by any connection",
      },
      {
        code: "W003",
        message: "component 'rear-wheel' is not referenced by any connection",
      },
    ],
    stats,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText(/2 warnings/);
    await canvas.findByText(/front-wheel/);
  },
};

export const Errors: Story = {
  args: {
    status: "error",
    head: "1 error, 0 warnings — no score (compilation failed)",
    errors: [
      {
        code: "E011",
        message: "connection 'greet' references undefined component 'sender'",
      },
    ],
    stats: null,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText(/1 error/);
    await canvas.findByText(/E011/);
  },
};
