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

## Task <N> - Codebase Architecture Audit

You are performing a read-only architecture and maintainability audit of this
existing codebase.

Do NOT modify any source code, tests, configuration, or project files.

Your findings must be written to:

    audit/architecture.md

Create the `audit/` directory if it does not exist.

Do not output your findings, analysis, or report to the user/chat. The audit
file is the deliverable. Once it has been written, terminate the task.

### Repository context

This is an established codebase with:
- AGENTS.md, SPEC.md, README.md, other developer/agent documentation
- strict linters and type checking
- substantial automated tests, including unit, integration, and end-to-end tests
- a TypeScript frontend
- a Rust CLI, backend and a WASM library for sharing business logic with the frontend

Read the repository broadly before forming conclusions. Include relevant
documentation, tests, build configuration, and tooling in your understanding
of the architecture.

### What to look for

The primary goal is to find problems that are difficult to see when looking
at individual files but become apparent when considering the entire system.

Pay particular attention to:

- The same concept implemented independently in multiple places.
- Logic duplicated between the TypeScript frontend and Rust backend where one
  side could reasonably own the responsibility.
- Multiple abstractions which ultimately perform the same job.
- Locally sensible abstractions that become redundant at the system level.
- Multiple representations of the same domain concept that can drift apart.
- Repeated validation, transformation, serialization, parsing, error handling,
  state management, or business rules.
- Thin wrappers or layers that provide little actual value.
- Functionality introduced to solve a local problem that is now unnecessary
  because another mechanism elsewhere already solves it.
- Similar functionality implemented differently in different subsystems.
- Frontend/backend boundaries that cause unnecessary duplication.
- Over-engineering, unnecessary generality, or excessive indirection.
- Dead or effectively unreachable functionality.
- Architectural decisions that make future changes unnecessarily expensive.

#### TypeScript / Rust boundary

Trace important concepts and operations across the frontend/backend boundary.

Look for cases where both sides independently implement substantial portions
of the same:
- validation
- business rules
- state transitions
- transformations
- domain modeling
- error handling
- derived data

Do not automatically consider duplication across the API boundary a problem.
Distinguish intentional protocol/API contracts from duplicated implementation
logic.

### What NOT to optimize for

Do not report:

- purely stylistic preferences
- changes based solely on how you personally would structure the code
- fashionable architectural patterns
- line-count reduction for its own sake
- speculative performance improvements
- minor naming or formatting issues
- problems already intentionally handled by existing tooling
- abstractions merely because they could theoretically be removed

Assume existing abstractions may be intentional.

Only report a finding when there is concrete evidence that it introduces
unnecessary complexity, duplication, coupling, or maintenance cost.

### Findings

Prioritize findings by impact rather than by the number of occurrences.

For each significant finding, include:

### [Short descriptive title]

**Impact:** High / Medium / Low

**Confidence:** High / Medium / Low

**Locations:**
- relevant files, modules, symbols, or components

**Problem**

Describe what is happening.

**Why it looks reasonable locally**

Explain why an engineer working on an individual component could reasonably
have made this decision.

**Why it is problematic globally**

Explain the system-level redundancy, coupling, duplication, or complexity that
becomes visible when considering the whole repository.

**Potential simplification**

Describe the simplest plausible architectural change. Do not implement it.

**Evidence**

Reference the concrete code and relationships that led to the conclusion.

Avoid speculative findings. If evidence is insufficient, do not include the
finding.

### Final section

End `audit/architecture.md` with:

### Highest-value findings

List the 3–10 findings that are most worth investigating, ordered by expected
impact.

If the audit does not reveal significant architectural problems, explicitly
state that rather than inventing findings.

### Important execution constraint

This is an autonomous audit.

Do not ask the user questions.
Do not wait for user feedback.
Do not present findings in chat.
Do not modify anything outside `audit/architecture.md`.

Your final action should be writing the completed report to:

    audit/architecture.md

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
