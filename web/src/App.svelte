<script lang="ts">
  import Home from "./pages/Home.svelte";
  import Wasm from "./pages/Wasm.svelte";
  import Layout from "./pages/Layout.svelte";
  import Editor from "./pages/Editor.svelte";

  let hash = $state(window.location.hash);
  window.addEventListener("hashchange", () => (hash = window.location.hash));
</script>

{#if hash === "#/wasm"}
  <Wasm/>
{:else if hash === "#/layout"}
  <Layout/>
{:else if hash === "#/editor"}
  <Editor/>
{:else}
  <Home />
{/if}
