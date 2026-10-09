<script lang="ts">
import type { DiagnosticJS } from "rhizz";
import { getCurrentScore } from "../ProjectState.svelte";
import ScoreBadge from "./ScoreBadge.svelte";
import WarningLevelSelect from "./WarningLevelSelect.svelte";

// Bottom status bar replacing the Overview page's diagnostics sidebar, and the
// home of the project-wide controls that used to sit in the navbar: collapsed
// it shows only the counts (or a clean bill of health); clicking anywhere on
// the strip expands the full diagnostics list above the bar.
//
// The strip is a transparent full-bleed button with the content laid over it.
// The content row is capped (`max-w-7xl`) to sit on the panel's content edges,
// and on a screen wider than that cap the bar's gutters used to be dead
// margin — a button inside the capped row can never cover them, and a button
// around the row cannot exclude the strictness select (a `<select>` inside a
// `<button>` is neither valid markup nor a usable control). So the button is
// an `absolute inset-0` layer under everything: it spans the bar's full width,
// gutters included; the content row above it is `pointer-events-none` so
// clicks and hover fall through to it; and the select's wrapper is the one
// `pointer-events-auto` hole. The row needs `relative` for that — a static
// box paints below a positioned one, and the button must end up under the
// row, not over it.
//
// The button is empty (its content lives above it, outside it), so its
// accessible name is carried by `aria-label`/`title` instead of its children.
// One cost of `pointer-events-none` on the row: the score badge's own tooltip
// never shows — its rounded value is right there in the badge, and the exact
// one on the Overview page. `cursor-pointer` is set explicitly because neither
// the browser nor daisyUI gives a button one.
//
// The score is the one thing read from a singleton here: only Modeling
// publishes one (see ScoreBadge), and the bar is the surface that shows it now.
//
// Both surfaces are one opaque `bg-base-100`. They used to be `bg-base-100/95`
// + a backdrop blur, which is why the panel and the strip looked like two
// different colours: each showed 5% of whatever sat behind it, and they sit
// on different backdrops (the panel over the page, the strip over the app
// shell). One solid colour makes the bar a single surface, and a blur behind
// an opaque fill costs a compositing pass for nothing.
let { diagnostics }: { diagnostics: DiagnosticJS[] } = $props();

let score = $derived(getCurrentScore());

let expanded = $state(false);

let toggleLabel = $derived(
  expanded ? "Collapse diagnostics" : "Expand diagnostics",
);

let errors = $derived(diagnostics.filter((d) => d.code.startsWith("E")));
let warnings = $derived(diagnostics.filter((d) => !d.code.startsWith("E")));

// The panel's rows: errors first, warnings after — the order the two each
// blocks used to hardcode, as one list so both severities render identical
// row markup.
let rows = $derived([...errors, ...warnings]);

function specUrl(code: string): string {
  return `https://github.com/Wint3rmute/rhizz/blob/main/SPEC/diagnostics/${code}.md`;
}
</script>

<div
  class="relative z-20 border-t border-base-300 bg-base-100"
  data-testid="diagnostics-status-bar"
>
  {#if expanded}
    <!-- Overlay: floats above the page instead of pushing content up,
         so expanding never shifts the layout. Same background as the bar
         below (see the note above); the shadow is what keeps it reading as
         a panel over the page rather than as more page.

         The list is VS Code's Problems panel, not a stack of alert badges:
         one dense row per diagnostic — severity glyph, the code as a
         monospace underlined link to its spec page, then the message
         (truncated, full text in a tooltip). Rows are
         list items rather than `role="alert"`s: the panel opens on demand
         and its contents are a list to scan, and an alert role would
         announce every row on expand. -->
    <div
      class="absolute inset-x-0 bottom-full max-h-64 overflow-y-auto px-4 sm:px-6 lg:px-8 py-2 bg-base-100 border-t border-base-300 shadow-[0_-8px_24px_rgba(0,0,0,0.25)]"
    >
      <ul class="max-w-7xl mx-auto text-sm">
        {#if diagnostics.length === 0}
          <li class="px-2 py-1.5 text-base-content/60">
            No problems detected in this project — Well Done!
          </li>
        {/if}
        {#each rows as diagnostic, i (i)}
          {@const isError = diagnostic.code.startsWith("E")}
          <li
            class="flex items-center gap-2 min-w-0 px-2 py-1.5 rounded hover:bg-base-200"
          >
            <span
              class="shrink-0 w-4 text-center {isError
                ? "text-error"
                : "text-warning"}"
              aria-hidden="true"
            >
              {isError ? "✕" : "⚠"}
            </span>
            <a
              class="link underline shrink-0 font-mono text-xs"
              target="_blank"
              href={specUrl(diagnostic.code)}
              title={`Open the ${diagnostic.code} spec`}
            >{diagnostic.code}</a>
            <span
              class="truncate min-w-0 flex-1"
              title={diagnostic.message}
            >
              {diagnostic.message}
            </span>
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  <!-- The sandwich: a full-bleed toggle button *under* the content row, the
       content row `pointer-events-none` on top of it, and the strictness
       control's wrapper the one `pointer-events-auto` hole (the header comment
       says why the button cannot simply contain the row).

       The row keeps the cap and padding it always had — `max-w-7xl mx-auto` is
       what keeps the score, the counts and the strictness control on the
       panel's content edges — and it still sets the strip's height: the select
       is the tallest thing in it (24px + `py-2`), and the button is sized by
       `inset-0` over the row, not the other way round.

       The row stays one line at every width, so the responsive rules are all
       about what *gives* when space runs short: below `sm` the score badge is
       hidden and the gaps tighten, and the strictness select is capped. What
       never gives is the counts — and
       `overflow-hidden` on their zone means a model with unusually many
       diagnostics clips the chevron rather than spilling it over the select.
       A missing glyph beats two overlapping controls. -->
  <div class="relative text-sm">
    <button
      type="button"
      class="absolute inset-0 rounded cursor-pointer hover:bg-base-200/60"
      onclick={() => (expanded = !expanded)}
      aria-expanded={expanded}
      aria-label={toggleLabel}
      title={toggleLabel}
    ></button>
    <div
      class="relative w-full max-w-7xl mx-auto flex items-stretch pointer-events-none"
    >
      <div
        class="min-w-0 flex-1 flex items-center gap-1.5 sm:gap-3 text-left px-4 sm:px-6 lg:px-8 py-2 overflow-hidden"
      >
        <ScoreBadge {score} />
        {#if diagnostics.length === 0}
          <span class="badge badge-success badge-sm shrink-0">✓ clean</span>
          <span class="text-base-content/60 truncate min-w-0 hidden sm:inline">
            No errors, no warnings
          </span>
        {:else}
          <!-- Collapsed the strip carries counts only — no message preview.
               The count badges never shrink: at phone widths they, the chevron
               and the strictness control are what is left of the row, and a
               squeezed "2 warnings" reads as a rendering fault. -->
          {#if errors.length > 0}
            <span class="badge badge-error badge-sm shrink-0">
              {errors.length} error{errors.length === 1 ? "" : "s"}
            </span>
          {/if}
          {#if warnings.length > 0}
            <span class="badge badge-warning badge-sm shrink-0">
              {warnings.length} warning{warnings.length === 1 ? "" : "s"}
            </span>
          {/if}
        {/if}
        <span class="ml-auto shrink-0 text-base-content/50" aria-hidden="true">
          {expanded ? "▾" : "▴"}
        </span>
      </div>
      <div
        class="flex items-center py-2 pl-2 sm:pl-3 pr-4 sm:pr-6 lg:pr-8 pointer-events-auto"
      >
        <WarningLevelSelect />
      </div>
    </div>
  </div>
</div>
