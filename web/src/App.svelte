<script lang="ts">
  import Home from "./pages/Home.svelte";
  import Playground from "./pages/Playground.svelte";
  import Wasm from "./pages/Wasm.svelte";

  let hash = $state(window.location.hash);
  window.addEventListener("hashchange", () => (hash = window.location.hash));
</script>

{#if hash === "#/playground"}
  <Playground />
{:else if hash === "#/wasm"}
  <Wasm/>
{:else}
  <Home />
{/if}
