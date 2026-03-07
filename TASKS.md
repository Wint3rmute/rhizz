# Implementation Tasks

How to work on this file:

- Read the next task
- Implement it, use red/green TDD
- Run tests & linters (`cargo test`, `cargo clippy`, `cargo doc`, `cargo build`) until it's all working
- Once all linters/builds/tests pass, run `cargo fmt`
- Delete the task from the file once done, report that you're finished

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

## Task 17 — Spec v0.3: Migrate rhizz-mermaid renderer

Same changes as Task 16 but for Mermaid output.

- Replace `InterfaceId`/`Interface`/`Direction` references with `ConnectionId`/`Connection`
- Infer arrow style from port roles: `-->` (unidirectional), `<-->` (bidirectional), `-.->` (unknown/ambiguous)
- Messages from connected ports when rendering edge labels
- Update all Mermaid rendering tests (14 tests)

Run: `cargo test -p rhizz-mermaid`, `cargo clippy -p rhizz-mermaid -- -D warnings`, `cargo fmt`

---

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

## Task 19 — Task template

- When a tab is selected, call `rhizz_dot::render_view` to get the DOT string, then pass it to the `layout` crate to compute node positions.
- Draw nodes and edges with `egui::Painter` inside a `ScrollArea` (pan via scroll, no zoom required for the prototype).
- Leaf components → solid-border box; non-leaf components → dashed-border cluster rectangle containing their children; unidirectional interface → arrow; bidirectional → plain line.
- `cargo build`, `cargo clippy`, `cargo fmt` must all pass.
