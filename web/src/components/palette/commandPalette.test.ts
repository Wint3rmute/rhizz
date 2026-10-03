import { describe, expect, it } from "vitest";
import {
  createPaletteIndex,
  isPaletteShortcut,
  labelSegments,
  type PaletteItem,
  paletteRows,
  paletteShortcutHint,
  subsequenceRanges,
  wrapIndex,
} from "./commandPalette";

const ITEMS: PaletteItem[] = [
  { id: "view:main", label: "main.hcl", group: "Views" },
  { id: "file:system", label: "system.hcl", detail: "model", group: "Files" },
  { id: "cmd:explore", label: "Go to Explore", hint: "Navigate" },
];

// Shaped after the workspace rows the palette is actually built from: five
// "Go to <page>" commands and a list of "Go to component <name>" rows, all
// sharing one 17-character prefix. That prefix is why a match can never begin
// where Fuse looks for one.
const COMMANDS: PaletteItem[] = [
  { id: "command:page:overview", label: "Go to Overview", group: "Navigate" },
  { id: "command:page:code", label: "Go to Code", group: "Navigate" },
  {
    id: "inventory:MPS",
    label: "Go to component MPS",
    detail: "Main power supply",
    group: "Inventory",
  },
  {
    id: "inventory:battery",
    label: "Go to component battery",
    group: "Inventory",
  },
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
    // "mq", not "mh": neither file has a q, so this is still the query that
    // matches nothing. "mh" stopped being one when the palette grew a
    // subsequence fallback — both files do hold an m before an h — which is
    // pinned below rather than quietly forgotten here.
    expect(paletteRows(index, "mq")).toEqual([]);
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

describe("subsequenceRanges", () => {
  it("reports one contiguous run for a term that appears as written", () => {
    expect(subsequenceRanges("Go to component MPS", "comp")).toEqual([[6, 9]]);
  });

  it("splits a term into runs wherever the label skips characters", () => {
    // "ovr" over "Go to Overview": the three characters are in order, but not
    // next to each other. One run spanning the gap would light up "v…er" —
    // including the "e" that did not match.
    expect(subsequenceRanges("Go to Overview", "ovr")).toEqual([
      [1, 1],
      [7, 7],
      [9, 9],
    ]);
  });

  it("matches each whitespace-separated term independently", () => {
    // The reported bug. "comp MPS" is two words, and Fuse scores it as one
    // eight-character pattern, so the space has to line up with a space in the
    // label — and there is only one, in the "Go to" every row shares. Matching
    // is case-insensitive on both sides.
    for (const query of ["comp MPS", "COMP mps", "Comp Mps"]) {
      expect(subsequenceRanges("Go to component MPS", query)).toEqual([
        [6, 9],
        [16, 18],
      ]);
    }
  });

  it("returns null when a term is not there at all", () => {
    expect(subsequenceRanges("Go to component MPS", "comp XYZ")).toBeNull();
  });

  it("returns null when a term's letters are there but out of order", () => {
    // Subsequence, not anagram: "spm" is not "MPS".
    expect(subsequenceRanges("Go to component MPS", "spm")).toBeNull();
  });

  it("runs the terms one after another, so the highlight lands on the right words", () => {
    // The order the terms are matched in is what decides what is lit up.
    // Searching each term from the start of the label matches *more* queries
    // and highlights the wrong thing: "MPS" would take the m and the p out of
    // "comp" and leave a lone "S" marked. So each term resumes where the last
    // one stopped, which is what makes the reverse order a non-match.
    expect(subsequenceRanges("Go to component MPS", "MPS comp")).toBeNull();
  });

  it("treats a query of only whitespace as matching everything", () => {
    expect(subsequenceRanges("main.hcl", "   ")).toEqual([]);
  });
});

describe("paletteRows, when the index rejects the query outright", () => {
  // Fuse's bitap scores a fuzzy match as (errors / pattern length) plus a
  // penalty for *where* in the text the match sits. Every row in this palette
  // begins "Go to ", so the interesting text is never at the start, and a
  // query with a word break in it needs the space to line up with a space.
  // "comp MPS" therefore scores worse than the noise it is compared against
  // and is dropped at any threshold. These are the rows it should have found.

  it("finds a component by a gapped, two-word query", () => {
    const index = createPaletteIndex(COMMANDS);
    expect(paletteRows(index, "comp MPS").map((r) => r.item.id)).toEqual([
      "inventory:MPS",
    ]);
  });

  it("highlights the matched characters and leaves the skipped text alone", () => {
    const [row] = paletteRows(createPaletteIndex(COMMANDS), "comp MPS");
    expect(row?.segments).toEqual([
      { text: "Go to ", matched: false },
      { text: "comp", matched: true },
      { text: "onent ", matched: false },
      { text: "MPS", matched: true },
    ]);
  });

  it("still needs every term, so a word that is not there finds nothing", () => {
    const index = createPaletteIndex(COMMANDS);
    expect(paletteRows(index, "comp MPS xyz")).toEqual([]);
    // But "comp battery" is a real query, not a wrong one: it is the battery
    // row's own two words, and it finds that row.
    expect(paletteRows(index, "comp battery").map((r) => r.item.id)).toEqual([
      "inventory:battery",
    ]);
  });

  it("is looser than the index, which is the point: m before h finds both files", () => {
    // A subsequence fallback has no notion of a typo-free query. "mh" holds an
    // m before an h in both of these, so both come back — and the palette
    // shows every match, so the user sees two rows rather than an empty list.
    // Clearing the box is still the way to see everything.
    //
    // "main.hcl" leads because the query covers more of it: two characters out
    // of eight rather than two out of ten.
    const index = createPaletteIndex([
      { id: "system", label: "system.hcl" },
      { id: "main", label: "main.hcl" },
    ]);
    expect(paletteRows(index, "mh").map((r) => r.item.id)).toEqual([
      "main",
      "system",
    ]);
  });

  it("ranks a fallback by how much of the label the query covers", () => {
    // All three hold the query's words, so what separates them is only how much
    // of the label those words account for — the tighter label is the closer
    // match. Order of listing decides nothing here on purpose.
    const index = createPaletteIndex([
      { id: "padded", label: "Go to component MPS unit" },
      { id: "exact", label: "Go to component MPS" },
      { id: "wordy", label: "Go to a component MPS" },
    ]);
    expect(paletteRows(index, "comp MPS").map((r) => r.item.id)).toEqual([
      "exact",
      "wordy",
      "padded",
    ]);
  });

  it("carries detail and group through, like any other row", () => {
    const [row] = paletteRows(createPaletteIndex(COMMANDS), "comp MPS");
    expect(row?.item).toMatchObject({
      detail: "Main power supply",
      group: "Inventory",
    });
  });

  it("does not run when the index found something", () => {
    // The index's own answer is kept whole — same rows, same order, same
    // highlights. The fallback only ever *adds* a result to an empty list, so
    // nothing that works today is re-scored or re-ordered by it.
    //
    // "Stores power" is only on the row's `hint`: no label contains those two
    // words, so a fallback would come back empty-handed and lose the row. That
    // this row survives at all is the proof the fallback did not run.
    const index = createPaletteIndex([
      ...COMMANDS,
      {
        id: "inventory:cell",
        label: "Go to component cell",
        hint: "Stores power",
        group: "Inventory",
      },
    ]);
    const rows = paletteRows(index, "stores power");
    expect(rows.map((r) => r.item.id)).toEqual(["inventory:cell"]);
    // Matched on the hidden text, so the label is left whole — which is also
    // how the index's own hits on a `hint` look.
    expect(rows[0]?.segments).toEqual([
      { text: "Go to component cell", matched: false },
    ]);
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
  it("spells the Apple platforms' chord with symbols", () => {
    for (
      const ua of [
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
        "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)",
      ]
    ) {
      expect(paletteShortcutHint(ua)).toBe("⌘P");
    }
  });

  it("spells everything else's chord with words", () => {
    for (
      const ua of [
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "",
      ]
    ) {
      expect(paletteShortcutHint(ua)).toBe("Ctrl+P");
    }
  });
});
