<script lang="ts">
// One diagnostic row, in the app's canonical status-bar format: a severity
// glyph, the code as a monospace link to its SPEC page, and the Markdown
// message (truncated, with the full text in the tooltip). Extracted from the
// bottom DiagnosticsStatusBar's expanded panel and shared with the book
// embed's VerdictPanel so both surfaces render identical rows.
import { renderMarkdownInline } from "./markdownRenderer";

let { diagnostic }: {
  diagnostic: { code: string; message: string };
} = $props();

let isError = $derived(diagnostic.code.startsWith("E"));

function specUrl(code: string): string {
  return `https://github.com/Wint3rmute/rhizz/blob/main/SPEC/diagnostics/${code}.md`;
}
</script>

<li
  class="flex items-center gap-2 min-w-0 px-2 py-1.5 rounded hover:bg-base-200"
>
  <span
    class="shrink-0 w-4 text-center {isError
      ? " text-error"
    : "text-warning"}"
    aria-hidden="true"
  >
    {isError ? "✕" : "⚠"}
  </span>
  <a
    class="link underline shrink-0 font-mono text-xs"
    target="_blank"
    href={specUrl(diagnostic.code)}
    title={`Open the ${diagnostic.code} spec`}
  >{diagnostic.code}</a>
  <span class="truncate min-w-0 flex-1" title={diagnostic.message}>
    <!-- eslint-disable-next-line svelte/no-at-html-tags -- html is escaped by renderMarkdownInline (see markdownRenderer.ts) -->
    {@html renderMarkdownInline(diagnostic.message)}
  </span>
</li>
