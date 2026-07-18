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

## Task 50 - automatic layout via force simulation

**Status: in progress.** Steps 1–3 of the phased plan below are done and
demoable — there's a working "Auto Layout" button on the diagrams page’s
bottom toolbar. Steps 4–5 (recursive per-sibling-group layout, "pin
existing nodes" for the new-nodes use-case, and the "exploring
interactively" use-case) are still open follow-ups; see the end of this
entry for what's implemented so far.

The goal of this task is to implement automatic layout via force simulation, so
that nodes are automatically positioned to avoid overlap and minimize edge
crossings.

The functionality to trigger force simulation would be triggered by the user,
either via a button or a keyboard shortcut. The functionality shall allow to run
the force simulation and automatically position the nodes, either for all nodes
or for a selected subset of nodes.

Specific use-cases:

- Button on the bottom toolbar - "auto-layout" - positioning all selected nodes (or all if nothing is selected)
- When new nodes are added to the diagram (although the force simulation should only run for new nodes)
- When exploring the system model in an interactive fashion

**Important note:** simulation should only interact with the diagram data model, not with rhizz-core models. This avoids any coupling between the view-focused layouting and the core model.

### Brainstorm: library choice

Three realistic options:

1. **`d3-force`** (the force-simulation module of D3, usable standalone without
   the rest of D3). Battle-tested, uses a quadtree/Barnes-Hut approximation for
   the repulsion force so it stays fast well beyond the node counts this app
   will ever see, and its primitives map almost 1:1 onto what's needed here:
   `forceManyBody()` (repulsion, avoids overlap in aggregate), `forceLink()`
   (attraction along connections, pulls linked nodes together), `forceCollide()`
   (hard overlap avoidance, radius-based), `forceCenter()`/`forceX()`/`forceY()`
   (keeps a group from drifting off to infinity). Small (~10 kB min+gzip for
   just the pieces used, since it's tree-shakeable). **Recommended** — same
   reasoning as picking Zod over hand-rolling validation: this is a solved
   problem, and a well-tested library beats a bespoke physics loop.
2. **`webcola`/`cola.js`**. Purpose-built for diagram layout, and notably
   supports *rectangle-aware* overlap removal (`avoidOverlaps`) instead of
   d3-force's circle approximation — a better fit in principle, since nodes
   here are boxes with independently adjustable width/height. Downside: much
   less actively maintained, heavier API surface, and rectangle-vs-circle
   accuracy probably isn't worth the trade-off for a first version.
3. **Roll a tiny custom simulation** (pairwise repulsion + spring attraction
   along edges, integrated with simple velocity damping). Zero new
   dependency, full control — but reimplements a well-solved problem, and a
   naive O(n²) pairwise loop is fine for this app's realistic node counts but
   still risks subtle bugs (energy not damping out, jitter, nodes escaping to
   infinity) that a mature library has already ironed out.

### Brainstorm: rectangles vs. the library's point/circle model

`d3-force`'s `forceCollide(radius)` reasons about circles, not boxes. The
pragmatic approximation: give each node a radius of
`Math.hypot(box.width, box.height) / 2` (the circumscribing circle) — good
enough to keep boxes from visibly overlapping without needing custom
rectangle-vs-rectangle SAT collision code. Rectangle-aware packing (letting
boxes nest edge-to-edge more tightly, especially very non-square ones) is a
reasonable future refinement, not a v1 requirement.

### Brainstorm: this diagram is hierarchical — a single global simulation is the wrong model

The SPEC's component hierarchy (and the containment/clamping machinery from
Tasks 35/45/46) means nodes aren't just a flat bag of boxes: a node can have a
parent, and must always stay inside that parent's box. Running one global
force simulation over every currently-placed node (parents and children
together) would actively fight that: an unrelated top-level node could repel a
deeply-nested leaf it happens to be geometrically near, and any motion that
pushes a child outside its parent would just get snapped back by the existing
`clampWithin`/`reclampChildren` cascade on the very next tick, causing visible
jitter.

The layout that actually matches the domain model: run **one independent
simulation per sibling group** (i.e. group currently-placed nodes by
`parent_component_index`, `undefined` meaning the top-level group), using only
intra-group connections for the link force, with each group's simulation
confined to its own bounding region — the whole canvas for the top-level
group, or the parent's current box for a nested group (via a custom
boundary/center force, or just re-running the existing `clampWithin` clamp
after each tick as a safety net, same as a live drag already does). This
composes cleanly with the existing containment code instead of fighting it,
and is a closer match to "minimize edge crossings" too, since cross-hierarchy
noise never enters a given group's simulation.

### Brainstorm: mapping the three use-cases to behavior

- **"Auto-layout" button** (selection, or everything if nothing's selected):
  build one simulation per sibling group *represented in the target set*,
  run each to convergence, write back positions. Most straightforward case,
  good first target.
- **New nodes added to the diagram**: per the task's own note, existing nodes
  shouldn't visibly jump just because something new was checked onto the
  canvas. `d3-force` supports pinning a node's position via `node.fx`/`fy`
  (fixed, ignored by all forces) — so this case is "run the same per-group
  simulation, but fix every pre-existing node in place and only let the
  newly-added node(s) move," letting them settle into whatever gap is left
  without disturbing anything else.
- **"Exploring the system model interactively"**: the vaguest of the three
  and probably not worth designing for yet — likely ends up being a variant
  of the "new nodes" case (e.g. auto-checking a component's children when
  first expanding it) once that feature actually exists. Recommend
  explicitly deferring this one until there's a concrete trigger to hang it
  off of.

### Brainstorm: animation, architecture, and safety

- `d3-force`'s simulation is inherently iterative (an `alpha` that decays over
  ~300 ticks by default) — driving it via `requestAnimationFrame`, calling
  `simulation.tick()` and writing the result back through the existing
  `setNodeBox()` path each frame (same mechanism a live drag already uses),
  gives a natural "settling into place" animation for free, rather than
  jumping straight to the final layout.
- Following the project's established pattern (`geometry.ts`, `persistence.ts`
  — plain, Svelte/DOM-free, directly Vitest-testable modules), the simulation
  setup/stepping logic belongs in a new `layout.ts`: a pure function taking
  plain `{ index, box }[]` nodes + `{ from, to }[]` edges in, returning final
  `{ index, x, y }[]` positions out, with zero dependency on `rhizz-wasm`
  types — satisfying the task's "only interact with the diagram data model"
  constraint by construction, not by convention.
- Safety net: this app has no undo system at all today. An accidental
  "auto-layout everything" click on a carefully hand-arranged diagram would
  be irreversible. Worth at least snapshotting the affected nodes' boxes
  before running, so a one-shot "Undo Auto-Layout" affordance could restore
  them, without building a full undo stack.

### Suggested phased plan (for later, iterative implementation)

1. Add `d3-force` as a dependency; create `web/src/routes/diagrams/layout.ts`
   with a pure `runForceLayout(nodes, edges, options)` function and Vitest
   coverage (connected nodes converge without fully overlapping; disconnected
   nodes repel apart; a pinned/fixed node doesn't move).
2. Wire an "Auto Layout" button into the bottom-center toolbar, scoped to
   **top-level nodes only** for v1 (defer the recursive per-sibling-group
   case as an explicit, documented follow-up) — operating on the current
   selection, or every placed top-level node if nothing's selected.
3. Animate it via `requestAnimationFrame`, writing back through `setNodeBox`
   each tick, instead of jumping straight to the converged result.
4. Follow-up: extend to full recursive per-sibling-group layout (so nested
   hierarchies each get their own contained simulation), and the "pin
   existing nodes, only lay out new ones" behavior for the "new nodes added"
   use-case.
5. Follow-up: revisit the "exploring the system model interactively" use
   case once there's a concrete feature (e.g. auto-expanding children) to
   hang it off of.

### Implemented so far (steps 1–3)

- `web/src/routes/diagrams/forceLayout.ts`: pure, Svelte/rhizz-free module
  wrapping `d3-force` (added as a dependency, along with `@types/d3-force`).
  Named `forceLayout.ts` rather than `layout.ts` to avoid colliding with
  SvelteKit's reserved `+layout.ts` route-file convention. Exposes
  `createForceLayout(nodes, edges, options)` (returns a `{ tick(), alpha() }`
  pair for frame-by-frame driving) and `runForceLayout(...)` (a synchronous
  convenience wrapper that ticks to convergence, used by tests). Nodes are
  approximated as circles (`Math.hypot(width, height) / 2`) for the
  collision force; a node's own diagram index is round-tripped via a
  `componentIndex` field (NOT `index` — d3-force reserves that name on
  every simulation node for its own bookkeeping and will silently overwrite
  it). Supports pinning a node in place via `fixed: true` (sets d3-force's
  `fx`/`fy`), already threaded through for the not-yet-wired-up "new nodes"
  use-case. 9 Vitest tests in `forceLayout.test.ts`.
- `web/src/routes/diagrams/+page.svelte`: added a `runAutoLayout()` function
  and an "Auto Layout" button in the bottom toolbar. Target set is the
  current selection, or every placed top-level node if nothing's selected
  (v1 scope, per step 2 above). Edges are `connections` filtered to those
  with both endpoints in the target set. Driven via `requestAnimationFrame`,
  writing each frame's result back through `writeClampedToActiveParent`
  (the same clamp-to-own-parent-and-cascade path drag/resize already use
  — Tasks 45/46), so a manually-selected mix of parents/children stays
  containment-safe even without hierarchy-aware grouping yet. Stops once
  `alpha` decays below `AUTO_LAYOUT_ALPHA_MIN` or `AUTO_LAYOUT_MAX_FRAMES`
  is reached. `autoLayoutRunning` disables the button mid-run so a second
  click can't race the first.
- Not yet done: the undo/snapshot safety net mentioned above — running
  auto-layout on a hand-arranged diagram is currently irreversible other
  than manually dragging things back.
- Validated with `deno task check` (0 errors/warnings), `deno task build`
  (succeeds), `deno task test` (56/56 pass), and `deno fmt` (clean).

---

## (For later brainstorming) Task 48 - virtual filesystem hierarchy for frontend

High-level goal: make it possible to store multiple multi-file projects & diagrams,
with the web application pretending to have a virtual filesystem hierarchy.

## (For later brainstorming) Task 49 - visual regression testing

As we now have a virtual filesystem hierarchy for the frontend, we can create
end-to-end tests which load the project, render a diagram and verify that it
matches the expected output.

Vitest supports visual regression testing. The goal of this task is to implement
infrastructure for visual regression testing in the frontend, then ask the
developer to create diagrams, which can be saved as reference images for future
comparisons.


## Task <NUMBER> — Task template

- Task description here
- Requirements, spec, acceptance criteria as bullet points
- Keep on increasing the task ID when creating new tasks
- Don't remove this template, move it to the bottom instead
