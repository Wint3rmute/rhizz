// Shared "drawn" predicate for view connections: one rule for the Modeling
// canvas edge list and the connections sidebar, so they cannot disagree.
//
// A connection is drawn in a view when both endpoint components are placed
// in the view, belong to the view's system, and the connection is not hidden.
// Hidden is a per-view setting keyed by connection name
// (`views/<label>.hcl`: `connection "name" { hidden = true }`).
//
// Connections are identified by name within a system: copies of one
// declaration (each instance clones its definition's connections) share a
// name and are one connection for hiding and the sidebar.
export interface ConnectionRef {
  label: string;
  from: number;
  to: number;
}

/** Both endpoints placed on the canvas, ignoring visibility. */
export function isPlacedInSystem(
  conn: Pick<ConnectionRef, "from" | "to">,
  placed: ReadonlySet<number>,
  inSystem: (index: number) => boolean,
): boolean {
  return (
    placed.has(conn.from) &&
    placed.has(conn.to) &&
    inSystem(conn.from) &&
    inSystem(conn.to)
  );
}

/** Drawn means placed, in-system, and not hidden. */
export function isConnectionDrawn(
  conn: Pick<ConnectionRef, "from" | "to" | "label">,
  placed: ReadonlySet<number>,
  inSystem: (index: number) => boolean,
  isHidden: (label: string) => boolean,
): boolean {
  if (isHidden(conn.label)) return false;
  return isPlacedInSystem(conn, placed, inSystem);
}

export interface ConnectionRow {
  label: string;
  /** Checked means shown: at least one copy is drawn. */
  shown: boolean;
}

/**
 * Sidebar rows, grouped by connection name. A name is listed when any of its
 * copies has both endpoints placed in the view's system (hidden or not, so a
 * hidden connection stays listed and can be shown again); it is checked when
 * any copy is drawn. Copies that are not placed have no visible effect.
 * Rows are sorted by label for a stable list.
 */
export function sidebarConnectionRows(
  connections: readonly Pick<ConnectionRef, "from" | "to" | "label">[],
  placed: ReadonlySet<number>,
  inSystem: (index: number) => boolean,
  isHidden: (label: string) => boolean,
): ConnectionRow[] {
  const byLabel = new Map<string, { listed: boolean; shown: boolean }>();
  for (const conn of connections) {
    let entry = byLabel.get(conn.label);
    if (!entry) {
      entry = { listed: false, shown: false };
      byLabel.set(conn.label, entry);
    }
    if (isPlacedInSystem(conn, placed, inSystem)) entry.listed = true;
    if (isConnectionDrawn(conn, placed, inSystem, isHidden)) entry.shown = true;
  }
  return [...byLabel.entries()]
    .filter(([, entry]) => entry.listed)
    .map(([label, entry]) => ({ label, shown: entry.shown }))
    .sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
}

/** Canvas edges: every copy that is drawn. Order is the input order. */
export function drawnConnections<
  T extends Pick<ConnectionRef, "from" | "to" | "label">,
>(
  connections: readonly T[],
  placed: ReadonlySet<number>,
  inSystem: (index: number) => boolean,
  isHidden: (label: string) => boolean,
): T[] {
  return connections.filter((conn) =>
    isConnectionDrawn(conn, placed, inSystem, isHidden),
  );
}
