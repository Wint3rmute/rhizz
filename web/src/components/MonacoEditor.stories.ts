import type { Meta, StoryObj } from "@storybook/svelte";
import { expect, waitFor, within } from "storybook/test";
import MonacoEditorHost from "./MonacoEditorHost.svelte";

// The one editor the app uses, on both surfaces that edit text: the Code page
// (HCL) and the Inventory's documentation tab (Markdown). It had no stories at
// all until now, which is why its `options` escape hatch had nothing standing
// behind it — the Inventory is the only caller that passes one, and nothing
// would have noticed the option being dropped.

const meta = {
  title: "Components/MonacoEditor",
  component: MonacoEditorHost,
  args: {
    value: "",
    language: "hcl",
  },
} satisfies Meta<typeof MonacoEditorHost>;

export default meta;

type Story = StoryObj<typeof meta>;

const BATTERY_PROSE =
  "# Battery\n\nA single paragraph that is deliberately much longer than this editor is wide, so the only way to read all of it without a horizontal scrollbar is for the line to wrap onto the next one.\n";

/** The label Monaco puts on the hidden textarea it focuses. */
const EDITOR_CONTENT = "Editor content";

/**
 * The rendered editor around `textarea`: its `.monaco-editor` root, its
 * `.view-lines`, and its on-screen text.
 *
 * Text is read off the DOM rather than queried per line, because Monaco splits
 * every line into one span per token and breaks wrapped lines across several
 * `.view-line` elements — no single element holds the string you want. Note
 * the `\s` in the patterns callers pass: Monaco pads wrapped segments with
 * non-breaking spaces, which `\s` matches and a literal space does not.
 */
function rendered(textarea: HTMLElement) {
  const editor = textarea.closest(".monaco-editor");
  if (!editor) throw new Error("the textarea should sit in a .monaco-editor");
  const lines = editor.querySelector(".view-lines");
  if (!lines) throw new Error("Monaco should have rendered .view-lines");
  // No `?? ""`: `textContent` is never null on an element — an empty one is
  // the empty string — so the fallback would be dead code.
  return {
    editor: editor as HTMLElement,
    lines: lines as HTMLElement,
    text: editor.textContent,
  };
}

/**
 * Monaco renders its first lines asynchronously — the language's tokenizer is a
 * lazily imported chunk — so an editor can exist, with its textarea focused and
 * a `.view-lines` node, and still be showing nothing. Every assertion below
 * waits, because one that does not is satisfied by an editor that never painted:
 * zero-width lines make "does not overflow" true for the wrong reason.
 */
async function waitForRendered(textarea: HTMLElement, text: RegExp) {
  await waitFor(() => {
    // `void`, not `await`: a `waitFor` callback must be synchronous, and
    // Storybook's `expect` is thenable (hence the `await expect(...)` the rest
    // of the suite writes).
    void expect(rendered(textarea).text).toMatch(text);
  });
}

// The Code page's configuration, which is also the component's defaults.
export const Hcl: Story = {
  args: {
    value:
      'system "drone" {\n  instance "fc" {\n    source = "flight-controller"\n  }\n}\n',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const textarea = await canvas.findByLabelText(EDITOR_CONTENT);
    await waitForRendered(textarea, /source\s*=\s*"flight-controller"/);
  },
};

// `options`: the Inventory's documentation editor wraps long lines, because its
// pane is two fifths of a row and Monaco's own markdown configuration sets no
// `wordWrap` — unwrapped, a prose line is one long horizontal scroll.
//
// Asserted geometrically rather than by reading the option back: with wrapping
// on, the rendered lines stay inside the editor's width; without it,
// `.view-lines` is as wide as its longest line.
export const MarkdownWordWrapped: Story = {
  args: {
    language: "markdown",
    value: BATTERY_PROSE,
    options: { wordWrap: "on" },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const textarea = await canvas.findByLabelText(EDITOR_CONTENT);
    await waitForRendered(textarea, /only\s+way\s+to\s+read\s+all/);
    const { editor, lines } = rendered(textarea);
    // Generous slack — this is about "not one long line", not about a pixel.
    await waitFor(() => {
      void expect(lines.scrollWidth).toBeLessThanOrEqual(
        editor.clientWidth + 8,
      );
    });
  },
};

// The counter-case: the same prose in the same box with wrapping off really is
// one long line. Without it the measurement above could be passing because the
// editor is too narrow to overflow *anything*, rather than because wrapping
// works.
export const MarkdownUnwrappedOverflows: Story = {
  args: {
    language: "markdown",
    value: BATTERY_PROSE,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const textarea = await canvas.findByLabelText(EDITOR_CONTENT);
    await waitForRendered(textarea, /only\s+way\s+to\s+read\s+all/);
    const { editor, lines } = rendered(textarea);
    await waitFor(() => {
      void expect(lines.scrollWidth).toBeGreaterThan(editor.clientWidth);
    });
  },
};
