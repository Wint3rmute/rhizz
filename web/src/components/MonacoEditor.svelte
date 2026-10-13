<script lang="ts">
import * as monaco from "monaco-editor";
import { untrack } from "svelte";
import { cssVarToHex } from "../css_var_to_hex";

interface Props {
  value: string;
  language?: string;
  /** Monaco options merged over the defaults below. Create-time only. */
  options?: monaco.editor.IStandaloneEditorConstructionOptions;
  /** The live editor, for callers that need `focus()` or a selection. */
  editor?: monaco.editor.IStandaloneCodeEditor | undefined;
  /**
   * Background tone. `"base-200"` (default) sits on a panel; `"base-300"` is
   * the darker recessed tone of a workspace's central content area, like the
   * diagram canvas; `"base-100"` is the bright panel tone, for editors that
   * sit beside a panel and should read as one surface with it. Create-time
   * only, like `options`.
   */
  surface?: "base-100" | "base-200" | "base-300";
}

let {
  value = $bindable(),
  language = "plaintext",
  options = {},
  editor = $bindable(undefined),
  surface = "base-200",
}: Props = $props();

let editor_div: HTMLDivElement;

// One theme per surface, snapshotted from the live daisyUI variables so the
// editor matches the page around it. The snapshot is a function, not a
// one-off: daisyUI swaps the variables under us whenever `<html data-theme>`
// changes (a user theme toggle, the OS preference flipping under "auto",
// Storybook's theme switcher), and Monaco never re-reads them on its own —
// without re-snapshotting, the editor keeps the theme it mounted with while
// the page around it moves on.
function themeColors(backgroundVar: string): monaco.editor.IColors {
  return {
    "editor.background": cssVarToHex(backgroundVar),
    "editor.foreground": cssVarToHex("--color-base-content"),
    "editor.lineHighlightBackground": cssVarToHex("--color-base-300"),
    "editorLineNumber.foreground": cssVarToHex(
      "--color-base-content",
    ),
    "editorCursor.foreground": cssVarToHex("--color-primary"),
    "editor.selectionBackground": cssVarToHex("--color-primary") + "55",
    "editorWidget.background": cssVarToHex("--color-base-300"),
    "editorWidget.border": cssVarToHex("--color-base-100"),
    "input.background": cssVarToHex(backgroundVar),
    "input.foreground": cssVarToHex("--color-base-content"),
  };
}

$effect(() => {
  // The surface is create-time (untracked, like `options`): each surface
  // gets its own Monaco theme name with its own background.
  const current = untrack(() => surface);
  const background = current === "base-300"
    ? "--color-base-300"
    : current === "base-100"
    ? "--color-base-100"
    : "--color-base-200";
  const themeName = current === "base-300"
    ? "daisy-recessed"
    : current === "base-100"
    ? "daisy-panel"
    : "daisy";
  monaco.editor.defineTheme(themeName, {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: themeColors(background),
  });

  const created = monaco.editor.create(editor_div, {
    value: untrack(() => value),
    language,
    lineNumbers: "off",
    roundedSelection: false,
    scrollBeyondLastLine: false,
    readOnly: false,
    theme: themeName,
    automaticLayout: true,
    // Untracked like `value`, and for a sharper reason: callers pass this
    // inline — `options={{ wordWrap: "on" }}` — which hands us a *new* object
    // on every render. Tracking it would tear the editor down and rebuild it
    // on every keystroke (the parent re-renders on each one, since `value` is
    // two-way bound), throwing away the cursor, the scroll position and the
    // undo stack. So options are create-time only, and `language` remains the
    // one prop that rebuilds the editor.
    ...untrack(() => options),
  });
  editor = created;

  const on_content_changed = created.onDidChangeModelContent(() => {
    value = created.getValue();
  });

  // Re-snapshot the theme whenever the page's theme flips: re-defining a
  // theme name updates its stored colors, and `updateOptions({ theme })`
  // repaints this editor from them — without tearing the editor down (no
  // lost cursor, scroll, or undo stack). Observed via the attribute itself
  // rather than the app's ThemeState so Storybook's theme switcher (which
  // sets `data-theme` directly) is followed the same way.
  const theme_observer = new MutationObserver(() => {
    monaco.editor.defineTheme(themeName, {
      base: "vs-dark",
      inherit: true,
      rules: [],
      colors: themeColors(background),
    });
    created.updateOptions({ theme: themeName });
  });
  theme_observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });

  return () => {
    theme_observer.disconnect();
    on_content_changed.dispose();
    created.dispose();
    editor = undefined;
  };
});

// Sync external changes to `value` (e.g. loading an example project) into
// the editor. Changes originating from the editor itself are filtered out
// by the equality check below, avoiding feedback loops.
$effect(() => {
  if (editor && value !== editor.getValue()) {
    editor.setValue(value);
  }
});
</script>

<div bind:this={editor_div} class="w-full h-full"></div>
