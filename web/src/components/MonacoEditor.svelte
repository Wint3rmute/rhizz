<script lang="ts">
import * as monaco from "monaco-editor";
import { untrack } from "svelte";
import { cssVarToHex } from "../css_var_to_hex";

interface Props {
  value: string;
  language?: string;
  /**
   * Monaco options merged over the defaults below. Applied at create time
   * only — see the `untrack` at the call site for why that matters.
   */
  options?: monaco.editor.IStandaloneEditorConstructionOptions;
  /** The live editor, for callers that need `focus()` or a selection. */
  editor?: monaco.editor.IStandaloneCodeEditor | undefined;
}

let {
  value = $bindable(),
  language = "plaintext",
  options = {},
  editor = $bindable(undefined),
}: Props = $props();

let editor_div: HTMLDivElement;

$effect(() => {
  monaco.editor.defineTheme("daisy", {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": cssVarToHex("--color-base-200"),
      "editor.foreground": cssVarToHex("--color-base-content"),
      "editor.lineHighlightBackground": cssVarToHex("--color-base-300"),
      "editorLineNumber.foreground": cssVarToHex(
        "--color-base-content",
      ),
      "editorCursor.foreground": cssVarToHex("--color-primary"),
      "editor.selectionBackground": cssVarToHex("--color-primary") + "55",
      "editorWidget.background": cssVarToHex("--color-base-300"),
      "editorWidget.border": cssVarToHex("--color-base-100"),
      "input.background": cssVarToHex("--color-base-200"),
      "input.foreground": cssVarToHex("--color-base-content"),
    },
  });

  const created = monaco.editor.create(editor_div, {
    value: untrack(() => value),
    language,
    lineNumbers: "off",
    roundedSelection: false,
    scrollBeyondLastLine: false,
    readOnly: false,
    theme: "daisy",
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

  return () => {
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
