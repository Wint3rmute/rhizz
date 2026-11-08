<!-- The project lock affordance: an optional label (the project name) with
     an inline lock icon when held — no badge chrome. The whole thing is one
     dropdown trigger opening the holder menu (who holds it, your name, the
     rename row, and — while you hold it — an unlock button). Reads the
     holder as a prop so stories stay deterministic; the app passes the
     shared lock state. Renders nothing without a holder and without a
     label. -->
<script lang="ts">
  import { projectLock } from "../collab/projectLock.svelte";
  import { setUsername } from "../collab/identity";
  import { toastState } from "../ToastState.svelte";

  let {
    holder,
    me = projectLock.me,
    direction = "bottom",
    label = null,
  }: {
    /** Who holds the project, or null when it is free (no icon then). */
    holder: string | null;
    /** Our own username, for the "you" label and the rename row. */
    me?: string | null;
    /** Which way the details pop over opens. */
    direction?: "top" | "bottom";
    /**
     * Leading label (the project name). The label plus the optional lock
     * icon form a single dropdown trigger.
     */
    label?: string | null;
  } = $props();

  const mine = $derived(holder !== null && holder === me);

  let unlocking = $state(false);

  async function handleUnlock(): Promise<void> {
    if (unlocking || !projectLock.holding) return;
    unlocking = true;
    try {
      await projectLock.unlock();
      toastState.show("Project unlocked.", "success");
    } finally {
      unlocking = false;
    }
  }

  function handleRename(): void {
    const next = prompt("Your display name?", me ?? "");
    if (next === null) return;
    const wasHolding = projectLock.holding;
    const stored = setUsername(next);
    if (stored === null) {
      toastState.show("Display name can't be blank.", "warning");
      return;
    }
    projectLock.me = stored;
    // Locks are keyed by name: renaming while holding one hands it to the
    // old name until its lease lapses. Re-read so the badge tells the truth
    // right away.
    void projectLock.refresh();
    if (wasHolding) {
      toastState.show(
        "Renamed — your old name still holds the lock until its lease lapses.",
        "warning",
        8_000,
      );
    }
  }
</script>

{#if holder !== null || label !== null}
  <div
    class="dropdown {direction === 'top' ? 'dropdown-top' : ''} min-w-0"
    data-testid="lock-badge"
  >
    <div
      tabindex="0"
      role="button"
      class="flex items-center gap-1 min-w-0 cursor-pointer"
      title={holder !== null
        ? `Locked by ${holder} — select for details`
        : "Project details"}
      aria-label={holder !== null
        ? `Locked by ${holder}`
        : (label ?? "Project details")}
    >
      {#if label !== null}
        <span class="truncate">{label}</span>
      {/if}
      {#if holder !== null}
        <span aria-hidden="true">🔒</span>
      {/if}
    </div>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div
      tabindex="0"
      class="dropdown-content z-50 card bg-base-100 shadow-xl border border-base-300 p-3 w-64 text-left text-sm font-normal"
    >
      {#if holder !== null}
        <p class="font-semibold">🔒 Locked by {mine ? "you" : holder}</p>
        <p class="text-base-content/60 mt-1">
          {mine
            ? "Your edits hold the project. Anyone else sees it read-only."
            : "The project is read-only until they let go."}
        </p>
      {:else}
        <p class="font-semibold">Not locked</p>
        <p class="text-base-content/60 mt-1">
          Nobody holds this project. Your first edit takes the lock.
        </p>
      {/if}
      <div class="mt-2 flex items-center gap-2">
        <span class="text-base-content/60 truncate">
          You are {me ?? "unknown"}
        </span>
        <button
          type="button"
          class="btn btn-ghost btn-xs ml-auto shrink-0"
          onclick={handleRename}
        >
          Rename
        </button>
        {#if mine}
          <button
            type="button"
            class="btn btn-warning btn-xs shrink-0"
            onclick={() => void handleUnlock()}
            disabled={unlocking}
          >
            {unlocking ? "Unlocking…" : "Unlock"}
          </button>
        {/if}
      </div>
    </div>
  </div>
{/if}
