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


## Task <N> — 0004.2 Per-project writes + server enforcement

Replaces whole-VFS `PUT /api/vfs` with per-project writes so one client can no longer overwrite or delete another's projects. Depends on 0004.1.

- New write path: `PUT /api/projects/:id/files { user, baseVersion?, files }` via `storage::write_project` + `write_atomic`; non-holder writes rejected, file untouched (same refusal contract as `mutate_project`/`DOC_EDIT_LOCK`).
- Wrap `mutate_project` (all 16 `ModelOp` tools) with `acquire_or_check`: free → auto-acquire on first edit; held by other → refuse.
- `GET /api/vfs` stays for bootstrap/list; `PUT /api/vfs` returns 410. Update `SPEC/cli.md` + bundled frontend together.
- Rust tests: holder writes + persists, non-holder refused byte-identical, stale `baseVersion` refused, missing project on disk not deleted by another project's write.

Definition of done:

- `just test`, `just lint`, `just build` pass.
- No whole-blob overwrite path remains.

---

## Task <N> — 0004.3 Web identity + lock polling + read-only UI

Web half of 0004. Depends on 0004.1-0004.2.

- Identity: `web/src/collab/identity.ts` via `safeStorage`, key `rhizz-username`, `getOrCreateUsername()` + rename UI. Follow `lastView.ts`/`tourRequest` idioms, never raw `localStorage`.
- State: `ProjectLock.svelte.ts` context in `routes/projects/[id]/+layout.svelte` (`{ version, lockedBy, isMine, readonly }`), polls `GET state` every ~3-5s only when `ServerProjectStore` is active (local/memory backends stay always-mine).
- Write gate: single choke point in `vfs/vfsStore.ts::mutate()` — attach `{ user, baseVersion }`, map 409/423 → discard drafts + `projectModel.reload()` + toast ("lock lost"). Auto-acquire at `planModelMutation`/transaction `do()`, not at debounced flush. Add `store.invalidate()` for poll-triggered reload (today cache only drops on write failure).
- Read-only: thread `readonly` into `MonacoEditor`, `ModelingPage.runModelLayoutTransaction` early-return (push nothing on refusal), `Inventory` modals, `FileTree` ops. `DiagramViewer`/`Explore` already write-free. Clear undo stack on lock loss.
- UI: lock badge (lock icon + holder on click) in `Navbar.svelte` desktop/mobile + `ProjectStatusBar`/`DiagnosticsStatusBar` next to score. Project-list icons deferred (open question in 0004).
- Tests: vitest for lock context/gate mapping + Playwright two-tab (tab A edits, tab B refused + follows version, idle release lets B in). VRT for lock badge.

Definition of done:

- `just test`, `just lint`, `just build` pass; `just vrt-accept` for new badge baselines.

---

## Task <N> — 0004.4 MCP `AI` holder + lock/version on reads

MCP half of 0004. Depends on 0004.1-0004.2.

- In `mcp.rs::call_tool` (or `run_mutation`/`overwrite_model`/`create_doc`/`edit_documentation` wrappers) hardcode `user = "AI"`: free → auto-acquire as `AI` (each tool call = activity, resets idle); held by human → tool error naming holder, file untouched; held by `AI` → proceed with existing `DOC_EDIT_LOCK`/`MODEL_WRITE_LOCK` as inner CAS mutex.
- Expose lock/version on reads: `list_files` (+`check_project`, `fetch_projects` entries) return `version + lockedBy/lockExpiresAt?` so an AI loop (`read -> check -> mutate`) sees staleness without extra calls.
- Update 0003 proposal notes + every tool description that says "0004 is not implemented".
- Tests through `/mcp` RPC: `AI` acquires free project, refused while human holds (byte-identical), expiry/idle frees for `AI`, read tools echo `version+lock`.

Definition of done:

- `cargo test -p rhizz-server`, `just lint-rust`, `just format` pass.

---

## Task <N> — 0004.5 Lock/poll timing tune + hardening

Final pass over 0004.1-0004.4. Mark [0004](book/src/proposals/0004-locking-and-collab.md) implemented.

- Tune lease length, heartbeat interval, poll interval, 60s idle (proposal leaves timings to implementation). Document chosen values in proposal + `SPEC/frontend.md`/`SPEC/architecture.md`.
- Harden: same-user two-tab self-lockout decision (`user#tabId` vs shared holder), heartbeat stops on `pagehide`, poll backoff on failure, `pagehide` best-effort heartbeat-stop/release.
- Flip proposal status draft → implemented, close open questions (project-list icons yes/no).
- Full validation: `just test`, `just lint`, `just build`, relevant e2e re-run.

Definition of done:

- Timings documented, proposal status flipped, full suite green.

---

## Task <NUMBER> — Task template

- Task description here
- Requirements, spec, acceptance criteria as bullet points
- Keep on increasing the task ID when creating new tasks
- Don't remove this template, move it to the bottom instead
