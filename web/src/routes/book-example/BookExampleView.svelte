<script lang="ts">
import CompilationDiagnosticsOutline from "../../components/CompilationDiagnosticsOutline.svelte";
import { resolveIcon } from "../../iconHelper";
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

type Tab = "diagram" | "code";

let { files }: { files: BookPayloadFile[] } = $props();

let tab = $state<Tab>("diagram");
let verdictOpen = $state(false);
const infoIcon = resolveIcon("circle-info");

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

function plural(count: number, word: string): string {
  return `${String(count)} ${word}${count === 1 ? "" : "s"}`;
}

// Book-panel-style verdict summary, pinned to the bottom of the embed.
let verdict = $derived.by(() => {
  if (compileCrashed) {
    return {
      kind: "error" as const,
      text: "The project failed to compile in the browser.",
    };
  }
  if (errorCount > 0) {
    return {
      kind: "error" as const,
      text: `✗ ${plural(errorCount, "error")}, ${
        plural(warningCount, "warning")
      } — no score`,
    };
  }
  if (warningCount > 0) {
    const percent = score?.overall_percentage;
    const tail = percent === undefined
      ? "no completion score produced"
      : `model completes at ${percent.toFixed(1)}%`;
    return {
      kind: "warn" as const,
      text: `⚠ ${plural(warningCount, "warning")} — ${tail}`,
    };
  }
  return { kind: "ok" as const, text: "✓ No errors, no warnings" };
});

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
  <!-- Top bar: tabs + score + info only, so its height never shifts. -->
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
    </div>
    {#if score !== undefined}
      <span class="ml-auto text-sm text-base-content/60">
        Completeness {score.overall_percentage.toFixed(1)}%
      </span>
    {/if}
    {#if infoIcon}
      <div
        class="tooltip tooltip-left flex items-center"
        data-tip="Rhizz book example — rendered locally in your browser, nothing is saved."
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 {infoIcon.width} {infoIcon.height}"
          fill="currentColor"
          class="text-base-content/50"
          role="img"
          aria-label="About this embed"
        >
          <path d={infoIcon.svgPath} />
        </svg>
      </div>
    {/if}
  </div>

  <!-- File selectors live on their own row so the top bar never moves. -->
  {#if tab === "diagram" && diagramFiles.length > 1}
    <div class="px-3 pt-2">
      <select
        class="select select-sm select-bordered"
        aria-label="Select diagram"
        bind:value={selectedDiagram}
      >
        {#each diagramFiles as file (file.path)}
          <option value={file.path}>{file.path}</option>
        {/each}
      </select>
    </div>
  {/if}
  {#if tab === "code" && files.length > 1}
    <div class="px-3 pt-2">
      <select
        class="select select-sm select-bordered"
        aria-label="Select file"
        bind:value={selectedCodeFile}
      >
        {#each files as file (file.path)}
          <option value={file.path}>{file.path}</option>
        {/each}
      </select>
    </div>
  {/if}

  <div class="flex-1 min-h-0 p-3">
    {#if tab === "diagram"}
      {#if compileCrashed}
        <div role="alert" class="alert alert-error">
          The project failed to compile in the browser — details below.
        </div>
      {:else if Object.keys(boxes).length === 0}
        <div class="flex h-full items-center justify-center text-sm text-base-content/60">
          No placed components in this diagram.
        </div>
      {:else}
        <DiagramStaticView {components} {connections} {boxes} {annotations} />
      {/if}
    {:else}
      <pre class="w-full h-full overflow-auto rounded-lg bg-base-200 p-4 text-sm">{codeContent}</pre>
    {/if}
  </div>

  {#if verdictOpen}
    <div class="max-h-48 overflow-auto px-3">
      {#if compileCrashed}
        <div role="alert" class="alert alert-error mb-2">
          The project failed to compile in the browser.
        </div>
      {:else}
        <CompilationDiagnosticsOutline {diagnostics} />
      {/if}
    </div>
  {/if}

  <div class="p-3 pt-0">
    <button
      class="alert w-full py-2 text-sm"
      class:alert-error={verdict.kind === "error"}
      class:alert-warning={verdict.kind === "warn"}
      class:alert-success={verdict.kind === "ok"}
      onclick={() => {
        verdictOpen = !verdictOpen;
      }}
      aria-expanded={verdictOpen}
    >
      <span>{verdict.text}</span>
    </button>
  </div>
</div>
