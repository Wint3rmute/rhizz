<script lang="ts">
// Story host only: MonacoEditor fills whatever box it is given (`h-full`), and
// a Storybook story root has no height of its own — so without one the editor
// lays out at zero, renders no lines, and every assertion about its content
// passes vacuously. Same reason DiagramCanvasHost supplies an <svg> with
// explicit dimensions.
import type * as monaco from "monaco-editor";
import MonacoEditor from "./MonacoEditor.svelte";

let {
  value = $bindable(),
  language = "hcl",
  options = {},
  editor = $bindable(undefined),
  height = "24rem",
}: {
  value: string;
  language?: string;
  options?: monaco.editor.IStandaloneEditorConstructionOptions;
  editor?: monaco.editor.IStandaloneCodeEditor | undefined;
  /** CSS height of the editor box. */
  height?: string;
} = $props();
</script>

<div class="p-4">
  <div
    class="overflow-hidden rounded border border-base-300"
    style:height={height}
  >
    <MonacoEditor bind:value {language} {options} bind:editor />
  </div>
</div>
