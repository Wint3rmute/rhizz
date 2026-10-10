// The diagnostics bottom bar's layout state: the expanded panel's height
// in pixels plus whether the panel is open, persisted across reloads.
//
// Same guarded, validated storage idiom as `lastView.ts` and the side-panel
// stores (`paneLayout.ts`): a namespaced key, JSON-encoded value, and a
// validated read so garbage never reaches the layout. Deliberately
// dependency-free so the logic is unit-testable in isolation.

/** Serializable layout state for the diagnostics bar. */
export interface DiagnosticsLayout {
  /** Expanded panel height in pixels. */
  height: number;
  /** Whether the diagnostics panel is open. */
  expanded: boolean;
}

/** localStorage key holding the JSON-encoded layout. */
export const DIAGNOSTICS_LAYOUT_KEY = "rhizz-diagnostics-layout:v1";

/** Default panel height: the old fixed cap (`max-h-64`). */
export const DIAGNOSTICS_DEFAULT_HEIGHT = 256;

/** Minimum panel height: a few rows stay readable. */
export const DIAGNOSTICS_MIN_HEIGHT = 96;

/** Maximum panel height in pixels. */
export const DIAGNOSTICS_MAX_HEIGHT = 480;

/** Default layout: closed bar, default panel height. */
export const DIAGNOSTICS_LAYOUT_DEFAULTS: DiagnosticsLayout = {
  height: DIAGNOSTICS_DEFAULT_HEIGHT,
  expanded: false,
};

/** Clamps a panel height to the allowed [min, max] range. */
export function clampDiagnosticsHeight(height: number): number {
  if (!Number.isFinite(height)) return DIAGNOSTICS_DEFAULT_HEIGHT;
  return Math.min(
    DIAGNOSTICS_MAX_HEIGHT,
    Math.max(DIAGNOSTICS_MIN_HEIGHT, height),
  );
}

/**
 * Coerces an arbitrary value into a valid layout, falling back to defaults
 * field-by-field so a partially corrupt entry still preserves what it can.
 */
export function coerceDiagnosticsLayout(value: unknown): DiagnosticsLayout {
  if (typeof value !== "object" || value === null) {
    return { ...DIAGNOSTICS_LAYOUT_DEFAULTS };
  }
  const record = value as Record<string, unknown>;
  const height = typeof record.height === "number"
    ? clampDiagnosticsHeight(record.height)
    : DIAGNOSTICS_LAYOUT_DEFAULTS.height;
  const expanded = typeof record.expanded === "boolean"
    ? record.expanded
    : false;
  return { height, expanded };
}

function layoutStore():
  | Pick<Storage, "getItem" | "setItem" | "removeItem">
  | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    // Private browsing etc. — persistence simply does not happen.
    return null;
  }
}

/** Reads the persisted layout, or defaults when nothing usable was stored. */
export function readDiagnosticsLayout(): DiagnosticsLayout {
  try {
    const raw = layoutStore()?.getItem(DIAGNOSTICS_LAYOUT_KEY) ?? null;
    if (raw === null) return { ...DIAGNOSTICS_LAYOUT_DEFAULTS };
    return coerceDiagnosticsLayout(JSON.parse(raw) as unknown);
  } catch {
    return { ...DIAGNOSTICS_LAYOUT_DEFAULTS };
  }
}

/** Persists the layout. Quiet when storage is unavailable. */
export function writeDiagnosticsLayout(layout: DiagnosticsLayout): void {
  try {
    layoutStore()?.setItem(DIAGNOSTICS_LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    // Storage unwritable: the layout just does not survive reload.
  }
}

/**
 * Drops the persisted layout — test seam for hermetic stories, and the
 * right call when a layout needs resetting.
 */
export function forgetDiagnosticsLayout(): void {
  try {
    layoutStore()?.removeItem(DIAGNOSTICS_LAYOUT_KEY);
  } catch {
    // Storage unwritable: nothing to forget.
  }
}

/** Returns the layout with the panel open, preserving its height. */
export function expandDiagnosticsPanel(
  layout: DiagnosticsLayout,
): DiagnosticsLayout {
  return { ...layout, expanded: true };
}

/** Returns the layout with the panel closed, preserving its height. */
export function collapseDiagnosticsPanel(
  layout: DiagnosticsLayout,
): DiagnosticsLayout {
  return { ...layout, expanded: false };
}

/**
 * Returns the layout with the panel resized, clamped to [min, max].
 * The open flag is untouched so a resize never opens or closes the panel.
 */
export function resizeDiagnosticsPanel(
  layout: DiagnosticsLayout,
  height: number,
): DiagnosticsLayout {
  return { ...layout, height: clampDiagnosticsHeight(height) };
}
