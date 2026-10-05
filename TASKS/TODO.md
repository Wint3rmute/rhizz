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

## Task <N> - UI for creating and browsing systems

The current Rhizz web interace is missing features related to management of systems. I want to manage systems in the following ways:

1. I want to have a systems counter in the stats bar on the overview/ page, on the left from Components.
2. I want to be able to filter out just systems in the inventory/ page, using
   the selection box which currently has "All", "Components", and "Interfaces":
  - Remove the "all" option
  - Add "Systems" option
3. When a specific system is selected, in the inventory/ page, it should display
   the diagram which has the same name as the system, if it exists. If it
   doesn't exist, it should display a message indicating that no diagram is
   available and a button to create a new view, same as it currently works with
   components.
4. A "Add System/Component" button shall be added to inventory/ allowing the
   user to add a new system or component, depending on the selected filtering
   mode.

## Task <N> - Put the project scope in the call: scope every ProjectStore node operation

Every node operation in `web/src/vfs/operations.ts` resolves its target against
the *whole* `nodes` array rather than the project it was called for:
`findNode` (`:88-94`) takes the first match anywhere, and
`updateFileContent`/`renameNode`/`moveNode` then rewrite **every** node whose
id matches. `deleteNode` collects descendants through `tree.ts`'s
`descendantsOf`, which builds its child map from all nodes, and
`wouldCreateCycle` builds `new Map(nodes.map(n => [n.id, n]))` — last one
wins. So a node id is being used as an unforgeable capability token, and it is
not one: whoever holds a valid id can name any node in the VFS, in any project.
This is what let a write in one project land in another (see Task 119a in
`FINISHED.md`).

Task 119a closed the *producers* (rhizz-server now emits project-qualified
ids, and `sanitizeVfsData` drops duplicate node ids from a foreign blob), and
added a "node identity and project isolation" section to the ProjectStore
contract suite. What is left is the *consumers*: the store itself is still
unsafe by construction, and only the uniqueness of the ids stands between it
and a cross-project write.

The filesystem-alike fix is the one `web/src/vfs/store.ts:6-10` already
describes ("real filesystems don't expose inode numbers to userland"): make the
scope part of the call rather than an inference, the way `openat(dirfd, path)`
roots every syscall at a directory handle. There is no `open(42)`.

Definition of done:

1. Every node method on the `ProjectStore` interface takes the `projectId` it
   belongs to: `updateFileContent(projectId, fileId, content)`,
   `renameNode(projectId, nodeId, name)`, `moveNode(projectId, nodeId,
   newParentId)`, `deleteNode(projectId, nodeId)`.
2. `findNode` filters on `(projectId, id)`, and every rewrite filters on both —
   so a node of another project is *unrepresentable* as a target rather than
   merely guarded. `assertValidParent` stops being a check downstream of a
   global lookup (and starts rejecting genuinely foreign ids, which it cannot
   distinguish today).
3. `descendantsOf` and `wouldCreateCycle` are scoped to the project too.
4. `fs.ts` barely changes: `openProjectFs(store, projectId)` already closes over
   `projectId` and currently throws it away at every mutating call.
5. Tests: extend the isolation section of `store.contract.test.ts` (it runs
   against all three backends) with cases that pass an id belonging to another
   project and assert a typed rejection rather than a silent cross-write.
6. Keep the "ids are unique across the VFS" invariant documented on
   `vfs/types.ts` — it is still what keeps per-project ids sufficient, and
   `FsNode` remains the wire shape rhizz-server sends.

Deliberately *not* part of this task: collapsing the id layer entirely, i.e.
making `ProjectStore` path-based per project and deleting the resolution
duplicated across `tree.ts` and `pathTree.ts`. Once (1)-(3) land, per-project
id uniqueness is sufficient, so that refactor buys tidiness rather than safety
and costs the 14-method interface plus the whole contract suite. Worth doing
eventually as a simplification; not as this fix.

---

## Task <N> - During view transitions, connection arrows don't fade out

It appears that connection arrows don't fade out when the component to which the
arrow points to is not supposed to exist in the target view. They stay fully
visible until the transition completes, then disappear abruptly.

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
