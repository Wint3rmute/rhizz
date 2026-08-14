# Implementation Tasks

How to work on this file:

- Read the next task from this file
- Get extra context from recently finished tasks - read the first 50 lines of
  `FINISHED_TASKS.md`
- Implement the task, use red/green TDD
- Run tests & linters (`cargo test`, `cargo clippy`, `cargo doc`, `cargo build`)
  until it's all working
- Once all linters/builds/tests pass, run `cargo fmt`
- Move the completed task to `FINISHED_TASKS.md` and report that you're finished

---

## Task 70 — Reactive document store for multi-file workspace (`system.hcl` + `views.hcl`)

Create a centralized Svelte 5 reactive document store (`web/src/DocumentStore.svelte.ts`) in the frontend that coordinates the active in-memory model, layout state, diagnostics, and bi-directional serialization.

- Create `DocumentStore` class with Svelte 5 `$state` and `$derived`:
  - Holds active system entities (`systems`, `components`, `ports`, `connections`, `messages`) and view layouts.
  - Automatically derives formatted `system.hcl` and `views.hcl` via `rhizz-wasm` serialization.
  - Maintains live compilation diagnostics and completion score calculations on every state mutation.
- Decouple layout state (`checked` nodes, positions, sizes) into the `views.hcl` representation while leaving `system.hcl` purely architectural.
- Provide foundational mutation methods: `addSystem`, `addComponent`, `deleteComponent`, `reparentComponent`, `addPort`, `addConnection`.
- Unit tests for store mutations and reactive derivations.
- Validate with `deno task check`, `deno task test`, `deno task build`.

---

## Task 71 — Visual node creation and hierarchy editing on the canvas

Enable creating and managing systems and components entirely via the visual canvas UI without typing HCL.

- Add a canvas creation toolbar and hotkey/context-menu actions:
  - Quick-add buttons: "+ System", "+ Component".
  - Double-click on empty canvas creates a new component at the cursor position.
- Implement visual hierarchical nesting and reparenting:
  - Dragging a component over a parent system or parent component highlights the target container.
  - Dropping the component inside reparents it structurally in the document store and visually clamps it within the parent boundary.
  - Dragging a child component outside its parent reparents it up one level (or to root system level).
- State changes instantly update the document store, recalculating completion scores and updating the serialized `system.hcl`.
- Validate with `deno task check`, `deno task test`, `deno task build`.

---

## Task 72 — Interactive property and message inspector panel

Expand the canvas inspector panel so users can configure component properties, define ports, and specify message payloads/fields with full schema details in the GUI.

- Component properties:
  - Edit label, description, tags, and toggle atomic status (`leaf`).
- Port management:
  - Add/remove ports on a component.
  - Set port label, description, `protocol` (e.g. SPI, CAN, HTTP), and `role` (`provider`, `consumer`, `peer`).
- Message and field editor:
  - Add/remove messages inside ports.
  - Add typed data fields (`type`, `unit`, `description`, `required`).
- Real-time score feedback:
  - As descriptions, ports, and fields are filled in the inspector, the completion score meter in the top navigation updates dynamically.
- Validate with `deno task check`, `deno task test`, `deno task build`.

---

## Task 73 — Interactive visual wiring (drag-to-connect ports & connections)

Implement visual drag-to-connect interactions directly on the canvas to wire components together.

- Render distinct interactive port handles along component borders (color-coded by role/protocol).
- Dragging from a source port handle draws an active interactive connection line to the cursor.
- Hovering over a compatible target port highlights the port as a valid connection target.
- Dropping creates a `connection` in the document store wiring the two sibling endpoints (`from = "compA:port1"`, `to = "compB:port2"`).
- Surface instant compiler diagnostic feedback if incompatible protocols or invalid sibling scopes are connected.
- Validate with `deno task check`, `deno task test`, `deno task build`.

---

## Task 74 — Multi-file workspace tabs and project import/export

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

## Task 75 — Install FontAwesome icons, use them in the FileTree

- Install FontAwesome icons via deno
- Use the `free-solid-svg-icons` variant
  - In general, pick the most minimal and free variant
- Use the icons in the FileTree - one icon for a folder, another icon for a file

---

## Task 76 — Allow embedding diagrams via unique URLs

- Add a unique URL scheme for embedding diagrams (e.g. `/projects/[project-id]/diagrams/embed/[diagram-id]`)
- Update the `Diagram` component to support the new URL scheme
  - Re-use existing components. On conflict, refactor the `Diagram` to smaller reusable components
- The embedded diagram should have pan/zoom functionality and a link to the full diagram, but no editing capabilities. Reuse the style of the current bottom bar, but with limited button layout

---

## (For later brainstorming) Task <N> - use UNIX-style paths for component references

Currently, when defining connections between components, path are specified using label + colon notation (e.g. `foo:bar`). While this is convenient for simple cases, it should be replaced with a more standard UNIX-style path notation (e.g. `/foo/bar`).

Both relative and absolute paths should be supported.

Definition of done:

- All documentation (SPEC.md and other markdown documents) are updated to reflect the new approach
- The rhizz-core module is updated
- Code is checked for presence of unit tests which check that both relative and absolute paths are supported. Existing tests are updated to reflect the new approach.
- Example models in `examples/` are updated to reflect the new approach. Each example model is checked after changes using the Rhizz CLI.
- Example model hardcoded in the frontend application is updated to use the new approach

---

## (For later brainstorming) Task <N> - relax requirements regarding adding new connections

This is not well understood by me at this point, but interactive experimentation with rhizz shows that it's kinda hard to "just add a new connection and have it show up on the diagram". Lots of boilerplate must be written before the Rhizz compiler accepts a model without errors. This is against `SPEC.md`, which describes a gradual validation system, which detects incomplete definitions, emits warnings to the user, but **still allows to build the system**.

I suggest starting out this task with writing a new example in `examples/` that demonstrates all possible incomplete definitions and how the compiler handles them,
showcasing the compiler's flexibility in gradual validation.

It should later be expanded into unit tests, but that is only after the core idea is implemented and checked by the user.

---

## (For later brainstorming) Task <N> - pin existing nodes when auto-laying-out newly-added ones

Split out from Task 50 (now finished — see `FINISHED_TASKS.md`) as the one
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

## (For later brainstorming) Task <N> - visual regression testing

As we now have a virtual filesystem hierarchy for the frontend, we can create
end-to-end tests which load the project, render a diagram and verify that it
matches the expected output.

Vitest supports visual regression testing. The goal of this task is to implement
infrastructure for visual regression testing in the frontend, then ask the
developer to create diagrams, which can be saved as reference images for future
comparisons.

---

## Task <NUMBER> — Task template

- Task description here
- Requirements, spec, acceptance criteria as bullet points
- Keep on increasing the task ID when creating new tasks
- Don't remove this template, move it to the bottom instead
