import type { Meta, StoryObj } from "@storybook/svelte";
import type { DiagnosticJS } from "rhizz";
import { setCurrentScore } from "../ProjectState.svelte";
import { expect, userEvent, waitFor, within } from "storybook/test";
import DiagnosticsStatusBar from "./DiagnosticsStatusBar.svelte";
import { forgetDiagnosticsLayout } from "./modular_ui/diagnosticsLayout";

type StoryDiagnostic = Pick<DiagnosticJS, "code" | "message">;

const sampleDiagnostics = [
  {
    code: "E002",
    message: "connection `uart-link` references undefined component `gps`",
  },
  { code: "W004", message: "component `motor` is missing a full_name" },
  { code: "W004", message: "component `esc` is missing a full_name" },
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

/**
 * Reset persisted bar state so no story inherits another story's open or
 * resized panel (the bar persists both across reloads, and stories share
 * one browser profile).
 */
function resetDiagnosticsBar(): void {
  forgetDiagnosticsLayout();
}

/** One of the bar's rendered surfaces (the panel, when expanded). */
function surface(root: Element, index: number): HTMLElement {
  const el = root.children.item(index);
  if (!el) throw new Error("status bar has no such surface");
  return el as HTMLElement;
}

export const Collapsed: Story = {
  args: {},
  loaders: [resetDiagnosticsBar],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const bar = within(canvas.getByTestId("diagnostics-status-bar"));
    // Collapsed: counts only — no message preview, no expanded alert rows.
    await expect(await bar.findByText("1 error")).toBeInTheDocument();
    await expect(await bar.findByText("2 warnings")).toBeInTheDocument();
    await expect(
      bar.queryByText(/references undefined component/),
    ).not.toBeInTheDocument();
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
      "component `FDS` (source `FDS`) is not referenced by any connection",
  },
  {
    code: "W003",
    message:
      "component `FDS` (source `FDS`) is not referenced by any connection",
  },
] satisfies StoryDiagnostic[];

export const DuplicateDiagnostics: Story = {
  loaders: [resetDiagnosticsBar],
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
      // Two expanded list rows.
      await expect(bar.getAllByRole("listitem")).toHaveLength(2);
    });
  },
};

export const Clean: Story = {
  loaders: [resetDiagnosticsBar],
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
  loaders: [resetDiagnosticsBar, seedScore],
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
    const scoreBadge = await bar.findByTitle(/Architecture maturity/);
    await expect(scoreBadge).toBeInTheDocument();
    await expect(await bar.findByText("1 error")).toBeVisible();
    await expect(bar.getByLabelText("Strictness")).toBeVisible();

    // The strip's toggle is a full-bleed layer *under* the content: the row is
    // capped to the panel's content edges, so a button inside it leaves the
    // gutters dead — on a screen wider than the cap they were exactly that.
    // The guards: the button spans the bar's full width (gutters included),
    // the pointer falls through the `pointer-events-none` row onto it —
    // checked at the count badge, the row's leftmost always-visible thing,
    // and at the bar's far-left edge — and the strictness select stays outside
    // it: a `<select>` inside a `<button>` is neither valid markup nor a
    // usable control, so its zone remains its own. The button carries the
    // pointer cursor explicitly — the browser gives a bare `<button>` none.
    const toggle = bar.getByRole("button");
    await expect(getComputedStyle(toggle).cursor).toBe("pointer");
    const barBox = canvas.getByTestId("diagnostics-status-bar")
      .getBoundingClientRect();
    await expect(toggle.getBoundingClientRect().width)
      .toBeCloseTo(barBox.width);
    const hitAt = (x: number, y: number) =>
      document.elementFromPoint(x, y)?.closest("button");
    const countBadge = await bar.findByText("1 error");
    const countBox = countBadge.getBoundingClientRect();
    await expect(hitAt(countBox.x + 1, countBox.y + 1)).toBe(toggle);
    await expect(hitAt(barBox.x + 2, barBox.y + barBox.height / 2))
      .toBe(toggle);
    await expect(toggle.contains(bar.getByLabelText("Strictness"))).toBe(
      false,
    );
  },
};

// The strip at phone width, which is where the three zones have to share one
// line. VRT captures this story at the `mobile1` viewport (320px); the play
// assertions run at the test runner's own phone-sized viewport, the same case
// one notch wider.
//
// Only Modeling publishes a score, and a static VRT build never has one, so
// this is the tightest row the bar really renders: counts on the left,
// strictness on the right, and the chevron between them.
export const NarrowStrip: Story = {
  loaders: [resetDiagnosticsBar],
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
    // The chevron is the only thing that says the strip expands, so it has
    // to survive being squeezed.
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
  loaders: [resetDiagnosticsBar],
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
    // One row per diagnostic; each row reads icon, then code, then message —
    // the code is the monospace underlined link to its spec page.
    const rows = await bar.findAllByRole("listitem");
    await expect(rows).toHaveLength(3);
    for (const row of rows) {
      const link = within(row).getByRole("link");
      await expect(link).toHaveTextContent(/^[EW]\d+$/);
      // Icon, then code, then message: the link is the row's second element
      // child, between the glyph span and the message span.
      const children = Array.from(row.children);
      await expect(children.indexOf(link)).toBe(1);
      await expect(children).toHaveLength(3);
      const style = getComputedStyle(link);
      await expect(style.textDecorationLine).toContain("underline");
      await expect(style.fontFamily.toLowerCase()).toContain("mono");
    }

    const panel = surface(root, 0);
    const background = (el: Element) => getComputedStyle(el).backgroundColor;
    await expect(background(panel)).toBe(background(root));
    // A backdrop blur on an opaque surface is dead weight, and it is the tell
    // that a surface is meant to be glass.
    await expect(getComputedStyle(panel).backdropFilter).toBe("none");
    await expect(getComputedStyle(root).backdropFilter).toBe("none");
  },
};

// The expanded panel opens at its persisted height with a resize handle on
// its top edge. Opens through a click (like the other expanding stories),
// because seeding open state through the store loader races the static
// build's first mount; the persisted-open path itself is pinned by e2e
// (expand → reload → still open). Dragging and the keyboard are e2e's job
// too (pointer capture + reload persistence need a real page).
export const ResizablePanel: Story = {
  loaders: [resetDiagnosticsBar],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const root = canvas.getByTestId("diagnostics-status-bar");
    const bar = within(root);
    await expect(await bar.findByText("1 error")).toBeInTheDocument();

    // Same bottom-anchoring as Expanded: the panel pops *above* the bar,
    // so without a page above it the story renders off-screen and VRT
    // captures a clipped sliver.
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
    const panel = canvas.getByTestId("diagnostics-panel");
    await expect(panel).toBeVisible();
    // Fixed persisted height (border-box, so the 1px top border is inside
    // the 256, give or take sub-pixel rounding).
    await expect(panel.getBoundingClientRect().height).toBeCloseTo(256, 0);

    const slider = bar.getByRole("slider", {
      name: "Resize diagnostics panel",
    });
    await expect(slider).toBeVisible();
    await expect(slider.getAttribute("aria-valuenow")).toBe("256");
    await expect(slider.getAttribute("aria-valuemin")).toBe("96");
    await expect(slider.getAttribute("aria-valuemax")).toBe("1000");
    await expect(slider.getAttribute("aria-orientation")).toBe("vertical");

    // The panel carries the shared pane header: title plus its own hide
    // control, which collapses through the same persisted flag as the
    // strip toggle. Ends open (re-expanded) so the baseline shows it.
    await expect(
      bar.getByRole("heading", { name: "Diagnostics" }),
    ).toBeVisible();
    await userEvent.click(
      bar.getByRole("button", { name: "Hide Diagnostics" }),
    );
    await expect(panel).not.toBeVisible();
    await userEvent.click(
      bar.getByRole("button", { name: "Expand diagnostics" }),
    );
    // Re-query: the panel is inside an `{#if expanded}`, so hiding destroyed
    // the node — the reference captured above is detached, not hidden.
    await expect(canvas.getByTestId("diagnostics-panel")).toBeVisible();
  },
};
