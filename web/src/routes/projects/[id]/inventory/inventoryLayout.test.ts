import { afterEach, describe, expect, it } from "vitest";
import {
  clampPanelWidth,
  coerceInventoryLayout,
  forgetInventoryLayout,
  hideInventoryPanel,
  INVENTORY_LAYOUT_DEFAULTS,
  INVENTORY_LAYOUT_KEY,
  INVENTORY_PANEL_MAX_WIDTH,
  INVENTORY_PANEL_MIN_WIDTH,
  type InventoryLayout,
  readInventoryLayout,
  resizeInventoryPanel,
  showInventoryPanel,
  writeInventoryLayout,
} from "./inventoryLayout";

function layout(overrides: Partial<InventoryLayout> = {}): InventoryLayout {
  return { ...INVENTORY_LAYOUT_DEFAULTS, ...overrides };
}

function stubStore() {
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value);
      },
      removeItem: (key: string) => {
        data.delete(key);
      },
    },
    writable: true,
    configurable: true,
  });
  return data;
}

afterEach(() => {
  // Bare node has no localStorage; restore that between tests.
  Reflect.deleteProperty(globalThis, "localStorage");
});

describe("clampPanelWidth", () => {
  it("passes through widths inside the range", () => {
    expect(clampPanelWidth(320)).toBe(320);
    expect(clampPanelWidth(INVENTORY_PANEL_MIN_WIDTH)).toBe(
      INVENTORY_PANEL_MIN_WIDTH,
    );
    expect(clampPanelWidth(INVENTORY_PANEL_MAX_WIDTH)).toBe(
      INVENTORY_PANEL_MAX_WIDTH,
    );
  });

  it("clamps below min up to min", () => {
    expect(clampPanelWidth(0)).toBe(INVENTORY_PANEL_MIN_WIDTH);
    expect(clampPanelWidth(-100)).toBe(INVENTORY_PANEL_MIN_WIDTH);
    expect(clampPanelWidth(INVENTORY_PANEL_MIN_WIDTH - 1)).toBe(
      INVENTORY_PANEL_MIN_WIDTH,
    );
  });

  it("clamps above max down to max", () => {
    expect(clampPanelWidth(5000)).toBe(INVENTORY_PANEL_MAX_WIDTH);
    expect(clampPanelWidth(INVENTORY_PANEL_MAX_WIDTH + 1)).toBe(
      INVENTORY_PANEL_MAX_WIDTH,
    );
  });

  it("falls back to default for non-finite widths", () => {
    expect(clampPanelWidth(Number.NaN)).toBe(
      INVENTORY_LAYOUT_DEFAULTS.leftWidth,
    );
    expect(clampPanelWidth(Number.POSITIVE_INFINITY)).toBe(
      INVENTORY_LAYOUT_DEFAULTS.leftWidth,
    );
  });
});

describe("coerceInventoryLayout", () => {
  it("returns defaults for non-objects", () => {
    expect(coerceInventoryLayout(undefined)).toEqual(
      INVENTORY_LAYOUT_DEFAULTS,
    );
    expect(coerceInventoryLayout(null)).toEqual(INVENTORY_LAYOUT_DEFAULTS);
    expect(coerceInventoryLayout("garbage")).toEqual(
      INVENTORY_LAYOUT_DEFAULTS,
    );
    expect(coerceInventoryLayout(42)).toEqual(INVENTORY_LAYOUT_DEFAULTS);
  });

  it("returns defaults for an empty object", () => {
    expect(coerceInventoryLayout({})).toEqual(INVENTORY_LAYOUT_DEFAULTS);
  });

  it("clamps out-of-range widths instead of rejecting the entry", () => {
    expect(
      coerceInventoryLayout({ leftWidth: 1, rightWidth: 9999 }),
    ).toEqual(
      layout({
        leftWidth: INVENTORY_PANEL_MIN_WIDTH,
        rightWidth: INVENTORY_PANEL_MAX_WIDTH,
      }),
    );
  });

  it("falls back per-field so a partially corrupt entry keeps what it can", () => {
    expect(
      coerceInventoryLayout({
        leftWidth: 300,
        rightWidth: "wide",
        leftHidden: "yes",
        rightHidden: true,
      }),
    ).toEqual(
      layout({ leftWidth: 300, rightHidden: true }),
    );
  });

  it("preserves hidden flags", () => {
    expect(
      coerceInventoryLayout({ leftHidden: true, rightHidden: true }),
    ).toEqual(layout({ leftHidden: true, rightHidden: true }));
  });
});

describe("hide/show helpers", () => {
  it("hiding a panel preserves its width", () => {
    const start = layout({ leftWidth: 350, rightWidth: 450 });
    expect(hideInventoryPanel(start, "left")).toEqual(
      layout({ leftWidth: 350, rightWidth: 450, leftHidden: true }),
    );
    expect(hideInventoryPanel(start, "right")).toEqual(
      layout({ leftWidth: 350, rightWidth: 450, rightHidden: true }),
    );
  });

  it("showing a panel preserves its width (state survives hide/restore)", () => {
    const hidden = layout({
      leftWidth: 350,
      rightWidth: 450,
      leftHidden: true,
      rightHidden: true,
    });
    expect(showInventoryPanel(hidden, "left")).toEqual(
      layout({ leftWidth: 350, rightWidth: 450, rightHidden: true }),
    );
    expect(showInventoryPanel(hidden, "right")).toEqual(
      layout({ leftWidth: 350, rightWidth: 450, leftHidden: true }),
    );
  });

  it("hiding one side leaves the other side untouched", () => {
    const start = layout({ rightHidden: true });
    expect(hideInventoryPanel(start, "left")).toEqual(
      layout({ rightHidden: true, leftHidden: true }),
    );
  });
});

describe("resizeInventoryPanel", () => {
  it("sets the width for the chosen side only", () => {
    const start = layout();
    expect(resizeInventoryPanel(start, "left", 400)).toEqual(
      layout({ leftWidth: 400 }),
    );
    expect(resizeInventoryPanel(start, "right", 500)).toEqual(
      layout({ rightWidth: 500 }),
    );
  });

  it("clamps the new width to [min, max]", () => {
    const start = layout();
    expect(resizeInventoryPanel(start, "left", 1).leftWidth).toBe(
      INVENTORY_PANEL_MIN_WIDTH,
    );
    expect(resizeInventoryPanel(start, "right", 9999).rightWidth).toBe(
      INVENTORY_PANEL_MAX_WIDTH,
    );
  });

  it("never flips the hidden flag", () => {
    const hidden = layout({ leftHidden: true });
    const resized = resizeInventoryPanel(hidden, "left", 400);
    expect(resized.leftHidden).toBe(true);
    expect(resized.leftWidth).toBe(400);
  });
});

describe("layout storage", () => {
  it("is the default layout when nothing was stored", () => {
    stubStore();
    expect(readInventoryLayout()).toEqual(INVENTORY_LAYOUT_DEFAULTS);
  });

  it("round-trips widths and hidden flags", () => {
    stubStore();
    const saved = layout({
      leftWidth: 280,
      rightWidth: 500,
      leftHidden: true,
      rightHidden: false,
    });
    writeInventoryLayout(saved);
    expect(readInventoryLayout()).toEqual(saved);
  });

  it("rejects garbage instead of handing it back", () => {
    const data = stubStore();
    data.set(INVENTORY_LAYOUT_KEY, "{not json");
    expect(readInventoryLayout()).toEqual(INVENTORY_LAYOUT_DEFAULTS);
    data.set(INVENTORY_LAYOUT_KEY, JSON.stringify(42));
    expect(readInventoryLayout()).toEqual(INVENTORY_LAYOUT_DEFAULTS);
  });

  it("clamps stored widths on read", () => {
    const data = stubStore();
    data.set(
      INVENTORY_LAYOUT_KEY,
      JSON.stringify({ leftWidth: 1, rightWidth: 9999 }),
    );
    expect(readInventoryLayout()).toEqual(
      layout({
        leftWidth: INVENTORY_PANEL_MIN_WIDTH,
        rightWidth: INVENTORY_PANEL_MAX_WIDTH,
      }),
    );
  });

  it("forgets the stored layout", () => {
    stubStore();
    writeInventoryLayout(layout({ leftHidden: true }));
    forgetInventoryLayout();
    expect(readInventoryLayout()).toEqual(INVENTORY_LAYOUT_DEFAULTS);
  });

  it("stays quiet without any storage", () => {
    expect(readInventoryLayout()).toEqual(INVENTORY_LAYOUT_DEFAULTS);
    expect(() => {
      writeInventoryLayout(layout({ leftHidden: true }));
    }).not.toThrow();
    expect(() => {
      forgetInventoryLayout();
    }).not.toThrow();
  });
});
