<script lang="ts">
  import { ModelJS } from "rhizz";
  let { model }: { model: ModelJS } = $props();
  let components = $derived(model.components());
</script>

<h3 class="font-semibold mb-3 text-base-content">Model Outline</h3>
<div class="text-sm text-base-content/70 space-y-2">
  {#if components.length === 0}
    <div>No components defined...</div>
  {/if}
  {#each components as component}
    <div class="alert alert-soft">
      {component.label}
    </div>
  {/each}
</div>
