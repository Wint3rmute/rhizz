<script lang="ts">
import {
  type ToastLevel,
  type ToastState,
  toastState,
} from "../ToastState.svelte";

let { state = toastState }: { state?: ToastState } = $props();

const levelClasses: Record<ToastLevel, string> = {
  info: "border-info/40",
  warning: "border-warning/40",
  error: "border-error/40",
  success: "border-success/40",
};
</script>

<div class="toast toast-top toast-end z-50" aria-live="polite">
  {#each state.toasts as toast (toast.id)}
    <div
      role="alert"
      class="card bg-base-100 border shadow-xl p-3 {levelClasses[toast.level]}"
    >
      <div class="flex items-center gap-2">
        <span class="text-sm text-base-content">{toast.message}</span>
        <button
          type="button"
          class="btn btn-ghost btn-xs"
          aria-label="Dismiss notification"
          onclick={() => state.dismiss(toast.id)}
        >
          ✕
        </button>
      </div>
    </div>
  {/each}
</div>
