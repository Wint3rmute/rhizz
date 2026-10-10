import { afterEach, describe, expect, it } from "vitest";
import {
  createPaneLayout,
  DEFAULT_PANE_MAX_WIDTH,
  DEFAULT_PANE_MIN_WIDTH,
  type PaneLayout,
} from "./paneLayout";

const store = createPaneLayout({ key: "test-pane-layout" });

function layout(overrides: Partial<PaneLayout> = {}): PaneLayout {
  return { ...store.defaults, ...overrides };
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

describe("clampWidth", () => {
  it("passes through widths inside the range", () => {
    expect(store.clampWidth(320)).toBe(320);
    expect(store.clampWidth(DEFAULT_PANE_MIN_WIDTH)).toBe(
      DEFAULT_PANE_MIN_WIDTH,
    );
    expect(store.clampWidth(DEFAULT_PANE_MAX_WIDTH)).toBe(
      DEFAULT_PANE_MAX_WIDTH,
    );
  });

  it("clamps below min up to min", () => {
    expect(store.clampWidth(0)).toBe(DEFAULT_PANE_MIN_WIDTH);
    expect(store.clampWidth(-100)).toBe(DEFAULT_PANE_MIN_WIDTH);
    expect(store.clampWidth(DEFAULT_PANE_MIN_WIDTH - 1)).toBe(
      DEFAULT_PANE_MIN_WIDTH,
    );
  });

  it("clamps above max down to max", () => {
    expect(store.clampWidth(5000)).toBe(DEFAULT_PANE_MAX_WIDTH);
    expect(store.clampWidth(DEFAULT_PANE_MAX_WIDTH + 1)).toBe(
      DEFAULT_PANE_MAX_WIDTH,
    );
  });

  it("falls back to the default width for non-finite widths", () => {
    expect(store.clampWidth(Number.NaN)).toBe(store.defaults.leftWidth);
    expect(store.clampWidth(Number.POSITIVE_INFINITY)).toBe(
      store.defaults.leftWidth,
    );
  });

  it("honours custom bounds", () => {
    const narrow = createPaneLayout({
      key: "test-narrow",
      minWidth: 100,
      maxWidth: 300,
    });
    expect(narrow.clampWidth(50)).toBe(100);
    expect(narrow.clampWidth(500)).toBe(300);
    expect(narrow.clampWidth(200)).toBe(200);
  });
});

describe("coerce", () => {
  it("returns defaults for non-objects", () => {
    expect(store.coerce(undefined)).toEqual(store.defaults);
    expect(store.coerce(null)).toEqual(store.defaults);
    expect(store.coerce("garbage")).toEqual(store.defaults);
    expect(store.coerce(42)).toEqual(store.defaults);
  });

  it("returns defaults for an empty object", () => {
    expect(store.coerce({})).toEqual(store.defaults);
  });

  it("clamps out-of-range widths instead of rejecting the entry", () => {
    expect(
      store.coerce({ leftWidth: 1, rightWidth: 9999 }),
    ).toEqual(
      layout({
        leftWidth: DEFAULT_PANE_MIN_WIDTH,
        rightWidth: DEFAULT_PANE_MAX_WIDTH,
      }),
    );
  });

  it("falls back per-field so a partially corrupt entry keeps what it can", () => {
    expect(
      store.coerce({
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
      store.coerce({ leftHidden: true, rightHidden: true }),
    ).toEqual(layout({ leftHidden: true, rightHidden: true }));
  });

  it("honours custom defaults", () => {
    const custom = createPaneLayout({
      key: "test-custom-defaults",
      defaultLeftWidth: 256,
      defaultRightWidth: 256,
    });
    expect(custom.coerce({})).toEqual(
      {
        leftWidth: 256,
        rightWidth: 256,
        leftHidden: false,
        rightHidden: false,
      },
    );
  });
});

describe("hide/show helpers", () => {
  it("hiding a panel preserves its width", () => {
    const start = layout({ leftWidth: 350, rightWidth: 450 });
    expect(store.hide(start, "left")).toEqual(
      layout({ leftWidth: 350, rightWidth: 450, leftHidden: true }),
    );
    expect(store.hide(start, "right")).toEqual(
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
    expect(store.show(hidden, "left")).toEqual(
      layout({ leftWidth: 350, rightWidth: 450, rightHidden: true }),
    );
    expect(store.show(hidden, "right")).toEqual(
      layout({ leftWidth: 350, rightWidth: 450, leftHidden: true }),
    );
  });

  it("hiding one side leaves the other side untouched", () => {
    const start = layout({ rightHidden: true });
    expect(store.hide(start, "left")).toEqual(
      layout({ rightHidden: true, leftHidden: true }),
    );
  });
});

describe("resize", () => {
  it("sets the width for the chosen side only", () => {
    const start = layout();
    expect(store.resize(start, "left", 400)).toEqual(
      layout({ leftWidth: 400 }),
    );
    expect(store.resize(start, "right", 500)).toEqual(
      layout({ rightWidth: 500 }),
    );
  });

  it("clamps the new width to [min, max]", () => {
    const start = layout();
    expect(store.resize(start, "left", 1).leftWidth).toBe(
      DEFAULT_PANE_MIN_WIDTH,
    );
    expect(store.resize(start, "right", 9999).rightWidth).toBe(
      DEFAULT_PANE_MAX_WIDTH,
    );
  });

  it("never flips the hidden flag", () => {
    const hidden = layout({ leftHidden: true });
    const resized = store.resize(hidden, "left", 400);
    expect(resized.leftHidden).toBe(true);
    expect(resized.leftWidth).toBe(400);
  });
});

describe("layout storage", () => {
  it("is the default layout when nothing was stored", () => {
    stubStore();
    expect(store.read()).toEqual(store.defaults);
  });

  it("round-trips widths and hidden flags", () => {
    stubStore();
    const saved = layout({
      leftWidth: 280,
      rightWidth: 500,
      leftHidden: true,
      rightHidden: false,
    });
    store.write(saved);
    expect(store.read()).toEqual(saved);
  });

  it("keeps stores with different keys apart", () => {
    stubStore();
    const other = createPaneLayout({ key: "test-other-layout" });
    store.write(layout({ leftHidden: true }));
    expect(other.read()).toEqual(other.defaults);
  });

  it("rejects garbage instead of handing it back", () => {
    const data = stubStore();
    data.set(store.key, "{not json");
    expect(store.read()).toEqual(store.defaults);
    data.set(store.key, JSON.stringify(42));
    expect(store.read()).toEqual(store.defaults);
  });

  it("clamps stored widths on read", () => {
    const data = stubStore();
    data.set(
      store.key,
      JSON.stringify({ leftWidth: 1, rightWidth: 9999 }),
    );
    expect(store.read()).toEqual(
      layout({
        leftWidth: DEFAULT_PANE_MIN_WIDTH,
        rightWidth: DEFAULT_PANE_MAX_WIDTH,
      }),
    );
  });

  it("forgets the stored layout", () => {
    stubStore();
    store.write(layout({ leftHidden: true }));
    store.forget();
    expect(store.read()).toEqual(store.defaults);
  });

  it("stays quiet without any storage", () => {
    expect(store.read()).toEqual(store.defaults);
    expect(() => {
      store.write(layout({ leftHidden: true }));
    }).not.toThrow();
    expect(() => {
      store.forget();
    }).not.toThrow();
  });
});
