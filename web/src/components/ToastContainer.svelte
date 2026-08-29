<script lang="ts">
import {
  type ToastLevel,
  type ToastState,
  toastState,
} from "../ToastState.svelte";

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
    <div role="alert" class="alert {levelClasses[toast.level]} shadow-lg">
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
