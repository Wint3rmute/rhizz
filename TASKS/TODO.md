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

## Task <N> — Remove `connection.encapsulates`

`connection.encapsulates` (sibling connection labels) is superseded by
`connection.realized_by` plus `protocol.encapsulates` (proposal 0002). Nothing
in the W019–W021 realization checks uses it. `SPEC.md` has already been updated
(§2.7, §3, §9); bring the rest of the repository in line with it.

- Remove the attribute from the core model, parsing, serialization and mutation
  ops, together with the `E003` and `E004` checks that only exist for it.
  Remove `SPEC/diagnostics/E003.md` and `E004.md`. Do not reuse the codes.
- Anything that reads or writes the attribute must stop doing so: web app (TS
  types, UI, e2e tests, stories), WASM/JSON contracts, `SPEC/*.md`, `book/`,
  and `examples/`. Find the uses by searching; do not assume the list is
  complete.
- Breaking change: unknown attributes are rejected (`E000`), so any `.hcl` that
  still sets it will fail to compile. Migrate every in-repo `.hcl` file. Decide
  whether a clearer error message for this specific attribute is worth adding,
  and if so keep it small.
- Update the "Naming trap" note in the 0002 shared context below, which
  currently says `Connection.encapsulates` "keeps its behavior".
- Do not change `protocol.encapsulates`, `realized_by`, or scoring.
- Acceptance criteria:
  - `grep -ri encapsulates` hits only protocol-level uses (plus the changelog
    and `FINISHED.md` history).
  - `just test`, `just lint`, and `just build` pass.
  - A `.hcl` file that sets `encapsulates` on a connection fails with a
    diagnostic, covered by a test that asserts the exact code.

## Task <N> — "New connection" dialog: create a connection together with its ports

Today dragging an arrow between two components dispatches a bare
`add_connection` (port-less). Replace that with a dialog that creates the
connection **and one new port on each end** in a single step. The goal is fast
defaults (press Enter and you are done) with an optional, gradual path to typing
the connection (protocol, roles).

**Context from a quick look at the code** (verify, do not trust blindly):

- Core has `ModelOp::AddConnection { scope_path, label, from, to }` and
  `AddProtocol` in `crates/rhizz-core/src/mutation.rs`. There is **no
  add-port op**: ports are carried as `PortJson` inside `create_component` /
  `update_component` (full-list replacement).
- Ports live on component **definitions**. Adding a port through an instance
  changes the definition, so every instance of it gets the port. This is
  accepted for the MVP; no extra UI is needed for it.
- `ApplyOutcome.actions` is a list, so one op can emit several logged actions.
  The web side maps ops and actions in `web/src/actionLog.ts`
  (`ModelAction` ↔ `toMutationOp`) and `web/src/history/applyMutation.ts`, and
  the Rust↔TS JSON shapes are pinned by `op_json_contract_matches_typescript_shapes`.
- I did not locate the current arrow-drag handler in the web app. Find it and
  replace its direct `add_connection` dispatch with the dialog.

**Dialog behavior:**

1. The user drags an arrow from component `A` to component `B`. The dialog
   opens. Esc cancels and creates nothing (no connection, no ports).
   Enter confirms with whatever is filled in.
2. **Connection name** is the auto-focused field, prefilled `a-to-b` (made
   unique in the connection's scope with a numeric suffix).
3. **Preview:** a simple side-by-side diagram of the two components joined by a
   line, with the new port pins and their names, updating live as the user
   types. For nested endpoints, show the component path (breadcrumb style) so
   it is clear which instances are wired.
4. **Protocol:** a searchable combobox, empty by default (empty is allowed).
   Order: protocols used in this system, then recently used, then the rest. The
   last row is "Create protocol 'xyz'…", which creates a stub protocol
   (existing `add_protocol`, non-leaf, no messages) inside the same combined
   step.
5. **Two columns, one per end.** Each column describes the new port on that
   component:
   - **Name:** prefilled `link-<other>` (`link-b` on `A`, `link-a` on `B`),
     using the other component's label. Names are neutral on purpose, because
     direction comes from roles. Make it unique within the component with a
     numeric suffix. The prefill is **not** updated afterwards (not even when
     the protocol changes or the other component is renamed).
   - **Role:** with a protocol selected, a dropdown of that protocol's
     `roles`, with a "No roles defined" fallback. With no protocol, a free-text
     input (gradual specification: a role without a protocol is allowed, but
     produces a warning). Default is unset. Check how `PortJson` treats a
     missing role ("defaults to `peer`") and make sure an unset role stays
     unset.
6. **Advanced** (collapsed): `external` and `required` per port.
   - `required` defaults to `true` (the spec default).
   - `external` is derived per end: `false` when that component is a direct
     child of the scope that holds the connection (siblings), `true` when the
     connection crosses out of a nested component's boundary. Confirm this
     reading against §2.6/§4 "Locality" in `SPEC.md` and document it in
     `SPEC/frontend.md`.
7. Creating the connection writes `from`/`to` as `<component path>/<port>`
   endpoints, placed in the lowest common ancestor like today.

**Core / history:**

- Add **one** op (for example `connect_components`) that adds both ports, the
  connection and, if requested, the stub protocol atomically. A refusal (name
  collision, bad label, unknown component) leaves the model untouched, like the
  other ops. Emit the individual `LoggedAction`s so "Copy Debug Info" replays
  correctly.
- It must be **one undo step**: undo removes the connection, both ports and the
  stub protocol together; redo restores them.
- Update the Rust↔TS contract test, `actionLog.ts`, and `applyMutation.ts`.

**Out of scope:**

- Choosing an existing port on either end (every connection creates two new
  ports; a port has exactly one connection in this app version).
- Auto-updating prefilled fields after the user edits something.
- A "skip the dialog" quick mode: the dialog always opens.
- Existing port-less connections: do not migrate them and do not add UI for
  them. Their deprecation is a separate, later task. This dialog assumes every
  connection it creates has ports.
- Exposing boundary ports on parents for connections across hierarchy levels.

**Tests (per `AGENTS.md`):**

- Rust unit tests for the new op: happy path, attributes written (`external`,
  `required`, role, protocol), name collisions, refusal leaves the model
  untouched, stub protocol creation. Assert exact diagnostic codes where
  relevant.
- Vitest for `actionLog` / `applyMutation` mapping and the combined undo step.
- Playwright e2e for the interaction (drag opens the dialog; Enter creates with
  defaults; Esc creates nothing; with a protocol, the role dropdown shows its
  roles; undo removes everything in one step).
- A Storybook story for the dialog's look, only if no existing story covers it.

**Acceptance criteria:**

- Dragging between two components and pressing Enter yields a connection plus
  two new ports named `link-<other>`, with `external` derived as above and
  `required` left at its default.
- A typed connection (protocol and roles chosen in the dialog) compiles without
  new errors, and an undo reverts all of it in one step.
- `just test`, `just lint`, and `just build` pass.

---

# Proposal 0002 (Protocol Modeling) — implementation tasks

Source of truth: `book/src/proposals/0002-protocol-modeling.md` (read it fully
first, including the "Reference syntax" and "Diagnostics" sections). Tasks
0002.1 – 0002.5 below are meant to be delegated to separate coding agents.

**Shared context for every 0002 task:**

- **Order and branches.** 0002.1 goes first. 0002.2 and 0002.3 both start from
  0002.1 and can run in parallel (they touch different functions in
  `resolve.rs`; expect a trivial merge conflict). 0002.4 starts after 0002.3.
  0002.5 goes last. Branch each task from the previous task's branch (stacked
  PRs), or from `main` once the previous one is merged.
- **Diagnostic codes** (final, from the proposal): `E017` unresolved
  `realized_by`, `E018` `realized_by` cycle, `E019` leaf protocol with
  `realized_by`, `E020` `protocol.encapsulates` cycle, `W019` incomplete
  connection (architectural), `W020` hierarchy violation (architectural), `W021`
  `encapsulates` compatibility violation (architectural), `W022` undefined
  `protocol.encapsulates` label (business).
- **How codes work.** `crates/rhizz-core/build.rs` generates the code constants
  from `SPEC/diagnostics/*.md` (format: `SPEC/diagnostics.md`). A W file needs a
  `**Warning level:**` line right after the title, an E file must not have one.
  A new W code also needs a row in `SPEC/warning-levels.md`.
- **Naming trap.** `Connection.encapsulates` (a list of sibling connections)
  already exists and keeps its behavior. The new `protocol.encapsulates`
  (protocol labels) and `connection.realized_by` are separate fields. Do not
  merge or reuse the old code paths.
- **Already known facts** (verified by reading the code, not by running it):
  - A connection has no protocol field. It is derived from the endpoint ports
    in `validate.rs` (W008) and `score.rs`, from the free-form `Port.protocol`
    string.
  - The serializer omits default values and sorts lists (`serialize.rs`).
  - `E003`/`E004` have no tests at all.
- **Spec updates ship with the code.** Each task updates the matching parts of
  `SPEC.md` (§2.5, §2.7, §3, §4), `SPEC/models.md` and
  `SPEC/diagnostics/`, so the spec never lags behind the code.
- **Scoring is out of scope.** Do not touch `score.rs`, connection scoring, or
  `SPEC.md` §5.
- **Out of scope for all tasks:** web UI, WASM getters, mutation ops that edit
  protocols, view files. The WASM `Model` serializes through serde, so new
  `Model` fields will pass through without extra work. Do not add unused getters.

---

# Rhizz Web Application protocols

Web-side work for proposal 0002. Four tasks (W.1 – W.4). These depend on the
0002 tasks above and must not start before them.

**Shared context:**

- **Order.** W.1 and W.3 are Rust/WASM/TypeScript plumbing and can run in
  parallel (different ops, trivial merge conflicts in `mutation.rs`,
  `applyMutation.ts` and `actionLog.ts`). W.2 needs W.1. W.4 needs W.2 and W.3.
  W.1 needs 0002.5 (completeness and `realized_by`). W.3 needs 0002.2 (`E020`
  and `W022` make an invalid protocol edit refusable).
- **Current state** (verified by reading the code, not by running it):
  - The Modeling page selects connections by label only. Its connection
    inspector is an inline block in `ModelingPage.svelte` (`connection-inspector`
    test id, about `:3918-3969`). It shows From/To, the per-view
    start/end side pickers and a "Delete connection" button. No story or e2e
    test targets it.
  - `ConnectionJS` (wasm) exposes only `label`, `from`, `to`. `ProtocolJS`
    exposes `label`, `full_name`, `tags`, `roles`. `ModelJS.protocols()` is
    unused in `web/src`. Everything else is reachable today through
    `projectModel.raw` (`model.to_js()`), typed in `modelView.ts`
    (`RawModelPayload`).
  - No `ModelOp` edits a connection or touches a protocol.
    `update_component` redirects instance paths to the definition.
  - `delete_connection_by_label` is keyed by label only. Labels are unique per
    scope, not globally, so new connection ops address `scopePath` + `label`
    like `add_connection` does.
  - Every `ModelOp` has a mirror in `LoggedAction` (Rust), `ModelAction` and
    `toMutationOp` (the exhaustive switch in `web/src/actionLog.ts`). Without a
    mirror, "Copy Debug Info" cannot replay it. Add all three together, with the
    test that checks the TS and Rust action JSON stay in sync
    (`logged_actions_match_typescript_model_action_json` in `mutation.rs`).
- **Inspector scopes pattern.** `NodeInspector.svelte` already separates
  attributes by where they are written: a "Component" panel
  (`data-testid="component-attributes"`) with a heading tooltip
  ("Written to system.hcl — these travel with the component wherever it is
  used"), a `divider`, then a "This view" panel (`data-testid="view-attributes"`)
  for `views/<view>.hcl`. Its story `AttributeScopes` and e2e spec
  `inspector-attribute-scopes.spec.ts` assert the split and check that an edit
  never lands in the wrong file. The new inspector reuses that pattern and
  must not invent a new look.
- **Process rules from `AGENTS.md`.** Prefer DaisyUI components over Tailwind
  utilities. Interaction logic needs Playwright e2e tests, new visuals need a
  Storybook story (VRT) only if no existing story covers them. Accept new
  baselines with `just vrt-accept` and list them in the report. Use `just`, never
  `npm`/`cargo`/`npx` directly.
- **Out of scope for all four tasks:** the realization tree in the Connections
  sidebar, the rules-filtered realization picker (only offering compatible
  connections), the "Realize this connection..." creation flow, clickable
  diagnostics and quick fixes, the layered chain view, editing a connection's
  endpoints, renaming protocols, and message/field editing. Do not start them.

---

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
