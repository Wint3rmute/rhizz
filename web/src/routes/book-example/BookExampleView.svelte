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
import { highlightHcl } from "./hclHighlight";
import type { BookPayloadFile } from "./payload";

let { files, open = null }: { files: BookPayloadFile[]; open?: string | null } =
  $props();

// Resolve the `?open=` target: exact path first, then a bare filename
// (e.g. `main.hcl` matches `diagrams/main.hcl`).
function matchOpen(candidates: string[], target: string | null): string | null {
  if (target === null) return null;
  if (candidates.includes(target)) return target;
  return candidates.find((path) => path.split("/").pop() === target) ?? null;
}
const infoIcon = resolveIcon("circle-info");
const codeIcon = resolveIcon("code");
const diagramIcon = resolveIcon("diagram-project");

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

interface StatRow {
  label: string;
  complete: number;
  total: number;
}

// Book-panel-style completion stats (rhizz-stats): per-category
// complete/total plus the overall percentage. Absent when compilation
// produced no model — mirroring the book, which omits the score then.
let stats = $derived.by((): { rows: StatRow[]; overall: number } | null => {
  const report = score;
  if (report === undefined) return null;
  const rows: StatRow[] = [];
  for (
    const [label, cat] of [
      ["Components", report.components],
      ["Ports", report.ports],
      ["Connections", report.connections],
      ["Messages", report.messages],
    ] as const
  ) {
    rows.push({
      label,
      complete: cat.complete,
      total: cat.complete + cat.partial + cat.incomplete,
    });
  }
  return { rows, overall: report.overall_percentage };
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

function isDiagram(path: string | null): boolean {
  return path !== null &&
    diagramFiles.some((file) => file.path === path);
}

let selectedFile = $state<string | null>(null);
let diagramView = $state(true);
$effect(() => {
  if (
    selectedFile === null ||
    !files.some((file) => file.path === selectedFile)
  ) {
    selectedFile = diagramFiles[0]?.path ?? files[0]?.path ?? null;
    diagramView = true;
  }
});

// `open` selects the initial file only: apply once files are present, then
// never again so later navigation is undisturbed.
let openFile = $derived(
  matchOpen(
    files.map((file) => file.path),
    open,
  ),
);
let openConsumed = $state(false);
$effect(() => {
  if (openConsumed || files.length === 0) return;
  openConsumed = true;
  if (openFile !== null) {
    selectedFile = openFile;
    diagramView = true;
  }
});

let selectedViews = $derived.by((): ViewDefinition[] => {
  return diagramFiles.find((entry) => entry.path === selectedFile)?.views ??
    [];
});

// Diagram files render as diagrams unless toggled to code; anything else
// always renders as code.
let showDiagram = $derived(diagramView && isDiagram(selectedFile));

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

let codeContent = $derived(
  files.find((file) => file.path === selectedFile)?.content ?? "",
);
let highlightedCode = $derived(highlightHcl(codeContent));

// The toggle offers the *other* view of a diagram file; for anything else
// it renders grayed out so the bar never shifts.
let toggleIcon = $derived(
  !isDiagram(selectedFile) || !diagramView ? diagramIcon : codeIcon,
);
let toggleLabel = $derived(
  !isDiagram(selectedFile)
    ? "Diagram view unavailable"
    : diagramView
    ? "Show code"
    : "Show diagram",
);
</script>

<div class="flex flex-col w-full h-full bg-base-100 text-base-content">
  <!-- Top bar: one tab per file (full paths) + view toggle + info. The
       toggle is always rendered so the bar never shifts. -->
  <div class="flex items-center gap-2 px-3 pt-2">
    <button
      class="btn btn-ghost btn-sm btn-square shrink-0"
      class:opacity-40={!isDiagram(selectedFile)}
      disabled={!isDiagram(selectedFile)}
      title={toggleLabel}
      aria-label={toggleLabel}
      onclick={() => {
        diagramView = !diagramView;
      }}
    >
      {#if toggleIcon}
        <svg
          width="16"
          height="16"
          viewBox="0 0 {toggleIcon.width} {toggleIcon.height}"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d={toggleIcon.svgPath} />
        </svg>
      {/if}
    </button>
    <div role="tablist" class="tabs tabs-box flex-nowrap overflow-x-auto">
      {#each files as file (file.path)}
        <button
          role="tab"
          class="tab whitespace-nowrap"
          class:tab-active={file.path === selectedFile}
          onclick={() => {
            selectedFile = file.path;
            diagramView = true;
          }}
        >
          {file.path}
        </button>
      {/each}
    </div>
    {#if infoIcon}
      <div
        class="tooltip tooltip-left flex items-center ml-auto shrink-0"
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

  <div class="flex-1 min-h-0 p-3">
    {#if showDiagram}
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
      <pre class="w-full h-full overflow-auto rounded-lg bg-base-200 p-4 text-sm"><code>{#each highlightedCode as token, i (i)}{#if token.cls === "plain"}{token.text}{:else}<span class="hcl-{token.cls}">{token.text}</span>{/if}{/each}</code></pre>
    {/if}
  </div>

  {#if compileCrashed}
    <div class="px-3 pb-2">
      <div role="alert" class="alert alert-error">
        The project failed to compile in the browser.
      </div>
    </div>
  {:else if diagnostics.length > 0}
    <div class="max-h-48 overflow-auto px-3 pb-2">
      <CompilationDiagnosticsOutline {diagnostics} />
    </div>
  {/if}

  {#if stats}
    <div class="px-3 pb-3">
      <ul class="flex flex-wrap gap-x-5 gap-y-1 px-1 text-sm">
        {#each stats.rows as row (row.label)}
          <li>
            <span class="opacity-70">{row.label}</span>
            <b class="ml-1 tabular-nums">{row.complete}/{row.total}</b>
          </li>
        {/each}
        <li>
          <span class="opacity-70">Overall</span>
          <b class="ml-1 tabular-nums">{stats.overall.toFixed(1)}%</b>
        </li>
      </ul>
    </div>
  {/if}
</div>

<style>
/* Read-only HCL highlighting, matching the book's highlight.js theme. */
.hcl-keyword {
  color: #9d00ec;
  font-weight: 600;
}
.hcl-string {
  color: #008200;
}
/* Dark-theme placeholders: light values until reviewed in dark mode. */
:global(html[data-theme="dark"]) .hcl-keyword {
  color: #9d00ec;
}
:global(html[data-theme="dark"]) .hcl-string {
  color: #008200;
}
</style>
