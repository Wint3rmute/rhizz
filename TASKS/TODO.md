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

Consolidate all UI-driven model mutations and diagram layout changes into
a single unified transaction and undo/redo history engine. (Today `Ctrl+Z`
only reverts the layout-only snapshot in `diagrams/history.ts`; model writes
through `applyModelMutation` have no `undo()` — so add/remove leaves `system.hcl`
behind.)

- **Strategy**
  - Build on the existing single entry point `web/src/history/applyMutation.ts`
    (Rust-owned `apply_model_op` via WASM). `DocumentStore.svelte.ts` is a
    reactive **read** model and is never mutated on the write path — do not
    build a second dispatcher.
  - Add a centralized `TransactionManager` where each action encapsulates
    bidirectional execution (`do()` and `undo()`), covering both the primary
    HCL write **and** the corresponding `views.hcl` layout write
    (`DocumentStore.updateNodeLayout` / `diagrams/persistence.ts` /
    `ViewEditorState`).
  - Inverse ops must invert the Rust dispatcher's higher-level ops, not just
    the TS call site: `create_component` (container fallback,
    definition+instance creation, instance-under-instance redirection) and
    connection ops (LCA scope resolution, `delete_connection_by_label`).
    Undoing a create must remove exactly what the dispatcher created
    (including any auto-created definition); undoing a delete must restore
    scope/label.
- **Implementation Scope**
  - Create `web/src/history/TransactionManager.ts` (preferred —
    `web/src/history/` currently holds only `applyMutation.ts`) rather than
    widening the diagram-scoped generic stack in
    `web/src/routes/projects/[id]/diagrams/history.ts` (`DiagramSnapshot`,
    `UNDO_HISTORY_LIMIT = 100`, page-level `diagramHistory`). The page-scoped
    stack is the migration source for drag/resize snapshots, not the new home.
  - Define transactions covering:
    - Model mutations: component creation/deletion, property updates,
      connection additions/deletions (via `applyModelMutation` kinds).
    - Layout mutations: node moves, resizing, visual attribute styling,
      alignment changes (via `updateNodeLayout` / `views.hcl` persistence).
  - Connect UI trigger points (`CreateComponentModal` →
    `handleModalCreateComponent`, node drags, `NodeInspector` →
    `handleUpdateSelectedComponent`, connection handlers) to dispatch
    transactions through the manager.
  - Replace the page-scoped `onDiagramKeyDown` handler in `diagrams/+page.svelte`
    (deliberately kept out of `KeyboardState.svelte`) with wiring to the unified
    manager: `Ctrl+Z` / `Ctrl+Y` / `Ctrl+Shift+Z`. Resolve ownership explicitly —
    no double handling between page and global scope.
- **Acceptance Criteria**
  - Creating a component via the diagram modal and pressing `Ctrl+Z` undoes both
    its visual placement and deletes the entity from `system.hcl`.
  - Redo (`Ctrl+Y`) restores both the HCL definition and canvas coordinates.
  - Existing diagram drag/resize undo/redo remains functional without regressions.
  - Integrated into the deterministic simulation test harness from Task 89
    (not 88) to verify undo/redo reversibility: extend `WorkspaceHarness.dispatch`
    (currently only `select-component`, `set-node-visuals`, `move-node`,
    `add-diagram-view`) with create/delete component, connection ops, and undo;
    generated sequences must respect `editableComponentKeys` guards (single
    primary HCL file, `apollo-11` excluded, visual-owners only — sourced
    instances edit shared definitions).
  - Note: the planned change of delete-key semantics to view-only removal will
    shift undo semantics when it lands; undo of full-model delete must not be
    assumed to survive that change.
  - Validated with `just test`, `just lint`, and `just build`.
  
---

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

## (For later) Task <N> — Pressing "delete" on a component should not delete it from the whole model

In the diagrams menu, pressing "delete" while having a compoent selected causes
this component to be wiped out from the entire system model. This is unintuitive
and dangerous. Change this behavior, so that using "delete" will only delete the
system from the **current view**.

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

---

## Task <NUMBER> — Task template

- Task description here
- Requirements, spec, acceptance criteria as bullet points
- Keep on increasing the task ID when creating new tasks
- Don't remove this template, move it to the bottom instead
