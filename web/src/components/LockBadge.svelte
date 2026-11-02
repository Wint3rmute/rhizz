<!-- A locked project's badge: who holds it, and (for us) a display-name
     rename. Reads nothing on its own — the holder comes in as a prop so
     stories stay deterministic; the app passes the shared lock state.
     Renders nothing when the project is free. -->
<script lang="ts">
  import { projectLock } from "../collab/projectLock.svelte";
  import { setUsername } from "../collab/identity";
  import { toastState } from "../ToastState.svelte";

  let {
    holder,
    me = projectLock.me,
    direction = "bottom",
  }: {
    /** Who holds the project, or null when it is free (renders nothing). */
    holder: string | null;
    /** Our own username, for the "you" label and the rename row. */
    me?: string | null;
    /** Which way the details pop over opens. */
    direction?: "top" | "bottom";
  } = $props();

  const mine = $derived(holder !== null && holder === me);

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

{#if holder !== null}
  <div
    class="dropdown {direction === 'top' ? 'dropdown-top' : ''}"
    data-testid="lock-badge"
  >
    <div
      tabindex="0"
      role="button"
      class="badge badge-warning badge-sm gap-1 shrink-0"
      title="Locked by {holder} — select for details"
      aria-label="Locked by {holder}"
    >
      🔒 {mine ? "you" : holder}
    </div>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div
      tabindex="0"
      class="dropdown-content z-50 card bg-base-100 shadow-xl border border-base-300 p-3 w-64 text-left text-sm"
    >
      <p class="font-semibold">🔒 Locked by {mine ? "you" : holder}</p>
      <p class="text-base-content/60 mt-1">
        {mine
          ? "Your edits hold the project. Anyone else sees it read-only."
          : "The project is read-only until they let go."}
      </p>
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
      </div>
    </div>
  </div>
{/if}
