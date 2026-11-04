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


## Task <N> — Follower auto-reload on remote version change

Watchers poll the project version but never act on it: a follower tab sits
on a stale snapshot until it writes (409) or reloads by hand. Implement the
reload half of 0004's "watchers reload when the version changes".

- **Reload rule (per page, no cross-page coordinator):** each of Code,
  Modeling, and Inventory keeps a local `appliedVersion` (starts null =
  seed on mount and on project switch, never reload) and an `$effect` on
  `(projectLock.version, projectLock.pollSeq)`: reload iff version is known,
  differs from applied, the holder is someone else (`lockedBy !== me` — a
  holder only ever sees their own writes, so followers never self-trigger),
  and the page is not busy. Advance the tracked version only when actually
  reloading; busy skips retry automatically on the next poll because the
  version still differs.
- **Poll counter:** `projectLock` bumps a monotonic `pollSeq` after every
  completed poll so effects re-run even when the version is unchanged
  (otherwise a busy skip would never be retried).
- **Busy means:** an open non-blocking modal (Inventory/Modeling create
  modals, Modeling connection/delete modals), an active canvas gesture
  (`interaction.type !== "idle"`), or a running auto-layout. Native
  `confirm()`/`prompt()` block the thread, so no guard is needed for them.
  No draft-preservation UI: dropping ≤700 ms of typing is accepted.
- **Reload = invalidate the store first, or it re-reads the cache:**
  add `VfsProjectStore.invalidate()` (clears `cached`, bumps an epoch so an
  in-flight read cannot repopulate it) to the `ProjectStore` interface, then
  per page: Code (`projectModel.reload()` + `refreshEntries()` + re-read the
  open file, resetting `content`/`lastWrittenContent`; missing file after
  reload clears the selection), Modeling (`projectModel.reload()` +
  `refreshDiagramEntries()` + re-read the current view's layout through the
  existing load path + `resetUndoHistory()`, since stored undo steps name
  the pre-remote model), Inventory (`projectModel.reload()` + re-read the
  open doc).
- **Cancel, don't flush, pending debounced writes on reload** (add
  `cancel()` to `createDebounced`): Code's `scheduleFileWrite`, Modeling's
  `scheduleLayoutWrite`, Inventory's `DetailPane.scheduleDocSave`
  (DetailPane watches the version itself and drops to view mode — it owns
  that debouncer; the parent cannot reach it). Flushing would persist text
  composed against the old revision on top of the remote edit and silently
  destroy it; canceling loses at most one debounce window.
- **Deleted project:** project layout watches for version-known → 404 and
  then toasts "This project was deleted" and navigates to `/projects`.
  (Reads and writes already 404/409 through the normal paths.)
- **No holder tracking beyond `lockedBy === me`:** same-user tabs share one
  holder by design (see 0004.5), so a second tab acts as one more follower
  of the first — no per-tab identity is introduced here.
- **Out of scope:** draft preservation or merge UI (dropped, per directive);
  push channels (still polling); presence ("who's watching"); reacting to
  outside-git edits while holding the lock (holder skips reload, same as
  today — 0004 leaves those uncovered).
- **Tests:** vitest for the decision helper (`seed / changed / busy /
  holder / unknown`), `createDebounced.cancel()`, `invalidate()` (second
  writer visible only after invalidate), DetailPane drop-to-view on version
  change; `just vrt-quick` unchanged (no UI changes); manual two-browser
  checklist below is the real gate since e2e runs the localStorage backend.
- **Manual verification** (two browsers, different usernames): edit in A →
  B reloads silently within ~5 s with badge intact (a holder never
  self-reloads); drag in B while A edits (no yank, reload lands after);
  type continuously in B while A edits (B's in-progress keystrokes are
  dropped on reload, no toast, A's edit survives); delete in A → B toasts
  and lands on /projects; background B's tab past the lease (A can take the
  lock, B re-syncs on foreground with no errors).
- **Docs:** one paragraph in `SPEC/frontend.md` under the collaboration
  text. No 0004 proposal change (it already describes this behavior).

Definition of done:

- `just test`, `just lint`, `just build` pass; `just vrt-quick` unchanged
  (334); manual two-browser checklist above verified.

---

## Task <NUMBER> — Task template

- Task description here
- Requirements, spec, acceptance criteria as bullet points
- Keep on increasing the task ID when creating new tasks
- Don't remove this template, move it to the bottom instead
