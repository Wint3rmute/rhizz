// The vocabulary and pure logic behind the command palette, kept out of
// the component so it can be unit-tested without a DOM (this repo has no
// jsdom — see vitest.config.ts) and so the shell stays free of any
// project knowledge: it knows about `PaletteItem`s and nothing else. The
// app-specific halves (which files exist, which commands are on offer)
// live in ../commands/.
import type { ResolvedIcon } from "../../iconHelper";
import Fuse from "fuse.js";

/** One selectable row. Everything the shell renders is declared here. */
export interface PaletteItem {
  /** Stable identity — the `#each` key and what `onselect` hands back. */
  id: string;
  /** The primary text, and the only field that gets match highlighting. */
  label: string;
  /** Dimmed secondary text after the label (a path, a folder). */
  detail?: string;
  /**
   * Extra fuzzy-searchable text that is never rendered — the words a user
   * would guess for this row but that aren't on screen (a group name,
   * synonyms). Matched, but deliberately not highlighted: there is nothing
   * on screen to point at.
   */
  hint?: string;
  /** Section heading, drawn above the first row of each group. */
  group?: string;
  /**
   * The leading glyph, drawn before the label: either a literal character
   * (an emoji, which is what the page commands use) or resolved SVG
   * geometry, which is what a model that names its own icons produces. The
   * two are one field rather than two so a row cannot claim both a glyph and
   * an icon, and so there is a single slot to align.
   *
   * Geometry rather than an icon *name* because the shell has no icon set and
   * no business having one — the caller resolves a name to a path (see
   * `resolveIcon`) and hands over something drawable. `ResolvedIcon` is
   * imported as a type only, so nothing here pulls in an icon library; it is
   * the same struct the canvas and the tree already draw, which is what keeps
   * a component's icon the same shape everywhere it appears.
   *
   * Three states, and the difference between the last two is the whole reason
   * this is not a plain optional:
   *
   * - a character or geometry — draw the slot, with this in it.
   * - `null` — draw the slot and leave it empty.
   * - absent — draw no slot at all, and the label starts at the row's edge.
   *
   * A row with `null` is a row in a list whose other rows have glyphs, and it
   * is what keeps that list's left edge straight: without it, one component
   * without an icon would start half a word earlier than its neighbours and
   * read as a mistake rather than as an absent icon. So callers whose list
   * draws glyphs pass `null` for the rows that have none, and callers whose
   * list has no glyphs at all (the files) leave the field off.
   */
  icon?: string | ResolvedIcon | null;
  /**
   * What picking this row does. Optional, so a palette may also be a
   * read-only list (and so a story can drive the shell without navigating
   * anywhere). It rides on the row rather than being looked up by id
   * because the shell must not know what any particular row means.
   */
  action?: () => void;
}

/** One run of a label: either inside a fuzzy match or outside it. */
export interface PaletteSegment {
  text: string;
  matched: boolean;
}

/** A row as the shell renders it: the item plus its split-up label. */
export interface PaletteRow {
  item: PaletteItem;
  segments: PaletteSegment[];
}

/** The subset of a KeyboardEvent the chord test needs. */
export interface PaletteKeyEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey?: boolean;
}

/**
 * Splits a label into matched/unmatched runs for rendering. The ranges are
 * the inclusive `[start, end]` offsets Fuse reports against the *original*
 * string, so `[0, 1]` covers two characters. Out-of-bounds and negative
 * offsets are clamped rather than rejected (a shorter label than the index
 * was built from shouldn't throw), and overlapping or touching ranges
 * merge — otherwise the gaps between them would render as empty,
 * zero-width runs.
 */
export function labelSegments(
  label: string,
  ranges: readonly (readonly [number, number])[],
): PaletteSegment[] {
  if (label.length === 0) return [];

  const spans: [number, number][] = [];
  for (const [rawStart, rawEnd] of ranges) {
    // A range that misses the label altogether is dropped rather than
    // clamped — clamping a wholly-outside range onto the last character
    // would light up a character the search never matched.
    if (rawEnd < 0 || rawStart > label.length - 1) continue;
    const start = Math.max(0, rawStart);
    const end = Math.min(rawEnd, label.length - 1);
    if (end >= start) spans.push([start, end]);
  }
  if (spans.length === 0) return [{ text: label, matched: false }];

  spans.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  const first = spans[0];
  if (first === undefined) return [{ text: label, matched: false }];

  const segments: PaletteSegment[] = [];
  let cursor = 0;
  let spanStart = first[0];
  let spanEnd = first[1];
  for (const [start, end] of spans.slice(1)) {
    // Ranges are inclusive, so `start === spanEnd + 1` is contiguous.
    if (start > spanEnd + 1) {
      pushRun(segments, label, cursor, spanStart - 1, false);
      pushRun(segments, label, spanStart, spanEnd, true);
      cursor = spanEnd + 1;
      spanStart = start;
    }
    spanEnd = Math.max(spanEnd, end);
  }
  pushRun(segments, label, cursor, spanStart - 1, false);
  pushRun(segments, label, spanStart, spanEnd, true);
  pushRun(segments, label, spanEnd + 1, label.length - 1, false);
  return segments;
}

function pushRun(
  segments: PaletteSegment[],
  label: string,
  from: number,
  to: number,
  matched: boolean,
): void {
  if (to < from) return;
  segments.push({ text: label.slice(from, to + 1), matched });
}

/** An item list plus its Fuse index — built together so they can't drift. */
export interface PaletteIndex {
  items: PaletteItem[];
  fuse: Fuse<PaletteItem>;
}

export function createPaletteIndex(items: PaletteItem[]): PaletteIndex {
  return {
    items,
    fuse: new Fuse(items, {
      keys: ["label", "hint"],
      threshold: 0.35,
      findAllMatches: true,
      includeMatches: true,
      includeScore: true,
      minMatchCharLength: 1,
    }),
  };
}

/**
 * The rows to show for a query. An empty query lists every item in the
 * order it was handed over — a palette whose untyped state is shuffled by
 * a relevance score nobody asked for is disorienting — and a real query
 * switches to Fuse's ranking.
 */
export function paletteRows(
  index: PaletteIndex,
  query: string,
): PaletteRow[] {
  const needle = query.trim();
  if (needle === "") {
    return index.items.map((item) => ({
      item,
      segments: labelSegments(item.label, []),
    }));
  }

  return index.fuse.search(needle).map((result) => {
    // Fuse reports one match entry per searched key. Only `label` is on
    // screen, so only its offsets can be highlighted; a hit that came from
    // `hint` leaves the label whole.
    const ranges = (result.matches ?? [])
      .filter((match) => match.key === "label")
      .flatMap((match) => match.indices);
    return {
      item: result.item,
      segments: labelSegments(result.item.label, ranges),
    };
  });
}

/**
 * Arrow-key navigation wraps in both directions (the house convention, see
 * IconAutocompleteInput). Returns -1 for an empty list, which every caller
 * reads as "nothing is highlighted" rather than "the first row is".
 */
export function wrapIndex(index: number, length: number): number {
  if (length <= 0) return -1;
  return ((index % length) + length) % length;
}

/**
 * Whether a keydown opens the palette. One chord, Ctrl/Cmd-P — the file
 * switcher and the commands live in the same list now, so there is no
 * second chord to tell apart. Alt is excluded — it is how Alt-P types a ¶
 * on several layouts, and a palette that swallows typed characters is
 * worse than one extra keystroke. Both Ctrl and Cmd are accepted rather
 * than sniffing the platform (see isModifierHeld in KeyboardState.svelte
 * for why).
 */
export function isPaletteShortcut(event: PaletteKeyEvent): boolean {
  if (event.key.toLowerCase() !== "p") return false;
  if (event.altKey === true) return false;
  if (event.shiftKey) return false;
  return event.ctrlKey || event.metaKey;
}

/**
 * How to print the chord for the platform `userAgent` names: with ⌘ on
 * Apple's, with the word Ctrl everywhere else. Sniffed on purpose — the
 * shortcut itself accepts both modifiers (see `isPaletteShortcut`), so this
 * only decides how the chord is *written* down, never what actually fires.
 */
export function paletteShortcutHint(userAgent: string): string {
  return /mac os x|macintosh|iphone|ipad|ipod/i.test(userAgent)
    ? "⌘P"
    : "Ctrl+P";
}
