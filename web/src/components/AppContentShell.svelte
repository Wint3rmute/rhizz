<script lang="ts">
  import type { Snippet } from "svelte";

  // Mimics the sizing of `routes/+layout.svelte` (h-screen flex column, minus
  // the Navbar) for fullscreen stories: the page root (`flex-1`) and its
  // `h-full` hero resolve against a definite viewport height, exactly like in
  // the running app. Without it the root is content-height and a full-page
  // screenshot pads the rest with white.
  let { children }: { children: Snippet } = $props();
</script>

<div class="h-screen w-full flex flex-col">
  {@render children()}
</div>
