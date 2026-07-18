<script lang="ts">
  import { DiagnosticJS } from "rhizz";
  let { diagnostics }: { diagnostics: DiagnosticJS[] } = $props();
</script>

<h3 class="font-semibold mb-3 text-gray-100">Diagnostics</h3>
<div class="text-sm text-gray-300 space-y-2">
  {#if diagnostics.length === 0}
    <div role="alert" class="alert alert-success alert-soft">
      No Warnings<br />
      No Errors<br />
      Well Done!
    </div>
  {/if}
  {#each diagnostics as diagnostic}
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
</div>
