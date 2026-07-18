<script lang="ts">
import "../app.css";
import Navbar from "../components/Navbar.svelte";

let { children } = $props();
</script>

<div class="h-screen w-screen flex flex-col bg-base-100 text-base-content">
  <Navbar />
  {@render children()}
</div>
