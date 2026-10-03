import type { Meta, StoryObj } from "@storybook/svelte";
import { expect, fn, userEvent, within } from "storybook/test";
import { resolveIcon } from "../../iconHelper";
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

/**
 * The leading glyph for a row whose icon came out of a model, resolved by the
 * caller. `null` — slot drawn, nothing in it — for a row in a list whose
 * neighbours have glyphs, which is what keeps that list's left edge straight.
 * Absent would mean "this row has no slot at all", and the shell can tell the
 * two apart because `exactOptionalPropertyTypes` will not let a caller write
 * `undefined` here by accident.
 */
function glyph(name?: string): Pick<PaletteItem, "icon"> {
  return { icon: resolveIcon(name ?? "") };
}

// One slot, two kinds of glyph: a page command's emoji and a model's resolved
// icon, plus a row with neither. This is the only place the two are drawn side
// by side, which is the only way to see whether they read as one list — a
// 14px SVG path and a colour-emoji in the same 1.25rem column either line up
// or they do not, and no assertion on the markup would say which.
const GLYPH_ITEMS: PaletteItem[] = [
  {
    id: "cmd:modeling",
    label: "Go to Modeling",
    group: "Navigate",
    icon: "📐",
  },
  {
    id: "inventory:battery",
    label: "Go to component battery",
    detail: "Stores power",
    group: "Inventory",
    ...glyph("battery-three-quarters"),
  },
  {
    id: "inventory:rotor",
    label: "Go to component rotor",
    detail: "Spins the blades",
    group: "Inventory",
    // No icon in the model. The slot is still drawn, so this row's label starts
    // where the others' do — included here rather than left out because a
    // ragged left edge is invisible in the markup and glaring in a screenshot.
    ...glyph(),
  },
];

export const TextAndSvgGlyphsShareOneSlot: Story = {
  args: { items: GLYPH_ITEMS },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const command = await canvas.findByRole("option", {
      name: /go to modeling/i,
    });
    const battery = await canvas.findByRole("option", { name: /battery/i });
    const rotor = await canvas.findByRole("option", { name: /rotor/i });
    // The emoji is still text, drawn as text.
    await expect(command).toHaveTextContent("📐");
    await expect(command.querySelector("svg")).toBeNull();
    // The resolved icon is drawn, and drawn inside the same slot — the glyph
    // wrapper is the `aria-hidden` span, so the icon never joins the row's
    // accessible name and cannot change what a search or a screen reader
    // calls the row.
    await expect(
      battery.querySelector('span[aria-hidden="true"] > svg'),
    ).toBeInTheDocument();
    await expect(battery).toHaveTextContent("Go to component battery");
    // And the row with no icon keeps the slot and draws nothing in it, rather
    // than losing the slot (ragged edge) or being given a stand-in glyph.
    const rotorSlot = rotor.querySelector('span[aria-hidden="true"]');
    await expect(rotorSlot).toBeInTheDocument();
    await expect(rotorSlot?.children).toHaveLength(0);
    // Same slot width on both, which is the claim the picture is making.
    await expect(rotorSlot).toHaveClass("w-5");
  },
};

// A query the index rejects and the palette's own matcher rescues. Two words
// with a gap between them, over a label that carries a five-word prefix before
// the part the user is typing: "comp MPS" is a substring of nothing here, and
// as a single eight-character pattern its space cannot line up with the only
// space the label has — the one in "Go to".
export const GappedWordsStillFindTheRow: Story = {
  args: {
    items: [
      {
        id: "command:page:overview",
        label: "Go to Overview",
        group: "Navigate",
        icon: "🔍",
      },
      {
        id: "inventory:MPS",
        label: "Go to component MPS",
        detail: "Main power supply",
        group: "Inventory",
      },
      {
        id: "inventory:battery",
        label: "Go to component battery",
        detail: "Stores power",
        group: "Inventory",
      },
    ] satisfies PaletteItem[],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(
      canvas.getByTestId("command-palette-input"),
      "comp MPS",
    );
    const rows = await canvas.findAllByRole("option");
    await expect(rows).toHaveLength(1);
    await expect(rows[0]).toHaveTextContent("Go to component MPS");
    // Both words are marked where they actually land, and the six characters
    // the query skipped between them are not — a highlight is the only account
    // the user gets of why this row matched.
    const marks = canvas.getAllByText((_, node) => node?.tagName === "MARK");
    await expect(marks.map((m) => m.textContent)).toEqual(["comp", "MPS"]);
  },
};

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
