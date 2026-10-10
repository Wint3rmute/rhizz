// Viewport-relative size caps for resizable panels: a panel may grow up to
// a fraction of the viewport along its extension direction (side panels to
// a share of the width, the bottom bar to a share of the height), so large
// screens get roomier panels while small screens keep a usable centre.
//
// The absolute px ceilings in the layout stores stay as backstops (and as
// the announced slider range); this cap only ever lowers the effective
// maximum, never below the stores' minimum widths. No `window` (SSR, unit
// tests) means uncapped — resize handlers only run on client events, so
// the guard is for safety, not for a live code path.
export type ViewportAxis = "width" | "height";

/**
 * Share of the viewport width one side panel may grow to. Both panels
 * fully open still leave room for the centre.
 */
export const SIDE_PANEL_WIDTH_FRACTION = 0.4;

/**
 * Share of the viewport height the bottom bar may grow to. The overlay
 * floats over the page, so this stops short of swallowing it.
 */
export const BOTTOM_BAR_HEIGHT_FRACTION = 0.7;

/**
 * The largest size allowed at a fraction of the viewport along `axis`,
 * or `Infinity` when there is no viewport to measure.
 */
export function viewportCap(fraction: number, axis: ViewportAxis): number {
  if (
    typeof window === "undefined" ||
    typeof window.innerWidth !== "number" ||
    typeof window.innerHeight !== "number"
  ) {
    return Number.POSITIVE_INFINITY;
  }
  const viewport = axis === "width" ? window.innerWidth : window.innerHeight;
  return viewport * fraction;
}
