// Regression test for the book-embed blank page: when the app runs in a
// cross-site iframe with third-party storage blocked (Safari by default,
// Chrome/Firefox/Brave with strict tracking protection), every touch of
// `localStorage` throws a SecurityError — including merely evaluating the
// `localStorage` binding itself. Storage access must therefore never throw,
// or module init (ThemeState, WarningLevelState, ProjectState, …) crashes
// the whole page and the embed renders only its empty app background.
import { afterEach, describe, expect, it } from "vitest";
import { safeGetItem, safeRemoveItem, safeSetItem } from "./safeStorage";

function stubWorkingStore() {
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
}

function stubBlockedStore() {
  // Mirrors a browser denying third-party storage: even reading the
  // binding throws, so `typeof localStorage` alone is not a guard.
  Object.defineProperty(globalThis, "localStorage", {
    get() {
      throw new DOMException("Access is denied", "SecurityError");
    },
    configurable: true,
  });
}

afterEach(() => {
  // @ts-expect-error test seam: restore the no-storage environment
  delete globalThis.localStorage;
});

describe("safeStorage with working storage", () => {
  it("round-trips get/set/remove", () => {
    stubWorkingStore();
    expect(safeGetItem("k")).toBeNull();
    safeSetItem("k", "v");
    expect(safeGetItem("k")).toBe("v");
    safeRemoveItem("k");
    expect(safeGetItem("k")).toBeNull();
  });
});

describe("safeStorage with blocked storage", () => {
  it("reads as missing instead of throwing", () => {
    stubBlockedStore();
    expect(() => {
      safeGetItem("k");
    }).not.toThrow();
    expect(safeGetItem("k")).toBeNull();
  });

  it("writes and removes as no-ops instead of throwing", () => {
    stubBlockedStore();
    expect(() => {
      safeSetItem("k", "v");
    }).not.toThrow();
    expect(() => {
      safeRemoveItem("k");
    }).not.toThrow();
  });
});

describe("safeStorage with no storage at all (SSR)", () => {
  it("reads as missing and writes as no-ops", () => {
    expect(safeGetItem("k")).toBeNull();
    expect(() => {
      safeSetItem("k", "v");
    }).not.toThrow();
    expect(() => {
      safeRemoveItem("k");
    }).not.toThrow();
  });
});
