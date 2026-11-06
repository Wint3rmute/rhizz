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

## Task <N> — 0005.0 Projection resolver (foundation, no UI)

Pure helper implementing `SPEC.md` §6.3–§6.4 + §6.7 item 2, next to
`web/src/routes/projects/[id]/modeling/connectionVisibility.ts`
(the existing shared drawn-predicate both sidebar and canvas consume).

- Input: resolved connections (`from`/`to` component ids, label), parent links,
  placed set, `hidden` lookup. Output per connection copy: `direct` (both ends
  directly placed) | `projected` (resolved visible ancestors + projected port
  names `<rel-path>/<port>`) | `omitted` (no ancestor, or projected self-edge:
  both resolve to same ancestor with ≥1 endpoint projected).
- Slash rule (`SPEC.md` §3): real labels never contain `/`, so projected names
  can't collide — no special-casing in the resolver.
- Red/green TDD, colocated unit tests (direct, mixed direct/projected,
  omitted, `B/C/input`, copies sharing a name → same toggle).
- Definition of done: unit tests green; no UI change; `just test`, `just lint`.

## Task <N> — 0005.1 Sidebar lists all connections + Projected badge

End state bullet 1 + 2: the modeling inspector (right side) always shows every
defined connection of the view's system, with a small `Projected` badge on
ones the resolver marks projected under current visibility.

- Extend `sidebarConnectionRows` (currently only lists placed connections):
  list all in-system connections; per-name state `drawn | projected | hidden |
  omitted` from the 0005.0 resolver. Copies sharing a name stay one row (same
  hide/show semantics as today).
- UI: DaisyUI badge (prefer `badge-ghost`), Storybook stories for each state
  (VRT). Interaction logic (badge reactivity on show/hide) covered by e2e.
- Definition of done: high-level view lists `low-link` with badge; hiding via
  existing `connection` block still works; `just test`, `just lint`, `just build`.

## Task <N> — 0005.2 Canvas draws projected edges

Projected connections render between visible ancestors under their original
name/identity (`SPEC.md` §6.2, §6.6).

- Edge list (`drawnConnections` consumers) emits projected edges with resolved
  endpoints; `hidden`/`start_side`/`end_side` apply unchanged; multiples
  preserved (no merging); projected self-edges omitted (0005.0).
- Direction arrowheads from original roles (§6.1).
- e2e first: view with only `A`,`C` shows `A—C` for `B/input—D/output`;
  hidden flag hides it; two connections onto same pair render twice.
- Definition of done: e2e green; `just test`, `just lint`, `just build`.

## Task <N> — 0005.3 Draggable projected ports + persistence

End state bullet 3: projected port dots move like any other port, position
persisted per view.

- Port dots for projected names reuse existing drag gesture; writes go through
  `persistence.ts` as `node "sys/A" { port "B/input" { side offset } }`
  (existing HCL convention, §2.10/§6.5). Direct layout wins when present.
- Verify `parse_views`/serializer round-trip of `/`-containing port labels
  (`persistence.test.ts`); e2e drag test for a projected dot.
- Definition of done: reload keeps position; `just test`, `just lint`.

## Task <N> — 0005.4 Reveal/hide transitions (jump) + stale handling

End state bullet 4: connection added as projected, then inner component shown
→ edge jumps from projected rendering to the real inner port. Hiding reverses it.

- Must fall out of shared-resolver reactivity (0005.0): visibility change
  re-resolves; no position transfer (projected layout ignored once direct
  applies; direct falls back to its own block or role default — state this in
  e2e assertions).
- Stale `port` blocks (renamed/removed descendant): ignored with fallback, no
  diagnostic (per scoping decision) — e2e covers fallback, no warning asserted.
- e2e: project → reveal inner → attached to real port → hide inner → projected
  again.
- Definition of done: e2e green; `just test`, `just lint`, `just build`.

## Task <N> — Slash-in-label compiler error (Rust)

Enforce the `SPEC.md` §3 rule (block labels must be non-empty, must not contain
`/`; `/` is the path separator) in `rhizz-core` instead of relying on
incidental resolution failure + the editor-only `mutation/connect.ts:check_label`
guard. Motivating case: guarantees projected names (`B/input`) can never
collide with a real single label.

- New diagnostic file under `SPEC/diagnostics/` (error code; `build.rs` picks it
  up — follow `diagnostics.md` format rules), emitted at parse/resolution for
  any block label containing `/` (system, component, instance, port,
  connection, protocol, message, field, view). Check what `E000`/`E001`
  already cover first and reuse if fitting; otherwise mint the new code.
- Assert the exact new code (not just counts) in tests, per repo convention.
- Red/green TDD in `crates/rhizz-core`; `just test`, `just lint`, `just build`;
  `just format`. No frontend change.

---

## Task <N> - exploring diagrams in embed mode

When browsing system diagrams in Embed mode (/modeling/embed/), it's not
possible to navigate defined system views, as it is possible in the explore/
view. Please make it possible to navigate back and forth through linked views.

## Task <N> - more advanced connection routing on canvas

Currently, every connection is routed with a "double-knee" elbow
(horizontal-vertical-horizontal or vertical-horizontal-vertical jog — see
`elbowPath` in `web/src/routes/projects/[id]/modeling/geometry.ts`), always
with 2 turning points. This does not always work.

Design a smarter router. Cases it must cover:

- **1 vs. 2 knees:** smartly decide whether a single turning point suffices
  or two are needed, from the relative node positions and the sides the ends
  leave from — instead of always using two.
- **Port-anchored endpoints:** since the ports work, an edge end can sit
  anywhere on the outline (`DiagramEdge.fromPort`/`toPort` plus `PortSpot`),
  not just at a side midpoint. Same-side endpoints (both dots on e.g. the
  right edge) and facing edges currently produce awkward loops; the router
  must take the exact anchor points and their sides as inputs.
- **Out of scope here:** multiple connections between the same 2 components
  drawing over each other — that stays in the "routing multiple connections
  between 2 components" task below (PCB-style shared path with offset).

Think about existing well-thought solutions in diagram editors and propose
the smallest router covering the cases above. Geometry-level unit tests
(`geometry.test.ts`) and VRT stories for each case first, then the canvas
change.

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

## Task <N> - exploring diagrams in embed mode

When browsing system diagrams in Embed mode (/modeling/embed/), it's not
possible to navigate defined system views, as it is possible in the explore/
view. Please make it possible to navigate back and forth through linked views.

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

---

## Task <N> — Replace the Justfile with Nix-managed scripts

Replace `Justfile` recipes with scripts defined in `flake.nix` and put them on
the devshell `PATH`, so they run as `lint-rust`, `lint-commit`, etc.

- Decide the script language: bash (`pkgs.writeShellApplication`) or nushell
  (`pkgs.writers.writeNuBin`). Confirm the chosen writer exists in the pinned
  nixpkgs before committing to it.
- Start with `lint-rust`, `lint-frontend`, and `lint-commit`. Add them to
  `devShells.default` `packages`, and keep the devshell env vars (`LLVM_COV`,
  `PLAYWRIGHT_BROWSERS_PATH`, `RHIZZ_VRT_FONTCONFIG_FILE`) working inside them.
- Port the remaining recipes (`format`, `test`, `build`, `coverage`, `wasm`,
  `web-build`, `book`, `vrt`, `serve`, `changelog`, `bump`), with a script
  `cd`ing to the repo root via `git rev-parse --show-toplevel`.
- Point CI at the scripts: `nix develop --command <script>` in
  `.github/workflows/*.yml`, including `commitizen.yml`'s `commit-check` and
  `changelog` calls.
- Remove `Justfile` and update `AGENTS.md` and docs that mention `just`.
- Remove the stub `builder.sh` package from the devshell in `flake.nix`.

Definition of done:

- `lint` runs `lint-rust`, `lint-frontend`, and `lint-commit` and passes.
- Every former `just` recipe has a devshell equivalent.
- CI passes with no `just` invocations left in `.github/`.

---


## Task <NUMBER> — Task template

- Task description here
- Requirements, spec, acceptance criteria as bullet points
- Keep on increasing the task ID when creating new tasks
- Don't remove this template, move it to the bottom instead
