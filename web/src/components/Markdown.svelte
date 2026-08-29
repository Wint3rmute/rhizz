<script lang="ts">
import { renderMarkdown } from "./markdownRenderer";

let { content = "" }: { content?: string } = $props();

let html = $derived(renderMarkdown(content));
</script>

<div class="markdown prose prose-sm max-w-none text-base-content">
  <!-- eslint-disable-next-line svelte/no-at-html-tags -- html is escaped by renderMarkdown (see markdownRenderer.ts) -->
  {@html html}
</div>
