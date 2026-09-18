// Typed anchor names for the guided tours.
//
// Tour spotlights resolve through `[data-tour="..."]` selectors (see
// `tourSelector`) instead of bare HTML ids: ids are global, collide when a
// component renders twice (main diagram + embedded view) and break silently
// on rename — a key of this object is compiler-checked at every use site.
export const TOUR_TARGETS = {
  /** Top navigation bar (links + project controls). */
  navbar: "navbar",
  /** System Overview stats card. */
  overview: "overview-stats",
  /** Diagrams floating toolbar (layout, zoom, add) — small and always
      in view, unlike the viewport-filling canvas (no outside placement
      fits that, so the canvas itself is never a spotlight target). */
  diagramToolbar: "diagrams-toolbar",
  /** Diagrams sidebar (component selection + node inspector). */
  diagramSidebar: "diagrams-sidebar",
  /** Inventory component list. */
  inventory: "inventory-list",
  /** Explore documentation viewer. */
  explore: "explore-docs",
  /** Editor code pane. */
  editor: "editor-pane",
} as const;

export type TourTargetKey = keyof typeof TOUR_TARGETS;

/** Builds the `[data-tour="..."]` selector Zag resolves the target with. */
export function tourSelector(key: TourTargetKey): string {
  return `[data-tour="${TOUR_TARGETS[key]}"]`;
}
