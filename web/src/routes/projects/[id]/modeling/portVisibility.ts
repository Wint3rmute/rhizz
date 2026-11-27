// Per-view port visibility, toggled from the Components tree.
//
// A view draws a port when a drawn connection names it, or when the view
// marks it as shown (`port "x" { visible = true }`, kept in
// `DiagramLayout.visiblePorts`). The shown flag is what makes an unconnected
// port — e.g. part of a component's public interface — appear at all.

/** How a port row in the Components tree presents its checkbox. */
export type PortRowState =
  /** Owning component is not placed in this view: nothing to show it on. */
  | "unplaced"
  /** A drawn connection names the port, so it shows regardless of the flag. */
  | "connected"
  /** Shown because the view marks it visible. */
  | "shown"
  /** Placed, unconnected in this view, not marked visible. */
  | "hidden";

export function portRowState(input: {
  placed: boolean;
  connected: boolean;
  shown: boolean;
}): PortRowState {
  if (!input.placed) return "unplaced";
  if (input.connected) return "connected";
  return input.shown ? "shown" : "hidden";
}

/**
 * Flips whether `label` is shown on component `key`, returning a new map.
 * Labels stay sorted (stable, diff-friendly output); a component left with no
 * shown ports is dropped so the view file carries no empty entries.
 */
export function togglePortVisibility(
  visiblePorts: Readonly<Record<string, readonly string[]>>,
  key: string,
  label: string,
): Record<string, string[]> {
  const current = visiblePorts[key] ?? [];
  const next = current.includes(label)
    ? current.filter((entry) => entry !== label)
    : [...current, label].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return Object.fromEntries(
    [
      ...Object.entries(visiblePorts).filter(([other]) => other !== key),
      [key, next] as const,
    ]
      .filter(([, labels]) => labels.length > 0)
      .map(([k, labels]) => [k, [...labels]]),
  );
}
