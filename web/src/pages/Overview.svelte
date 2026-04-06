<script lang="ts">
  import { compile_system } from "../rhizz_wasm_wrapper";
  import CompilationDiagnosticsOutline from "../components/CompilationDiagnosticsOutline.svelte";
  import Navbar from "../components/Navbar.svelte";
  import persisted from "../Persisted.svelte";

  let input = persisted("SYSTEM_INPUT_BOX", "# Your input goes here");

  let output = $derived.by(() =>
    compile_system([{ filename: "all.hcl", content: input.value }])
  );

  let model     = $derived(output.model());
  let diagnostics = $derived(output.diagnostics());

  // ── derived stats ──────────────────────────────────────────────────────────
  let components  = $derived(model ? model.components() : []);
  let score       = $derived(model ? model.score()      : null);
  let project     = $derived(model ? model.project()    : null);

  let leafCount      = $derived(components.filter(c => c.leaf).length);
  let compositeCount = $derived(components.filter(c => !c.leaf).length);

  function catTotal(cat: { complete: number; partial: number; incomplete: number } | null) {
    return cat ? cat.complete + cat.partial + cat.incomplete : 0;
  }
  function catPct(cat: { percentage: number } | null) {
    return cat ? Math.round(cat.percentage) : 0;
  }

  let totalPorts       = $derived(catTotal(score?.ports       ?? null));
  let totalConnections = $derived(catTotal(score?.connections  ?? null));
  let totalMessages    = $derived(catTotal(score?.messages     ?? null));
  let overallPct       = $derived(score ? Math.round(score.overall_percentage) : 0);

  // Badge colour for component level
  function levelBadge(level: number): string {
    if (level <= 1) return "badge-primary";
    if (level === 2) return "badge-secondary";
    if (level === 3) return "badge-accent";
    return "badge-neutral";
  }
</script>

<div class="h-screen w-screen flex flex-col bg-gray-900 text-gray-100">
  <Navbar {project} errorCount={output.error_count()} warningCount={output.warning_count()} />

  <div class="flex-1 w-full bg-gray-900 overflow-y-auto">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 grid grid-cols-1 md:grid-cols-12 gap-6">

      <!-- Left sidebar -->
      <aside class="md:col-span-3 lg:col-span-2 bg-gray-900 text-gray-100 p-4 rounded shadow">
        <h3 class="font-semibold mb-3 text-gray-100">Navigation</h3>
        <ul class="space-y-2 text-sm text-gray-300">
          <li><a href="#/" class="block hover:text-white">Overview</a></li>
          <li><a href="#/" class="block hover:text-white">Components</a></li>
          <li><a href="#/" class="block hover:text-white">Systems</a></li>
          <li><a href="#/" class="block hover:text-white">Settings</a></li>
        </ul>
      </aside>

      <!-- Main dashboard -->
      <main class="md:col-span-6 lg:col-span-8 flex flex-col gap-6">

        {#if !model}
          <!-- Empty state -->
          <div class="card bg-gray-800 shadow">
            <div class="card-body items-center text-center py-16">
              <div class="text-5xl mb-4">📐</div>
              <h2 class="card-title text-gray-100">No model loaded</h2>
              <p class="text-gray-400 text-sm">
                Open the editor and write some HCL to see your system overview here.
              </p>
              {#if output.error_count() > 0}
                <div class="alert alert-error alert-soft mt-4 text-left">
                  {output.error_count()} compilation error(s) — check the Diagnostics panel.
                </div>
              {/if}
            </div>
          </div>
        {:else}

          <!-- ── Project header ── -->
          {#if project && project.name}
            <div class="card bg-gray-800 shadow">
              <div class="card-body py-4 px-6 flex-row items-center gap-4 flex-wrap">
                <div>
                  <h1 class="text-2xl font-bold text-white">{project.name}</h1>
                  {#if project.version}
                    <span class="text-sm text-gray-400">v{project.version}</span>
                  {/if}
                </div>
                {#if project.authors.length > 0}
                  <div class="ml-auto flex gap-2 flex-wrap">
                    {#each project.authors as author}
                      <div class="badge badge-outline badge-sm text-gray-300">{author}</div>
                    {/each}
                  </div>
                {/if}
              </div>
            </div>
          {/if}

          <!-- ── Stats row ── -->
          <div class="stats stats-vertical sm:stats-horizontal shadow bg-gray-800 w-full">
            <div class="stat">
              <div class="stat-figure text-primary">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                </svg>
              </div>
              <div class="stat-title text-gray-400">Components</div>
              <div class="stat-value text-gray-100">{components.length}</div>
              <div class="stat-desc text-gray-500">{leafCount} atomic · {compositeCount} composite</div>
            </div>

            <div class="stat">
              <div class="stat-figure text-secondary">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <div class="stat-title text-gray-400">Ports</div>
              <div class="stat-value text-gray-100">{totalPorts}</div>
              <div class="stat-desc text-gray-500">{catPct(score?.ports ?? null)}% defined</div>
            </div>

            <div class="stat">
              <div class="stat-figure text-accent">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                </svg>
              </div>
              <div class="stat-title text-gray-400">Connections</div>
              <div class="stat-value text-gray-100">{totalConnections}</div>
              <div class="stat-desc text-gray-500">{catPct(score?.connections ?? null)}% defined</div>
            </div>

            <div class="stat">
              <div class="stat-figure text-success">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div class="stat-title text-gray-400">Completion</div>
              <div class="stat-value {overallPct >= 80 ? 'text-success' : overallPct >= 50 ? 'text-warning' : 'text-error'}">{overallPct}%</div>
              <div class="stat-desc text-gray-500">{totalMessages} messages defined</div>
            </div>
          </div>

          <!-- ── Completion breakdown ── -->
          <div class="card bg-gray-800 shadow">
            <div class="card-body">
              <h2 class="card-title text-gray-100 mb-6">Completion Breakdown</h2>

              <!-- Overall score hero -->
              <div class="flex flex-col sm:flex-row items-center gap-6 mb-8 p-4 rounded-xl bg-gray-900">
                <div class="radial-progress {overallPct >= 80 ? 'text-success' : overallPct >= 50 ? 'text-warning' : 'text-error'} shrink-0"
                     style="--value:{overallPct}; --size:8rem; --thickness:8px;"
                     role="progressbar" aria-label="Overall completion">
                  <span class="text-2xl font-bold {overallPct >= 80 ? 'text-success' : overallPct >= 50 ? 'text-warning' : 'text-error'}">{overallPct}%</span>
                </div>
                <div class="flex-1 text-center sm:text-left">
                  <div class="text-xl font-semibold text-gray-100 mb-1">
                    {#if overallPct === 100}
                      Model fully specified
                    {:else if overallPct >= 80}
                      Nearly complete
                    {:else if overallPct >= 50}
                      Work in progress
                    {:else if overallPct > 0}
                      Early stage
                    {:else}
                      Not yet started
                    {/if}
                  </div>
                  <p class="text-sm text-gray-400">
                    {#if score}
                      {score.components.complete + score.ports.complete + score.connections.complete + score.messages.complete} entities fully specified out of
                      {catTotal(score.components) + catTotal(score.ports) + catTotal(score.connections) + catTotal(score.messages)} total
                    {/if}
                  </p>
                  <!-- Mini legend -->
                  <div class="flex gap-4 mt-3 justify-center sm:justify-start text-xs text-gray-400">
                    <span class="flex items-center gap-1"><span class="inline-block w-2 h-2 rounded-full bg-green-500"></span>Complete</span>
                    <span class="flex items-center gap-1"><span class="inline-block w-2 h-2 rounded-full bg-yellow-500"></span>Partial</span>
                    <span class="flex items-center gap-1"><span class="inline-block w-2 h-2 rounded-full bg-gray-600"></span>Incomplete</span>
                  </div>
                </div>
              </div>

              <!-- Per-category breakdown -->
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {#each [
                  { label: "Components", icon: "▦", cat: score?.components ?? null, color: "progress-primary",   ring: "text-primary"   },
                  { label: "Ports",      icon: "⚡", cat: score?.ports      ?? null, color: "progress-secondary", ring: "text-secondary" },
                  { label: "Connections",icon: "⇄",  cat: score?.connections ?? null, color: "progress-accent",   ring: "text-accent"    },
                  { label: "Messages",   icon: "✉",  cat: score?.messages    ?? null, color: "progress-success",  ring: "text-success"   },
                ] as row}
                  {@const pct = catPct(row.cat)}
                  {@const total = catTotal(row.cat)}
                  <div class="bg-gray-900 rounded-xl p-4 flex flex-col gap-3">
                    <div class="flex items-center justify-between">
                      <div class="flex items-center gap-2">
                        <span class="text-lg {row.ring}">{row.icon}</span>
                        <span class="font-semibold text-gray-200">{row.label}</span>
                      </div>
                      <span class="text-lg font-bold tabular-nums {pct >= 80 ? 'text-success' : pct >= 50 ? 'text-warning' : 'text-error'}">{pct}%</span>
                    </div>
                    <progress class="progress {row.color} w-full h-2" value={pct} max="100"></progress>
                    <!-- Stacked count pills -->
                    <div class="flex gap-2 text-xs flex-wrap">
                      {#if total === 0}
                        <span class="badge badge-sm badge-ghost text-gray-500">none defined</span>
                      {:else}
                        <span class="badge badge-sm bg-green-900 text-green-300 border-0">{row.cat?.complete ?? 0} complete</span>
                        <span class="badge badge-sm bg-yellow-900 text-yellow-300 border-0">{row.cat?.partial ?? 0} partial</span>
                        <span class="badge badge-sm badge-ghost text-gray-500">{row.cat?.incomplete ?? 0} incomplete</span>
                      {/if}
                    </div>
                  </div>
                {/each}
              </div>
            </div>
          </div>

          <!-- ── Components table ── -->
          {#if components.length > 0}
            <div class="card bg-gray-800 shadow">
              <div class="card-body">
                <h2 class="card-title text-gray-100 mb-2">Components</h2>
                <div class="overflow-x-auto">
                  <table class="table table-sm">
                    <thead>
                      <tr class="text-gray-400 border-gray-700">
                        <th>Label</th>
                        <th>Level</th>
                        <th>Type</th>
                        <th>Description</th>
                        <th>Tags</th>
                      </tr>
                    </thead>
                    <tbody>
                      {#each components as comp}
                        <tr class="border-gray-700 hover:bg-gray-700">
                          <td class="font-mono text-primary text-sm">{comp.label}</td>
                          <td>
                            <span class="badge badge-sm {levelBadge(comp.level)}">L{comp.level}</span>
                          </td>
                          <td>
                            {#if comp.leaf}
                              <span class="badge badge-sm badge-outline text-gray-300">atomic</span>
                            {:else}
                              <span class="badge badge-sm badge-outline text-gray-400">composite</span>
                            {/if}
                          </td>
                          <td class="text-gray-300 text-sm max-w-xs truncate">
                            {#if comp.description}
                              {comp.description}
                            {:else}
                              <span class="text-gray-600 italic">—</span>
                            {/if}
                          </td>
                          <td>
                            <div class="flex gap-1 flex-wrap">
                              {#each comp.tags as tag}
                                <span class="badge badge-xs badge-ghost text-gray-400">{tag}</span>
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
      <aside class="md:col-span-3 lg:col-span-2 bg-gray-900 text-gray-100 p-4 rounded shadow">
        <CompilationDiagnosticsOutline {diagnostics}/>
      </aside>

    </div>
  </div>
</div>
