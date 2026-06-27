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

  $effect(() => {
    monaco.editor.defineTheme("daisy", {
      base: "vs-dark",
      inherit: true,
      rules: [],
      colors: {
        "editor.background": cssVarToHex("--color-gray-800"),
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

    const editor = monaco.editor.create(editor_div, {
      value: untrack(() => value),
      language,
      lineNumbers: "off",
      roundedSelection: false,
      scrollBeyondLastLine: false,
      readOnly: false,
      theme: "daisy",
      automaticLayout: true,
    });

    const on_content_changed = editor.onDidChangeModelContent(() => {
      value = editor.getValue();
    });

    return () => {
      on_content_changed.dispose();
      editor.dispose();
    };
  });
</script>

<div bind:this={editor_div} class="w-full h-full"></div>
