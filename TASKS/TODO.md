# Tasks

How to work on this file:

- Read the next task from this file
- Get extra context from recently finished tasks - read the first 50 lines of
  `TASKS/FINISHED.md`
- If on `main`, switch to a new feature branch
- Implement the task, use red/green TDD
- Run tests & linters (`just test`, `just lint`, `just build`)
  until it's all working
- Once all linters/builds/tests pass, run `cargo fmt`
- Move the completed task to `FINISHED.md` and report that you're finished
- Commit using conventional commits
- Push your feature branch. **Never push directly to main**

---

## Task <N> — Single diagram rendering engine

`web/src/routes/projects/[id]/modeling/+page.svelte` is 3,977 lines (3,180 of
them `<script>`) and re-implements the diagram renderer inline, while
`DiagramElements.svelte` renders a *second*, already-diverged copy for the
read-only hosts. Explore and `embed/[...diagram]` additionally duplicate ~120
lines of host logic. Unify all of it behind one engine.

### Why this is not just "tidying"

The duplication has **already shipped a bug**. `Explore.svelte` and
`embed/[...diagram]/+page.svelte` have the same hover-popup handler at two
different versions: Explore got the scroll-invariant fix
(`hoverClient` + `positionPopup()` + capture-phase `scroll` listener,
L243–276), embed still runs the pre-fix one-shot `getBoundingClientRect()`
version (L194–205). The VRT suite caught it in Explore (see `FINISHED.md`,
"Make the VRT suite deterministic"); embed has no hover baseline, so nobody
noticed. The same drift is visible in the renderer, where
`DiagramStaticView.svelte` opens by admitting it is *"a smaller, first-cut
extraction of +page.svelte's canvas rendering, deliberately stripped of…"*.

### The scene is built three times, with three defaulting rules

| | `+page.svelte` | `DiagramElements.svelte` | `persistence.ts` |
| --- | --- | --- | --- |
| node box | `nodeBox()` L789 | `nodeBox()` L46 | `mapLayoutToBoxes()` L83 |
| size default | `DEFAULT_NODE_WIDTH/HEIGHT` | **none** | hardcoded `100, 100` |
| align default | `DEFAULT_TEXT_ALIGN` | `"center"` literal | — |
| render order | `renderOrder` L2855 | `renderOrder` L56 | — |
| edge routing | `visibleConnections` L2824 | `visibleConnections` L60 | — |
| system filter | L2861 | **none** | — |

And hit-test *candidate collection* is hand-rolled in **four** places in
`+page.svelte` (`findHoveredTarget` L1952, reparent L2520, `marqueeCandidates`
L2871, `marqueeAnnotationCandidates` L2898), in three different shapes.
`computePortPositions` is called in the template (L3469) *and* again in
`findHoveredTarget` (L1959).

### Five read-only consumers already share a renderer. The modeler is the lone holdout.

`DiagramStaticView` (and `DiagramEmbedView` for the pannable case) is already
the single funnel for:

| Consumer | Uses |
| --- | --- |
| `Explore.svelte` L404 | `DiagramStaticView` (click-to-change-diagram + doc popup) |
| `Inventory.svelte` L409 | `DiagramStaticView` (definition preview) |
| `book-example/BookExampleView.svelte` | `DiagramStaticView` (worked examples) |
| `embed/[...diagram]/+page.svelte` L224 | `DiagramEmbedView` (chromeless embed) |
| `+page.svelte` L3335–3777 | **its own inline `<svg>` — the outlier** |

So the modeler is not "one of several duplicates" — it is the single page that
never adopted the shared renderer, and it did so by copying the older version
and extending it. Folding it in is therefore mostly *subtraction*.

Each consumer also adapts to the renderer's shape independently:
`mapLayoutToBoxes` has **four** call sites (`Explore` L298, `Inventory` L210,
`BookExampleView` L215, plus its own home), and `BookExampleView` L218–229
hand-rolls an annotation adapter because it reads `ViewDefinition[]` rather
than a `DiagramLayout`.

### The abstraction

Four layers. The governing rule:

> The scene knows *what to draw*. The host knows *what it means*. The renderer
> knows *how to draw it*. None knows the others' business.

**1. `diagramScene.ts`** — pure, WASM-free, no Svelte. `buildDiagramScene()`
returns render-ordered nodes (with `depth` and precomputed ports), routed edges
(with `orientation` and the SVG path `d`), annotations, and `bounds`, plus a
hit index: `pick(point)`, `query(rect)`, `reparentTargetAt(box)`. Boxes are
keyed by the stable component key, not arena index — removing the per-host
`keyToIndex` dance and the rename-reattaches-a-box class of bug. This is where
`renderOrder`, `visibleConnections`, the 100/100/center defaults, system
filtering, and all four candidate loops collapse to one implementation.

**2. `<DiagramScene>`** — the one renderer. It owns **no interaction state**:
`selectedNodes`, `selectedEdge`, `hoveredNode`, `marquee`, `pendingConnection`,
`reparentTarget` are all props. Affordances are **optional callbacks**, and
extensibility along a second axis comes from snippets (`background`,
`nodeOverlay`, `edgeOverlay`, `overlay`).

- *Rule:* absent callback ⇒ that affordance is not rendered at all. Read-only
  hosts pass `{}` and pay for no hit targets, no listeners, no dead markup.
- *Do not* introduce a `mode: "interactive" | "read-only" | …` prop. It is a
  discriminated union in disguise: the first host needing a different
  combination grows a branch, branches interact (Inventory wants click + dim +
  no popup; Explore wants click + dim + popup), and within two releases it is a
  second `+page.svelte`. If answering "what does host X need?" requires reading
  an `if (mode === …)` chain, the abstraction has leaked.
- Hover highlight is `presentation.hoveredNode` (world coords, in the scene);
  the popup is the host's response to it (screen coords, outside).

**3. `<DiagramViewport>`** — the one pan/zoom host (already exists, 233 lines,
only consumer is `DiagramEmbedView`). Grows a `panPolicy` so the modeler keeps
left-drag-on-empty-canvas.

**4. `useDiagramDrilldown()`** — the one host controller: node hover/activate →
doc lookup + cursor-anchored popup + drill-down navigation. The host injects
*only* the navigation policy, so Explore (`?diagram=` search param) and embed
(`[...diagram]` route param) stop diverging.

Supporting pure modules: `diagramTransform.ts` (`translateSelection`,
`scaleSelection`, `resizeBox` — pure today but welded to `interaction`) and
`useCursorAnchor()` (scroll-invariant popup positioning, so neither host can
regress it again).

**Deliberately not unified:** the two Markdown pipelines. `Markdown.svelte`
emits HTML flow; `AnnotationText.svelte` + `annotationMarkdown.ts` emit
measured, positioned SVG `<text>`. Different output geometry — sharing them
would be a false unification.

### Definition of done

- [ ] `diagramScene.ts` extracted from the existing `+page.svelte` logic, with
      the hit index. Both `DiagramElements.svelte` and `+page.svelte` call it;
      `mapLayoutToBoxes` (4 call sites) and the four inline candidate loops are
      gone.
- [ ] `<DiagramScene>` takes `(scene, affordances, presentation)` + snippets.
      `DiagramElements.svelte` and `DiagramStaticView.svelte` point at it.
- [ ] Modeler adopts it; ~260 lines of inline SVG deleted from `+page.svelte`;
      `Interaction` union + move/resize math move to a named module.
- [ ] The four `mapLayoutToBoxes` call sites and the ad-hoc annotation adapter
      are replaced by one scene builder.
- [ ] `DiagramViewport` folded in as the single pan/zoom host.
- [ ] Explore and embed use `useDiagramDrilldown()`; the scroll-invariant
      popup fix reaches **both**.
- [ ] `explore/docs.ts` moves to a neutral `web/src/docs/` — the shared
      controller must not reach sideways into another route's folder.
      (embed already imports from it today.)
- [ ] `data-testid="explore-doc-tooltip"` renamed to `doc-popup`, since embed
      will render the same shared card. Update `Explore.stories.ts` L319.

### Constraint: net reduction

**Total lines of code must go down, or at worst stay flat.** If a layer does
not pay for itself, it should not exist. Outdated code, comments, docs, and
tests may be deleted freely — including tests that only cover code this
rework removes or replaces. Aim for a full holistic rework, not local edits
bolted onto the old structure.

Validate with `just test`, `just lint`, `just build`, `just format`. The VRT
suite is the safety net for steps 1–2: rendering must not change, so
baselines stay byte-identical and no re-acceptance is needed. A baseline that
*does* move without an intended visual change means the extraction changed
behaviour — investigate, don't re-accept.

---

## Task <N> - more advanced connection routing on canvas

Currently, the connections are always routed using a "double-knee" approach,
with 2 turning points on each connection. This does not always work.

Think about existing well-thought solutions to structuring connections in such
diagram editors and suggest a more flexible option, which will smartly figure
out whether to use connections with 2 turning points or just a single turning
point.

## Task <N> — Detect isolated component trees in systems

It is possible to define a system with 2 completely independent component trees,
You can verify that empirically. This is not a correct behavior, since it means
that the user has effectively defined 2 separate systems and shoved them into one.
While this is not an error, it should emit a warning.

Definition of done:

1. Add a new warning "Multiple isolated component trees found in system <name>".
2. Use some graph algorithm to walk the system model and detect "isolated trees".
3. Write tests for this feature.

Extra: Can you find any human-readable way to inform the user where they should
look to find the isolated system subtree? Just bare "multiple component trees"
detected is not very informative, although at this point I've no idea how to
point the user towards resolving their issue.



---

## Task <N> — Modular multi-pane workspace with shared reactive context

Refactor the web architecture from isolated page routes to a unified, dockable multi-pane workspace where multiple synchronized views (Editor, Diagrams, Explore, Diagnostics) operate concurrently on a shared reactive data model.

- **Strategy**
  - Hoist project file and compiled model state into a shared reactive context (`ProjectWorkspaceContext.svelte.ts`) at the project layout root.
  - Decouple view pages into standalone, embeddable pane components (`<EditorPane />`, `<DiagramPane />`, `<ExplorePane />`, `<DiagnosticsPane />`).
  - Introduce a configurable split/tiling layout container supporting resizable horizontal and vertical panes.
- **Implementation Scope**
  - **Shared Reactive State:** Single source of truth for VFS `sources`, WASM compilation outputs, diagnostics, and transaction history. Edits in any pane immediately update the reactive model and notify all sibling panes.
  - **Pane Components:** Extract view logic from `routes/projects/[id]/*` into standalone modular components.
  - **Layout Manager:** Implement a dockable/splittable window layout container (supporting tabs, 2-column split, 3-column split, grid) with persistent layout configuration in localStorage.
- **Acceptance Criteria**
  - User can display the Code Editor and Diagram Canvas side-by-side simultaneously.
  - Editing HCL text in the Editor pane updates the rendered diagram in real-time.
  - Creating/moving components in the Diagram pane updates the text in the open Editor pane without cursor jump or desynchronization.
  - Panes can be resized, split horizontally/vertically, and closed.
  - Layout configuration persists across page reloads.
  - Validated with `just test`, `just lint`, and `just build`.

---

## (For later brainstorming) Task <N> - pin existing nodes when auto-laying-out newly-added ones

Split out from Task 50 (now finished — see `FINISHED.md`) as the one
remaining concrete piece of its original scope. `forceLayout.ts` already
supports pinning a node in place via `fixed: true` on a `LayoutNode` (sets
d3-force's `fx`/`fy`, ignored by all forces) — added specifically for this
case, but nothing calls it that way yet.

- When a component is checked onto the canvas (the sidebar checkbox's
  "check" branch), instead of just placing it at a default/remembered
  position, run a force-layout pass where every *other* currently-placed
  sibling is `fixed: true` and only the newly-checked node is free to
  move — so it settles into whatever gap is available near its
  connections, without visibly disturbing anything else already placed.
- Needs a concrete trigger decision: should this replace the current
  "restore remembered position, or default to (100, 100)" behavior
  unconditionally, or only when there's no remembered position to
  restore (i.e. first-time placement only, not re-checking something
  that was previously positioned)? Lean towards the latter — respecting
  a remembered position take priority over auto-placing.
- Validate with `deno task check`, `deno task build`, `deno task test`.

---

## (For later brainstorming) Task <N> - routing multiple connections between 2 components

When 2 components have more than one connection between them, connection routing
rules cause connections to be drawn over each other. Instead, a better routing algorithm should be implemented.
I'm thinking about a PCB-style routing that lines up multiple connections along a shared path, but with some extra
offset to avoid overlapping.

---

## (For later brainstorming) Task <N> - when adding a new node - place it in the center of the viewport

As in the title. Position of the node is persisted across deletes, so it can
be "brought back" into the same position as it was before, but only if it was
in the diagram before! For completely new nodes, they always appear in a fixed
place in the diagram. This is cumbersome, as the user might not have that part
of the diagram in their viewport, which might make them think that nothing
happened.

Definition of done:

- If a new element is added to the diagram, this element is placed at the center of the viewport by default

---

## (For later) Task <N> — Allow for panning & zooming in the Explore view

Currently, only the Diagrams page allows panning & zooming. I want to extract
this feature and make it possible to pan & zoom in other pages:

- Explore
- Inventory
- Embedded diagrams viewer

Definition of done:

- Panning & zooming is clearly extracted, ideally as a reusable system
- Panning & zooming now works in Explore/Inventory/Embedded diagrams viewer

--

## (For later) Task <N> — Multi-file workspace tabs and project import/export

Add a unified workspace view that lets users inspect the generated `system.hcl` and `views.hcl` files side-by-side with the visual canvas, and import/export projects.

- Tabbed workspace switcher:
  - "Canvas" (interactive visual modeler, default)
  - "system.hcl" (live code viewer / editor for the core architectural model)
  - "views.hcl" (live code viewer / editor for layout coordinates and view filters)
- File Import / Export:
  - "Export Project" downloads `system.hcl` and `views.hcl`.
  - "Open / Import" loads existing `.hcl` files into the GUI and auto-populates the visual model.
- Validate with `deno task check`, `deno task test`, `deno task build`.

---

## Task <N> - exploring diagrams in embed mode

When browsing system diagrams in Embed mode (/modeling/embed/), it's not
possible to navigate defined system views, as it is possible in the explore/
view. Please make it possible to navigate back and forth through linked views.

---

## Task <NUMBER> — Task template

- Task description here
- Requirements, spec, acceptance criteria as bullet points
- Keep on increasing the task ID when creating new tasks
- Don't remove this template, move it to the bottom instead
