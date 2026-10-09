// Pure helpers for the Inventory modular panes layout: panel widths,
// hidden flags, clamping, and localStorage persistence.
//
// Deliberately dependency-free so the logic is unit-testable in isolation
// and reusable by both the page component and its Storybook stories.

/** Serializable layout state for the Inventory three-pane workspace. */
export interface InventoryLayout {
  leftWidth: number;
  rightWidth: number;
  leftHidden: boolean;
  rightHidden: boolean;
}

/** localStorage key holding the JSON-encoded layout. */
export const INVENTORY_LAYOUT_KEY = "rhizz-inventory-layout:v1";

/** Default panel widths in pixels. */
export const INVENTORY_LEFT_DEFAULT_WIDTH = 320;
export const INVENTORY_RIGHT_DEFAULT_WIDTH = 384;

/** Minimum panel width in pixels. */
export const INVENTORY_PANEL_MIN_WIDTH = 200;

/** Maximum panel width in pixels. */
export const INVENTORY_PANEL_MAX_WIDTH = 600;

/** Default layout: both panels visible at their default widths. */
export const INVENTORY_LAYOUT_DEFAULTS: InventoryLayout = {
  leftWidth: INVENTORY_LEFT_DEFAULT_WIDTH,
  rightWidth: INVENTORY_RIGHT_DEFAULT_WIDTH,
  leftHidden: false,
  rightHidden: false,
};

/** Clamps a panel width to the allowed [min, max] range. */
export function clampPanelWidth(width: number): number {
  if (!Number.isFinite(width)) return INVENTORY_LEFT_DEFAULT_WIDTH;
  return Math.min(
    INVENTORY_PANEL_MAX_WIDTH,
    Math.max(INVENTORY_PANEL_MIN_WIDTH, width),
  );
}

/**
 * Coerces an arbitrary value into a valid layout, falling back to defaults
 * field-by-field so a partially corrupt entry still preserves what it can.
 */
export function coerceInventoryLayout(value: unknown): InventoryLayout {
  if (typeof value !== "object" || value === null) {
    return { ...INVENTORY_LAYOUT_DEFAULTS };
  }
  const record = value as Record<string, unknown>;
  const leftWidth = typeof record.leftWidth === "number"
    ? clampPanelWidth(record.leftWidth)
    : INVENTORY_LAYOUT_DEFAULTS.leftWidth;
  const rightWidth = typeof record.rightWidth === "number"
    ? clampPanelWidth(record.rightWidth)
    : INVENTORY_LAYOUT_DEFAULTS.rightWidth;
  const leftHidden = typeof record.leftHidden === "boolean"
    ? record.leftHidden
    : false;
  const rightHidden = typeof record.rightHidden === "boolean"
    ? record.rightHidden
    : false;
  return { leftWidth, rightWidth, leftHidden, rightHidden };
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
export function readInventoryLayout(): InventoryLayout {
  try {
    const raw = layoutStore()?.getItem(INVENTORY_LAYOUT_KEY) ?? null;
    if (raw === null) return { ...INVENTORY_LAYOUT_DEFAULTS };
    return coerceInventoryLayout(JSON.parse(raw) as unknown);
  } catch {
    return { ...INVENTORY_LAYOUT_DEFAULTS };
  }
}

/** Persists the layout. Quiet when storage is unavailable. */
export function writeInventoryLayout(layout: InventoryLayout): void {
  try {
    layoutStore()?.setItem(INVENTORY_LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    // Storage unwritable: the layout just does not survive reload.
  }
}

/**
 * Drops the persisted layout — test seam for hermetic stories, and the
 * right call when a layout needs resetting.
 */
export function forgetInventoryLayout(): void {
  try {
    layoutStore()?.removeItem(INVENTORY_LAYOUT_KEY);
  } catch {
    // Storage unwritable: nothing to forget.
  }
}

/** Returns the layout with the given side hidden, preserving its width. */
export function hideInventoryPanel(
  layout: InventoryLayout,
  side: "left" | "right",
): InventoryLayout {
  return side === "left"
    ? { ...layout, leftHidden: true }
    : { ...layout, rightHidden: true };
}

/** Returns the layout with the given side shown, preserving its width. */
export function showInventoryPanel(
  layout: InventoryLayout,
  side: "left" | "right",
): InventoryLayout {
  return side === "left"
    ? { ...layout, leftHidden: false }
    : { ...layout, rightHidden: false };
}

/**
 * Returns the layout with the given side resized, clamped to [min, max].
 * The hidden flag is untouched so a resize never shows or hides a panel.
 */
export function resizeInventoryPanel(
  layout: InventoryLayout,
  side: "left" | "right",
  width: number,
): InventoryLayout {
  const clamped = clampPanelWidth(width);
  return side === "left"
    ? { ...layout, leftWidth: clamped }
    : { ...layout, rightWidth: clamped };
}
