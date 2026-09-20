// Typed anchor names for the guided tours.
//
// Tour spotlights resolve through `[data-tour="..."]` selectors (see
// `tourSelector`) instead of bare HTML ids: ids are global, collide when a
// component renders twice (main diagram + embedded view) and break silently
// on rename — a key of this object is compiler-checked at every use site.
//
// Anchor rule: spotlight small chrome (bars, headers, controls), never
// viewport-filling panels — no outside card placement fits those, so the
// card escapes the viewport and the step goes dead.
export const TOUR_TARGETS = {
  /** Top navigation bar (links + project controls). */
  navbar: "navbar",
  /** Overview stats card. */
  overview: "overview-stats",
  /** Diagrams floating toolbar (layout, zoom, add) — small and always
      in view, unlike the viewport-filling canvas (no outside placement
      fits that, so the canvas itself is never a spotlight target). */
  diagramToolbar: "diagrams-toolbar",
  /** Diagrams sidebar (component selection + node inspector). */
  diagramSidebar: "diagrams-sidebar",
  /** Inventory filter tabs (above the list). */
  inventory: "inventory-list",
  /** Explore diagram breadcrumb. */
  explore: "explore-docs",
  /** Editor pane header (shows the open file). */
  editor: "editor-pane",
} as const;

export type TourTargetKey = keyof typeof TOUR_TARGETS;

/** Builds the `[data-tour="..."]` selector Zag resolves the target with. */
export function tourSelector(key: TourTargetKey): string {
  return `[data-tour="${TOUR_TARGETS[key]}"]`;
}
