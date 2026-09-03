import { describe, expect, it } from "vitest";
import {
  isThemeSelection,
  loadSelection,
  nextSelectionOnToggle,
  type ResolvedTheme,
  resolveTheme,
  type ThemeSelection,
} from "./theme";

describe("loadSelection", () => {
  it("defaults to auto when nothing is stored", () => {
    expect(loadSelection(null)).toBe("auto");
  });

  it("reads an explicitly pinned dark selection (legacy raw format)", () => {
    expect(loadSelection("dark")).toBe("dark");
  });

  it("reads an explicitly pinned light selection (legacy raw format)", () => {
    expect(loadSelection("light")).toBe("light");
  });

  it("reads an explicit auto selection", () => {
    expect(loadSelection("auto")).toBe("auto");
  });

  it("accepts JSON-encoded values for backward compatibility", () => {
    expect(loadSelection(JSON.stringify("dark"))).toBe("dark");
    expect(loadSelection(JSON.stringify("auto"))).toBe("auto");
  });

  it("falls back to auto on corrupt JSON", () => {
    expect(loadSelection("{not json")).toBe("auto");
  });

  it("falls back to auto on an unknown value", () => {
    expect(loadSelection("blue")).toBe("auto");
    expect(loadSelection(JSON.stringify("blue"))).toBe("auto");
  });

  it("is robust to surrounding whitespace", () => {
    expect(loadSelection("  dark  ")).toBe("dark");
  });
});

describe("resolveTheme", () => {
  const cases: [ThemeSelection, boolean, ResolvedTheme][] = [
    // selection, prefersDark, expected resolved theme
    ["auto", true, "dark"],
    ["auto", false, "light"],
    ["dark", true, "dark"],
    ["dark", false, "dark"],
    ["light", true, "light"],
    ["light", false, "light"],
  ];
  it.each(cases)(
    "resolveTheme(%s, prefersDark=%s) = %s",
    (selection, prefersDark, expected) => {
      expect(resolveTheme(selection, prefersDark)).toBe(expected);
    },
  );
});

describe("nextSelectionOnToggle", () => {
  it("pins light when toggling away from a resolved dark theme", () => {
    expect(nextSelectionOnToggle("dark")).toBe("light");
  });

  it("pins dark when toggling away from a resolved light theme", () => {
    expect(nextSelectionOnToggle("light")).toBe("dark");
  });
});

describe("isThemeSelection", () => {
  it("accepts only the three known selections", () => {
    expect(isThemeSelection("auto")).toBe(true);
    expect(isThemeSelection("light")).toBe(true);
    expect(isThemeSelection("dark")).toBe(true);
    expect(isThemeSelection("blue")).toBe(false);
    expect(isThemeSelection("")).toBe(false);
    expect(isThemeSelection(42)).toBe(false);
    expect(isThemeSelection(null)).toBe(false);
  });
});
