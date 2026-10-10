import { afterEach, describe, expect, it } from "vitest";
import {
  clampDiagnosticsHeight,
  coerceDiagnosticsLayout,
  collapseDiagnosticsPanel,
  DIAGNOSTICS_LAYOUT_DEFAULTS,
  DIAGNOSTICS_LAYOUT_KEY,
  DIAGNOSTICS_MAX_HEIGHT,
  DIAGNOSTICS_MIN_HEIGHT,
  type DiagnosticsLayout,
  expandDiagnosticsPanel,
  forgetDiagnosticsLayout,
  readDiagnosticsLayout,
  resizeDiagnosticsPanel,
  writeDiagnosticsLayout,
} from "./diagnosticsLayout";

function layout(overrides: Partial<DiagnosticsLayout> = {}): DiagnosticsLayout {
  return { ...DIAGNOSTICS_LAYOUT_DEFAULTS, ...overrides };
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

describe("clampDiagnosticsHeight", () => {
  it("passes through heights inside the range", () => {
    expect(clampDiagnosticsHeight(256)).toBe(256);
    expect(clampDiagnosticsHeight(DIAGNOSTICS_MIN_HEIGHT)).toBe(
      DIAGNOSTICS_MIN_HEIGHT,
    );
    expect(clampDiagnosticsHeight(DIAGNOSTICS_MAX_HEIGHT)).toBe(
      DIAGNOSTICS_MAX_HEIGHT,
    );
  });

  it("clamps outside [min, max]", () => {
    expect(clampDiagnosticsHeight(0)).toBe(DIAGNOSTICS_MIN_HEIGHT);
    expect(clampDiagnosticsHeight(5000)).toBe(DIAGNOSTICS_MAX_HEIGHT);
  });

  it("falls back to the default height for non-finite heights", () => {
    expect(clampDiagnosticsHeight(Number.NaN)).toBe(
      DIAGNOSTICS_LAYOUT_DEFAULTS.height,
    );
  });
});

describe("coerceDiagnosticsLayout", () => {
  it("returns defaults for non-objects", () => {
    expect(coerceDiagnosticsLayout(undefined)).toEqual(
      DIAGNOSTICS_LAYOUT_DEFAULTS,
    );
    expect(coerceDiagnosticsLayout(null)).toEqual(
      DIAGNOSTICS_LAYOUT_DEFAULTS,
    );
    expect(coerceDiagnosticsLayout("garbage")).toEqual(
      DIAGNOSTICS_LAYOUT_DEFAULTS,
    );
  });

  it("clamps out-of-range heights instead of rejecting the entry", () => {
    expect(coerceDiagnosticsLayout({ height: 1, expanded: true })).toEqual(
      layout({ height: DIAGNOSTICS_MIN_HEIGHT, expanded: true }),
    );
  });

  it("falls back per-field on partial corruption", () => {
    expect(
      coerceDiagnosticsLayout({ height: "tall", expanded: "yes" }),
    ).toEqual(DIAGNOSTICS_LAYOUT_DEFAULTS);
  });
});

describe("expand/collapse helpers", () => {
  it("flips the flag while preserving the height", () => {
    const start = layout({ height: 300 });
    expect(expandDiagnosticsPanel(start)).toEqual(
      layout({ height: 300, expanded: true }),
    );
    expect(
      collapseDiagnosticsPanel(layout({ height: 300, expanded: true })),
    ).toEqual(layout({ height: 300 }));
  });
});

describe("resizeDiagnosticsPanel", () => {
  it("sets the height, clamped, without flipping the open flag", () => {
    expect(resizeDiagnosticsPanel(layout(), 300).height).toBe(300);
    expect(resizeDiagnosticsPanel(layout(), 1).height).toBe(
      DIAGNOSTICS_MIN_HEIGHT,
    );
    expect(resizeDiagnosticsPanel(layout(), 9999).height).toBe(
      DIAGNOSTICS_MAX_HEIGHT,
    );
    const open = resizeDiagnosticsPanel(
      layout({ expanded: true }),
      300,
    );
    expect(open.expanded).toBe(true);
  });
});

describe("diagnostics layout storage", () => {
  it("is the default layout when nothing was stored", () => {
    stubStore();
    expect(readDiagnosticsLayout()).toEqual(DIAGNOSTICS_LAYOUT_DEFAULTS);
  });

  it("round-trips height and the open flag", () => {
    stubStore();
    const saved = layout({ height: 320, expanded: true });
    writeDiagnosticsLayout(saved);
    expect(readDiagnosticsLayout()).toEqual(saved);
  });

  it("rejects garbage instead of handing it back", () => {
    const data = stubStore();
    data.set(DIAGNOSTICS_LAYOUT_KEY, "{not json");
    expect(readDiagnosticsLayout()).toEqual(DIAGNOSTICS_LAYOUT_DEFAULTS);
  });

  it("forgets the stored layout", () => {
    stubStore();
    writeDiagnosticsLayout(layout({ expanded: true }));
    forgetDiagnosticsLayout();
    expect(readDiagnosticsLayout()).toEqual(DIAGNOSTICS_LAYOUT_DEFAULTS);
  });

  it("stays quiet without any storage", () => {
    expect(readDiagnosticsLayout()).toEqual(DIAGNOSTICS_LAYOUT_DEFAULTS);
    expect(() => {
      writeDiagnosticsLayout(layout({ expanded: true }));
    }).not.toThrow();
    expect(() => {
      forgetDiagnosticsLayout();
    }).not.toThrow();
  });
});
