<script lang="ts">
import init, { compile_sources } from "rhizz-wasm/rhizz_wasm.js";
await init();

let input = $state('# Your input goes here');

let output = $derived.by(() => {
  let a = compile_sources([{"filename": "all.hcl", "content": input}]);
  console.log(a);
  return JSON.stringify(a, null, 2);
});
</script>

<div class="h-screen w-screen flex flex-col">
  <div class="navbar bg-base-200">
    <a href="#/" class="btn btn-ghost text-xl">← rhizz</a>
    <span class="ml-2 text-sm opacity-60">WASM Test</span>
  </div>
  <div class="flex-1 w-full bg-[#0a0a14]">

    <textarea bind:value={input} cols="40" rows="5" />

    <pre> {output} </pre>
  </div>
</div>
