<script lang="ts">
import { ModelJS } from "rhizz";
	let { model }: { model: ModelJS } = $props();
  let components = $derived(model.components());
</script>

<h3 class="font-semibold mb-3 text-gray-100">Model Outline</h3>
<div class="text-sm text-gray-300 space-y-2">
  {#if components.length === 0}
    <div>No components defined...</div>
    <br>
  {/if}
  {#each components as component}
    <div class="alert alert-soft">
      {component.label}
    </div>
  {/each}
</div>