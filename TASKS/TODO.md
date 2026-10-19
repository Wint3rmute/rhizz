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

## Task <N> — 0002.1: Schema for `protocol.leaf`, `protocol.encapsulates`, `connection.realized_by`

Add the new attributes through parse, model and serialization, plus the
documentation for every new diagnostic code. No validation yet.

- **Parse** (`parse.rs`): `ProtocolAttrs` gets `leaf` (bool, default `false`) and
  `encapsulates` (list of strings). `ConnectionAttrs` / `RawConnection` get
  `realized_by` (list of strings, default empty). Unknown attributes must still
  fail with E000.
- **Model** (`model.rs`): `Protocol` stores `leaf` and its `encapsulates`
  labels (resolved ids come in 0002.2). `Connection` gets a `realized_by` field
  for the raw entries (resolved ids come in 0002.3). Keep it distinct from the
  existing `Connection.encapsulates`.
- **Serialize** (`serialize.rs`): emit `leaf = true` only when true, and
  non-empty `encapsulates` / `realized_by` only. Sort the entries. Canonical
  output of files without the new syntax must not change.
- **Diagnostic docs:** create `SPEC/diagnostics/E017.md` – `E020.md` and
  `W019.md` – `W022.md` with the levels from the proposal, an example and a fix
  each. Put "(not yet implemented)" in their titles, as `W009.md` does; the task
  that implements a code removes the marker. Add W019–W022 to
  `SPEC/warning-levels.md` with the same marker. Fix the stale `E001`–`E016`
  and `W001`–`W016` ranges in `SPEC/architecture.md`.
- **Spec:** add the attributes to the `protocol` table (`SPEC.md` §2.5) and the
  `connection` table (§2.7), and say there that `realized_by` is a different
  attribute from `connection.encapsulates`. Add the reference syntax from the
  proposal to §3. Update the `Protocol` / `Connection` bullets in
  `SPEC/models.md`.
- **Tests (red first):**
  - parsing of each attribute and rejection of unknown ones;
  - serializer round trips with and without the attributes;
  - extend the generator in `crates/rhizz-core/tests/proptest_serialization.rs`
    to cover them;
  - `test_examples_idempotent_roundtrip` still passes untouched.

Definition of done: the attributes round-trip through parse and serialize,
`just test`, `just lint`, `just build` pass, and no existing diagnostics or
canonical outputs change.

---

## Task <N> — 0002.2: Protocol checks (`W022`, `E020`)

Depends on 0002.1.

- **Resolve** (`resolve.rs`, next to the protocol loop): resolve each
  `protocol.encapsulates` label to a `ProtocolId`, stored on `Protocol`.
  An undefined label emits `W022` and is dropped. A protocol listing itself, or any
  cycle in the `encapsulates` graph, emits `E020`. Report each cycle once, with
  the labels on it in the message.
- **Docs:** remove the "(not yet implemented)" markers from `W022.md`,
  `E020.md` and their `warning-levels.md` row. Update the resolution-pass list
  in `SPEC/models.md`.
- **Tests (red first):** `W022` for an undefined label, `E020` for a direct
  self-reference, a 2-protocol cycle and a longer cycle, and a diamond-shaped
  graph (no cycle) that must stay clean. Assert exact codes.

Definition of done: as above, with `just test`, `just lint`, `just build`.

---

## Task <N> — 0002.3: Resolve `realized_by` (`E017`, `E018`, `E019`)

Depends on 0002.1. Can run in parallel with 0002.2.

- **Resolution:** after all connections in all scopes are registered, resolve
  each `realized_by` entry to a `ConnectionId` using the "Reference syntax"
  section of the proposal. The last segment is the connection label. The
  preceding segments are resolved like the component part of an endpoint path
  (`resolve_endpoint`): reuse its scope traversal (`.`, `..`, leading system
  label) rather than writing a second walker. Restrictions:
  - the target must be in the same system or definition tree, otherwise `E017`;
  - an unresolvable entry emits `E017` naming the entry and the scope searched,
    and is dropped;
  - duplicates collapse to one.
- **Cycles:** after resolving every scope, run one global cycle check over the
  resolved `realized_by` graph. Do not copy `has_encapsulation_cycle`: it only
  starts from the connection being resolved, which is not enough for
  cross-scope references. Report each cycle once with `E018`, and clear the
  edges on the cycle so later passes terminate. Self-references are cycles.
- **`E019`:** a connection whose derived protocol (see below) has `leaf = true`
  and which declares `realized_by` emits `E019`.
- **Connection protocol helper:** add one function in `rhizz-core` that returns
  the connection's protocol (`Option<ProtocolId>`) per the proposal: both
  endpoints name a port, both ports declare the same non-empty protocol, and it
  resolves to a top-level protocol. It will be reused by 0002.4 and 0002.5.
  Do not change the existing W007/W008 behavior to use it.
- **Mutations** (`mutation.rs`): deleting a connection
  (`delete_connection_by_label`) or an instance (which drops the connections
  that use it) must also remove `realized_by` entries that point at the removed
  connections. Otherwise the re-resolve emits `E017` and the user's delete is
  refused. Find which entries to remove from the resolved model, not by string
  matching, since entries can be relative paths. This is the same latent trap as
  for connection `encapsulates`; fix it for both if it is cheap, and say what
  you did.
- **Tests (red first):**
  - one for each reference form in the proposal's table (bare, child instance,
    `..`, `./`, absolute, absolute through an instance);
  - `E017` for a missing label, a path through a missing instance and a
    reference into another system;
  - `E018` for a self reference, 2-cycle, and a cross-scope cycle;
  - `E019`;
  - copies of a definition's connections resolve independently per instance;
  - deleting the target of a `realized_by` through the mutation API succeeds and
    leaves no dangling entry;
  - while here, add the missing tests for `E003` and `E004`.
- **Docs:** remove the "(not yet implemented)" markers for `E017`, `E018`, `E019`.
  Update `SPEC/models.md` (resolution steps, reference scopes).

Definition of done: `just test`, `just lint`, `just build` pass and no example
changes behavior.

---

## Task <N> — 0002.4: Compatibility and hierarchy warnings (`W021`, `W020`)

Depends on 0002.3 (needs resolved `realized_by` and the connection protocol
helper). These checks only run on connections that declare `realized_by`, so no
existing example changes.

- **`W021`** (`validate.rs`): for every pair (parent `A`, realizing `B`) where
  both connections have a defined protocol (`P`, `Q`), `Q.encapsulates` must
  contain `P`. If either protocol is undefined, skip the check; `W019` in 0002.5
  reports that case.
- **`W020`:** for each realizing connection, its `from` component must be the
  parent's `from` component or a descendant of it, and the same for `to`. Use
  component containment (parent links), not `level`. Check every pair along the
  chain. Keep the direction as the proposal states it: a reversed realizing
  connection is reported.
- **Docs:** remove the "(not yet implemented)" markers for `W020`, `W021`.
  Add the validation rules to `SPEC.md` §4.
- **Tests (red first):** each warning with exact codes, and the clean case (the
  proposal's banking chain with all `encapsulates` declared must produce neither
  warning). Include a component-descendant endpoint that must pass `W020`, and a
  sibling endpoint that must fail. Add tests for each warning-level gate in
  `lib.rs` (the existing mixed-warnings test shows the pattern).

Definition of done: `just test`, `just lint`, `just build` pass.

---

## Task <N> — 0002.5: Completeness warning `W019` and migration

Depends on 0002.4. This task changes behavior of existing projects, so it goes
last.

- **`W019`** (`validate.rs`): implement the `complete(c)` definition from the
  proposal, section 3, with memoization over the resolved `realized_by` graph
  (it is acyclic after 0002.3). Put the computation in a public function in
  `rhizz-core` that returns, per connection, `Complete` or `Incomplete` with
  the first blocking connection (`Option<ConnectionId>`), and emit `W019` from
  that result. The web connection inspector (see "Rhizz Web Application
  protocols" below) reads the same result, so it must not be reimplemented in
  TypeScript. Emit it on every incomplete connection. The
  message names the first incomplete connection in the chain when there is one.
  A connection with an undefined protocol (bare endpoint, untyped port,
  mismatch, undefined protocol) is always incomplete. Level is `architectural`.
- **Expected fallout, do not weaken `W019` to avoid it.** Every connection in
  the examples and book fixtures will now get `W019` unless its protocol has
  `leaf = true` or it is realized. Fix the fallout:
  - Set `leaf = true` on the terminal protocols in `examples/` (about 40
    protocols across six examples). Judge each: transport protocols are leaves,
    business-level protocols are not and must get a realization or stay
    flagged. Do not mark a protocol `leaf` just to silence the warning.
    `examples/web-app` is a good place to show `encapsulates`
    (`https`/`jwt`/`websocket`) and one `realized_by` chain.
  - `crates/rhizz-cli/src/cli.rs` `COMPONENT_ONLY` strict-mode tests
    (around `:948-1004`): the bare `i -> j` connection now yields `W019` at
    `architectural`. Update the fixture, not the rule, and list the change in
    your report.
  - `web/src/routes/book-example/BookExampleView.stories.ts` ("1 warning"
    assertion near `:181`) and its VRT baseline screenshots.
  - `book/book.lock`: review each changed entry, then regenerate with
    `just book-accept`.
  - Drone/social-media/software-house `--strict` expectations in
    `rhizz-cli/tests/integration_test.rs` and the watch-mode warning count.
- **Docs:** remove the last "(not yet implemented)" marker (`W019`). Describe the
  completeness rule in `SPEC.md` §4. Do not change scoring (§5). Add the `leaf`,
  `encapsulates` and `realized_by` semantics to the book (`07_protocols.md` is a
  stub, `03_connections_ports.md` covers connections). Set the proposal's status
  to `implemented` and update `book/src/proposals/README.md`, as the proposal
  process requires, and bump the spec version in `SPEC.md`.
- **Tests (red first):** each rule in the proposal's list (leaf, non-leaf
  without `realized_by`, untyped, freeform, complete chain, one incomplete branch
  among several, `W019` on parent and on the incomplete child), plus a warning-level gating test.

Definition of done: `just test`, `just lint`, `just build` pass; the report
lists every fixture, example and baseline that changed and why.

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

## Task <N> — W.1: Connection read model and `update_connection` op

Depends on 0002.5. Rust, WASM and TypeScript plumbing for the connection
inspector. No UI.

- **WASM getters** (`crates/rhizz-wasm/src/lib.rs`): extend `ConnectionJS` with
  what the inspector reads: `full_name`, `tags`, `level`, the endpoint ports
  (`from_port`, `to_port` as optional port labels or indices), the derived
  protocol (`Option` of the protocol label, using the helper from 0002.3),
  the `realized_by` targets (as references the UI can display and re-send, see
  `ConnectionRef` below), and the completeness result from 0002.5 (state plus
  the first blocking connection). Extend `ProtocolJS` with `leaf` and
  `encapsulates`. The commented-out fields in `ConnectionJS` are a convention for
  "not used yet": only add getters that W.2 uses.
- **Scope and identity.** Add a stable way to address one connection from TS:
  `ConnectionRef = { scopePath: string; label: string }`. `scopePath` follows the
  existing `add_connection` / `delete_connection` convention. Document how it is
  built for a connection declared in a system, in an instance, and in a
  top-level definition.
- **Op** (`mutation.rs`): `update_connection { scopePath, label, patch }`.
  `patch` fields: `full_name`, `tags`, `level`, and `realized_by` as a **full
  replacement** list of `ConnectionRef`, like `ports` in `update_component`.
  Rust turns each `ConnectionRef` into the canonical `realized_by` entry (bare
  label for same-scope, otherwise the path form the serializer writes), so the
  UI never builds path strings. Unknown patch fields are rejected
  (`deny_unknown_fields`), as for `update_system`. If the connection lives in a
  reusable definition, the edit applies to the definition and so to all its
  copies; say so in the op's doc comment.
- **Refusals.** A patch that makes the model produce an error (`E017`, `E018`,
  `E019`) is refused through the existing re-resolve in `mutate_to_hcl`. Warnings
  are not refusals.
- **Mirrors:** `LoggedAction::UpdateConnection`, `ModelAction`,
  `toMutationOp`, `ModelMutationOp` in `applyMutation.ts`, a `ConnectionPatch`
  type, and the sync test. Extend `RawModelPayload` / `modelView.ts` with typed
  connection and protocol data, and add small pure helpers (for example
  "connection data by ref", "protocol usage count") with Vitest tests.
- **Tests (red first):** Rust unit tests for the op (each patch field, a refusal
  for a `realized_by` cycle, definition-copy semantics, no change to canonical
  output for an empty patch), wasm test for the new getters on the banking chain
  from the proposal, and the `actionLog` replay test.

Definition of done: `just test`, `just lint`, `just build` pass. `just build`
must succeed, because it also builds the WASM package.

---

## Task <N> — W.2: Connection inspector with protocol-bound and connection-bound panels

Depends on W.1.

Extract the inline connection inspector from `ModelingPage.svelte` into
`modeling/ConnectionInspector.svelte` (typed props and callbacks, like
`NodeInspector`), and add the realization information. Keep the per-view side
pickers and the delete flow working exactly as today.

**Panel layout.** Three panels in this order, separated by `divider`s, each with
a heading that has a tooltip naming where its fields are written, the same
markup as `NodeInspector`'s panel headings:

1. **Protocol** (`data-testid="protocol-attributes"`). Everything that belongs
   to the protocol and so is shared by every port and connection using it.
   Tooltip: "Defined by protocol `<label>` in system.hcl — shared by every
   connection and port that uses it". Content: protocol label (with a `leaf`
   badge), full name, `roles`, `encapsulates` list, and a count of other
   connections and ports using it. Read-only in this task. A secondary-text
   "Edit protocol" link is added by W.4, once the Inventory can show a protocol.
   When the derived protocol is undefined, show why in the panel (bare endpoint,
   untyped port, mismatch, undefined protocol) instead of empty fields.
2. **Connection** (`data-testid="connection-attributes"`). Everything that
   belongs to this connection declaration. Tooltip: "Written to system.hcl —
   applies to this connection only" (when the connection lives in a reusable
   component: "...and to its copies in every instance"). Content:
   - label, From and To (read-only; show component and port);
   - full name, tags, level (editable, via `update_connection`);
   - **Realization:** the completeness badge (complete, or incomplete with the
     blocking connection named, taken from the W.1 completeness result), the
     "Realized by" list, and an "Add realization" select. Each list row shows
     the target's label, scope, protocol and completeness badge, a button that
     selects that connection in the canvas when it is placed in the open view
     (disabled with a tooltip when it is not), and a remove button. The select
     lists every other connection, with no compatibility filtering (that is a
     later feature); invalid choices simply surface the compiler's warnings.
3. **This view** (`data-testid="view-attributes"`). Only the Start/End side
   pickers, as today. Tooltip names `views/<view>.hcl`, like `NodeInspector`.

Edits run through `runModelLayoutTransaction`, so Ctrl+Z restores them. A refused
edit shows the existing "Change refused" toast. The "Delete connection" button
stays below the panels.

- **Tests (red first):**
  - Storybook `ConnectionInspector.stories.ts`: `Default`, `Realized` (a chain,
    complete), `Incomplete` (names the blocker), `UndefinedProtocol` and
    `AttributeScopes`, mirroring `NodeInspector`'s `AttributeScopes` (asserts the
    panel split and the tooltips). Accept the VRT baselines.
  - Playwright `connection-inspector-scopes.spec.ts`, modeled on
    `inspector-attribute-scopes.spec.ts`: a full-name edit lands in `system.hcl`
    only, a side change lands in `views/<view>.hcl` only, the Protocol panel
    has no editable control, and no edit leaks into the other file.
  - Playwright `connection-realization.spec.ts`: add a realization, see the
    badge flip to complete, remove it, undo with Ctrl+Z, and a refused cycle
    shows the toast and writes nothing.

Definition of done: `just test`, `just lint`, `just build` pass, and the old
inline block is gone from `ModelingPage.svelte`.

---

## Task <N> — W.3: Protocol ops (`add_protocol`, `update_protocol`, `delete_protocol`)

Depends on 0002.2. Rust, WASM and TypeScript plumbing for the Inventory
protocol editor. No UI.

- **Ops** (`mutation.rs`):
  - `add_protocol { label, options? }` with `full_name`, `tags`, `roles`,
    `leaf`, `encapsulates`. A blank label, a label containing `/`, or an
    existing protocol label is refused like `add_component_definition`.
  - `update_protocol { path, patch }` where `path` is the protocol label. Patch
    fields: `full_name`, `tags`, `roles`, `leaf`, `encapsulates` (full
    replacement). Unknown fields are rejected. The label cannot be changed here.
  - `delete_protocol { path }`. It does not rewrite references: ports that name
    the protocol keep the string and get `W014`, and protocols that list it in
    `encapsulates` get `W022`. Messages go with the protocol.
- **Refusals.** An edit that introduces an error is refused through the existing
  re-resolve. The important one is `E020` (an `encapsulates` cycle), and
  `E009` when changing `roles` leaves a port with a role the protocol no longer
  allows.
- **Mirrors:** `LoggedAction` variants, `ModelAction`, `toMutationOp`,
  `ModelMutationOp`, a `ProtocolPatch` type, and the sync test.
- **Read side:** type `protocols` (label, full name, tags, roles, `leaf`,
  `encapsulates`, message labels) in `RawModelPayload`, and add a helper that
  returns, for a protocol, the ports using it (component key and port label),
  the protocols that list it in `encapsulates`, and the connections whose
  derived protocol it is. Pure functions with Vitest tests.
- **Tests (red first):** Rust unit tests for each op including each refusal and
  the unchanged canonical output when nothing changes, the sync test, and the
  helper tests. Assert exact diagnostic codes.

Definition of done: `just test`, `just lint`, `just build` pass.

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
    `encapsulates`, and connections it types.
  - **Delete:** the same type-the-label confirmation as components. It is not
    blocked by usage, because dangling references are warnings in the language,
    but the pane lists them first and says they will become `W014` / `W022`.
- **Deep link.** `/projects/<id>/inventory/<label>` already means a component
  or a system, and labels of different kinds can collide, so a protocol must not
  reuse that form. Use a form that cannot collide (for example a `?tab=protocols`
  query or a reserved route segment), mirror the open protocol in the URL like
  the other tabs do, and document the choice in the report.
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
    delete with the type-the-label confirmation; the deep link survives reload.
  - Storybook `InventoryPage` stories: `ProtocolsTab` (list), `ProtocolDetail`
    (overview, with the usage tab), and the create modal. Accept the VRT
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

