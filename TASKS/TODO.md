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

## Task <N> — W.4: Protocols tab in the Inventory

Depends on W.2 and W.3. The "Interfaces" tab in the Inventory selector is a
placeholder with no entities behind it. Replace it with "Protocols", where the
project's protocols can be added, edited and removed.

- **Tab.** Rename `InventoryTab.Interfaces` to `Protocols` (`inventory.ts`) and
  update the label, the hidden "Only with defined views" checkbox, and the
  placeholder text in `Inventory.svelte`. Remove every mention of interfaces as
  a placeholder (including the doc comments in `inventory.ts`).
  `filterDefinitions` keeps returning only components, and protocols get their
  own filter function, as systems do. Protocols are listed from
  `projectModel.raw`, searched by label and full name, sorted by label.
- **List.** Protocol cards in the `DefinitionCard` style: label, full name, a
  `leaf` badge, and the number of ports using it (a `badge badge-ghost`).
- **Add.** The "+ New" button (`inventory-add-entity`) opens a
  `CreateProtocolModal`, built like `CreateSystemModal`: label (required, no
  `/`, unique across protocols), optional full name, and a `leaf` checkbox. It
  applies `add_protocol` and selects the new protocol.
- **Detail pane.** A `ProtocolDetailPane.svelte` next to `DetailPane.svelte`,
  with the same tab styling. Tabs:
  - **Overview** (editable): full name, tags, roles, `leaf`, and
    `encapsulates` (a multi-select of the other protocols, with the
    "what this protocol can carry" wording from the proposal in the label).
    Edits apply `update_protocol`; a refusal (`E020`, `E009`) shows the
    "Change refused" toast. Unlike the rest of the page, which fails silently, a
    refusal must always be visible.
  - **Messages** (read-only): messages and their fields. Editing messages is a
    follow-up.
  - **Usage** (read-only): ports using the protocol (each linking to the
    component's page in the Inventory), protocols that list it in
    `encapsulates` (each linking to that protocol), and connections it types.
  - **Delete:** the same logic as component definitions. The delete button is
    disabled while the protocol is used, and a blockers box
    (`data-testid="inventory-delete-blockers"`, the same `border-warning/40
    bg-warning/10` styling as `DetailPane`) lists every usage the user has to
    remove first: ports using the protocol (linking to the component) and
    protocols that list it in `encapsulates`. Once nothing uses it, the
    type-the-label confirmation enables the delete, as for components. Compute
    the blockers with the W.3 usage helper.
- **Deep link.** `/projects/<id>/inventory/<label>` already means a component
  or a system, and labels of different kinds can collide, so a protocol must not
  reuse that form. Use query parameters instead:
  `/projects/<id>/inventory?tab=protocols` opens the Protocols tab, and
  `/projects/<id>/inventory?tab=protocols&protocol=<label>` also opens that
  protocol. Mirror the open protocol in the URL like the other tabs do, keep the
  tab and selection across reload, and ignore an unknown `protocol` label
  without an error. Add a small helper that builds this URL, so the inspector
  link and the Usage tab use the same one.
- **Connection inspector link.** Add the "Edit protocol" link to the Protocol
  panel of the W.2 inspector, pointing at the deep link above. The panel stays
  read-only.
- **Tests (red first):**
  - Update the e2e specs that encode the old placeholder:
    `inventory-systems.spec.ts` ("Interfaces has nothing to add: no button
    there") and `inventory-view-filter.spec.ts` (the Interfaces assertions at
    `:95-153`) and `inventory.test.ts` (`:154`). The checkbox still hides on the
    Protocols tab, and "+ New" is now present there.
  - Playwright `inventory-protocols.spec.ts`: add a protocol and see it in
    `system.hcl`; edit full name, `leaf` and `encapsulates` and see each in the
    file; an `encapsulates` cycle shows the refusal toast and writes nothing;
    deleting a used protocol is blocked (the button is disabled, the blockers
    box names the port and the protocol that use it); after removing those
    usages, the type-the-label confirmation deletes it; the deep link
    (`?tab=protocols&protocol=<label>`) survives reload.
  - Storybook `InventoryPage` stories: `ProtocolsTab` (list), `ProtocolDetail`
    (overview, with the usage tab), `ProtocolDeleteBlocked`, and the create
    modal. Accept the VRT
    baselines. The fixture already has `protocol "power"`; extend it only as
    needed.

Definition of done: `just test`, `just lint`, `just build` pass, and a search
for "Interfaces" in `web/` finds no placeholder references.

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
