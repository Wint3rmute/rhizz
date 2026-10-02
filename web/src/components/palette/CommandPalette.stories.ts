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

// The palette darkens the page behind it, and that is fine — a scrim is what
// separates a floating panel from whatever it floats over. What it must NOT
// do is blur, and it must not carry daisyUI's `.modal`, whose `:root:has(&)`
// rule reaches `<html>` the moment the dialog opens and made the browser
// re-infer its own toolbar colour.
//
// So three separate things, asserted separately: no blur, a real scrim, and
// none of the classes that caused the jump.
export const ScrimWithoutBlur: Story = {
  play: async ({ canvasElement }) => {
    const backdrop = within(canvasElement).getByTestId("command-palette");
    for (const daisyModalClass of ["modal", "modal-open", "modal-box"]) {
      await expect(backdrop).not.toHaveClass(daisyModalClass);
      await expect(
        backdrop.querySelector(`.${daisyModalClass}`),
      ).not.toBeInTheDocument();
    }
    const style = getComputedStyle(backdrop);
    // Darkening, yes — but the page stays legible through it, and no blur:
    // a blur over a live editor costs a compositing pass per frame and
    // hides the very page the palette is about.
    await expect(style.backdropFilter).toBe("none");
    const channels = style.backgroundColor.match(/[\d.]+/g) ?? [];
    if (channels.length !== 4) {
      throw new Error(`unexpected scrim colour: ${style.backgroundColor}`);
    }
    const [r, g, b, a] = channels.map(Number);
    await expect([r, g, b]).toEqual([0, 0, 0]);
    await expect(a).toBeGreaterThan(0.2);
    await expect(a).toBeLessThan(1);
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

// Long enough to overflow the list's `max-h-[70vh]`, in three groups so
// headings are interleaved with the rows.
const LONG_ITEMS: PaletteItem[] = [
  ...["Navigate", "Files", "Inventory"].flatMap((group) =>
    Array.from({ length: 15 }, (_, i) => ({
      id: `${group}:${String(i)}`,
      label: `${group} row ${String(i)}`,
      group,
    }))
  ),
];

// The highlight has to be *visible*, not merely selected: the list scrolls,
// and walking into the last group has to bring the highlighted row with it.
export const ScrollsHighlightIntoView: Story = {
  args: { items: LONG_ITEMS },
  // No baseline: this story is about scroll geometry, and a pinned
  // screenshot of "Navigate row 12" says nothing about which row is in view.
  tags: ["no-vrt"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByTestId("command-palette-input");
    const list = canvas.getByTestId("command-palette-list");

    // Precondition: the list really does overflow, or nothing is tested.
    if (list.scrollHeight <= list.clientHeight) {
      throw new Error(
        `list does not overflow: scrollHeight ${
          String(list.scrollHeight)
        } <= clientHeight ${String(list.clientHeight)}`,
      );
    }

    // Walks down to `target` and reports why the highlighted row is not
    // inside the list's visible window — or null when it is.
    const walkTo = async (target: number): Promise<string | null> => {
      await userEvent.click(input);
      for (let i = 0; i < target; i += 1) {
        await userEvent.keyboard("{ArrowDown}");
      }
      const options = canvas.getAllByRole("option");
      const index = options.findIndex(
        (el) => el.getAttribute("aria-selected") === "true",
      );
      const highlighted = options[index];
      if (highlighted === undefined) return "no highlighted option";
      const view = list.getBoundingClientRect();
      const row = highlighted.getBoundingClientRect();
      if (row.top >= view.top - 1 && row.bottom <= view.bottom + 1) return null;
      return (
        `row ${String(index)} "${highlighted.textContent.trim()}" sits at ` +
        `${row.top.toFixed(0)}..${row.bottom.toFixed(0)}, outside the window ` +
        `${view.top.toFixed(0)}..${view.bottom.toFixed(0)} (scrollTop ${
          String(list.scrollTop)
        })`
      );
    };

    // Grouped, on an empty query: the headings are siblings of the rows.
    const grouped = await walkTo(40);

    // Control: the identical walk with the headings hidden, which is what
    // typing does. Same list, same code path, only the headings differ — so
    // if this one is in view and the other is not, the headings are the cause.
    await userEvent.clear(input);
    await userEvent.type(input, "row");
    await expect(canvas.queryByText("Navigate")).not.toBeInTheDocument();
    const searched = await walkTo(40);

    if (grouped !== null || searched !== null) {
      throw new Error(
        `grouped (headings on screen): ${grouped ?? "in view"}\n` +
          `searched (headings hidden): ${searched ?? "in view"}`,
      );
    }
  },
};
