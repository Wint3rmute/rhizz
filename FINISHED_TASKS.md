# Finished Tasks

Completed tasks are listed here, most recent first.

---

## Task 23 — Update drone example to use `source`

Now that all the infrastructure is in place (Tasks 20–22), update the drone
example to demonstrate the feature end-to-end.

**Spec reference:** SPEC.md §2.3.

### Acceptance criteria

- In `examples/drone/systems.hcl`, replace the inline `flight-controller`
  component (approx 120 lines of ports, children, connections) with:
  ```hcl
  component "flight-controller" {
    source = "flight-controller"
  }
  ```
- `examples/drone/components/flight-controller.hcl` already exists as a
  top-level `component "flight-controller" { … }` with the full body. Verify
  it matches the removed inline definition (same ports, children, connections).
- `examples/drone/README.md` is updated to mention the `source` feature and
  list the `components/flight-controller.hcl` file.
- All integration tests that compile the drone example pass — the resolved
  model must be identical (same components, ports, connections, messages,
  scores, views) to the previous inline version.
- `cargo test --all`, `cargo clippy --all-targets --all-features -- -D warnings`,
  `cargo doc`, `cargo build`, `cargo fmt` all pass.

---

## Task 22 — Add `source` attribute and resolve component references

Add the `source` attribute to `RawComponent` and implement resolution: when a
component inside a system (or parent component) has `source = "some-label"`,
the resolver looks up the top-level component with that label, validates
exclusivity, detects cycles, and clones the body into the sourced component
slot.

**Spec reference:** SPEC.md §2.3 (source rules), SPEC/models.md (source
resolution during resolution pass).

**Important:** do NOT modify any existing example `.hcl` files in this task.
Write unit tests that exercise `source` with inline HCL strings. The drone
example update is Task 23.

### Acceptance criteria

- `RawComponent` gains `source: Option<String>`.
- `ComponentAttrs` serde helper gains `source: Option<String>`.
- `parse_component` reads the `source` attribute from HCL.
- New `DiagnosticCode` variants: `E012`, `E013`, `E014` are defined and emitted:
  - E012: component with `source` has other attributes or child blocks.
  - E013: circular `source` chain detected.
  - E014: `source` references an undefined top-level component.
- During resolution, before walking a system's component tree, the resolver
  builds a `HashMap<String, RawComponent>` from `RawFile.components`.
  Duplicate top-level component labels → E001.
- When a component has `source`:
  1. Check exclusivity (E012).
  2. Look up the label in the top-level component map (E014 if missing).
  3. Check the ancestor set for cycles (E013).
  4. Clone the top-level component's body (description, tags, level, leaf,
     ports, children, connections) into the sourced slot. The label at the
     usage site is kept.
  5. Recurse into the cloned children for nested `source` references.
- Unit tests (all using inline HCL strings — no example file changes):
  - Component with `source` pointing to a valid top-level component → body
    cloned correctly, resolved model is identical to inline definition.
  - Component with `source` + inline `description` → E012.
  - Component with `source` pointing to undefined label → E014.
  - Circular `source` (A sources B, B sources A) → E013.
  - Nested `source` (A sources B, B has child that sources C) → works.
  - Same top-level component sourced into two different systems → works.
- All existing tests continue to pass.
- `cargo test --all`, `cargo clippy --all-targets --all-features -- -D warnings`,
  `cargo doc`, `cargo build`, `cargo fmt` all pass.

---

## Task 21 — Recursive file discovery

The CLI's `load_sources` and the test helper `parse_dir` currently scan only
`max_depth(1)`. Change them to recursively discover all `.hcl` files in the
project directory tree so that files in subdirectories are parsed and merged
like any other file.

**Spec reference:** SPEC.md §1 (project structure).

**Why this is safe now:** Task 20 already taught the parser to accept
top-level `component` blocks. After this task, the drone example's
`components/flight-controller.hcl` will be discovered and parsed, but since it
only adds entries to `RawFile.components` (which the resolver currently
ignores), no tests break.

**Important:** do NOT modify any example `.hcl` files in this task. Existing
tests should pass as-is.

### Acceptance criteria

- `load_sources` in `rhizz-cli/src/cli.rs` uses `WalkDir::new(dir)` without
  `max_depth(1)` — all `.hcl` files at any depth are collected and returned.
- `parse_dir` test helper in `rhizz-core/src/parse.rs` is updated the same way.
- `rhizz-gui` file discovery is updated the same way.
- All existing tests and examples pass unchanged.
- `cargo test --all`, `cargo clippy --all-targets --all-features -- -D warnings`,
  `cargo doc`, `cargo build`, `cargo fmt` all pass.

---

## Task 20 — Parse top-level `component` blocks

- Added `components: Vec<Labeled<RawComponent>>` field to `RawFile`.
- `parse_file` now handles `"component"` as a top-level block identifier.
- `merge_into` concatenates `components` vecs from all files.
- Unit tests: top-level component parses, mixed blocks parse, merge across files.

---

## Task 19 — Replace custom RenderBackend with SVG rasterization in rhizz-gui

**Note:** this task has been cancelled, rendering quality & performance were unsatisfactory. No code changes were made.

The current `EguiBackend` (`RenderBackend` impl, ~300 lines) re-implements primitive
drawing on top of `layout-rs` internals. Replace it with `layout-rs`'s built-in SVG
output rasterized by `resvg` + `tiny-skia`, displayed as an `egui::ColorImage` texture.


## Task 18 — Spec v0.3: Migrate rhizz-cli and rhizz-gui frontends

### rhizz-cli

- Update `ScoreReport` display: show `Ports` and `Connections` rows instead of `Interfaces`
- Update JSON output `score` object: replace `"interfaces"` with `"ports"` and `"connections"` keys
- Update human-readable diagnostic examples if any are hardcoded
- Update CLI tests (16 tests)

### rhizz-gui

- Sidebar tree: replace interface listing with connections listing; optionally show ports under each component
- Any references to `model.interfaces` → `model.connections`
- Update GUI tests (5 tests)

Run: `cargo test --all`, `cargo clippy --all-targets --all-features -- -D warnings`, `cargo doc`, `cargo build`, `cargo fmt`

---

## Task 17 — Spec v0.3: Migrate rhizz-mermaid renderer

Same changes as Task 16 but for Mermaid output.

- Replace `InterfaceId`/`Interface`/`Direction` references with `ConnectionId`/`Connection`
- Infer arrow style from port roles: `-->` (unidirectional), `<-->` (bidirectional), `-.->` (unknown/ambiguous)
- Messages from connected ports when rendering edge labels
- Update all Mermaid rendering tests (14 tests)

Run: `cargo test -p rhizz-mermaid`, `cargo clippy -p rhizz-mermaid -- -D warnings`, `cargo fmt`

---

## Task 16 — Spec v0.3: Migrate rhizz-dot renderer

Update DOT rendering to use `Connection` + `Port` instead of `Interface`.

- Replace all `InterfaceId`/`Interface` references with `ConnectionId`/`Connection`
- Infer edge direction from port roles on `ConnectionEndpoint`:
  - `provider` → `consumer`: directed arrow
  - `consumer` → `provider`: reversed arrow
  - `peer` ↔ `peer`: undirected line (`dir=none`)
  - Either side untyped or roles ambiguous: dashed line
- When `show_messages = true`, collect messages from the connected port(s) (both endpoints if both are typed)
- Edge `ltail`/`lhead` logic uses `ConnectionEndpoint.component` (unchanged concept, new type)
- Update all DOT rendering tests (14 tests)

Run: `cargo test -p rhizz-dot`, `cargo clippy -p rhizz-dot -- -D warnings`, `cargo fmt`

---

## Task 15 — Spec v0.3: Migrate rhizz-core + examples to ports & connections

This is the core migration from spec v0.2 (interface-centric) to spec v0.3 (port + connection model). After this task, `cargo test -p rhizz-core` must pass. Downstream crates (rhizz-dot, rhizz-mermaid, rhizz-cli, rhizz-gui) will have compile errors until their migration tasks are completed.

### model.rs changes

**Add new types:**
- `PortId(usize)`, `ConnectionId(usize)` newtypes
- `PortRole` enum: `Provider`, `Consumer`, `Peer`
- `Port` struct: `label`, `description`, `protocol`, `role: PortRole`, `tags`, `owner: ComponentId`, `messages: Vec<MessageId>`
- `ConnectionEndpoint` struct: `component: ComponentId`, `port: Option<PortId>`
- `Connection` struct: `label`, `description`, `tags`, `level`, `from: ConnectionEndpoint`, `to: ConnectionEndpoint`, `encapsulates: Vec<ConnectionId>`
- `RawPort` struct: `description`, `protocol`, `role`, `tags`, `messages: Vec<Labeled<RawMessage>>`
- `RawConnection` struct: `description`, `tags`, `level`, `from`, `to`, `encapsulates`

**Remove:** `Interface`, `InterfaceId`, `Direction`, `RawInterface`

**Update:**
- `Component`: `interfaces: Vec<InterfaceId>` → `connections: Vec<ConnectionId>`, add `ports: Vec<PortId>`
- `System`: `interfaces: Vec<InterfaceId>` → `connections: Vec<ConnectionId>`
- `Model`: `interfaces: Vec<Interface>` → `connections: Vec<Connection>`, add `ports: Vec<Port>`
- `RawSystem`: `interfaces` → `connections: Vec<Labeled<RawConnection>>`
- `RawComponent`: `interfaces` → `connections`, add `ports: Vec<Labeled<RawPort>>`
- `lib.rs`: update public exports

### parse.rs changes

- Parse `port "label" { protocol, role, tags, message... }` inside `component` blocks
- Parse `connection "label" { from, to, tags, level, encapsulates }` instead of `interface`; no `direction`, `leaf`, or `message` children
- Messages are parsed inside `port`, not `connection`
- Update all parse unit tests

### examples/ changes

Rewrite all three example projects (drone, social-media, software-house) `.hcl` files:
- `interface` blocks → `connection` blocks (remove `direction`, `leaf`; move messages out)
- Add `port` blocks on components with `protocol`, `role`, and relocated `message`/`field` blocks
- Use `comp:port` syntax in `connection` `from`/`to` where appropriate
- Keep some bare `from`/`to` references to exercise W007 (gradual specification)

### resolve.rs changes

- Parse `from`/`to` strings: split on `:` to get `(comp_label, port_label)` or treat as bare component label
- Build `ScopeIndex.ports: HashMap<(ComponentId, String), PortId>` during component registration
- Update `ScopeIndex.interfaces` → `ScopeIndex.connections`
- Resolve `ConnectionEndpoint` with optional `PortId`
- Error code changes:
  - E005: leaf component with child components **or connections** (was "or interfaces")
  - Remove E006 (leaf interface with messages) — no longer applicable
  - Remove E008 (invalid direction) — no longer applicable
  - Renumber: E007→E006 (undefined system in view), E009→E007 (field missing type), E010→E008 (duplicate project)
  - Add E009 (invalid `port.role`), E010 (`comp:port` port not found), E011 (`comp:port` component not found)
- Update all resolution tests

### validate.rs changes

- Remove W002 (non-leaf interface with no messages)
- Renumber: W003→W002 (message no fields), W004→W003 (orphan component — check connections now), W005→W004 (missing description), W006→W005 (from==to same component), W007→W006 (level decreases)
- Add W007 (one side typed, other not), W008 (protocol mismatch between connected ports), W009 (incompatible port roles), W010 (unused port), W011 (port has no messages)
- Update all validation tests

### score.rs changes

- Remove interface scoring
- Add port scoring: complete (≥1 message, all complete), partial, incomplete (no messages)
- Add connection scoring: complete (both sides typed, matching protocol), partial (one side typed), incomplete (both untyped)
- `ScoreReport`: add `ports` and `connections` categories, remove `interfaces`
- Leaf component with description and no ports → still Complete (1.0)
- Update all scoring tests

Run: `cargo test -p rhizz-core`, `cargo clippy -p rhizz-core -- -D warnings`, `cargo fmt`

---

## Task 14 — File watcher + live recompile

Register a `notify` watcher on the project directory. Recompile and refresh all panels on any `.hcl` change.

- Use the same `notify` + `mpsc` + debounce pattern as `rhizz-cli`'s `watch` command (200 ms debounce).
- Keep the last successfully resolved `Model` in memory. If the new compile has hard errors, show the new diagnostics but continue rendering the previous valid model everywhere else.
- A small status bar at the bottom shows either "OK" or "X errors, Y warnings" after each recompile.
- `cargo build`, `cargo clippy`, `cargo fmt` must all pass.

---

## Task 13 — Startup load + diagnostic pane

On launch, read all `.hcl` files from the project directory argument, call `rhizz_core::compile`, and display results in the window.

- A scrollable bottom pane lists every diagnostic (`code`, `file`, `line`, `message`); errors in red, warnings in yellow.
- A left sidebar lists every system, component, and interface by name (flat list is fine).
- No watcher yet — compile once at startup and display the static result.
- `cargo build`, `cargo clippy`, `cargo fmt` must all pass.

---

## Task 12 — Scaffold `rhizz-gui` crate

Add `crates/rhizz-gui` to the Cargo workspace as a new binary crate.

- Add `rhizz-gui` to the `members` list in the root `Cargo.toml`.
- Create `crates/rhizz-gui/Cargo.toml` with dependencies: `eframe`, `egui`, `rhizz-core`, `rhizz-dot`, `notify`, `walkdir`, `anyhow`.
- `src/main.rs` accepts a single positional CLI argument — a path to a project directory — and opens a blank `eframe` window titled "rhizz" with the path shown in the title bar.
- No model logic yet; the window just needs to open without panicking.
- `cargo build`, `cargo clippy`, `cargo fmt` must all pass.

---

## Task 11 — `watch` command for rhizz-cli

Add a `rhizz watch <path>` command to `rhizz-cli` that behaves identically to `rhizz build` but reruns the full build pipeline automatically whenever any `.hcl` file in the project directory changes.

### Acceptance Criteria

- `rhizz watch <path>` performs the same pipeline as `rhizz build` (parse → validate → score → views) on startup, then sits in a loop waiting for file-system events.
- On any create, modify, or delete event for a `.hcl` file under `<path>`, the pipeline is rerun from scratch and the output is reprinted.
- Use the [`notify`](https://crates.io/crates/notify) crate (cross-platform; wraps `inotify` on Linux, `FSEvents` on macOS, `ReadDirectoryChangesW` on Windows) — **not** the `inotify` crate directly, so the feature works on macOS and Windows too.
- A short debounce period (e.g. 200 ms) prevents re-running the pipeline multiple times for a single logical save that produces several rapid events.
- The command can be interrupted cleanly with Ctrl-C (SIGINT); on exit it prints a short "Stopped watching." message and exits with code 0.
- All existing flags (`--strict`, `--json`, `--output-dir`, `--no-color`) are forwarded to the inner build pipeline exactly as they are for `rhizz build`.
- The `notify` dependency must be added only to `rhizz-cli/Cargo.toml`, not to `rhizz-core` or `rhizz-dot`.

### Implementation Notes

- Add `Watch` variant to the existing `Command` enum in `cli.rs`, with the same arguments as `Build`.
- Extract (or reuse) the existing `run_build` helper so both `build` and `watch` call it.
- The watch loop should live in a new function `run_watch` in `cli.rs` (or a new `watch.rs` module if you prefer).
- Use `notify::recommended_watcher` with a `std::sync::mpsc` channel; filter received events to `.hcl` extension before triggering a rebuild.
- Print a clear "Watching <path> for changes…" banner before the initial build so the user knows the watcher is active.

### Tests

- Integration test: spawn `rhizz watch` against one of the `examples/` directories, modify an `.hcl` file, and assert that the command prints the build output a second time.  Use a timeout to avoid hanging CI.
- Unit test: verify the debounce logic does not trigger multiple rebuilds for events arriving within the debounce window.

---

## Task 10 — Migrate CLI into `rhizz-cli`

Move `cli.rs` and the `main.rs` entry point into `crates/rhizz-cli/src/`.
Add `rhizz-core` and `rhizz-dot` as path dependencies.
The CLI crate must contain no parsing, validation, scoring, or DOT-rendering logic of its own — all calls delegate to the two library crates.
Move integration tests (examples: drone, social-media, software-house) to `crates/rhizz-cli/tests/`.
Verify that the `rhizz` binary behaviour is identical to before.

Then:

Delete the old `src/` directory at the repo root once all code has migrated.
Run `cargo test --all`, `cargo clippy --all-targets --all-features -- -D warnings`, `cargo doc --all`, and `cargo build --all`.
Fix any warnings or errors surfaced.
Run `cargo fmt --all`.

---

## Task 9 — Establish `rhizz-dot`

Move `dot.rs` into `crates/rhizz-dot/src/`.
Expose `fn render_view(model: &Model, view: &View) -> String`.
Add `rhizz-core` as a path dependency.
No I/O. All pre-existing tests travel with the module.

---

## Task 8 — Establish `rhizz-core`

Move `model.rs`, `parse.rs`, `resolve.rs`, `validate.rs`, and `score.rs` from `src/` into `crates/rhizz-core/src/`.
Expose a clean public API:
- `Source { filename: String, content: String }`
- `CompileResult { model: Option<Model>, diagnostics: Vec<Diagnostic> }`
- `fn compile(sources: &[Source]) -> CompileResult`
- `fn score(model: &Model) -> ScoreReport`

All public types must derive `Clone`, `serde::Serialize`, and `serde::Deserialize`.
The crate must have **no** `std::fs`, `std::env`, or any I/O dependency.
All pre-existing unit tests travel with their modules; they must pass under the new crate.

---

## Task 7 — Convert root to a Cargo workspace

Replace the root `Cargo.toml` `[package]` section with a `[workspace]` manifest that lists `crates/rhizz-core`, `crates/rhizz-dot`, and `crates/rhizz-cli` as members.
Create the three `crates/` subdirectories, each with a skeleton `Cargo.toml` and empty `src/lib.rs` (or `src/main.rs` for the CLI).
Verify that `cargo build` succeeds on the empty workspace.

---

## Task 6 — CLI

- Implement `clap` arg parser as specified in `SPEC/cli.md`: `check`, `score`, `views`, `build` subcommands; default to `build`
- Implement human-readable diagnostic output: `✗ E002  file.hcl:14  message` / `⚠ W001 ...`
- Implement `--json` output mode with the schema from `SPEC/cli.md`
- Implement `--strict` (warnings → errors), `--no-color`, `NO_COLOR` env var, non-TTY detection
- Wire exit codes: `0` on success, `1` on errors (or warnings under `--strict`)
- **Test:** run `rhizz build` on each example, assert exit code and stdout content

---

## Task 5 — Graphviz DOT Generation

- Implement `render_view(model: &Model, view: &View) -> String`
- Apply filter predicates: tag inclusion/exclusion, `max_level`, component whitelist, `show_messages`
- Emit `subgraph cluster_*` for non-leaf components, box nodes for leaf components
- Emit directed/undirected edges for interfaces; include message names in edge labels when `show_messages = true`
- Write rendered `.dot` files to `--output-dir`
- **Test:** render all views in each example; assert output contains expected node/edge identifiers

---

## Task 4 — Completion Scoring

- Implement `score(model: &Model) -> ScoreReport` with the per-entity 0.0/0.5/1.0 logic from SPEC.md §5
- Produce per-category counts (components/interfaces/messages) and overall aggregate
- Implement `ScoreReport` display formatting matching the spec output format
- **Test:** assert score values for each example match hand-calculated expectations

---

## Task 3 — Validation and Warnings

- Implement a warning pass over the resolved `Model`, emitting W001–W007 as non-blocking `Diagnostic` values
- Implement `Diagnostic` type with fields: `code`, `file`, `line` (optional), `message`
- **Test:** assert that each example emits exactly the expected warning codes and none of the examples produce unexpected errors

---

## Task 2 — Resolution

- Define resolved model types and newtyped ID structs (`ComponentId`, `InterfaceId`, etc.) and the full `Model` arena as described in `SPEC/models.md`
- Implement `resolve(raw: RawFile) -> Result<(Model, Vec<Diagnostic>), Vec<Diagnostic>>`:
  - Walk raw tree depth-first, allocate IDs, populate arenas
  - Build `ScopeIndex` mapping `(Scope, label) → id` for components and interfaces
  - Resolve `from`/`to` and `encapsulates` references via scope lookup
  - Apply all defaults (`level` auto-increment, `leaf = false`, empty strings)
  - Emit errors E001–E010 as `Diagnostic` values; return `Err` if any errors present
- **Test:** resolve drone + social-media + software-house examples; assert resolved IDs, relationships, and that deliberate W001/W002/W005 triggers are present

---

## Task 1 — Foundation

- Add dependencies to `Cargo.toml`: `hcl-rs`, `clap` (derive feature), `owo-colors`, `walkdir`, `anyhow`
- Set up module structure: `parse`, `model`, `resolve`, `validate`, `score`, `dot`, `cli`
- Define raw model types: `RawFile`, `Labeled<T>`, `RawProject`, `RawSystem`, `RawComponent`, `RawInterface`, `RawMessage`, `RawField` — all optional fields, no logic
- Implement `parse_file(src: &str) -> Result<RawFile>` by walking `hcl::Body`, handling recursive component/interface nesting
- Implement file discovery: glob all `.hcl` files in a directory, parse each, merge into one `RawFile`; detect E010 (multiple `project` blocks) during merge
- **Test:** parse all three example projects without error and assert field values on at least one
