<script lang="ts">
import CompilationDiagnosticsOutline from "../../components/CompilationDiagnosticsOutline.svelte";
import {
  compile_system,
  parse_views,
  type ViewDefinition,
} from "../../rhizz_wasm_wrapper";
import DiagramStaticView from "../projects/[id]/diagrams/DiagramStaticView.svelte";
import {
  buildKeyToIndexMap,
  mapLayoutToBoxes,
  viewsToLayout,
} from "../projects/[id]/diagrams/persistence";
import type { DiagramStaticAnnotation } from "../projects/[id]/diagrams/types";
import type { BookPayloadFile } from "./payload";

type Tab = "diagram" | "code" | "diagnostics";

let { files }: { files: BookPayloadFile[] } = $props();

let tab = $state<Tab>("diagram");

// Sources mirror `readProjectSources`: every `.hcl` file except diagram
// layouts (those live under `diagrams/` and are parsed as views instead).
let sources = $derived(
  files
    .filter(
      (file) =>
        file.path.endsWith(".hcl") && !file.path.startsWith("diagrams/"),
    )
    .map((file) => ({ filename: file.path, content: file.content })),
);

let output = $derived.by(() => {
  if (sources.length === 0) return null;
  try {
    return compile_system(sources);
  } catch {
    return null;
  }
});
let compileCrashed = $derived(sources.length > 0 && output === null);

let model = $derived(output?.model());
let components = $derived(model?.components() ?? []);
let connections = $derived(model?.connections() ?? []);
let systems = $derived(model?.systems() ?? []);
let diagnostics = $derived(output?.diagnostics() ?? []);
let score = $derived(model?.score());
let errorCount = $derived(output?.error_count() ?? 0);
let warningCount = $derived(output?.warning_count() ?? 0);

interface DiagramFile {
  path: string;
  views: ViewDefinition[];
}

// Any `.hcl` file carrying view blocks is a diagram candidate — this covers
// both `diagrams/*.hcl` layouts and root-level `views.hcl` files shipped by
// the worked examples. Files that fail to parse as views are skipped.
let diagramFiles = $derived.by((): DiagramFile[] => {
  const out: DiagramFile[] = [];
  for (const file of files) {
    if (!file.path.endsWith(".hcl")) continue;
    try {
      const views = parse_views(file.content);
      if (views.length > 0) out.push({ path: file.path, views });
    } catch {
      // Not a views file — ignore it here (it may still be a model source).
    }
  }
  return out;
});
let selectedDiagram = $state<string | null>(null);
$effect(() => {
  if (
    selectedDiagram === null ||
    !diagramFiles.some((file) => file.path === selectedDiagram)
  ) {
    selectedDiagram = diagramFiles[0]?.path ?? null;
  }
});

let selectedViews = $derived.by((): ViewDefinition[] => {
  return diagramFiles.find((entry) => entry.path === selectedDiagram)?.views ??
    [];
});

let keyToIndex = $derived(buildKeyToIndexMap(components, systems));
let boxes = $derived(
  mapLayoutToBoxes(viewsToLayout(selectedViews).checked, keyToIndex),
);
let annotations = $derived.by((): DiagramStaticAnnotation[] => {
  const out: DiagramStaticAnnotation[] = [];
  for (const view of selectedViews) {
    for (const annotation of view.annotations ?? []) {
      const entry: DiagramStaticAnnotation = {
        text: annotation.text,
        x: annotation.x,
        y: annotation.y,
      };
      if (annotation.scale !== undefined) entry.scale = annotation.scale;
      out.push(entry);
    }
  }
  return out;
});

let selectedCodeFile = $state<string | null>(null);
$effect(() => {
  if (
    selectedCodeFile === null ||
    !files.some((file) => file.path === selectedCodeFile)
  ) {
    selectedCodeFile = files.find((file) => file.path === "system.hcl")?.path ??
      files[0]?.path ?? null;
  }
});
let codeContent = $derived(
  files.find((file) => file.path === selectedCodeFile)?.content ?? "",
);
</script>

<div class="flex flex-col w-full h-full bg-base-100 text-base-content">
  <div class="flex items-center gap-2 px-3 pt-2">
    <div role="tablist" class="tabs tabs-box">
      <button
        role="tab"
        class="tab"
        class:tab-active={tab === "diagram"}
        onclick={() => {
          tab = "diagram";
        }}
      >
        Diagram
      </button>
      <button
        role="tab"
        class="tab"
        class:tab-active={tab === "code"}
        onclick={() => {
          tab = "code";
        }}
      >
        Code
      </button>
      <button
        role="tab"
        class="tab"
        class:tab-active={tab === "diagnostics"}
        onclick={() => {
          tab = "diagnostics";
        }}
      >
        Errors / Warnings
        {#if errorCount + warningCount > 0}
          <span class="badge badge-sm ml-1" class:badge-error={errorCount > 0} class:badge-warning={errorCount === 0}>
            {errorCount + warningCount}
          </span>
        {/if}
      </button>
    </div>
    {#if tab === "diagram" && diagramFiles.length > 1}
      <select
        class="select select-sm select-bordered"
        aria-label="Select diagram"
        bind:value={selectedDiagram}
      >
        {#each diagramFiles as file (file.path)}
          <option value={file.path}>{file.path}</option>
        {/each}
      </select>
    {/if}
    {#if tab === "code" && files.length > 1}
      <select
        class="select select-sm select-bordered"
        aria-label="Select file"
        bind:value={selectedCodeFile}
      >
        {#each files as file (file.path)}
          <option value={file.path}>{file.path}</option>
        {/each}
      </select>
    {/if}
    {#if score !== undefined}
      <span class="ml-auto text-sm text-base-content/60">
        Completeness {score.overall_percentage.toFixed(1)}%
      </span>
    {/if}
  </div>

  <div class="flex-1 min-h-0 p-3">
    {#if tab === "diagram"}
      {#if compileCrashed}
        <div role="alert" class="alert alert-error">
          The project failed to compile in the browser. See the Errors /
          Warnings tab.
        </div>
      {:else if Object.keys(boxes).length === 0}
        <div class="flex h-full items-center justify-center text-sm text-base-content/60">
          No placed components in this diagram.
        </div>
      {:else}
        <DiagramStaticView {components} {connections} {boxes} {annotations} />
      {/if}
    {:else if tab === "code"}
      <pre class="w-full h-full overflow-auto rounded-lg bg-base-200 p-4 text-sm">{codeContent}</pre>
    {:else}
      <div class="h-full overflow-auto">
        {#if compileCrashed}
          <div role="alert" class="alert alert-error mb-3">
            The project failed to compile in the browser.
          </div>
        {:else}
          <CompilationDiagnosticsOutline {diagnostics} />
        {/if}
      </div>
    {/if}
  </div>
</div>
