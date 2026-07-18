<script lang="ts">
  import { resolve } from "$app/paths";
  import { compile_system } from "../../rhizz_wasm_wrapper";
  import ModelComponentsOutline from "../../components/ModelComponentsOutline.svelte";
  import CompilationDiagnosticsOutline from "../../components/CompilationDiagnosticsOutline.svelte";
  import persisted from "../../Persisted.svelte";
  import MonacoEditor from "../../components/MonacoEditor.svelte";
  import ModelStatsRow from "../../components/ModelStatsRow.svelte";
  import { EXAMPLE_SYSTEM_HCL } from "../../example_system";

  let input = persisted("SYSTEM_INPUT_BOX", "# Your input goes here");

  function loadExample() {
    const confirmed = confirm(
      "Replace your current project with the example project? This will overwrite what's in the editor.",
    );
    if (confirmed) {
      input.value = EXAMPLE_SYSTEM_HCL;
    }
  }

  let output = $derived.by(() =>
    compile_system([{ filename: "all.hcl", content: input.value }])
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

<div class="flex-1 w-full bg-gray-900">
  <div
    class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 grid grid-cols-1 md:grid-cols-12 gap-6 h-full"
  >
    <aside
      class="md:col-span-3 lg:col-span-2 bg-gray-900 text-gray-100 p-4 rounded shadow"
    >
      <h3 class="font-semibold mb-3 text-gray-100">Navigation</h3>
      <ul class="space-y-2 text-sm text-gray-300">
        <li>
          <a
            href={resolve("/overview", {})}
            class="block hover:text-white"
          >Overview</a>
        </li>
        <li>
          <a
            href={resolve("/editor", {})}
            class="block hover:text-white"
          >Editor</a>
        </li>
        <li>
          <a href={resolve("/", {})} class="block hover:text-white">Home</a>
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
        class="w-full bg-gray-800 p-6 rounded shadow flex flex-col flex-1 text-gray-100"
      >
        <h1 class="text-2xl font-semibold mb-4 text-white">
          WASM Test
        </h1>
        <div class="flex-1 w-full">
          <MonacoEditor bind:value={input.value} language="hcl" />
        </div>
      </div>
    </main>

    <aside
      class="md:col-span-3 lg:col-span-2 bg-gray-900 text-gray-100 p-4 rounded shadow"
    >
      {#if model !== undefined}
        <ModelComponentsOutline {model} />
        <div class="divider"></div>
      {/if}
      <CompilationDiagnosticsOutline {diagnostics} />
    </aside>
  </div>
</div>

<button
  class="btn btn-circle btn-secondary fixed bottom-4 left-4 z-50"
  onclick={loadExample}
  title="Load example project"
>
  ?
</button>
