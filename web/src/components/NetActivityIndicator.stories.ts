import type { Meta, StoryObj } from "@storybook/svelte";
import { expect, within } from "storybook/test";
import NetActivityIndicator from "./NetActivityIndicator.svelte";
import { forgetDiagnosticsLayout } from "./modular_ui/diagnosticsLayout";

const meta = {
  title: "Overview/NetActivityIndicator",
  component: NetActivityIndicator,
  args: {
    label: "Syncing…",
  },
} satisfies Meta<typeof NetActivityIndicator>;

export default meta;

type Story = StoryObj<typeof meta>;

function resetDiagnosticsBar(): void {
  forgetDiagnosticsLayout();
}

export const Active: Story = {
  args: { label: "Uploading…" },
  loaders: [resetDiagnosticsBar],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const pill = await canvas.findByTestId("net-activity");
    await expect(pill).toBeInTheDocument();
    await expect(pill).toHaveTextContent("Uploading…");
    await expect(pill).toHaveAttribute("role", "status");
    await expect(pill).toHaveAttribute("data-error", "false");
    // DaisyUI loading bars spinner is present while active.
    await expect(pill.querySelector(".loading-bars")).not.toBeNull();
  },
};

export const Fading: Story = {
  args: { label: "Syncing…", fading: true },
  loaders: [resetDiagnosticsBar],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const pill = await canvas.findByTestId("net-activity");
    await expect(pill).toBeInTheDocument();
    await expect(pill).toHaveAttribute("data-fading", "true");
    await expect(pill).toHaveClass("opacity-0");
  },
};

export const ErrorState: Story = {
  args: { label: "Syncing…", error: "Sync failed" },
  loaders: [resetDiagnosticsBar],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const pill = await canvas.findByTestId("net-activity");
    await expect(pill).toBeInTheDocument();
    await expect(pill).toHaveTextContent("Sync failed");
    await expect(pill).toHaveAttribute("data-error", "true");
    await expect(pill.querySelector(".loading-bars")).toBeNull();
  },
};
