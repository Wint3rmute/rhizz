<script lang="ts">
import {
  type ToastLevel,
  type ToastState,
  toastState,
} from "../ToastState.svelte";

let { state = toastState }: { state?: ToastState } = $props();

const levelClasses: Record<ToastLevel, string> = {
  info: "bg-info/10 border-info/25 text-base-content",
  warning: "bg-warning/10 border-warning/25 text-base-content",
  error: "bg-error/10 border-error/25 text-base-content",
  success: "bg-success/10 border-success/25 text-base-content",
};
</script>

<div class="toast toast-top toast-end z-50" aria-live="polite">
  {#each state.toasts as toast (toast.id)}
    <div role="alert" class="alert border {levelClasses[toast.level]} shadow-md">
      <span>{toast.message}</span>
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
