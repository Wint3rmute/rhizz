<script lang="ts">
  // One diagnostic row, in the app's canonical status-bar format: a severity
  // glyph, the code as a monospace link to its SPEC page, where it points
  // (`system.hcl:14`, when the caller passes a location), and the Markdown
  // message (truncated, with the full text in the tooltip). Extracted from the
  // bottom DiagnosticsStatusBar's expanded panel and shared with the book
  // embed's VerdictPanel so both surfaces render identical rows.
  import { renderMarkdownInline } from "./markdownRenderer";
  import { REPO_URL } from "../links";

  let {
    diagnostic,
    location = null,
  }: {
    diagnostic: { code: string; message: string };
    /**
     * Where the diagnostic points (`system.hcl:14`). With an `href` the label
     * links there (the Code page, scrolled to the line); without one it is
     * plain text. Null hides it (the book embed, project-wide diagnostics).
     */
    location?: { label: string; href: string | null } | null;
  } = $props();

  let isError = $derived(diagnostic.code.startsWith("E"));

  function specUrl(code: string): string {
    return `${REPO_URL}/blob/main/SPEC/diagnostics/${code}.md`;
  }
</script>

<li
  class="flex items-center gap-2 min-w-0 px-2 py-1.5 rounded hover:bg-base-200"
>
  <span
    class="shrink-0 w-4 text-center {isError ? ' text-error' : 'text-warning'}"
    aria-hidden="true"
  >
    {isError ? "✕" : "⚠"}
  </span>
  <a
    class="link underline shrink-0 font-mono text-xs"
    target="_blank"
    href={specUrl(diagnostic.code)}
    title={`Open the ${diagnostic.code} spec`}>{diagnostic.code}</a
  >
  {#if location?.href}
    <a
      class="link link-hover shrink-0 font-mono text-xs text-base-content/60"
      href={location.href}
      title={`Open ${location.label}`}
      data-testid="diagnostic-location">{location.label}</a
    >
  {:else if location}
    <span
      class="shrink-0 font-mono text-xs text-base-content/60"
      data-testid="diagnostic-location">{location.label}</span
    >
  {/if}
  <span class="truncate min-w-0 flex-1" title={diagnostic.message}>
    <!-- eslint-disable-next-line svelte/no-at-html-tags -- html is escaped by renderMarkdownInline (see markdownRenderer.ts) -->
    {@html renderMarkdownInline(diagnostic.message)}
  </span>
</li>
