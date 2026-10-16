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

## Task <N> — More information in the modeling/ canvas action type popup

In the modeling/ page, a popup on the bottom-left corner informs the user about
their current action, e.g. "dragging" or "selecting". I want the popup to also fire when the user:

- Hides a component instance - "component <name> hidden"
- Hides a connection - "connection <name> hidden"
- Hides a connection - "connection <name> hidden"
- Runs undo/redo - "Undo" or "Redo", alternatively "No more actions to undo/redo"

## Task <N> - Weird undo-redo behavior after switching a diagram

Steps to reproduce:

1. Open up any example project
2. Navigate to some diagram (diagram A)
3. Switch to another diagram (diagram B)
4. Press Ctrl-Z

#### Expected result

Nothing happens, "no changes to undo" popup appears.

#### Actual result

Diagram B gets transformed into diagram A which was loaded before. I suspect
it has something to do with the undo history not being reset when a different
diagram file is loaded?

## Task <N> — Palette e2e flake

Command-palette e2e tests fail intermittently (2 of 5 runs with the audit
overrides, 1 of 4 without). A different test fails each time, and each passes
when rerun alone. Find the timing dependency in the palette tests or component
and make them deterministic.

---

## Task <N> - During view transitions, connection arrows don't fade out

It appears that connection arrows don't fade out when the component to which the
arrow points to is not supposed to exist in the target view. They stay fully
visible until the transition completes, then disappear abruptly.

## Task <N> - Changing project name does not respect lower/uppercase

Steps to reproduce:

1. Create a new project "test"
2. Go back to projects list, click on rename and enter "Test" as the project name, click "ok"
3. Notice that the project's name changed to "Test" - that's correct
4. Refresh the page
5. Project's name is back to "test"

I believe that the project name should live in the `project` metadata,
filesystem-based name should only be used when a project does not have a name
set under `project`. Think about how GitLab/GitHub handle this - there's a
separate project name and project **path**. Right now, the path is used for
everything and it also appears that it does not respect upper/lowercase.

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

## (For around November) Task <N> - Migrate to Typescript 7

TypeScript 7.0 (the native Go port) went GA on July 8, 2026 34. But
svelte-check, svelte2tsx, and the Svelte language server don't just shell out to
tsc — they import TypeScript's programmatic compiler API and drive the compiler
directly. TypeScript 7.0 shipped without a stable programmatic API; that's
deferred to 7.1, currently targeted for around October 2026 582.

Definition of done:

1. Check if Typescript 7 works with svelte now
2. If it does not - halt the execution immediately and inform the user that it cannot be done
3. If it does - migrate the project to Typescript 7:
  - Update dependencies and Typescript configuration
  - Remove all leftovers of Typescript 6, with zero thoughts about backward compatibility
  - Verify the migration by usual instructions from AGENTS.md
  - Commit that state
  - Do a comprehensive check of the current typescript configuration, focusing on whether something can be slimmed down after the update
  - If you made changes - verify again and commit the updated configuration


## (For later brainstorming) Task <N> - routing multiple connections between 2 components

When 2 components have more than one connection between them, connection routing
rules cause connections to be drawn over each other. Instead, a better routing algorithm should be implemented.
I'm thinking about a PCB-style routing that lines up multiple connections along a shared path, but with some extra
offset to avoid overlapping.

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

---

## Note — Remove the audit `overrides` when upstream is fixed

The `overrides` in `web/package.json` pin two transitive dependencies to fixed
versions. `npm audit fix` cannot replace them: without `--force` it moves
`dompurify` down to the vulnerable 3.2.7, and with `--force` it only offers
`monaco-editor@0.57.0`, which still resolves the vulnerable `dompurify@3.4.15`.

- **`dompurify` (under `monaco-editor`, runtime path):** remove the override
  once a Monaco release resolves `dompurify` to 3.4.17 or later. Check with
  `npm view monaco-editor@<version> dependencies.dompurify`.
- **`postcss-selector-parser` (under `@tailwindcss/typography`, build time):**
  remove the override once `@tailwindcss/typography` depends on a parser
  version outside the advisory range (below 7.1.6). Check with
  `npm view @tailwindcss/typography@<version> dependencies`.

After removing an override, run `npm audit` and confirm the finding stays clear.

