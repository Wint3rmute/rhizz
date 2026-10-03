import type { Meta, StoryObj } from "@storybook/svelte";
import type { DiagnosticJS } from "rhizz";
import { setCurrentScore } from "../ProjectState.svelte";
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
    // The strictness control is part of the strip now, not the navbar: it is
    // the bar's right-hand zone, so a bar rendered on its own has to carry it.
    await expect(bar.getByLabelText("Strictness")).toBeInTheDocument();
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

// The strip as a project page actually renders it: all three zones at once,
// which no other story here can show. The score is a module singleton the bar
// reads (only Modeling publishes one), so the story seeds it in a `loader` —
// which unlike `beforeEach` also runs in the static build VRT screenshots, and
// each of those is a fresh page load, so the seeded value cannot leak from one
// baseline into the next.
function seedScore(): void {
  setCurrentScore({ overall_percentage: 72.5 });
}

export const FullStrip: Story = {
  loaders: [seedScore],
  parameters: {
    viewport: { defaultViewport: "responsive" },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const bar = within(canvas.getByTestId("diagnostics-status-bar"));
    // Far left, middle, far right. The score's *presence* is asserted rather
    // than its visibility: it is `hidden` below `sm`, and this runner's
    // viewport is phone-sized — the three zones side by side at full width is
    // what the VRT baseline of this story shows.
    await expect(
      await bar.findByTitle(/Architecture maturity/),
    ).toBeInTheDocument();
    await expect(await bar.findByText("1 error")).toBeVisible();
    await expect(bar.getByLabelText("Strictness")).toBeVisible();
  },
};

// The strip at phone width, which is where the three zones have to share one
// line. VRT captures this story at the `mobile1` viewport (320px); the play
// assertions run at the test runner's own phone-sized viewport, the same case
// one notch wider.
//
// Only Modeling publishes a score, and a static VRT build never has one, so
// this is the tightest row the bar really renders: counts on the left,
// strictness on the right, and the message preview squeezed to nothing between
// them.
export const NarrowStrip: Story = {
  globals: {
    viewport: { value: "mobile1" },
  },
  parameters: {
    viewport: { defaultViewport: "mobile1" },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const bar = within(canvas.getByTestId("diagnostics-status-bar"));
    await expect(await bar.findByText("2 warnings")).toBeVisible();
    // Neither zone may be pushed out of the row to make room for the other.
    await expect(bar.getByLabelText("Strictness")).toBeVisible();
    // The message preview is what gives way at this width — the counts are
    // the news — but the chevron is the only thing that says the strip
    // expands, so it has to survive being squeezed.
    await expect(bar.getByText("▴")).toBeVisible();
    // …and nothing spills past the bar's own right edge.
    const rootBox = canvas.getByTestId("diagnostics-status-bar")
      .getBoundingClientRect();
    const selectBox = bar.getByLabelText("Strictness").getBoundingClientRect();
    await expect(selectBox.right).toBeLessThanOrEqual(rootBox.right);
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
