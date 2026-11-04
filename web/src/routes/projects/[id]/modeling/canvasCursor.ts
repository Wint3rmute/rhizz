// Cursor for the Modeling canvas: one pure function so the precedence is
// obvious and unit-testable (the rule used to be an inline nested ternary
// on the <svg>).
//
// Precedence: auto-layout wins (it rewrites positions every frame, so the
// pointer is never really in charge); then the read-only freeze (a project
// held by someone else shows `not-allowed`, since no gesture may start —
// panning excepted, it is navigation, not an edit); then the live gesture.
export type CanvasInteractionType =
  | "idle"
  | "dragging"
  | "resizing"
  | "panning"
  | "marquee"
  | "connecting"
  | "port-dragging";

export function canvasCursor(opts: {
  autoLayoutRunning: boolean;
  readonly: boolean;
  interactionType: CanvasInteractionType;
}): "wait" | "grabbing" | "crosshair" | "grab" | "not-allowed" {
  if (opts.autoLayoutRunning) return "wait";
  if (opts.readonly)
    return opts.interactionType === "panning" ? "grabbing" : "not-allowed";
  switch (opts.interactionType) {
    case "dragging":
    case "resizing":
    case "panning":
      return "grabbing";
    case "marquee":
      return "crosshair";
    case "idle":
    case "connecting":
    case "port-dragging":
      return "grab";
  }
}
