<script lang="ts">
// The generic command-palette shell: a fuzzy-filtered list with live
// match highlighting, arrow-key navigation and Escape-to-close. It knows
// nothing about projects, files or routes — it is handed a `PaletteItem[]`
// and hands back the chosen one, so the same shell serves the file
// switcher, the command palette, and anything added later. The search
// itself lives in ./commandPalette.ts (pure, unit-tested there).
//
// Visibility is a prop rather than internal state, matching ContextMenu
// and NewViewModal: the host decides *when* a palette opens (from a
// keyboard chord, a button, a story), this only decides what it shows.
import { tick } from "svelte";
import {
  createPaletteIndex,
  type PaletteItem,
  paletteRows,
  paletteShortcutHint,
  wrapIndex,
} from "./commandPalette";

interface Props {
  isOpen: boolean;
  items: PaletteItem[];
  onselect: (item: PaletteItem) => void;
  onclose: () => void;
  /** Heading above the input; also the dialog's accessible name. */
  title?: string;
  placeholder?: string;
  emptyMessage?: string;
  /**
   * Shows a "loading" row instead of the empty message while items load.
   *
   * Only reachable for a palette that can be empty: the row replaces the
   * empty message, so a host that always offers at least one row (this app's
   * does — the page commands are on offer everywhere) can never show it, and
   * should not pass it.
   */
  loading?: boolean;
  /** id prefix for the input and listbox, so two palettes never collide. */
  id?: string;
}

let {
  isOpen,
  items,
  onselect,
  onclose,
  title = "Command palette",
  placeholder = "Type a command…",
  emptyMessage = "No matches",
  loading = false,
  id = "command-palette",
}: Props = $props();

let query = $state("");
let highlightedIndex = $state(0);
let inputElement = $state<HTMLInputElement | null>(null);
let listElement = $state<HTMLUListElement | null>(null);

let index = $derived(createPaletteIndex(items));
let rows = $derived(paletteRows(index, query));

// A fresh query invalidates the old cursor position, and an item list that
// shrinks under the cursor would otherwise leave the highlight pointing at
// nothing — so clamp on every change rather than trusting the last index.
$effect(() => {
  const count = rows.length;
  if (count === 0) highlightedIndex = -1;
  else if (highlightedIndex < 0 || highlightedIndex >= count) {
    highlightedIndex = 0;
  }
});

// Group headings are chrome for browsing the full list; once the user has
// typed, a heading above a single match is just noise.
let showGroups = $derived(query.trim() === "" && items.some((i) => i.group));

// The input owns focus for the palette's whole life: rows are reached with
// the arrow keys and exposed through aria-activedescendant, so Tab must not
// walk the focus out of the dialog and into the page behind it. Focus is
// restored to whatever held it before, so dismissing a palette leaves the
// editor or canvas exactly where the user left it.
let previouslyFocused: HTMLElement | null = null;

$effect(() => {
  if (isOpen) {
    previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    query = "";
    highlightedIndex = 0;
    void tick().then(() => inputElement?.focus());
    return;
  }
  previouslyFocused?.focus();
  previouslyFocused = null;
});

function scrollToHighlighted(): void {
  // By row index, never by child position. The group headings are siblings of
  // the rows in this `<ul>`, so `children[n]` counts them too — which scrolls
  // whichever row sits one heading higher than the highlighted one, and leaves
  // the highlight itself below the fold once the list is scrolled to the end.
  // Addressing the row by the index it is rendered under skips the headings
  // entirely, whatever they are or however many there are.
  //
  // A negative index (an empty list) matches nothing, so this is a no-op
  // rather than a lookup of the last row.
  listElement
    ?.querySelector(`[data-row="${highlightedIndex}"]`)
    ?.scrollIntoView({ block: "nearest" });
}

function handleSelect(row: PaletteItem | undefined): void {
  if (row === undefined) return;
  // The row's own action first: a host that navigates on select will tear
  // this component down, and `onselect` may well be the callback that told
  // it to.
  row.action?.();
  onselect(row);
}

function handleKeyDown(event: KeyboardEvent): void {
  const count = rows.length;
  switch (event.key) {
    case "ArrowDown":
      event.preventDefault();
      highlightedIndex = wrapIndex(highlightedIndex + 1, count);
      scrollToHighlighted();
      break;
    case "ArrowUp":
      event.preventDefault();
      highlightedIndex = wrapIndex(highlightedIndex - 1, count);
      scrollToHighlighted();
      break;
    case "PageDown":
      event.preventDefault();
      highlightedIndex = wrapIndex(highlightedIndex + 10, count);
      scrollToHighlighted();
      break;
    case "PageUp":
      event.preventDefault();
      highlightedIndex = wrapIndex(highlightedIndex - 10, count);
      scrollToHighlighted();
      break;
    case "Enter":
      if (highlightedIndex >= 0 && highlightedIndex < count) {
        event.preventDefault();
        handleSelect(rows[highlightedIndex]?.item);
      }
      break;
    case "Tab":
      // Keep focus on the input; see the note above.
      event.preventDefault();
      inputElement?.focus();
      break;
  }
}

// Escape is handled at the window rather than in the dialog's keydown so
// there is exactly one handler: focus is trapped inside the dialog, but if
// it were ever not (the input gone, a host that reused this shell), Escape
// would still dismiss rather than silently do nothing.
function handleWindowKeyDown(event: KeyboardEvent): void {
  if (!isOpen) return;
  if (event.key === "Escape") {
    event.preventDefault();
    onclose();
  }
}
</script>

<svelte:window onkeydown={handleWindowKeyDown} />

{#if isOpen}
  <!-- Deliberately not daisyUI's `.modal` / `.modal-box`, even though this
       is a dialog. Those bring a background-colour transition and a
       `:root:has(&)` rule that reaches the `<html>` element exactly when the
       dialog opens — and with no `theme-color` for the browser to read
       instead, that made the browser re-infer its own toolbar colour and
       visibly jump. The scrim on its own was never the problem; borrowing
       it from a component that also targets the root was.

       So the wrapper states what it needs — full-bleed, click-to-dismiss,
       on top, and a darkening layer — and nothing else. The box declares its
       own background, border, radius, shadow *and its 1.5rem padding*, all of
       which it was borrowing from `.modal-box`; the padding in particular
       was never written down here, and the VRT caught it the moment the class
       went. -->
  <div
  class="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] cursor-pointer bg-black/60"
  role="dialog"
  aria-modal="true"
  aria-label={title}
  data-testid="command-palette"
  tabindex="-1"
  onkeydown={handleKeyDown}
  onclick={(event) => {
      if (event.target === event.currentTarget) onclose();
    }}
>
  <div
    class="w-full max-w-xl max-h-[70vh] p-6 bg-base-100 border border-base-300 shadow-2xl rounded-box flex flex-col overflow-hidden cursor-default"
  >
      <div
        class="flex items-center gap-2 px-4 py-2 border-b border-base-300 text-sm font-semibold text-base-content/70"
      >
        {#if title}<span class="truncate">{title}</span>{/if}
        {#if items.length > 0}
          <span class="ml-auto text-xs font-normal text-base-content/40"
            >{rows.length} of {items.length}</span>
        {/if}
      </div>

      <input
        {id}
        bind:this={inputElement}
        bind:value={query}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={true}
        aria-controls="{id}-listbox"
        aria-activedescendant={highlightedIndex >= 0
          ? `${id}-option-${highlightedIndex}`
          : undefined}
        {placeholder}
        autocomplete="off"
        class="w-full px-4 py-3 font-mono text-sm bg-transparent outline-none"
        data-testid="command-palette-input"
        oninput={() => (highlightedIndex = 0)}
      />

      <ul
        id="{id}-listbox"
        role="listbox"
        aria-label={title}
        bind:this={listElement}
        class="flex-1 overflow-y-auto p-1 text-sm"
        data-testid="command-palette-list"
      >
        {#each rows as row, i (row.item.id)}
          {#if showGroups && row.item.group !== undefined && row.item.group !== rows[i - 1]?.item.group}
            <li
              role="presentation"
              class="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-base-content/40"
            >
              {row.item.group}
            </li>
          {/if}
          <li
            id="{id}-option-{i}"
            role="option"
            data-row={i}
            aria-selected={highlightedIndex === i}
            class="flex cursor-pointer items-center gap-2 rounded px-3 py-1.5 scroll-mt-1 {highlightedIndex ===
            i
              ? 'bg-primary text-primary-content'
              : 'hover:bg-base-200 text-base-content'}"
            data-testid="command-palette-option"
            onmouseenter={() => (highlightedIndex = i)}
            onmousedown={(event) => {
              // mousedown, not click: the selection must land even if the
              // pointer leaves the row before the button is released, and
              // preventDefault keeps the input from losing focus.
              event.preventDefault();
              handleSelect(row.item);
            }}
          >
            {#if row.item.icon !== undefined}
              <!-- One slot, three states: a literal character, inline SVG, or
                   empty-but-present (a `null` icon, which is how a row in a
                   list of glyphs keeps its left edge straight without being
                   given a glyph it does not have). Absent means no slot at
                   all, so a list that has no glyphs is not indented by one.

                   `fill-current` so a drawn glyph takes the row's own colour —
                   the row turns its text colour when highlighted, and a
                   hard-coded one would leave the icon behind on exactly the
                   row the user is looking at. `w-3.5` is the same box the
                   component tree and the Inventory card draw a resolved icon
                   in, and `align-text-bottom` sits it on the text rather than
                   the baseline an inline SVG would use, so an emoji row and
                   an icon row read as one list. -->
              <span class="shrink-0 w-5 text-center" aria-hidden="true"
                >{#if typeof row.item.icon === "string"}{row.item.icon}{:else if row.item.icon}<svg
                    viewBox="0 0 {row.item.icon.width} {row.item.icon.height}"
                    class="w-3.5 h-3.5 fill-current align-text-bottom"
                  >
                    <path d={row.item.icon.svgPath} />
                  </svg>{/if}</span>
            {/if}
            <span class="shrink-0 truncate font-mono">
              {#each row.segments as segment, j (j)}
                {#if segment.matched}
                  <!-- `text-primary` would be the obvious way to mark a
                    match, but on the highlighted row that is the row's own
                    background — blue on blue. There the weight plus an
                    underline carries the highlight instead, in the colour the
                    row already sets. -->
                  <mark
                    class="bg-transparent font-bold {highlightedIndex === i
                      ? 'underline decoration-2 underline-offset-2'
                      : 'text-primary'}">{segment.text}</mark>
                {:else}{segment.text}{/if}
              {/each}
            </span>
            {#if row.item.detail}
              <span
                class="min-w-0 flex-1 truncate text-xs {highlightedIndex === i
                  ? 'opacity-70'
                  : 'text-base-content/50'}">{row.item.detail}</span>
            {/if}
            </li>
        {/each}
      </ul>

      {#if rows.length === 0}
        <div
          class="px-4 py-6 text-center text-sm text-base-content/50"
          data-testid="command-palette-empty"
        >
          {loading ? "Loading…" : emptyMessage}
        </div>
      {/if}

      <div
        class="flex items-center gap-3 border-t border-base-300 px-4 py-1.5 text-[11px] text-base-content/40"
      >
        <span>↑↓ navigate</span>
        <span>↵ select</span>
        <span>esc close</span>
        <span class="ml-auto font-mono"
          >{paletteShortcutHint(
            typeof navigator === "undefined" ? "" : navigator.userAgent,
          )}</span
        >
      </div>
    </div>
</div>
{/if}
