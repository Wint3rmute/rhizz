<script lang="ts">
import type { DiagnosticJS } from "rhizz";

// Bottom status bar replacing the Overview page's diagnostics sidebar.
// Collapsed it shows only the counts (or a clean bill of health); clicking
// expands the full diagnostics list above the bar.
let { diagnostics }: { diagnostics: DiagnosticJS[] } = $props();

let expanded = $state(false);

let errors = $derived(diagnostics.filter((d) => d.code.startsWith("E")));
let warnings = $derived(diagnostics.filter((d) => !d.code.startsWith("E")));

function specUrl(code: string): string {
  return `https://github.com/Wint3rmute/rhizz/blob/main/SPEC/diagnostics/${code}.md`;
}
</script>

<div
  class="relative z-20 border-t border-base-300 bg-base-100/95 backdrop-blur-xs"
  data-testid="diagnostics-status-bar"
>
  {#if expanded}
    <!-- Overlay: floats above the page instead of pushing content up,
         so expanding never shifts the layout. -->
    <div
      class="absolute inset-x-0 bottom-full max-h-64 overflow-y-auto px-4 sm:px-6 lg:px-8 py-3 bg-base-100/95 backdrop-blur-xs border-t border-base-300 shadow-[0_-8px_24px_rgba(0,0,0,0.25)]"
    >
      <div class="max-w-7xl mx-auto space-y-2 text-sm">
        {#if diagnostics.length === 0}
          <div role="alert" class="alert alert-success alert-soft">
            No Warnings<br />
            No Errors<br />
            Well Done!
          </div>
        {/if}
        {#each errors as diagnostic (diagnostic.code + diagnostic.message)}
          <div role="alert" class="alert alert-error alert-soft">
            <p>
              <a
                class="link"
                target="_blank"
                href={specUrl(diagnostic.code)}
              >{diagnostic.code}</a>
              - {diagnostic.message}
            </p>
          </div>
        {/each}
        {#each warnings as diagnostic (diagnostic.code + diagnostic.message)}
          <div role="alert" class="alert alert-warning alert-soft">
            <p>
              <a
                class="link"
                target="_blank"
                href={specUrl(diagnostic.code)}
              >{diagnostic.code}</a>
              - {diagnostic.message}
            </p>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  <button
    type="button"
    class="w-full px-4 sm:px-6 lg:px-8 py-2 flex items-center gap-3 text-sm hover:bg-base-200/60"
    onclick={() => (expanded = !expanded)}
    aria-expanded={expanded}
    title={expanded ? "Collapse diagnostics" : "Expand diagnostics"}
  >
    <span class="max-w-7xl mx-auto w-full flex items-center gap-3">
      {#if diagnostics.length === 0}
        <span class="badge badge-success badge-sm">✓ clean</span>
        <span class="text-base-content/60">No errors, no warnings</span>
      {:else}
        {#if errors.length > 0}
          <span class="badge badge-error badge-sm">
            {errors.length} error{errors.length === 1 ? "" : "s"}
          </span>
        {/if}
        {#if warnings.length > 0}
          <span class="badge badge-warning badge-sm">
            {warnings.length} warning{warnings.length === 1 ? "" : "s"}
          </span>
        {/if}
        <span class="text-base-content/60 truncate">
          {errors.length > 0 ? errors[0]?.message : warnings[0]?.message}
        </span>
      {/if}
      <span class="ml-auto text-base-content/50" aria-hidden="true">
        {expanded ? "▾" : "▴"}
      </span>
    </span>
  </button>
</div>
