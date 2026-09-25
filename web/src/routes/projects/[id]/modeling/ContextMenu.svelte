<script lang="ts">
// Right-click context menu for the Modeling canvas. Presentation-only: every
// row is a label (left) plus an optional keyboard shortcut hint (right,
// greyed). All behavior lives in +page.svelte — this component only reports
// which item was picked (or that the menu should close).
export interface ContextMenuItem {
  label: string;
  /** Hint shown right-aligned, e.g. "H" or "Del". Not wired here. */
  shortcut?: string | undefined;
  /** Red tint for destructive rows (annotation/connection delete). */
  dangerous?: boolean | undefined;
  action: () => void;
}

interface Props {
  /** Viewport (client) coordinates of the click. Clamped into the window. */
  x: number;
  y: number;
  items: ContextMenuItem[];
  onclose: () => void;
}

let { x, y, items, onclose }: Props = $props();

const MENU_WIDTH = 260;
let clampedX = $derived(
  typeof window === "undefined"
    ? x
    : Math.max(8, Math.min(x, window.innerWidth - MENU_WIDTH - 8)),
);
let clampedY = $derived(
  typeof window === "undefined"
    ? y
    : Math.max(8, Math.min(y, window.innerHeight - items.length * 36 - 24)),
);
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === "Escape") onclose();
  }}
/>

<!-- Fullscreen click-catcher: any click outside the menu closes it. -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="fixed inset-0 z-40 cursor-default"
  data-testid="context-menu-backdrop"
  onclick={onclose}
  oncontextmenu={(e) => {
    e.preventDefault();
    onclose();
  }}
></div>

<div
  role="menu"
  data-testid="context-menu"
  class="fixed z-50 w-65 rounded-box border border-base-300 bg-base-100 shadow-xl py-1"
  style="left: {clampedX}px; top: {clampedY}px; width: {MENU_WIDTH}px;"
>
  {#each items as item (item.label)}
    <button
      type="button"
      role="menuitem"
      class="flex w-full items-center justify-between gap-4 px-3 py-2 text-sm hover:bg-base-200 {item.dangerous
        ? 'text-error'
        : 'text-base-content'}"
      onclick={() => {
        item.action();
        onclose();
      }}
    >
      <span class="truncate">{item.label}</span>
      {#if item.shortcut}
        <kbd
          class="shrink-0 rounded border border-base-300 bg-base-200 px-1.5 py-0.5 font-mono text-[11px] text-base-content/50"
        >
          {item.shortcut}
        </kbd>
      {/if}
    </button>
  {/each}
</div>
