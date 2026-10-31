import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  chromeColorFor,
  isThemeSelection,
  loadSelection,
  nextSelectionOnToggle,
  type ResolvedTheme,
  resolveTheme,
  type ThemeSelection,
} from "./theme";

describe("loadSelection", () => {
  it.each([
    [null, "auto"],
    ["dark", "dark"],
    ["light", "light"],
    ["auto", "auto"],
    [JSON.stringify("dark"), "dark"],
    [JSON.stringify("auto"), "auto"],
    ["{not json", "auto"],
    ["blue", "auto"],
    [JSON.stringify("blue"), "auto"],
    ["  dark  ", "dark"],
  ])("loadSelection(%j) = %j", (stored, expected) => {
    expect(loadSelection(stored as string | null)).toBe(expected);
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

describe("chromeColorFor", () => {
  it("gives each theme the page background its own base-100 is", () => {
    // Measured off the built stylesheet's `--color-base-100` per theme
    // (oklch(100% 0 0) and oklch(25.33% .016 252.42)) and converted by
    // pixel readback, so the toolbar matches the app rather than a guess.
    expect(chromeColorFor("light")).toBe("#FFFFFF");
    expect(chromeColorFor("dark")).toBe("#1D232A");
  });

  it("is what a browser accepts as a theme-color", () => {
    for (const theme of ["light", "dark"] as const) {
      expect(chromeColorFor(theme)).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  // app.html's pre-paint script cannot import from this module — it runs
  // before any bundle exists — so the two copies of the colour can only be
  // tied together by a test.
  describe("agrees with the literals app.html has to hard-code", () => {
    const appHtml = readFileSync(
      fileURLToPath(new URL("./app.html", import.meta.url)),
      "utf8",
    );

    it("uses the same two colours in the pre-paint script's ternary", () => {
      expect(appHtml).toContain(
        `theme === "dark" ? "${chromeColorFor("dark")}" : "${chromeColorFor(
          "light",
        )}"`,
      );
    });

    it("gives the static tag the dark colour", () => {
      expect(appHtml).toContain(
        `<meta name="theme-color" content="${chromeColorFor("dark")}" />`,
      );
    });
  });
});
