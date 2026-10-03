<script module lang="ts">
// Tips displayed in the project selection page.
//
// Tips are Markdown (rendered through the shared Markdown.svelte): **bold**
// names the action or surface, `code` marks shortcuts, paths, commands,
// diagnostic codes, and HCL snippets.
//
// If you stumble across this file when implementing a user-facing functionality,
// consider adding a tip to this list explaining how to use the new feature.
export const tips: string[] = [
  "Press **Ctrl-P** (**Cmd-P** on Mac) to jump to any workspace page, file, or command from a single search box.",
  "The **Ctrl-P** palette uses *fuzzy search* — you can type incomplete words and still find correct matches",
  "**Right-click** a component in **Modeling** and choose “Create a detailed view” (or press `V`) to open or generate its detail view with the node centered.",
  "Clicking a node in an **Inventory** diagram preview focuses that component, just like clicking its card — **Back/Forward** walk through your clicks.",
  "**Inventory** and **Modeling** put the open view or entity in the **URL**, so you can bookmark or share exactly what you see.",
  "Use **Embed Diagram** in **Modeling** to get a shareable read-only link with pan/zoom and an “Open in Rhizz” back-link.",
  "Modeling tools — **Snap to Grid**, **+ System**, **+ Component**, **+ Note**, **Auto Layout**, grid toggle, **Zoom to Fill**, **Reset View** — live in the top-center toolbar.",
  "You can select nodes on the modeling canvas and nudge them with the **arrow keys** — one snap-grid step per press.",
  "Aim at the canvas and press `C` to spawn a new component or `N` to spawn a new note.",
  "**Right-click** anything in **Modeling** — components, connections, notes, or empty canvas — for actions like **Hide** (`H`), **New component** (`C`), **Zoom to fill** (`F`), or **Reset view** (`R`).",
  "Open a component in **Inventory** to read its rendered docs, then **Edit** (or **Add documentation**) to write `docs/<label>.md` without leaving the page.",
  "Select a canvas note to edit its text in the inspector and tune its size with the **Scale** field.",
  "View annotations support **Markdown** — headings, lists, bold/italic, code, links, quotes, and fenced blocks all render on the canvas.",
  "If a component has no diagram, **Inventory** offers “**Create a view**” to generate `views/<label>.hcl` and jump into **Modeling** with it selected.",
  "Set **Strictness** (**Business** / **Architectural** / **Component**) in the navbar to hide leaf-level warnings; your choice persists across reloads, and `rhizz check --warning-level` does the same in CI.",
  "Components are linked to `docs/<component_name>.md` files — open them from the **Node Inspector**, and a `W018` warning flags top-level components missing docs.",
  "`Delete` (or `Backspace`) only hides a node from the current view — your `system.hcl` model is untouched, and `Ctrl-Z` brings it back to view.",
  "`Ctrl-Z` / `Ctrl-Y` (or `Ctrl-Shift-Z`) undo and redo model edits, canvas moves, and annotation changes together in one history.",
  "Name components with `full_name` for the official expanded name.",
  "Pick **Auto** / **Light** / **Dark** theme from the navbar; **Auto** follows your browser, an explicit pick pins your choice.",
  "Browse every component definition on the **Inventory** page with search, filters, and a live diagram preview per definition.",
  "Define a library part once as top-level `component “label”`, then reuse it with `instance “local-name” { source = “label” }` — `source` must be the only attribute.",
  "In **Modeling**, **+ Component** → **Use Existing Component** places an instance of a reusable definition instead of inventing a new one.",
  "Reporting a **Modeling** bug? Click “**Copy Debug Info**” in the toolbar to export your session as a replayable test for the issue.",
  "Snapping is on by default — hold `Ctrl`/`Cmd` while dragging to place freely; the grid reads faint every 10 units, medium every 100, bold every 1000.",
  "In the **Modeling** page, you can pick a snap grid size (`10`/`20`/`50`/`100`) next to **Snap to Grid**; to place components more precisely.",
  "Hold `Shift` and click nodes to build a multi-selection, then drag to move the whole group at once.",
  "With a component selected, press `T`/`B`/`C`/`F` keys to cycle its text alignment, border style, color, and font (also settable as `color`/`border`/`font` in HCL).",
  "Select a node to edit name, tags, leaf status, ports, messages, and fields in the **Node Inspector** while the completion score updates live.",
  "**Double-click** empty canvas to create a component at your cursor, and drag a node onto another to reparent it.",
  "Drag from a color-coded **port handle** to another port or component box to wire a connection with live preview and instant system verification feedback.",
  "Select a connection to pin its start side (**Auto**/**Top**/**Right**/**Bottom**/**Left**), or drag from a selected component's directional handles to start wiring.",
  "Hit **Auto Layout** to force-arrange the selection (or everything when nothing is selected).",
  "In **Explore**, click a linked node to drill into its detail view, then use **Back/Forward** buttons in your browser to climb back out.",
  "A `W012` warning means a top-level component is never used in any of your system models — either instantiate it or delete the dead definition.",
  "Children stay clamped inside their parents when you drag or resize.",
  "The **Modeling** sidebar mirrors the component hierarchy — expand it, check nodes onto the canvas, or click a label to inspect it.",
  "In the **Modeling** page, you can glance at the bottom-right hint to see your live canvas activity — Calculating, Resizing, Panning, Selecting.",
  "Keep multiple named views per project (`views/*.hcl`) and switch between them as you model.",
];
</script>

<script lang="ts">
import Markdown from "./Markdown.svelte";
import { resolveIcon } from "../iconHelper";

interface Props {
  // Which tip to show. `null` (or absent) means "uncontrolled": pick one
  // at random on mount — the app passes nothing, stories pin an index so
  // VRT baselines stay deterministic.
  index?: number | null;
}

let { index = null }: Props = $props();

// Star glyph, resolved through the shared FontAwesome helper.
let starIcon = $derived(resolveIcon("star"));

// Computed once, at init — never re-rolled on re-render, so the tip cannot
// reshuffle mid-session.
let randomIndex = Math.floor(Math.random() * tips.length);
let tip = $derived(tips[(index ?? randomIndex) % tips.length] ?? "");
</script>

<!-- Sticky: pinned to the viewport bottom while the project list scrolls
     beneath it; falls back into normal flow once its own place is reached. -->
<section
  aria-label="Tips"
  class="alert alert-warning alert-soft text-base-content sticky bottom-4 z-10 shadow-sm"
>
  {#if starIcon}
    <svg
      viewBox={`0 0 ${starIcon.width} ${starIcon.height}`}
      class="w-5 h-5 fill-current shrink-0 self-start mt-0.5 text-warning"
      aria-hidden="true"
    >
      <path d={starIcon.svgPath} />
    </svg>
  {/if}
  <div class="min-w-0">
    <h2 class="font-semibold">Tips</h2>
    <Markdown content={tip} />
  </div>
</section>
