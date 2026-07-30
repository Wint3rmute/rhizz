<script lang="ts">
import { resolve } from "$app/paths";
import { compile_system } from "../../../../rhizz_wasm_wrapper";
import ModelComponentsOutline from "../../../../components/ModelComponentsOutline.svelte";
import CompilationDiagnosticsOutline from "../../../../components/CompilationDiagnosticsOutline.svelte";
import MonacoEditor from "../../../../components/MonacoEditor.svelte";
import ModelStatsRow from "../../../../components/ModelStatsRow.svelte";
import { projectStore } from "../../../../ProjectState.svelte";
import { openProjectFs } from "../../../../vfs/fs";
import type { PageProps } from "./$types";

let { data }: PageProps = $props();

// Until Task 58 adds a real file-tree sidebar, every project has exactly
// one editable file, always at this well-known path (see
// ProjectState.svelte's createProjectWithMainFile) — this page just
// reads/writes it directly, the same way any ordinary fs-based program
// would open a known file by path.
const MAIN_FILE_PATH = "main.hcl";

let fs = $derived(openProjectFs(projectStore, data.projectId));

let content = $state("");
let loadedProjectId: string | null = null;
let lastWrittenContent = "";

// Loads the file's content into the editor once, when the project first
// becomes available (or changes identity — e.g. after switching
// projects). Missing files (e.g. a project that predates this
// convention) fall back to empty content rather than erroring.
$effect(() => {
  const id = data.projectId;
  if (id === loadedProjectId) return;
  loadedProjectId = id;
  fs.readFile(MAIN_FILE_PATH)
    .catch(() => "")
    .then((loaded) => {
      content = loaded;
      lastWrittenContent = loaded;
    });
});

// Writes edits back to the store. Comparing against `lastWrittenContent`
// (rather than re-reading the file, which would need an extra round
// trip) means this only ever fires for an actual edit, never for the
// load effect's own initial assignment above.
$effect(() => {
  if (loadedProjectId !== null && content !== lastWrittenContent) {
    lastWrittenContent = content;
    fs.writeFile(MAIN_FILE_PATH, content);
  }
});

let output = $derived.by(() =>
  compile_system([{ filename: MAIN_FILE_PATH, content }])
);

let model = $derived(output.model());
let diagnostics = $derived(output.diagnostics());

// Persist the last successfully compiled model so stats survive syntax errors.
let lastModel = $state<ReturnType<typeof output.model>>(undefined);
$effect(() => {
  if (model !== undefined) lastModel = model;
});
let stale = $derived(model === undefined && lastModel !== undefined);

let components = $derived(lastModel ? lastModel.components() : []);
let score = $derived(lastModel ? lastModel.score() : null);
let leafCount = $derived(components.filter((c) => c.leaf).length);
let compositeCount = $derived(components.filter((c) => !c.leaf).length);

function catTotal(
  cat: { complete: number; partial: number; incomplete: number } | null,
) {
  return cat ? cat.complete + cat.partial + cat.incomplete : 0;
}
function catPct(cat: { percentage: number } | null) {
  return cat ? Math.round(cat.percentage) : 0;
}

let totalPorts = $derived(catTotal(score?.ports ?? null));
let totalConnections = $derived(catTotal(score?.connections ?? null));
let totalMessages = $derived(catTotal(score?.messages ?? null));
let overallPct = $derived(score ? Math.round(score.overall_percentage) : 0);
</script>

<div class="flex-1 w-full bg-base-100">
  <div
    class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 grid grid-cols-1 md:grid-cols-12 gap-6 h-full"
  >
    <aside
      class="md:col-span-3 lg:col-span-2 bg-base-100 text-base-content p-4 rounded shadow"
    >
      <h3 class="font-semibold mb-3 text-base-content">Navigation</h3>
      <ul class="space-y-2 text-sm text-base-content/70">
        <li>
          <a
            href={resolve("/projects/[id]/overview", { id: data.projectId })}
            class="block hover:text-base-content"
          >Overview</a>
        </li>
        <li>
          <a
            href={resolve("/projects/[id]/diagrams", { id: data.projectId })}
            class="block hover:text-base-content"
          >Diagrams</a>
        </li>
        <li>
          <a href={resolve("/projects", {})}
            class="block hover:text-base-content">Projects</a>
        </li>
      </ul>
    </aside>

    <main class="md:col-span-6 lg:col-span-8 flex flex-col gap-4">
      {#if lastModel !== undefined}
        <div
          class="
            transition-opacity duration-300 {stale
            ? 'opacity-40 grayscale'
            : ''}
          "
        >
          <ModelStatsRow
            componentCount={components.length}
            {leafCount}
            {compositeCount}
            portCount={totalPorts}
            portsPct={catPct(score?.ports ?? null)}
            connectionCount={totalConnections}
            connectionsPct={catPct(score?.connections ?? null)}
            {overallPct}
            messageCount={totalMessages}
          />
        </div>
      {/if}
      <div
        class="w-full bg-base-200 p-6 rounded shadow flex flex-col flex-1 text-base-content"
      >
        <h1 class="text-2xl font-semibold mb-4 text-base-content">
          Editor
        </h1>
        <div class="flex-1 w-full">
          <MonacoEditor bind:value={content} language="hcl" />
        </div>
      </div>
    </main>

    <aside
      class="md:col-span-3 lg:col-span-2 bg-base-100 text-base-content p-4 rounded shadow"
    >
      {#if model !== undefined}
        <ModelComponentsOutline {model} />
        <div class="divider"></div>
      {/if}
      <CompilationDiagnosticsOutline {diagnostics} />
    </aside>
  </div>
</div>
