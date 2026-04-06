<script lang="ts">
  import { compile_system } from "../../rhizz_wasm_wrapper";
  import ModelComponentsOutline from "../../components/ModelComponentsOutline.svelte";
  import CompilationDiagnosticsOutline from "../../components/CompilationDiagnosticsOutline.svelte";
  import persisted from "../../Persisted.svelte";

  let input = persisted("SYSTEM_INPUT_BOX", "# Your input goes here");

  let output = $derived.by(() =>
    compile_system([{ filename: "all.hcl", content: input.value }])
  );

  let model = $derived(output.model());
  let diagnostics = $derived(output.diagnostics());
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
        <li><a href="/overview" class="block hover:text-white">Overview</a></li>
        <li><a href="/editor" class="block hover:text-white">Editor</a></li>
        <li><a href="/" class="block hover:text-white">Home</a></li>
      </ul>
    </aside>

    <main class="md:col-span-6 lg:col-span-8 flex">
      <div
        class="w-full bg-gray-800 p-6 rounded shadow flex flex-col h-full text-gray-100"
      >
        <h1 class="text-2xl font-semibold mb-4 text-white">WASM Test</h1>
        <textarea
          bind:value={input.value}
          class="font-mono flex-1 w-full p-4 border rounded resize-none bg-gray-700 text-gray-100 border-gray-600 placeholder-gray-400"
        ></textarea>
      </div>
    </main>

    <aside
      class="md:col-span-3 lg:col-span-2 bg-gray-900 text-gray-100 p-4 rounded shadow"
    >
      {#if model !== undefined}
        <ModelComponentsOutline {model} />
      {/if}
      <CompilationDiagnosticsOutline {diagnostics} />
    </aside>
  </div>
</div>
