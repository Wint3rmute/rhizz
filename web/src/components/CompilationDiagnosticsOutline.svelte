<script lang="ts">
import { DiagnosticJS } from "rhizz";
let { diagnostics }: { diagnostics: DiagnosticJS[] } = $props();
</script>

<h3 class="font-semibold mb-3 text-base-content">Diagnostics</h3>
<div class="text-sm text-base-content/70 space-y-2">
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
          <p>
          <a class="link" target="_blank" href="https://github.com/Wint3rmute/rhizz/blob/main/SPEC/diagnostics/{diagnostic.code}.md">{diagnostic.code}</a>
            - {diagnostic.message}
          </p>
      </div>
    {:else}
      <div role="alert" class="alert alert-warning alert-soft">
          <p>
          <a class="link" target="_blank" href="https://github.com/Wint3rmute/rhizz/blob/main/SPEC/diagnostics/{diagnostic.code}.md">{diagnostic.code}</a>
            - {diagnostic.message}
          </p>
      </div>
    {/if}
  {/each}
</div>
