<script lang="ts">
// A drag handle between a side panel and the Inventory's central diagram:
// pointer drags report the horizontal delta in pixels, arrow keys nudge by a
// fixed step. Exposed as a `slider` (the interactive role for a resize handle
// with a value) so it is keyboard-focusable and announced with its current
// width. The parent owns the sign (a left panel grows with +dx, a right
// panel with −dx) and clamps the result — this component only measures.
import {
  INVENTORY_PANEL_MAX_WIDTH,
  INVENTORY_PANEL_MIN_WIDTH,
} from "./inventoryLayout";

let {
  side,
  value,
  min = INVENTORY_PANEL_MIN_WIDTH,
  max = INVENTORY_PANEL_MAX_WIDTH,
  onresize,
  hidden = false,
}: {
  /** Which panel the splitter resizes (names the control for AT). */
  side: "left" | "right";
  /** Current panel width in pixels, announced as the slider value. */
  value: number;
  /** Clamp bounds, announced as the slider range. */
  min?: number;
  /** Clamp bounds, announced as the slider range. */
  max?: number;
  /** Called with the horizontal drag delta in pixels (positive = right). */
  onresize: (dx: number) => void;
  /** When true the splitter is removed from the layout (panel hidden). */
  hidden?: boolean;
} = $props();

const label = $derived(
  side === "left" ? "Resize browser panel" : "Resize details panel",
);

let track = $state<HTMLElement | null>(null);
let dragX = $state<number | null>(null);

/** Keyboard nudge step in pixels (shift = coarse). */
const KEY_STEP = 8;
const KEY_STEP_COARSE = 32;

function onpointerdown(event: PointerEvent): void {
  dragX = event.clientX;
  track?.setPointerCapture(event.pointerId);
}

function onpointermove(event: PointerEvent): void {
  if (dragX === null) return;
  const dx = event.clientX - dragX;
  dragX = event.clientX;
  if (dx !== 0) onresize(dx);
}

function endDrag(event: PointerEvent): void {
  dragX = null;
  if (track?.hasPointerCapture(event.pointerId)) {
    track.releasePointerCapture(event.pointerId);
  }
}

function onkeydown(event: KeyboardEvent): void {
  const step = event.shiftKey ? KEY_STEP_COARSE : KEY_STEP;
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    onresize(-step);
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    onresize(step);
  }
}
</script>

<div
  bind:this={track}
  role="slider"
  aria-label={label}
  aria-valuenow={Math.round(value)}
  aria-valuemin={min}
  aria-valuemax={max}
  aria-orientation="vertical"
  tabindex="0"
  data-testid="inventory-splitter-{side}"
  style:display={hidden ? "none" : ""}
  class="shrink-0 hidden md:flex items-stretch justify-center w-2 cursor-col-resize group"
  onpointerdown={onpointerdown}
  onpointermove={onpointermove}
  onpointerup={endDrag}
  onpointercancel={endDrag}
  onkeydown={onkeydown}
>
  <div
    class="w-px bg-base-300 group-hover:bg-primary group-focus-visible:bg-primary transition-colors"
    aria-hidden="true"
  ></div>
</div>
