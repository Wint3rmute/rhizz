import type { Meta, StoryObj } from "@storybook/svelte";
import type { DiagnosticJS } from "rhizz";
import { expect, userEvent, waitFor, within } from "storybook/test";
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
    // Collapsed: counts visible (plus a plain-text preview of the first
    // message by design), but no expanded alert rows may render.
    await expect(await bar.findByText("1 error")).toBeInTheDocument();
    await expect(await bar.findByText("2 warnings")).toBeInTheDocument();
    await expect(bar.queryByRole("alert")).not.toBeInTheDocument();
  },
};

export const ExpandCollapse: Story = {
  args: {},
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const bar = within(canvas.getByTestId("diagnostics-status-bar"));
    const toggle = await bar.findByRole("button");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(toggle);
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    // Text queries would also match the toggle's plain-text preview, so
    // scope content checks to the expanded alert rows (1 error + 2 warnings).
    await waitFor(async () => {
      await expect(bar.getAllByRole("alert")).toHaveLength(3);
    });
    const alerts = bar.getAllByRole("alert");
    await expect(alerts[0]?.textContent).toMatch(/undefined component/);
    await expect(alerts[1]?.textContent).toMatch(/missing a description/);

    await userEvent.click(toggle);
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    // The plain-text preview stays by design; the alert rows must go.
    await waitFor(async () => {
      await expect(bar.queryByRole("alert")).not.toBeInTheDocument();
    });
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
    await expect(await bar.findByText("2 warnings")).toBeInTheDocument();
    await userEvent.click(await bar.findByRole("button"));
    await waitFor(async () => {
      // Two expanded alert rows (the collapsed preview span stays too, so
      // text matching would find three).
      await expect(bar.getAllByRole("alert")).toHaveLength(2);
    });
  },
};

export const Clean: Story = {
  args: {
    diagnostics: [] satisfies DiagnosticJS[],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const bar = within(canvas.getByTestId("diagnostics-status-bar"));
    await expect(await bar.findByText("✓ clean")).toBeInTheDocument();
    // Expanding a clean run shows the well-done message.
    await userEvent.click(await bar.findByRole("button"));
    await expect(await bar.findByText(/Well Done/)).toBeInTheDocument();
  },
};
