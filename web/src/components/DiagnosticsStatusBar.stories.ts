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
  { code: "W004", message: 'component "motor" is missing a full_name' },
  { code: "W004", message: 'component "esc" is missing a full_name' },
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

/** One of the bar's rendered surfaces (the panel, when expanded). */
function surface(root: Element, index: number): HTMLElement {
  const el = root.children.item(index);
  if (!el) throw new Error("status bar has no such surface");
  return el as HTMLElement;
}

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

// The bar's two surfaces — the always-visible strip and the panel that pops
// over the page when it is clicked — are one component, so they are one
// colour. They used to differ: both were `bg-base-100/95` + a backdrop blur,
// so each showed 5% of whatever sat behind it, and the panel (over the page's
// canvas) read a shade greyer than the strip (over the app's own background).
export const Expanded: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const root = canvas.getByTestId("diagnostics-status-bar");
    const bar = within(root);
    await expect(await bar.findByText("1 error")).toBeInTheDocument();

    // Reproduce the two backdrops the surfaces really sit on, so the baseline
    // shows the seam: in the app the panel floats over the page (base-300)
    // while the strip sits on the shell's own background (base-100). The panel
    // also pops *above* the bar, so anchor the story root to the bottom of
    // the frame — otherwise it renders off-screen and the VRT captures a
    // clipped sliver.
    canvasElement.style.display = "flex";
    canvasElement.style.flexDirection = "column";
    canvasElement.style.justifyContent = "flex-end";
    canvasElement.style.height = "100vh";
    canvasElement.style.background = "var(--color-base-100)";
    const page = document.createElement("div");
    page.style.flex = "1";
    page.style.background = "var(--color-base-300)";
    canvasElement.prepend(page);

    await userEvent.click(await bar.findByRole("button"));
    // One row per diagnostic; the collapsed strip's plain-text preview of the
    // first message matches the panel's text, so assert the rows, not the text.
    await expect(await bar.findAllByRole("alert")).toHaveLength(3);

    const panel = surface(root, 0);
    const background = (el: Element) => getComputedStyle(el).backgroundColor;
    await expect(background(panel)).toBe(background(root));
    // A backdrop blur on an opaque surface is dead weight, and it is the tell
    // that a surface is meant to be glass.
    await expect(getComputedStyle(panel).backdropFilter).toBe("none");
    await expect(getComputedStyle(root).backdropFilter).toBe("none");
  },
};
