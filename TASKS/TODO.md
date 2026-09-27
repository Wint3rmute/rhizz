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

## Task <N> — Decompose the Modeling page

`web/src/routes/projects/[id]/modeling/+page.svelte` is 3,904 lines: 3,132 of
`<script>` and 772 of template. It is not huge because of duplication — the
single-rendering-engine task removed what duplication there was, for −73
lines. It is huge because it is *ten subsystems in one component scope*.

This is the follow-up that task's own write-up pointed at. It is a different
kind of work: that task removed duplicated *computation*, this one extracts
*state machines and controllers* that have no second implementation to merge
with. The payoff is a legible page and testable units — not a line count,
which was never the problem.

### Where the lines are

| Area | Lines | Notes |
| --- | --- | --- |
| Template (sidebars, toolbar, error card, modals) | 772 | 4 of the 5 panels are already components |
| `views/*.hcl` file manager | 325 | CRUD + first-run seeding + `?diagram=` deep-link |
| Model mutations (create/rename/delete/connect/reparent) | 281 | all funnel through `runModelLayoutTransaction` |
| Undo/redo stacks + transactions | 234 | 4 near-identical fns, 4 parallel seq arrays |
| Pointer machine (`onSvgMouseMove`) | 166 | 5-variant `Interaction` union |
| Auto-layout (grouped d3 sim + rAF driver) | 162 | policy; `forceLayout.ts` already owns the sim |
| Layout store + load/save race guards | 127 | 4 flags guarding one async read |
| Keyboard shortcut chain | 105 | 82-line `if`/`else` on `event.key` |
| 4 context-menu builders | 114 | |
| `ViewNode` snippet | 129 | ~90 is modeler-only affordance markup |

### Targets, highest value first

1. **Undo/redo (234).** `history/TransactionManager.ts` and `history.ts` are
   already clean modules; the page wraps them in four near-identical
   undo/redo functions plus four parallel `number[]` sequence arrays, each
   hand-trimmed at `UNDO_HISTORY_LIMIT`. The merge policy — one monotonic
   clock across the model and layout stacks, so a drag after a create undoes
   the drag first — is a real requirement, and it belongs *in* the history
   module rather than in the page.
2. **Keyboard shortcuts (105).** An 82-line `if`/`else` on
   `event.key.toLowerCase()`, mixing view chrome (R, G) with model mutations
   (C, N) with attribute cycling (t/b/c/f), plus a documented key-collision
   rule (C and F mean two different things depending on whether a node is
   selected). Express it as data, not as a chain.
3. **Layout store (127).** `checked` / `savedLayout` / `savedConnections` /
   `annotations` are four bare `$state` records enumerated in five separate
   places, and four flags (`diagramLayoutLoaded`, `loadedDiagramPath`,
   `diagramEditStamp`, `loadStartStamp`) guard one async read against both a
   stale path and a concurrent edit.
4. **`views/*.hcl` file manager (325).** create / rename / delete / folder /
   first-run seeding / deep-link. Mostly plumbing over `persistence.ts` and
   `FileTree`.
5. **Pointer machine (166).** The `Interaction` union and its handlers move
   wholesale. The pure maths inside (`applyGroupDelta`, `applyGroupScale`,
   `computeResizedBox`) is already testable and belongs in a
   `diagramTransform.ts`.

### Constraints

- **Net line reduction again**, as with the previous task. Moving a 166-line
  function into a 166-line module is not a decomposition, it is a file move.
  Each extraction must collapse duplication *inside* the moved unit, shrink
  the caller's interface, or delete code outright.
- **Keep reactive state in the component scope** unless the extracted unit is
  a pure function. The single-rendering-engine task learned this the hard
  way: a factory in a `.svelte.ts` that read host state through option
  closures silently latched its first value, and only the VRT baselines
  caught it. Prefer plain functions that take their inputs over factories
  that hold state.
- **VRT is the safety net, not the arbiter.** A baseline that moves without
  an intended visual change is a bug, not a re-accept. And re-run `just vrt`,
  never `vrt-quick`, after anything structural — `vrt-quick` silently tests
  the previous Storybook build.
- Don't re-litigate the diagram scene; that task is closed and its findings
  are recorded in `FINISHED.md`.

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
