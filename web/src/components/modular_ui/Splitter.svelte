<script lang="ts">
// A drag handle between a panel and a workspace's central area: pointer
// drags report the delta in pixels along the orientation axis, arrow keys
// nudge by a fixed step. Exposed as a `slider` (the interactive role for a
// resize handle with a value) so it is keyboard-focusable and announced
// with its current size. The parent owns the sign (a left panel grows with
// +dx, a bottom panel with −dy) and clamps the result — this component
// only measures.
import { DEFAULT_PANE_MAX_WIDTH, DEFAULT_PANE_MIN_WIDTH } from "./paneLayout";

let {
  testid,
  orientation = "horizontal",
  panelName,
  value,
  min = DEFAULT_PANE_MIN_WIDTH,
  max = DEFAULT_PANE_MAX_WIDTH,
  onresize,
  hidden = false,
  responsive = true,
}: {
  /** Test hook, e.g. `"inventory-splitter-left"`. */
  testid: string;
  /**
   * Drag axis: `"horizontal"` for side panels (dx, ArrowLeft/Right,
   * vertical bar) or `"vertical"` for top/bottom panels (dy,
   * ArrowUp/Down, horizontal bar).
   */
  orientation?: "horizontal" | "vertical";
  /** Human name of the resized panel, e.g. `"browser"`. */
  panelName: string;
  /** Current panel size in pixels, announced as the slider value. */
  value: number;
  /** Clamp bounds, announced as the slider range. */
  min?: number;
  /** Clamp bounds, announced as the slider range. */
  max?: number;
  /**
   * Called with the drag delta in pixels along the orientation axis
   * (positive = right / down).
   */
  onresize: (d: number) => void;
  /** When true the splitter is removed from the layout (panel hidden). */
  hidden?: boolean;
  /**
   * When false the splitter stays visible below `md:` too (for panels
   * that never stack, like the always-visible diagnostics bar).
   */
  responsive?: boolean;
} = $props();

const label = $derived(`Resize ${panelName} panel`);
const isVertical = $derived(orientation === "vertical");

let track = $state<HTMLElement | null>(null);
let dragAt = $state<number | null>(null);

/** Keyboard nudge step in pixels (shift = coarse). */
const KEY_STEP = 8;
const KEY_STEP_COARSE = 32;

function onpointerdown(event: PointerEvent): void {
  dragAt = isVertical ? event.clientY : event.clientX;
  track?.setPointerCapture(event.pointerId);
}

function onpointermove(event: PointerEvent): void {
  if (dragAt === null) return;
  const at = isVertical ? event.clientY : event.clientX;
  const d = at - dragAt;
  dragAt = at;
  if (d !== 0) onresize(d);
}

function endDrag(event: PointerEvent): void {
  dragAt = null;
  if (track?.hasPointerCapture(event.pointerId)) {
    track.releasePointerCapture(event.pointerId);
  }
}

function onkeydown(event: KeyboardEvent): void {
  const step = event.shiftKey ? KEY_STEP_COARSE : KEY_STEP;
  const backward = isVertical ? "ArrowUp" : "ArrowLeft";
  const forward = isVertical ? "ArrowDown" : "ArrowRight";
  if (event.key === backward) {
    event.preventDefault();
    onresize(-step);
  } else if (event.key === forward) {
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
  aria-orientation={orientation}
  tabindex="0"
  data-testid={testid}
  style:display={hidden ? "none" : ""}
  class="shrink-0 {responsive
    ? 'hidden md:flex'
    : 'flex'} {isVertical
    ? 'w-full items-center justify-center h-2 cursor-row-resize'
    : 'items-stretch justify-center w-2 cursor-col-resize'} group"
  onpointerdown={onpointerdown}
  onpointermove={onpointermove}
  onpointerup={endDrag}
  onpointercancel={endDrag}
  onkeydown={onkeydown}
>
  <div
    class="{isVertical
      ? 'h-px w-full'
      : 'w-px'} bg-base-300 group-hover:bg-primary group-focus-visible:bg-primary transition-colors"
    aria-hidden="true"
  ></div>
</div>
