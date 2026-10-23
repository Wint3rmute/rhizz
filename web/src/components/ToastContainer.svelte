<script lang="ts">
  import {
    type ToastLevel,
    type ToastState,
    toastState,
  } from "../ToastState.svelte";
  import { renderMarkdownInline } from "./markdownRenderer";

  let { state = toastState }: { state?: ToastState } = $props();

  const levelClasses: Record<ToastLevel, string> = {
    info: "alert-info",
    warning: "alert-warning",
    error: "alert-error",
    success: "alert-success",
  };
</script>

<div class="toast toast-top toast-end z-50" aria-live="polite">
  {#each state.toasts as toast (toast.id)}
    <div role="alert" class="alert w-full {levelClasses[toast.level]}">
      <span>
        <!-- eslint-disable-next-line svelte/no-at-html-tags -- html is escaped by renderMarkdownInline (see markdownRenderer.ts) -->
        {@html renderMarkdownInline(toast.message)}
      </span>
      <button
        type="button"
        class="btn btn-ghost btn-xs"
        aria-label="Dismiss notification"
        onclick={() => state.dismiss(toast.id)}
      >
        ✕
      </button>
    </div>
  {/each}
</div>
