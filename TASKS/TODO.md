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

## (For later brainstorming) Task <N> - allow resizing of components by dragging from the edges

Currently, components can be resized only by dragging a "special" rectangle at the bottom-left corner,
only when the component is focused. I want to change it, so that components can be resized by dragging from any edge,
even when they are not focused.

## (For later brainstorming) Task <N> - Use the FileTree.svelte component to display component hierachy

The `FileTree.svelte` component is now only displaying the files in the project. It serves its purpose well,
so it could be used to display the component hierarchy as well. Right now, the hierarchy is displayed
in a poorly designed side panel, which is hard to navigate and does not allow expanding/collapsing of components.

Definition of done:

1. Analyze the current coode of the FileTree, determine if could be reused.
2. If it can be generalised, refactor it to be reusable for both file and component hierarchies.
3. Use the refactored components to display both file and component hierarchies in the Diagrams Editor.

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

## (For later brainstorming) Task <N> - relax requirements regarding adding new
connections

This is not well understood by me at this point, but interactive experimentation with rhizz shows that it's kinda hard to "just add a new connection and have it show up on the diagram". Lots of boilerplate must be written before the Rhizz compiler accepts a model without errors. This is against `SPEC.md`, which describes a gradual validation system, which detects incomplete definitions, emits warnings to the user, but **still allows to build the system**.

I suggest starting out this task with writing a new example in `examples/` that demonstrates all possible incomplete definitions and how the compiler handles them,
showcasing the compiler's flexibility in gradual validation.

It should later be expanded into unit tests, but that is only after the core idea is implemented and checked by the user.

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

## For later Task <N> — Visual attributes for components and connections

Make it possible to define system-model-level attributes specifying how
a component shall be rendered in diagrams. Currently, an icon is the only
customizable element. I want to add the following new attributes:

- Color
- Border style (solid, dashed, dotted)

## For later Task <N> — Adding annotation to plots

Make it possible to attach a text marker to a component with a specified offset.
This attachment should be saved on the view-level not on the system model.

---

## Task <NUMBER> — Task template

- Task description here
- Requirements, spec, acceptance criteria as bullet points
- Keep on increasing the task ID when creating new tasks
- Don't remove this template, move it to the bottom instead
