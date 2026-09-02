# Tasks

How to work on this file:

- Read the next task from this file
- Get extra context from recently finished tasks - read the first 50 lines of
  `TASKS/FINISHED.md`
- Implement the task, use red/green TDD
- Run tests & linters (`just test`, `just lint`, `just build`)
  until it's all working
- Once all linters/builds/tests pass, run `cargo fmt`
- Move the completed task to `FINISHED.md` and report that you're finished

---

## Task <N> — Unified command-based transaction history (Undo/Redo)

Consolidate all UI-driven model mutations (AST/HCL writes) and diagram layout
changes into a single unified transaction and undo/redo history engine.

- **Strategy**
  - Replace disparate ad-hoc file writes and layout snapshots with a centralized command/action dispatcher.
  - Each action encapsulates bidirectional execution (`do()` and `undo()`) or represents an immutable document transaction across both `DocumentStore` and diagram layout files.
- **Implementation Scope**
  - Create `web/src/history/TransactionManager.ts` (or extend `web/src/routes/projects/[id]/diagrams/history.ts` into a workspace-wide store).
  - Define transactions covering:
    - Model mutations: Component creation/deletion, property updates, connection additions.
    - Layout mutations: Node moves, resizing, visual attribute styling, alignment changes.
  - Connect UI trigger points (`CreateComponentModal`, node drags, inspector inputs) to dispatch transactions through the manager.
  - Wire `Ctrl+Z` / `Ctrl+Y` / `Ctrl+Shift+Z` to the unified manager.
- **Acceptance Criteria**
  - Creating a component via the diagram modal and pressing `Ctrl+Z` undoes both its visual placement and deletes the entity from `system.hcl`.
  - Redo (`Ctrl+Y`) restores both the HCL definition and canvas coordinates.
  - Existing diagram drag/resize undo/redo remains functional without regressions.
  - Integrated into the deterministic simulation test harness from Task 88 to verify undo/redo reversibility across arbitrary sequences.
  - Validated with `just test`, `just lint`, and `just build`.

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

## For later Task <N> — Adding annotation to plots

Make it possible to attach a text marker to a component with a specified offset.
This attachment should be saved on the view-level not on the system model.

## (For later brainstorming) Task <N> - map errors to different usage modes

I want Rhizz to be usable in different usage modes, such as:

- Business spec - super high-level
- Architectural spec - high-level architectural overview
- Component-level spec - component overview, touching low-level details

Those roles should have different requirements regarding the level of detail they need to provide
and therefore should see different levels of feedback from the compiler.

A business-level spec has almost no requirements regarding the level of detail,
while a component-level spec has detailed requirements. The level of detail
should gradually increase as the spec moves from business to component level.

Keep in mind that the compiler should still allow to build the system even if the spec is incomplete.

For the MVP stage, I want to create 3 presets:

- Business-level spec
- Architectural spec
- Component-level spec

On the frontend side, they should be switchable using a select dropdown on the navbar or similar.
In the CLI, there should be a flag `--preset` that allows the user to select the desired preset.

Now, all warnings defined in `SPEC/diagnostics/` must be mapped to the
appropriate preset. The current diagnostic Markdown format should be further
formalized to require assigning each warning to a specific preset. If a warning
is assigned to business-level, it should be shown on business level and all
lower levels. Similarly, if a warning is assigned to architectural-level, it
should be shown on architectural level and all lower levels.

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

## (For later brainstorming) Task <N> - visual regression testing

As we now have a virtual filesystem hierarchy for the frontend, we can create
end-to-end tests which load the project, render a diagram and verify that it
matches the expected output.

Vitest supports visual regression testing. The goal of this task is to implement
infrastructure for visual regression testing in the frontend, then ask the
developer to create diagrams, which can be saved as reference images for future
comparisons.

---

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

## Task <NUMBER> — Task template

- Task description here
- Requirements, spec, acceptance criteria as bullet points
- Keep on increasing the task ID when creating new tasks
- Don't remove this template, move it to the bottom instead
