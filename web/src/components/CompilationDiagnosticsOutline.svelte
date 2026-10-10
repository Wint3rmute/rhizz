<script lang="ts">
import { DiagnosticJS } from "rhizz";
import { renderMarkdownInline } from "./markdownRenderer";
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
  {#each diagnostics as diagnostic, i (i)}
    {#if diagnostic.code.startsWith("E")}
      <div role="alert" class="alert alert-error alert-soft">
          <p>
          <a class="link" target="_blank" href="https://github.com/Wint3rmute/rhizz/blob/main/SPEC/diagnostics/{diagnostic.code}.md">{diagnostic.code}</a>
            - <!-- eslint-disable-next-line svelte/no-at-html-tags -- html is escaped by renderMarkdownInline (see markdownRenderer.ts) -->
            {@html renderMarkdownInline(diagnostic.message)}
          </p>
      </div>
    {:else}
      <div role="alert" class="alert alert-warning alert-soft">
          <p>
          <a class="link" target="_blank" href="https://github.com/Wint3rmute/rhizz/blob/main/SPEC/diagnostics/{diagnostic.code}.md">{diagnostic.code}</a>
            - <!-- eslint-disable-next-line svelte/no-at-html-tags -- html is escaped by renderMarkdownInline (see markdownRenderer.ts) -->
            {@html renderMarkdownInline(diagnostic.message)}
          </p>
      </div>
    {/if}
  {/each}
</div>
