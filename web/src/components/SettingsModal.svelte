<script lang="ts">
  import { getSelection, setSelection } from "../ThemeState.svelte";
  import type { ThemeSelection } from "../theme";
  import {
    getWarningLevel,
    setWarningLevel,
    warningLevelLabel,
  } from "../WarningLevelState.svelte";
  import {
    getTransitionMs,
    setTransitionMs,
    TRANSITION_MS_MAX,
    TRANSITION_MS_MIN,
  } from "../TransitionState.svelte";
  import { WARNING_LEVELS } from "../rhizome_wasm_wrapper";
  import { resolveIcon } from "../iconHelper";

  let {
    open = false,
    onclose = () => {},
    onstarttour = () => {},
  }: {
    open?: boolean;
    onclose?: () => void;
    /** Starts the guided tour (provided by the navbar, which owns projects/navigation). */
    onstarttour?: () => void;
  } = $props();

  const tourIcon = resolveIcon("question");

  const THEME_OPTIONS: { value: ThemeSelection; label: string }[] = [
    { value: "auto", label: "Auto (follow browser)" },
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
  ];

  function transitionLabel(ms: number): string {
    if (ms <= 0) return "Instant (no animation)";
    if (ms < 1000) return `${String(ms)} ms`;
    const seconds = (ms / 1000)
      .toFixed(2)
      .replace(/0+$/, "")
      .replace(/\.$/, "");
    return `${seconds} s (${String(ms)} ms)`;
  }

  // Dismiss on Escape even when focus never entered the dialog (e.g. the
  // "Open settings" button keeps focus after opening). The backdrop's own
  // onkeydown only fires for events bubbling through it, so a window
  // listener — same as the command palette's — is the honest one.
  function handleWindowKeydown(e: KeyboardEvent): void {
    if (!open) return;
    if (e.key === "Escape") {
      e.preventDefault();
      onclose();
    }
  }
</script>

<svelte:window onkeydown={handleWindowKeydown} />

{#if open}
  <div
    class="modal modal-open z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center cursor-pointer"
    role="dialog"
    aria-modal="true"
    aria-label="Settings"
    data-testid="settings-modal"
    tabindex="-1"
    onclick={(e) => {
      if (e.target === e.currentTarget) onclose();
    }}
  >
    <div
      class="modal-box max-w-md bg-base-100 border border-base-300 shadow-2xl p-6 rounded-box max-h-[90vh] flex flex-col cursor-default"
    >
      <div
        class="flex items-center justify-between pb-3 border-b border-base-300"
      >
        <h3 class="font-bold text-lg">Settings</h3>
        <button
          onclick={onclose}
          class="btn btn-sm btn-ghost btn-circle"
          title="Close (Esc)"
          aria-label="Close settings"
        >
          ✕
        </button>
      </div>

      <div class="overflow-y-auto flex-1 py-4 flex flex-col gap-5">
        <div class="form-control w-full">
          <label class="label" for="settings-theme">
            <span class="label-text font-medium">Theme</span>
          </label>
          <select
            id="settings-theme"
            class="select select-bordered w-full"
            value={getSelection()}
            onchange={(e) =>
              setSelection(e.currentTarget.value as ThemeSelection)}
          >
            {#each THEME_OPTIONS as opt (opt.value)}
              <option value={opt.value}>{opt.label}</option>
            {/each}
          </select>
          <p class="mt-1 text-xs text-base-content/60">
            Auto follows the browser preference.
          </p>
        </div>

        <div class="form-control w-full">
          <label class="label" for="settings-warning-level">
            <span class="label-text font-medium">Compiler error level</span>
          </label>
          <select
            id="settings-warning-level"
            class="select select-bordered w-full"
            value={getWarningLevel()}
            onchange={(e) => setWarningLevel(e.currentTarget.value)}
          >
            {#each WARNING_LEVELS as level (level)}
              <option value={level}>{warningLevelLabel(level)}</option>
            {/each}
          </select>
          <p class="mt-1 text-xs text-base-content/60">
            Gates which warnings the compiler reports. Errors always show.
          </p>
        </div>

        <div class="form-control w-full">
          <label class="label" for="settings-transition">
            <span class="label-text font-medium">Diagram transition time</span>
            <span
              class="label-text-alt tabular-nums"
              data-testid="settings-transition-value"
              >{transitionLabel(getTransitionMs())}</span
            >
          </label>
          <input
            id="settings-transition"
            type="range"
            min={TRANSITION_MS_MIN}
            max={TRANSITION_MS_MAX}
            step="10"
            value={getTransitionMs()}
            oninput={(e) => setTransitionMs(Number(e.currentTarget.value))}
            class="range range-primary"
            aria-describedby="settings-transition-help"
          />
          <p
            id="settings-transition-help"
            class="mt-1 text-xs text-base-content/60"
          >
            0 is instant, 3000 is 3 seconds. Honors reduced-motion.
          </p>
        </div>

        <div class="divider my-0"></div>

        <div class="form-control w-full">
          <span class="label-text font-medium">Guided tour</span>
          <p class="mt-1 text-xs text-base-content/60">
            Walks through every workspace page with the drone example.
          </p>
          <button
            type="button"
            class="btn btn-outline w-full mt-2"
            onclick={onstarttour}
            aria-label="Start the guided tour"
          >
            {#if tourIcon}
              <svg
                viewBox={`0 0 ${tourIcon.width} ${tourIcon.height}`}
                class="w-4 h-4 fill-current"
                aria-hidden="true"
              >
                <path d={tourIcon.svgPath} />
              </svg>
            {/if}
            Start tour
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}
