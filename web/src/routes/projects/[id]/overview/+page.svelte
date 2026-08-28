<script lang="ts">
import { resolve } from "$app/paths";
import { compile_system } from "../../../../rhizz_wasm_wrapper";
import CompilationDiagnosticsOutline from "../../../../components/CompilationDiagnosticsOutline.svelte";
import ModelStatsRow from "../../../../components/ModelStatsRow.svelte";
import CompletionBreakdown from "../../../../components/CompletionBreakdown.svelte";
import type { CategoryScore } from "../../../../components/CompletionBreakdown.svelte";
import { projectStore } from "../../../../ProjectState.svelte";
import { readProjectSources, type Source } from "../../../../vfs/compile";
import { openProjectFs } from "../../../../vfs/fs";
import type { PageProps } from "./$types";

let { data }: PageProps = $props();

let sources = $state<Source[]>([]);
$effect(() => {
  const fs = openProjectFs(projectStore, data.projectId);
  void readProjectSources(fs).then((s) => {
    sources = s;
  });
});

let output = $derived.by(() => compile_system(sources));

let model = $derived(output.model());
let diagnostics = $derived(output.diagnostics());

let components = $derived(model ? model.components() : []);
let score = $derived(model ? model.score() : null);
let project = $derived(model ? model.project() : null);

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
function toCat(
  cat:
    | {
      complete: number;
      partial: number;
      incomplete: number;
      percentage: number;
    }
    | null
    | undefined,
): CategoryScore {
  return {
    complete: cat?.complete ?? 0,
    partial: cat?.partial ?? 0,
    incomplete: cat?.incomplete ?? 0,
    pct: cat ? Math.round(cat.percentage) : 0,
  };
}

let totalPorts = $derived(catTotal(score?.ports ?? null));
let totalConnections = $derived(catTotal(score?.connections ?? null));
let totalMessages = $derived(catTotal(score?.messages ?? null));
let overallPct = $derived(score ? Math.round(score.overall_percentage) : 0);
let completeTotal = $derived(
  score
    ? score.components.complete +
      score.ports.complete +
      score.connections.complete +
      score.messages.complete
    : 0,
);
let grandTotal = $derived(
  catTotal(score?.components ?? null) +
    catTotal(score?.ports ?? null) +
    catTotal(score?.connections ?? null) +
    catTotal(score?.messages ?? null),
);

function levelBadge(level: number): string {
  if (level <= 1) return "badge-primary";
  if (level === 2) return "badge-secondary";
  if (level === 3) return "badge-accent";
  return "badge-neutral";
}
</script>

<div class="flex-1 w-full bg-base-100 overflow-y-auto">
  <div
    class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 grid grid-cols-1 md:grid-cols-12 gap-6"
  >
    <!-- Left sidebar -->
    <aside
      class="md:col-span-3 lg:col-span-2 bg-base-100 text-base-content p-4 rounded shadow"
    >
      <h3 class="font-semibold mb-3 text-base-content">Navigation</h3>
      <ul class="space-y-2 text-sm text-base-content/70">
        <li>
          <a
            href={resolve("/projects/[id]/editor", { id: data.projectId })}
            class="block hover:text-base-content"
          >Editor</a>
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

    <!-- Main dashboard -->
    <main class="md:col-span-6 lg:col-span-8 flex flex-col gap-6">
      {#if !model}
        <div class="card bg-base-200 shadow">
          <div class="card-body items-center text-center py-16">
            <div class="text-5xl mb-4">📐</div>
            <h2 class="card-title text-base-content">
              No model loaded
            </h2>
            <p class="text-base-content/60 text-sm">
              Open the editor and write some HCL to see your system overview
              here.
            </p>
            {#if output.error_count() > 0}
              <div
                class="alert alert-error alert-soft mt-4 text-left"
              >
                {output.error_count()} compilation error(s) — check the
                Diagnostics panel.
              </div>
            {/if}
          </div>
        </div>
      {:else}
        <!-- ── Project header ── -->
        {#if project && project.name}
          <div class="card bg-base-200 shadow">
            <div
              class="card-body py-4 px-6 flex-row items-center gap-4 flex-wrap"
            >
              <div>
                <h1 class="text-2xl font-bold text-base-content">
                  {project.name}
                </h1>
                {#if project.version}
                  <span class="text-sm text-base-content/60">v{project.version}</span>
                {/if}
              </div>
              {#if project.authors.length > 0}
                <div class="ml-auto flex gap-2 flex-wrap">
                  {#each project.authors as author, i (i)}
                    <div
                      class="badge badge-outline badge-sm text-base-content/70"
                    >
                      {author}
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          </div>
        {/if}

        <!-- ── Stats row ── -->
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

        <!-- ── Completion breakdown ── -->
        <CompletionBreakdown
          {overallPct}
          {completeTotal}
          {grandTotal}
          components={toCat(score?.components)}
          ports={toCat(score?.ports)}
          connections={toCat(score?.connections)}
          messages={toCat(score?.messages)}
        />

        <!-- ── Components table ── -->
        {#if components.length > 0}
          <div class="card bg-base-200 shadow">
            <div class="card-body">
              <h2 class="card-title text-base-content mb-2">
                Components
              </h2>
              <div class="overflow-x-auto">
                <table class="table table-sm">
                  <thead>
                    <tr
                      class="text-base-content/60 border-base-300"
                    >
                      <th>Label</th>
                      <th>Level</th>
                      <th>Type</th>
                      <th>Description</th>
                      <th>Tags</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each components as comp, i (i)}
                      <tr
                        class="border-base-300 hover:bg-base-300"
                      >
                        <td
                          class="font-mono text-primary text-sm"
                        >
                          {comp.label}
                        </td>
                        <td>
                          <span
                            class="
                              badge badge-sm {levelBadge(
                              comp.level,
                              )}
                            "
                          >L{comp.level}</span>
                        </td>
                        <td>
                          {#if comp.leaf}
                            <span
                              class="badge badge-sm badge-outline text-base-content/70"
                            >atomic</span>
                          {:else}
                            <span
                              class="badge badge-sm badge-outline text-base-content/60"
                            >composite</span>
                          {/if}
                        </td>
                        <td
                          class="text-base-content/70 text-sm max-w-xs truncate"
                        >
                          {#if comp.description}
                            {comp.description}
                          {:else}
                            <span
                              class="text-base-content/40 italic"
                            >—</span>
                          {/if}
                        </td>
                        <td>
                          <div
                            class="flex gap-1 flex-wrap"
                          >
                            {#each comp.tags as tag, j (j)}
                              <span
                                class="badge badge-primary text-base-content"
                              >{tag}</span>
                            {/each}
                          </div>
                        </td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        {/if}
      {/if}
    </main>

    <!-- Right sidebar -->
    <aside
      class="md:col-span-3 lg:col-span-2 bg-base-100 text-base-content p-4 rounded shadow"
    >
      <CompilationDiagnosticsOutline {diagnostics} />
    </aside>
  </div>
</div>
