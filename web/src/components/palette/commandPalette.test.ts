import { describe, expect, it } from "vitest";
import {
  createPaletteIndex,
  isApplePlatform,
  isPaletteShortcut,
  labelSegments,
  type PaletteItem,
  paletteRows,
  paletteShortcutHint,
  wrapIndex,
} from "./commandPalette";

const ITEMS: PaletteItem[] = [
  { id: "view:main", label: "main.hcl", group: "Views" },
  { id: "file:system", label: "system.hcl", detail: "model", group: "Files" },
  { id: "cmd:explore", label: "Go to Explore", hint: "Navigate" },
];

describe("labelSegments", () => {
  it("returns the whole label as one unmatched run when nothing matched", () => {
    expect(labelSegments("main.hcl", [])).toEqual([
      { text: "main.hcl", matched: false },
    ]);
  });

  it("returns nothing for an empty label", () => {
    expect(labelSegments("", [[0, 2]])).toEqual([]);
  });

  it("splits a label around a single matched range", () => {
    expect(labelSegments("main.hcl", [[0, 3]])).toEqual([
      { text: "main", matched: true },
      { text: ".hcl", matched: false },
    ]);
  });

  it("keeps several matched runs in order", () => {
    // Fuse's ranges are inclusive, so [0, 0] is one character.
    expect(labelSegments("main.hcl", [[0, 0], [5, 5]])).toEqual([
      { text: "m", matched: true },
      { text: "ain.", matched: false },
      { text: "h", matched: true },
      { text: "cl", matched: false },
    ]);
  });

  it("merges ranges that overlap or touch, so no empty run survives", () => {
    // [0, 1] and [1, 2] are contiguous, and [2, 3] reaches them.
    expect(labelSegments("abcd", [[0, 1], [1, 2], [2, 3]])).toEqual([
      { text: "abcd", matched: true },
    ]);
  });

  it("keeps runs separate when a real gap separates them", () => {
    expect(labelSegments("abcd", [[0, 0], [2, 3]])).toEqual([
      { text: "a", matched: true },
      { text: "b", matched: false },
      { text: "cd", matched: true },
    ]);
  });

  it("clamps ranges that run past either end of the label", () => {
    expect(labelSegments("ab", [[-5, 99]])).toEqual([
      { text: "ab", matched: true },
    ]);
  });

  it("drops a range that clamps down to nothing", () => {
    expect(labelSegments("ab", [[5, 9]])).toEqual([
      { text: "ab", matched: false },
    ]);
  });

  });

describe("wrapIndex", () => {
  it("wraps forward past the end", () => {
    expect(wrapIndex(3, 3)).toBe(0);
  });

  it("wraps backward past the start", () => {
    expect(wrapIndex(-1, 3)).toBe(2);
  });

  it("passes an in-range index through", () => {
    expect(wrapIndex(1, 3)).toBe(1);
  });

  it("reports no highlight at all for an empty list", () => {
    expect(wrapIndex(0, 0)).toBe(-1);
  });
});

describe("paletteRows", () => {
  it("lists every item in its given order when the query is empty", () => {
    const index = createPaletteIndex(ITEMS);
    const rows = paletteRows(index, "");
    expect(rows.map((r) => r.item.id)).toEqual([
      "view:main",
      "file:system",
      "cmd:explore",
    ]);
  });

  it("treats a whitespace-only query as no query", () => {
    const index = createPaletteIndex(ITEMS);
    expect(paletteRows(index, "   ")).toHaveLength(3);
  });

  it("fuzzy-matches out of order and ranks the best match first", () => {
    const index = createPaletteIndex([...ITEMS, { id: "b", label: "battery" }]);
    const rows = paletteRows(index, "batt");
    expect(rows[0]?.item.id).toBe("b");
  });

  it("prefers the label a query points most directly at", () => {
    // The ranking is the whole reason the fuse options do not turn
    // location off: "m" should lead to "main.hcl" and then reach
    // "views/main.hcl" last, not keep whatever the index listed first.
    const index = createPaletteIndex([
      { id: "system", label: "system.hcl" },
      { id: "main", label: "main.hcl" },
      { id: "views/main", label: "views/main.hcl" },
    ]);
    expect(paletteRows(index, "m").map((r) => r.item.id)).toEqual([
      "main",
      "system",
      "views/main",
    ]);
  });

  it("narrows as the query grows instead of reordering at random", () => {
    const index = createPaletteIndex([
      { id: "system", label: "system.hcl" },
      { id: "main", label: "main.hcl" },
    ]);
    expect(paletteRows(index, "m").map((r) => r.item.id)).toEqual([
      "main",
      "system",
    ]);
    expect(paletteRows(index, "ma").map((r) => r.item.id)).toEqual(["main"]);
    expect(paletteRows(index, "mh")).toEqual([]);
  });

  it("highlights every matched character, not just the first run", () => {
    const index = createPaletteIndex([{ id: "x", label: "explore" }]);
    const [row] = paletteRows(index, "epl");
    expect(row?.segments).toEqual([
      { text: "e", matched: true },
      { text: "x", matched: false },
      { text: "pl", matched: true },
      { text: "ore", matched: false },
    ]);
  });

  it("matches on the hidden hint too, leaving the label unhighlighted", () => {
    const index = createPaletteIndex(ITEMS);
    const rows = paletteRows(index, "navigate");
    expect(rows.map((r) => r.item.id)).toEqual(["cmd:explore"]);
    expect(rows[0]?.segments).toEqual([
      { text: "Go to Explore", matched: false },
    ]);
  });

  it("carries detail and group through untouched", () => {
    const index = createPaletteIndex(ITEMS);
    const row = paletteRows(index, "system")[0];
    expect(row?.item).toMatchObject({
      id: "file:system",
      detail: "model",
      group: "Files",
    });
  });

  it("returns nothing for a query that matches nothing", () => {
    const index = createPaletteIndex(ITEMS);
    expect(paletteRows(index, "zzzzqqq")).toEqual([]);
  });

  it("searches an empty item list without throwing", () => {
    expect(paletteRows(createPaletteIndex([]), "main")).toEqual([]);
  });
});

describe("isPaletteShortcut", () => {
  const press = (
    key: string,
    mods: Partial<{
      ctrlKey: boolean;
      metaKey: boolean;
      shiftKey: boolean;
      altKey: boolean;
    }> = {},
  ) => ({
    key,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...mods,
  });

  it("opens on Ctrl-P", () => {
    expect(isPaletteShortcut(press("p", { ctrlKey: true }))).toBe(true);
  });

  it("treats Cmd as the same primary modifier as Ctrl", () => {
    expect(isPaletteShortcut(press("p", { metaKey: true }))).toBe(true);
    // Uppercase, as a shifted keypress reports it.
    expect(isPaletteShortcut(press("P", { metaKey: true }))).toBe(true);
  });

  it("is not the chord any more once Shift is added", () => {
    // Ctrl-Shift-P used to open a second palette. There is one now, and this
    // says so: the chord is exactly Ctrl-P, so nothing else may claim it.
    expect(
      isPaletteShortcut(press("p", { ctrlKey: true, shiftKey: true })),
    ).toBe(false);
  });

  it("ignores the chord without a modifier, or with Alt held", () => {
    expect(isPaletteShortcut(press("p"))).toBe(false);
    expect(
      isPaletteShortcut(press("p", { ctrlKey: true, altKey: true })),
    ).toBe(false);
  });

  it("ignores any other key", () => {
    expect(isPaletteShortcut(press("k", { ctrlKey: true }))).toBe(false);
  });
});

describe("paletteShortcutHint", () => {
  it("spells the mac chord with symbols", () => {
    expect(paletteShortcutHint(true)).toBe("⌘P");
  });

  it("spells the other platforms' chord with words", () => {
    expect(paletteShortcutHint(false)).toBe("Ctrl+P");
  });
});

describe("isApplePlatform", () => {
  it("recognises the platforms that write the chord with ⌘", () => {
    expect(isApplePlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"))
      .toBe(true);
    expect(
      isApplePlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"),
    ).toBe(true);
    expect(isApplePlatform("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)"))
      .toBe(
        true,
      );
  });

  it("treats everything else as Ctrl", () => {
    expect(
      isApplePlatform("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"),
    ).toBe(false);
    expect(isApplePlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe(
      false,
    );
    expect(isApplePlatform("")).toBe(false);
  });
});
