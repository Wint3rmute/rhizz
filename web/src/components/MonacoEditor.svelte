<script lang="ts">
import * as monaco from "monaco-editor";
import { untrack } from "svelte";
import { cssVarToHex } from "../css_var_to_hex";

interface Props {
  value: string;
  language?: string;
}

let { value = $bindable(), language = "plaintext" }: Props = $props();

let editor_div: HTMLDivElement;
let editor: monaco.editor.IStandaloneCodeEditor | undefined;

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
