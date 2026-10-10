// Drag guard for pane splitters: while a splitter is dragged, pointer
// motion must not select page text. A reference count (one entry per active
// drag) drives a single body class, so overlapping drags (multi-touch)
// cannot clear each other's guard early. The class itself lives in
// `app.css` (`body.pane-dragging`); this module only toggles it.
//
// Deliberately dependency-free so the counting is unit-testable in
// isolation (the DOM is touched through a guarded lookup, quiet without
// one, same idiom as the layout stores).
let activeDrags = 0;

function guardTarget(): Document | null {
  try {
    if (typeof document === "undefined") return null;
    return document;
  } catch {
    return null;
  }
}

/** Marks one splitter drag as active; safe to call without a DOM. */
export function beginPaneDrag(): void {
  activeDrags += 1;
  guardTarget()?.body.classList.add("pane-dragging");
}

/**
 * Marks one splitter drag as finished, clearing the guard once none
 * remain. Extra calls without a matching begin are ignored, so a stray
 * pointerup can never drive the count negative.
 */
export function endPaneDrag(): void {
  activeDrags = Math.max(0, activeDrags - 1);
  if (activeDrags === 0) {
    guardTarget()?.body.classList.remove("pane-dragging");
  }
}
