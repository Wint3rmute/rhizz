<script lang="ts">
  import Home from "./pages/Home.svelte";
  import Playground from "./pages/Playground.svelte";

  let hash = $state(window.location.hash);
  window.addEventListener("hashchange", () => (hash = window.location.hash));
</script>

{#if hash === "#/playground"}
  <Playground />
{:else}
  <Home />
{/if}
