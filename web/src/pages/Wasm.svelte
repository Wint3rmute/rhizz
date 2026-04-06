<script lang="ts">
  import { compile_system } from "../rhizz_wasm_wrapper";

  let input = $state("# Your input goes here");

  let output = $derived.by(() => {
    let compilation_result = compile_system([{
      "filename": "all.hcl",
      "content": input,
    }]);
    // console.log(compilation_result.try_get_model().diagnostics);
    console.log(compilation_result.has_model());
    console.log(JSON.stringify(compilation_result.diagnostics(), null, 2));
    // compilation_result

    // compilation_result.try_get_model();
    // if (compilation_result.)
    return compilation_result;
  });
</script>

<div class="h-screen w-screen flex flex-col bg-gray-900 text-gray-100">
  <div class="navbar bg-gray-900 text-gray-100 border-b border-gray-800">
    <a href="#/" class="btn btn-ghost text-xl text-white">← rhizz</a>
    <span class="ml-2 text-sm opacity-70">Rhizz</span>
    <div class="ml-auto flex items-center space-x-3">
      <input
        placeholder="Search"
        class="hidden sm:block input input-sm bg-gray-800 text-gray-100 placeholder-gray-400 border-gray-700"
      />
      <button class="btn btn-primary btn-sm">New</button>
    </div>
  </div>

  <div class="flex-1 w-full bg-gray-900">
    <div
      class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 grid grid-cols-1 md:grid-cols-12 gap-6 h-full"
    >
      <!-- Left sidebar (dark) -->
      <aside
        class="md:col-span-3 lg:col-span-2 bg-gray-900 text-gray-100 p-4 rounded shadow"
      >
        <h3 class="font-semibold mb-3 text-gray-100">Navigation</h3>
        <ul class="space-y-2 text-sm text-gray-300">
          <li><a href="#/" class="block hover:text-white">Overview</a></li>
          <li><a href="#/" class="block hover:text-white">Components</a></li>
          <li><a href="#/" class="block hover:text-white">Systems</a></li>
          <li><a href="#/" class="block hover:text-white">Settings</a></li>
        </ul>
      </aside>

      <!-- Main content (center) -->
      <main class="md:col-span-6 lg:col-span-8 flex">
        <div
          class="w-full bg-gray-800 p-6 rounded shadow flex flex-col h-full text-gray-100"
        >
          <h1 class="text-2xl font-semibold mb-4 text-white">Rhizz</h1>
          <textarea
            bind:value={input}
            class="font-mono flex-1 w-full p-4 border rounded resize-none bg-gray-700 text-gray-100 border-gray-600 placeholder-gray-400"
          ></textarea>
          TODO: render here
        </div>
      </main>

      <!-- Right sidebar (dark) -->
      <aside
        class="md:col-span-3 lg:col-span-2 bg-gray-900 text-gray-100 p-4 rounded shadow"
      >
        <h3 class="font-semibold mb-3 text-gray-100">Details</h3>
        <div class="text-sm text-gray-300 space-y-2">
          {#each output.diagnostics as diagnostic}
            {#if diagnostic.code.startsWith("E")}
              <div role="alert" class="alert alert-error alert-soft">
                {diagnostic.code} - {diagnostic.message}
              </div>
            {:else}
              <div role="alert" class="alert alert-warning alert-soft">
                {diagnostic.code} - {diagnostic.message}
              </div>
            {/if}
          {/each}

          <pre
            class="p-2 bg-gray-800 rounded font-mono"
          >{JSON.stringify(output, null, 2)}</pre>
        </div>
      </aside>
    </div>
  </div>
</div>
