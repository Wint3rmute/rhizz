// Shared layout state for workspaces with two hideable, resizable side
// panels (Inventory, Modeling): panel sizes + hidden flags in one plain
// serializable object, persisted to localStorage under a per-workspace key.
//
// Each workspace defines its store in one line —
// `createPaneLayout({ key: "rhizz-inventory-layout:v1" })` — and reads it
// back with the same guarded, validated idiom as `lastView.ts`, so garbage
// never reaches the layout. Deliberately dependency-free so the logic is
// unit-testable in isolation.

/** Serializable layout state: sizes in pixels + hidden flags. */
export interface PaneLayout {
  leftWidth: number;
  rightWidth: number;
  leftHidden: boolean;
  rightHidden: boolean;
}

/** Default panel sizes in pixels. */
export const DEFAULT_PANE_LEFT_WIDTH = 320;
export const DEFAULT_PANE_RIGHT_WIDTH = 384;

/** Clamp bounds in pixels, shared by every side-panel workspace. */
export const DEFAULT_PANE_MIN_WIDTH = 200;
export const DEFAULT_PANE_MAX_WIDTH = 600;

export interface PaneLayoutOptions {
  /** localStorage key holding the JSON-encoded layout. */
  key: string;
  /** Default left panel width in pixels. */
  defaultLeftWidth?: number;
  /** Default right panel width in pixels. */
  defaultRightWidth?: number;
  /** Minimum panel width in pixels. */
  minWidth?: number;
  /** Maximum panel width in pixels. */
  maxWidth?: number;
}

/** Which side of the workspace a panel stands on. */
export type PaneSide = "left" | "right";

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

/**
 * Defines a workspace's side-panel layout store. All helpers below close
 * over the key/defaults, so workspaces never touch localStorage directly
 * and two stores can never collide.
 */
export function createPaneLayout(options: PaneLayoutOptions) {
  const {
    key,
    defaultLeftWidth = DEFAULT_PANE_LEFT_WIDTH,
    defaultRightWidth = DEFAULT_PANE_RIGHT_WIDTH,
    minWidth = DEFAULT_PANE_MIN_WIDTH,
    maxWidth = DEFAULT_PANE_MAX_WIDTH,
  } = options;

  const defaults: PaneLayout = {
    leftWidth: defaultLeftWidth,
    rightWidth: defaultRightWidth,
    leftHidden: false,
    rightHidden: false,
  };

  /** Clamps a panel width to the store's [min, max] range. */
  function clampWidth(width: number): number {
    if (!Number.isFinite(width)) return defaultLeftWidth;
    return Math.min(maxWidth, Math.max(minWidth, width));
  }

  /**
   * Coerces an arbitrary value into a valid layout, falling back to
   * defaults field-by-field so a partially corrupt entry still preserves
   * what it can.
   */
  function coerce(value: unknown): PaneLayout {
    if (typeof value !== "object" || value === null) {
      return { ...defaults };
    }
    const record = value as Record<string, unknown>;
    const leftWidth = typeof record.leftWidth === "number"
      ? clampWidth(record.leftWidth)
      : defaults.leftWidth;
    const rightWidth = typeof record.rightWidth === "number"
      ? clampWidth(record.rightWidth)
      : defaults.rightWidth;
    const leftHidden = typeof record.leftHidden === "boolean"
      ? record.leftHidden
      : false;
    const rightHidden = typeof record.rightHidden === "boolean"
      ? record.rightHidden
      : false;
    return { leftWidth, rightWidth, leftHidden, rightHidden };
  }

  /** Reads the persisted layout, or defaults when nothing usable was stored. */
  function read(): PaneLayout {
    try {
      const raw = layoutStore()?.getItem(key) ?? null;
      if (raw === null) return { ...defaults };
      return coerce(JSON.parse(raw) as unknown);
    } catch {
      return { ...defaults };
    }
  }

  /** Persists the layout. Quiet when storage is unavailable. */
  function write(layout: PaneLayout): void {
    try {
      layoutStore()?.setItem(key, JSON.stringify(layout));
    } catch {
      // Storage unwritable: the layout just does not survive reload.
    }
  }

  /**
   * Drops the persisted layout — test seam for hermetic stories, and the
   * right call when a layout needs resetting.
   */
  function forget(): void {
    try {
      layoutStore()?.removeItem(key);
    } catch {
      // Storage unwritable: nothing to forget.
    }
  }

  /** Returns the layout with the given side hidden, preserving its width. */
  function hide(layout: PaneLayout, side: PaneSide): PaneLayout {
    return side === "left"
      ? { ...layout, leftHidden: true }
      : { ...layout, rightHidden: true };
  }

  /** Returns the layout with the given side shown, preserving its width. */
  function show(layout: PaneLayout, side: PaneSide): PaneLayout {
    return side === "left"
      ? { ...layout, leftHidden: false }
      : { ...layout, rightHidden: false };
  }

  /**
   * Returns the layout with the given side resized, clamped to [min, max].
   * The hidden flag is untouched so a resize never shows or hides a panel.
   */
  function resize(
    layout: PaneLayout,
    side: PaneSide,
    width: number,
  ): PaneLayout {
    const clamped = clampWidth(width);
    return side === "left"
      ? { ...layout, leftWidth: clamped }
      : { ...layout, rightWidth: clamped };
  }

  return {
    key,
    defaults,
    minWidth,
    maxWidth,
    clampWidth,
    coerce,
    read,
    write,
    forget,
    hide,
    show,
    resize,
  };
}

/** A layout store as returned by {@link createPaneLayout}. */
export type PaneLayoutStore = ReturnType<typeof createPaneLayout>;
