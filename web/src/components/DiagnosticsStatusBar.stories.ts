import type { Meta, StoryObj } from "@storybook/svelte";
import type { DiagnosticJS } from "rhizz";
import { expect, userEvent, within } from "storybook/test";
import DiagnosticsStatusBar from "./DiagnosticsStatusBar.svelte";

type StoryDiagnostic = Pick<DiagnosticJS, "code" | "message">;

const sampleDiagnostics = [
  {
    code: "E002",
    message: 'connection "uart-link" references undefined component "gps"',
  },
  { code: "W004", message: 'component "motor" is missing a description' },
  { code: "W004", message: 'component "esc" is missing a description' },
] satisfies StoryDiagnostic[];

const meta = {
  title: "Overview/DiagnosticsStatusBar",
  component: DiagnosticsStatusBar,
  args: {
    diagnostics: sampleDiagnostics as DiagnosticJS[],
  },
} satisfies Meta<typeof DiagnosticsStatusBar>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Collapsed: Story = {
  args: {},
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const bar = within(canvas.getByTestId("diagnostics-status-bar"));
    // Collapsed: counts visible, messages hidden.
    await expect(bar.getByText("1 error")).toBeInTheDocument();
    await expect(bar.getByText("2 warnings")).toBeInTheDocument();
    await expect(bar.queryByText(/undefined component/)).not
      .toBeInTheDocument();
  },
};

export const ExpandCollapse: Story = {
  args: {},
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const bar = within(canvas.getByTestId("diagnostics-status-bar"));
    const toggle = bar.getByRole("button");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(toggle);
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(bar.getByText(/undefined component/)).toBeInTheDocument();
    await expect(bar.getByText(/missing a description/)).toBeInTheDocument();

    await userEvent.click(toggle);
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(bar.queryByText(/undefined component/)).not
      .toBeInTheDocument();
  },
};

// The compiler legitimately repeats identical diagnostics (e.g. one W003
// per unreferenced instance sharing a label path) — index-keyed rows must
// render them all instead of throwing each_key_duplicate.
const duplicateDiagnostics = [
  {
    code: "W003",
    message:
      "component 'FDS' (source 'FDS') is not referenced by any connection",
  },
  {
    code: "W003",
    message:
      "component 'FDS' (source 'FDS') is not referenced by any connection",
  },
] satisfies StoryDiagnostic[];

export const DuplicateDiagnostics: Story = {
  args: {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- svelte-check needs DiagnosticJS (wasm class); ESLint's program can't see it.
    diagnostics: duplicateDiagnostics as DiagnosticJS[],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const bar = within(canvas.getByTestId("diagnostics-status-bar"));
    await expect(bar.getByText("2 warnings")).toBeInTheDocument();
    await userEvent.click(bar.getByRole("button"));
    await expect(bar.getAllByText(/not referenced by any connection/))
      .toHaveLength(2);
  },
};

export const Clean: Story = {
  args: {
    diagnostics: [] satisfies DiagnosticJS[],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const bar = within(canvas.getByTestId("diagnostics-status-bar"));
    await expect(bar.getByText("✓ clean")).toBeInTheDocument();
    // Expanding a clean run shows the well-done message.
    await userEvent.click(bar.getByRole("button"));
    await expect(bar.getByText(/Well Done/)).toBeInTheDocument();
  },
};
