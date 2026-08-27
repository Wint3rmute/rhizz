<script lang="ts">
import { resolve } from "$app/paths";

let {
  projectId,
  diagramPath = null,
  disabled = false,
}: {
  projectId: string;
  diagramPath?: string | null;
  disabled?: boolean;
} = $props();

let isModalOpen = $state(false);
let copiedType = $state<"link" | "iframe" | null>(null);

function normalizeDiagramName(path: string | null): string {
  if (!path) return "main.hcl";
  return path;
}

let embedPath = $derived.by(() => {
  const norm = normalizeDiagramName(diagramPath);
  return resolve("/projects/[id]/diagrams/embed/[...diagram]", {
    id: projectId,
    diagram: norm,
  });
});

let fullEmbedUrl = $derived.by(() => {
  if (typeof window === "undefined") return embedPath;
  try {
    return new URL(embedPath, window.location.origin).toString();
  } catch {
    return embedPath;
  }
});

let iframeSnippet = $derived.by(() => {
  return `<iframe src="${fullEmbedUrl}" width="100%" height="500" style="border: 1px solid #ccc; border-radius: 8px;" allowfullscreen></iframe>`;
});

async function copyToClipboard(text: string, type: "link" | "iframe") {
  try {
    await navigator.clipboard.writeText(text);
    copiedType = type;
    setTimeout(() => {
      copiedType = null;
    }, 2000);
  } catch (err) {
    console.error("Failed to copy:", err);
  }
}
</script>

<button
  type="button"
  class="btn btn-outline btn-sm w-full flex items-center justify-center gap-1.5"
  disabled={disabled || !diagramPath}
  onclick={() => (isModalOpen = true)}
  title="Get embed link or iframe code for this diagram"
>
  <span aria-hidden="true">🔗</span>
  <span>Embed Diagram</span>
</button>

{#if isModalOpen}
  <div class="modal modal-open">
  <div class="modal-box max-w-lg bg-base-100 border border-base-300 shadow-2xl">
    <div
      class="flex items-center justify-between pb-2 border-b border-base-300 mb-4">
      <h3 class="font-bold text-base flex items-center gap-2">
          <span>🔗</span> Embed Diagram: <span class="font-mono text-primary text-sm">{normalizeDiagramName(diagramPath)}</span>
        </h3>
      <button
        type="button"
        class="btn btn-ghost btn-sm btn-circle"
        onclick={() => (isModalOpen = false)}
      >
          ✕
        </button>
    </div>

    <div class="flex flex-col gap-4 text-sm">
      <!-- Direct URL -->
      <div class="flex flex-col gap-1.5">
        <span
          class="font-semibold text-xs uppercase tracking-wide text-base-content/70">
            Direct Embed URL
          </span>
        <div class="join w-full">
          <input
            type="text"
            readonly
            class="input input-bordered input-sm join-item flex-1 font-mono text-xs bg-base-200"
            value={fullEmbedUrl}
          />
          <button
            type="button"
            class="btn btn-sm join-item {copiedType === 'link' ? 'btn-success' : 'btn-primary'}"
            onclick={() => copyToClipboard(fullEmbedUrl, 'link')}
          >
              {copiedType === 'link' ? '✓ Copied' : 'Copy'}
            </button>
        </div>
      </div>

      <!-- iframe Snippet -->
      <div class="flex flex-col gap-1.5">
        <span
          class="font-semibold text-xs uppercase tracking-wide text-base-content/70">
            HTML &lt;iframe&gt; Embed Code
          </span>
        <textarea
          readonly
          rows="3"
          class="textarea textarea-bordered textarea-sm w-full font-mono text-xs bg-base-200 resize-none"
          value={iframeSnippet}
        ></textarea>
        <div class="flex justify-end">
          <button
            type="button"
            class="btn btn-sm {copiedType === 'iframe' ? 'btn-success' : 'btn-secondary'}"
            onclick={() => copyToClipboard(iframeSnippet, 'iframe')}
          >
              {copiedType === 'iframe' ? '✓ Copied Embed Code' : 'Copy <iframe> Code'}
            </button>
        </div>
      </div>

      <!-- Preview Action -->
      <div
        class="pt-2 flex items-center justify-between border-t border-base-300">
        <span class="text-xs text-base-content/60">
            Embeds are read-only with pan/zoom.
          </span>
        <a
          href={embedPath}
          target="_blank"
          rel="noopener noreferrer"
          class="btn btn-ghost btn-xs text-primary flex items-center gap-1"
        >
          <span>Preview in new tab</span>
          <span aria-hidden="true">↗</span>
        </a>
      </div>
    </div>
  </div>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal-backdrop" onclick={() => (isModalOpen = false)}></div>
</div>
{/if}
