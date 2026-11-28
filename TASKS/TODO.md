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

## Task — Examples declare their own name and description

The name and description of every example project are hard-coded twice:

- `crates/rhizome-core/build.rs` (`generate_example_projects`) has a `match`
  on the directory name that supplies `ExampleProject::name` and
  `ExampleProject::description` for the web app's example picker. A new
  example falls through to `"Example architecture project"`.
- `examples/README.md` keeps its own table of the same examples (domain and
  what each one shows).

Make each example the single source of truth for its own metadata, and derive
both from it:

1. Decide where an example declares it. The language already has a `project`
   block (`Project` in `crates/rhizome-core/src/model.rs`: name, version,
   authors). Either extend it with a `description`, or use a small
   example-only file. Prefer the `project` block if it fits the SPEC, since
   it also helps real projects.
2. `build.rs` reads the name and description from each example instead of the
   `match`. A missing declaration should fail the build, not fall back.
3. Generate the README table (or replace it with a pointer to the picker /
   each example's declaration), with a check in CI that fails on drift, like
   `assets-check`.
4. Update SPEC (`project` block attributes) if the language changes.

**Done when:** adding a directory under `examples/` with its declaration is
enough for it to show up correctly in the picker, the README and the example
build test (`crates/rhizome-cli/tests/integration_test.rs`), with no other
hand edits.

---

## Task — Rename a connection from the Modeling editor

A connection's name (its HCL label, `connection "<label>" { … }`) can only be
chosen once, in the New-connection modal. The Connection Inspector shows it as
a read-only heading, `ConnectionPatch` (Rust `crates/rhizome-core/src/mutation.rs`
and TS `web/src/actionLog.ts`) has no `label` field, and there is no rename op.
The only way to change it today is to delete and recreate the connection, which
loses its `full_name`/`tags`/`level` and breaks every `realized_by` that points
to it. Users want to rename a connection the way they can rename a component
(`rename_component`).

### What a connection's name is referenced by

The rename has to keep all of these consistent, or the model breaks or the view
quietly loses state:

1. **The declaration**: the label of the block in the declaring scope's
   `connections` (a system or a component definition).
2. **`realized_by` entries** on other connections, written as paths from
   *their* declaring scope (`"sub"`, `"outer/sub"`, `"../x"`, … — see
   SPEC/models.md step 7 and `realized_by_entries`). A stale entry is E017.
3. **Views** (`views/*.hcl`): per-view `connection "<label>" { hidden = …,
   layout … }` blocks keyed by name (`savedConnections` in `ModelingPage.svelte`,
   `connectionVisibility.ts`). A stale key does not error, but the connection
   silently loses its hidden state and layout.

### Implementation

1. **Core op** `ModelOp::RenameConnection { scope_path, label, new_label }`
   (`"kind": "rename_connection"`, camelCase like `update_connection`) plus a
   matching `LoggedAction::RenameConnection`, in `mutation.rs`:
   - Address and redirect it like `update_connection`: an instance path goes
     to the definition the connection is declared in, so every copy is renamed.
   - Refuse with `MutationError::InvalidInput`/E000 when `new_label` is empty
     or contains `/`. Stay idle (as other ops do on a guard miss) when the
     scope or label is unknown or `new_label == label`. Refuse a collision.
     Since views key connections by name, use the same uniqueness rule as the
     New-connection modal (`takenConnectionLabels` in `newConnection.ts`, which
     checks every label in the model), not only the declaring scope.
   - Rewrite every `realized_by` entry in every scope that *resolves* to the
     renamed connection. Resolve before the rename (to a `ConnectionId`) and
     compare ids rather than matching text, because the same connection is
     spelled differently from different scopes. Rewrite only the last path
     segment and keep the rest of the spelling.
   - A refusal leaves the model untouched (one atomic op).
2. **Views.** Re-key `connection "<old>"` blocks to `<new>` in **every** view
   file, not only the open one: a view that is not open would otherwise lose
   the hidden state. Decide where this lives. The preferred option is a core
   helper that the web layer and the MCP tool both call on each `views/*.hcl`.
   Note that `handleRenameSelectedComponent` only re-keys the *open* view's
   layout. If that turns out to be a gap for components too, file a follow-up
   task rather than widening this one.
3. **WASM / web plumbing**: add `rename_connection` to `ModelMutationOp`
   (`web/src/history/applyMutation.ts`), `ModelAction` + its replay mapping in
   `web/src/actionLog.ts` (so "Copy Debug Info" dumps replay it), and the WASM
   wrapper.
4. **UI** (`ConnectionInspector.svelte`): make the name heading editable. Use an
   input committed on blur/Enter, like the Full name field, with Escape to
   cancel. Disable it when `readonly`. Show the modal's validation messages
   inline (empty, `/`, already exists) and reuse `validateNewConnection`'s
   rules rather than copying them. `ModelingPage.svelte` runs it through
   `runModelLayoutTransaction` (one undo step) and, in the layout callback,
   moves `savedConnections[old]` → `[new]` and keeps the connection selected
   under its new name. Delegation edges can be renamed too.
5. **MCP**: add a `rename_connection` tool in `crates/rhizome-server/src/mcp.rs`
   next to `update_connection` (same lock and refusal behavior as
   `rename_component`), and map it in the op→tool-name table.
6. **SPEC**: document the op (SPEC.md mutation/ops section, `SPEC/frontend.md`
   for the inspector, `SPEC/models.md` if `realized_by` rewriting needs a note).

### Tests

- Rust unit tests in `mutation.rs`:
  - a rename in a system;
  - a rename in a definition, reached through an instance path;
  - `realized_by` rewritten from the same scope, a parent scope and a child
    scope;
  - the empty/`/`/collision refusals;
  - a no-op when the label is unchanged or unknown;
  - JSON round-trip of the op and the logged action;
  - the model still resolves with no new diagnostics after the rename.
- Views re-key test (core helper or vitest): hidden state and layout follow the
  rename in an open and a non-open view.
- `actionLog.test.ts` / `applyMutation.test.ts`: the op is recorded and replays.
- MCP: the tool is listed and is refused when a human holds the lock, like
  `rename_component`.
- e2e (new interaction): rename from the inspector → HCL label, `realized_by`
  and view block updated, the edge stays drawn and selected, a hidden connection
  stays hidden, a collision shows an inline error and writes nothing, and
  Ctrl+Z restores the old name everywhere.
- Storybook: add a `ConnectionInspector` story only if the editable heading
  looks different from an existing story (e.g. the inline error state).

**Done when:** a connection can be renamed from the Connection Inspector (and
over MCP). After the rename, the model compiles with no new diagnostics, every
`realized_by` and view that referred to the old name uses the new one, and the
whole rename is one undo step.

---

## Task — Rename a port without breaking its connections

Renaming a port that a connection ends on is refused. One example, from a
homelab model: renaming `router`'s port `link-thinkcentre` to `eth` fails with

```
Change refused: connection ethernet: component router has no port link-thinkcentre (in 'to')
```

The cause is that the port name field in `NodeInspector.svelte`
(`handleUpdatePort`) does no rename. It sends the component's whole port list
back with the edited label, as `update_component` with `ports` (`apply_patch`
in `crates/rhizome-core/src/mutation.rs`). The core replaces the list but leaves
every endpoint spelled `…/router/link-thinkcentre` alone. The re-resolve then
fails and the whole op is refused. A port can only be renamed today while no
connection uses it, or by editing the HCL by hand. `rename_component` doesn't
have this problem because it rewrites endpoints
(`rewrite_connections_for_rename`, `rewrite_ancestor_connections_for_rename`).
Ports need the same treatment.

### What a port's label is referenced by

Ports are declared on component **definitions**, so one rename reaches every
instance of the definition:

1. **The declaration**: `port "<label>"` in the definition.
2. **Connection endpoints**, in every scope where an instance of the
   definition is wired: systems and other definitions. Spellings include
   relative (`inst/port`, `outer/inst/port`), `./`-prefixed, absolute
   (`/sys/inst/port`) and `..`-relative ones.
3. **Delegation endpoints in the definition itself**: `./<label>` self
   endpoints (SPEC/models.md step 6/6b).
4. **Views** (`views/*.hcl`): `node "<key>" { port "<label>" { side, visible } }`
   blocks for every placed instance of the definition (`PortLayout` in
   `serialize.rs`, `DiagramLayout.visiblePorts` / `portVisibility.ts`). A stale
   key doesn't error, but the port silently loses its side and its
   shown-when-unconnected flag.

### Implementation

1. **Core op** `ModelOp::RenamePort { component, label, new_label }`
   (`"kind": "rename_port"`) plus a matching `LoggedAction::RenamePort`, in
   `mutation.rs`:
   - `component` is a definition label, or an instance path that redirects to
     its definition, the same as `update_component`.
   - Refuse with E000 when `new_label` is empty or contains `/`, or when the
     definition already has a port with that label. Stay idle when the
     component or port is unknown or `new_label == label`.
   - Rewrite every endpoint that **resolves** to this port. Resolve before the
     rename and compare the resolved `(component instance, port)` rather than
     matching text, because the same port is spelled differently from different
     scopes and two definitions can have ports with the same name. Replace only
     the last segment and keep the rest of the spelling.
   - Keep all the port's other attributes. Keep the delegation-outer
     "omitted type" handling from `apply_patch` intact (a delegated outer must
     not gain an explicit protocol/role, or it becomes E022).
   - It's one atomic op: a refusal leaves the model untouched.
2. **Views**: re-key `port "<old>"` blocks under every node whose instance
   comes from the definition, in **every** view file and not only the open one.
   Share the view-rewriting helper with the "Rename a connection" task if that
   lands first, or design it here so that task can reuse it.
3. **Web**: in `NodeInspector.svelte`, the port name input sends `rename_port`
   (through `runModelLayoutTransaction`, one undo step) instead of a
   full-list `ports` patch. In the layout callback it moves the open view's
   `visiblePorts` entries. Validate inline (empty, `/`, duplicate) and treat an
   unchanged or empty value as no-op/revert. Wire the op into
   `ModelMutationOp` (`web/src/history/applyMutation.ts`), `ModelAction` and
   replay in `web/src/actionLog.ts` (so "Copy Debug Info" replays it), and the
   WASM wrapper.
4. **Full-list `ports` patches** (`update_component` from the inspector and
   MCP) keep their replace semantics. Make the refusal actionable, though: when
   a port that a connection uses disappears from the list, refuse with a
   message that names the connection and points to `rename_port`, not the
   bare resolver error.
5. **MCP**: add a `rename_port` tool in `crates/rhizome-server/src/mcp.rs`
   (same lock and refusal behavior as `rename_component`), and map it in the
   op→tool-name table.
6. **SPEC**: document the op and the endpoint/view rewriting (SPEC.md ops
   section, `SPEC/frontend.md` for the inspector).

### Tests

- Rust unit tests in `mutation.rs`:
  - a rename with an endpoint in a system, using absolute and relative
    spellings;
  - an endpoint reached through a nested instance path from an ancestor system;
  - an endpoint inside another definition;
  - a `./port` delegation endpoint;
  - two definitions with the same port name, where only the targeted one
    changes;
  - the empty/`/`/duplicate refusals;
  - a no-op when the port is unknown or the label is unchanged;
  - JSON round-trip of the op and the logged action;
  - the model resolves with no new diagnostics.
  - Add the homelab case above as a regression test: rename `router`'s
    `link-thinkcentre` while `connection "ethernet"` ends on it.
- Views re-key test: side and `visible` follow the rename in an open and a
  non-open view, for every placed instance of the definition.
- `actionLog.test.ts` / `applyMutation.test.ts`: the op is recorded and replays.
- MCP: the tool is listed and is refused while a human holds the lock.
- e2e (new interaction): renaming a connected port from the Node Inspector
  updates the HCL port and endpoint, the edge stays drawn, a shown unconnected
  port stays shown, a duplicate name shows an inline error and writes nothing,
  and Ctrl+Z restores the old name everywhere.

**Done when:** a port that connections end on can be renamed from the Node
Inspector (and over MCP). After the rename, the model compiles with no new
diagnostics, every endpoint and view that named the old port uses the new one,
and the whole rename is one undo step.
