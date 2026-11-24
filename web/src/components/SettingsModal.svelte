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
  import { WARNING_LEVELS } from "../rhizz_wasm_wrapper";

  let {
    open = false,
    onclose = () => {},
  }: {
    open?: boolean;
    onclose?: () => void;
  } = $props();

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

  function onBackdropKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape") onclose();
  }
</script>

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
    onkeydown={onBackdropKeydown}
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
          <label class="label" for="settings-theme">
            <span class="label-text-alt text-base-content/60"
              >Auto follows the browser preference.</span
            >
          </label>
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
          <label class="label" for="settings-warning-level">
            <span class="label-text-alt text-base-content/60"
              >Gates which warnings the compiler reports. Errors always show.</span
            >
          </label>
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
          <label class="label" for="settings-transition">
            <span
              id="settings-transition-help"
              class="label-text-alt text-base-content/60"
              >0 is instant, 3000 is 3 seconds. Honors reduced-motion.</span
            >
          </label>
        </div>
      </div>
    </div>
  </div>
{/if}
