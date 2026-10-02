import type { Meta, StoryObj } from "@storybook/svelte";
import { expect, fn, userEvent, within } from "storybook/test";
import CommandPalette from "./CommandPalette.svelte";
import type { PaletteItem } from "./commandPalette";

const ITEMS: PaletteItem[] = [
  {
    id: "cmd:overview",
    label: "Go to Overview",
    group: "Navigate",
    icon: "🔍",
  },
  {
    id: "cmd:modeling",
    label: "Go to Modeling",
    group: "Navigate",
    icon: "📐",
  },
  {
    id: "cmd:inventory",
    label: "Go to Inventory",
    group: "Navigate",
    icon: "📦",
  },
  { id: "cmd:explore", label: "Go to Explore", group: "Navigate", icon: "🧭" },
  { id: "cmd:code", label: "Go to Code", group: "Navigate", icon: "📝" },
  {
    id: "file:system",
    label: "system.hcl",
    detail: "main model",
    group: "Files",
  },
  { id: "file:views/main", label: "views/main.hcl", group: "Files" },
  { id: "file:docs/engine", label: "docs/engine.md", group: "Files" },
];

// The palette is a fixed-position dialog, so the stories render fullscreen —
// otherwise the backdrop is clipped to the canvas' default padding and the
// baselines say nothing about how the dialog reads as *over* a page.
const meta = {
  title: "Components/Palette/CommandPalette",
  component: CommandPalette,
  parameters: { layout: "fullscreen" },
  args: {
    isOpen: true,
    items: ITEMS,
    onselect: fn(),
    onclose: fn(),
    title: "Go to",
    placeholder: "Search files and commands…",
  },
} satisfies Meta<typeof CommandPalette>;

export default meta;
type Story = StoryObj<typeof meta>;

export const BrowseAll: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("dialog", { name: "Go to" }),
    ).toBeInTheDocument();
    await expect(canvas.getAllByRole("option")).toHaveLength(ITEMS.length);
    await expect(canvas.getByText("Navigate")).toBeInTheDocument();
    await expect(canvas.getByText("Files")).toBeInTheDocument();
    // The first row starts highlighted so Enter does something useful
    // without the user having to reach for the arrow keys.
    await expect(canvas.getAllByRole("option")[0]).toHaveAttribute(
      "aria-selected",
      "true",
    );
  },
};

// The palette must not disturb the page it was summoned from, and the part
// that is easy to get wrong is not the page but the *browser*: daisyUI's
// `.modal` carries a `:root:has(&)` rule that reaches `<html>` the moment the
// dialog opens, and with nothing pinning the browser's own toolbar colour it
// re-inferred it — so the toolbar visibly jumped. Overriding the scrim's
// colour, as this component used to, does not help: the rule still targets
// the root.
//
// So the assertion is on the absence of those classes, which is the part that
// actually caused it, plus the two visible symptoms.
export const NoScrim: Story = {
  play: async ({ canvasElement }) => {
    const backdrop = within(canvasElement).getByTestId("command-palette");
    for (const daisyModalClass of ["modal", "modal-open", "modal-box"]) {
      await expect(backdrop).not.toHaveClass(daisyModalClass);
      await expect(
        backdrop.querySelector(`.${daisyModalClass}`),
      ).not.toBeInTheDocument();
    }
    const style = getComputedStyle(backdrop);
    await expect(style.backdropFilter).toBe("none");
    await expect(style.backgroundColor).toBe("rgba(0, 0, 0, 0)");
    // And the box still declares its own surface, so it reads as floating
    // over the page without a scrim behind it.
    const box = backdrop.querySelector("div");
    if (box === null) throw new Error("palette box is missing");
    await expect(getComputedStyle(box).backgroundColor).not.toBe(
      "rgba(0, 0, 0, 0)",
    );
  },
};

export const FuzzyFiltered: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // "engr" skips the "i" in "engine" and lands on the next "n": the live
    // highlight has to light up each matched run where it actually lands,
    // not just the first one.
    await userEvent.type(canvas.getByTestId("command-palette-input"), "engr");
    await expect(canvas.getAllByRole("option")).toHaveLength(1);
    const marks = canvas.getAllByText((_, node) => node?.tagName === "MARK");
    await expect(marks.map((m) => m.textContent)).toEqual(["eng", "n"]);
  },
};

export const GroupsHiddenWhileSearching: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Navigate")).toBeInTheDocument();
    await userEvent.type(
      canvas.getByTestId("command-palette-input"),
      "modeling",
    );
    await expect(canvas.queryByText("Navigate")).not.toBeInTheDocument();
    await expect(canvas.getAllByRole("option")).toHaveLength(1);
  },
};

export const NoMatches: Story = {
  args: { emptyMessage: "No matching commands" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(
      canvas.getByTestId("command-palette-input"),
      "zzzzzz",
    );
    await expect(
      canvas.getByTestId("command-palette-empty"),
    ).toHaveTextContent("No matching commands");
    await expect(canvas.queryAllByRole("option")).toHaveLength(0);
  },
};

export const Loading: Story = {
  args: { items: [], loading: true },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByTestId("command-palette-empty"),
    ).toHaveTextContent("Loading…");
  },
};

export const ArrowKeysWrapAround: Story = {
  args: { items: ITEMS.slice(0, 3) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(
      canvas.getByTestId("command-palette-input"),
      "{ArrowDown}",
    );
    await expect(canvas.getAllByRole("option")[1]).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await userEvent.type(
      canvas.getByTestId("command-palette-input"),
      "{ArrowUp}{ArrowUp}",
    );
    // Past the top wraps to the last row, not to nothing.
    await expect(canvas.getAllByRole("option")[2]).toHaveAttribute(
      "aria-selected",
      "true",
    );
  },
};

export const EnterRunsTheAction: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.type(
      canvas.getByTestId("command-palette-input"),
      "{Enter}",
    );
    await expect(args.onselect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "cmd:overview" }),
    );
  },
};

export const ClickRunsTheAction: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("option", { name: /go to explore/i }),
    );
    await expect(args.onselect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "cmd:explore" }),
    );
  },
};

export const EscapeCloses: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.type(
      canvas.getByTestId("command-palette-input"),
      "{Escape}",
    );
    await expect(args.onclose).toHaveBeenCalled();
  },
};
