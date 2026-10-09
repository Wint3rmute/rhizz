<script lang="ts">
// A side panel of the Inventory modular workspace: owns its header (title +
// hide control), its width, and its restore rail. The panel content arrives
// as `children` and is left unchanged.
//
// Hiding never unmounts the content: the section stays in the DOM with
// `display: none`, so component state (search text, scroll, open tabs,
// half-typed edits) survives hide/restore. The restore rail is a slim bar
// that is only visible while hidden — and the whole bar is the expand
// control (one large click target, not a fiddly icon button).
import type { Snippet } from "svelte";

let {
  title,
  side,
  width,
  hidden = false,
  onhide,
  onshow,
  children,
}: {
  /** Panel title, shown in the header and naming the hide/show controls. */
  title: string;
  /** Which side of the workspace the panel stands on. */
  side: "left" | "right";
  /** Panel width in pixels (applied from `md:` up; full width below). */
  width: number;
  /** When true the panel is hidden and the restore rail shows instead. */
  hidden?: boolean;
  /** Hides the panel (width is preserved for the restore). */
  onhide: () => void;
  /** Restores the panel at its preserved width. */
  onshow: () => void;
  /** Panel content — stays mounted across hide/restore. */
  children: Snippet;
} = $props();

const panelId = $derived(`inventory-pane-${side}`);
const hideLabel = $derived(`Hide ${title}`);
const showLabel = $derived(`Show ${title}`);
</script>

<!-- Restore rail: a slim bar while the panel is hidden. The whole bar is
     one button — a large click target instead of a fiddly icon — with an
     explicit pointer cursor (Tailwind v4 does not put one on buttons) and
     hover feedback so its clickability is obvious. -->
<button
  type="button"
  data-testid="inventory-pane-rail-{side}"
  style:display={hidden ? "" : "none"}
  onclick={onshow}
  aria-label={showLabel}
  title={showLabel}
  aria-expanded="false"
  aria-controls={panelId}
  class="shrink-0 flex md:flex-col items-center justify-center gap-1 bg-base-100 border-base-300 px-2 py-3 cursor-pointer hover:bg-base-200 hover:text-primary transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary {side ===
  'left'
    ? 'border-r'
    : 'border-l'}"
>
  {#if side === "left"}
    <span aria-hidden="true" class="text-base leading-none">»</span>
  {:else}
    <span aria-hidden="true" class="text-base leading-none">«</span>
  {/if}
</button>

<section
  id={panelId}
  aria-label={title}
  data-testid="inventory-pane-{side}"
  style:display={hidden ? "none" : ""}
  style:--pane-width="{width}px"
  class="shrink-0 w-full md:w-[var(--pane-width)] bg-base-100 text-base-content flex flex-col min-h-0 overflow-hidden {side ===
  'left'
    ? 'border-r border-base-300'
    : 'border-l border-base-300'}"
>
  <header class="flex items-center gap-2 px-3 py-2 border-b border-base-300">
    <h2 class="font-semibold text-lg flex-1 min-w-0 truncate">{title}</h2>
    <button
      type="button"
      class="btn btn-ghost btn-xs"
      onclick={onhide}
      aria-label={hideLabel}
      title={hideLabel}
      aria-expanded="true"
      aria-controls={panelId}
      data-testid="inventory-pane-hide-{side}"
    >
      {#if side === "left"}
        <span aria-hidden="true">«</span>
      {:else}
        <span aria-hidden="true">»</span>
      {/if}
    </button>
  </header>
  <div class="flex-1 min-h-0 flex flex-col overflow-hidden">
    {@render children()}
  </div>
</section>
