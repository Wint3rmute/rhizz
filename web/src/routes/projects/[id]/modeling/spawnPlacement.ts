// Where an entity spawned onto the modeling canvas lands.
//
// Every spawn path that has no position of its own — the `C`/`N` keyboard
// shortcuts, the toolbar buttons — resolves to the same anchor: under the
// pointer while it is over the canvas, otherwise the viewport center (where
// the user is looking). Deliberately DOM-free so the policy is unit
// testable; the page owns tracking the pointer and converting its client
// coordinates to world (SVG) coordinates.
export interface Point {
  x: number;
  y: number;
}

/**
 * Anchor for a newly spawned entity: `cursor` (already in world
 * coordinates) when the pointer is over the canvas, else `viewportCenter`.
 * `cursor` is null — not undefined/0 — when the pointer is elsewhere, so a
 * cursor legitimately at the canvas origin still wins.
 */
export function pickSpawnAnchor(
  cursor: Point | null,
  viewportCenter: Point,
): Point {
  return cursor ?? viewportCenter;
}

/**
 * Top-left corner of a `width` × `height` box centered on `point`, so a
 * spawned node covers the pointer instead of hanging off to its bottom-right.
 */
export function nodeTopLeftAt(
  point: Point,
  width: number,
  height: number,
): Point {
  return { x: point.x - width / 2, y: point.y - height / 2 };
}
