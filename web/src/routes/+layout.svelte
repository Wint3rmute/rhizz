<script lang="ts">
  import "../app.css";
  import Navbar from "../components/Navbar.svelte";

  let { children } = $props();
</script>

<div class="h-screen w-screen flex flex-col bg-gray-900 text-gray-100">
  <Navbar />
  {@render children()}
</div>
