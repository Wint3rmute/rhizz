# Core Data Models

## Overview

Two model layers:

1. **Raw (deserialization) models** — `serde::Deserialize` structs mirroring HCL
   structure. Used for parsing only.
2. **Resolved models** — validated, cross-referenced IR used by all downstream
   passes (validation, scoring, view generation).

Parsing pipeline: `.hcl` files (`system.hcl` + view files) → `hcl::from_str` → raw models → merge → resolve → resolved models.

---

## Raw Models

These map 1:1 to the HCL schema. All fields `Option` or defaulted. Block labels
become the key in a `BTreeMap` (or `Vec` of labeled items — see below).

HCL body blocks with labels (e.g. `component "foo" { ... }`) don't deserialize
directly into a `HashMap<String, T>` with the `hcl` crate. Use the `hcl::Body`
type and walk blocks manually, **or** use `hcl-rs`'s labeled block support via
`#[serde(rename = "component")]` on a wrapper. The pragmatic approach:
deserialize into `hcl::Body`, then extract blocks by type into typed structs
with a thin conversion layer.

```rust
/// Top-level file content — the result of parsing one .hcl file.
/// `RawFile`s from the system model file (`system.hcl`) and any view definition
/// files are merged into a unified raw representation before resolution.
#[derive(Debug, Default)]
struct RawFile {
    project: Option<RawProject>,
    systems: Vec<Labeled<RawSystem>>,
    components: Vec<Labeled<RawComponent>>,  // top-level (reusable) components
    protocols: Vec<Labeled<RawProtocol>>,    // top-level (reusable) protocols
    views: Vec<Labeled<RawView>>,
}

#[derive(Debug, Clone)]
struct Labeled<T> {
    label: String,
    inner: T,
}
```

### Block structs

```rust
#[derive(Debug, Clone, Deserialize)]
struct RawProject {
    name: Option<String>,
    version: Option<String>,
    authors: Option<Vec<String>>,
}

#[derive(Debug, Clone)]
struct RawSystem {
    description: Option<String>,
    tags: Option<Vec<String>>,
    level: Option<i32>,
    components: Vec<Labeled<RawComponent>>,
    connections: Vec<Labeled<RawConnection>>,
}

#[derive(Debug, Clone)]
struct RawComponent {
    source: Option<String>,          // label reference to a top-level component — mutually exclusive with all other fields
    description: Option<String>,
    tags: Option<Vec<String>>,
    level: Option<i32>,
    leaf: Option<bool>,
    ports: Vec<Labeled<RawPort>>,
    components: Vec<Labeled<RawComponent>>,  // recursive
    connections: Vec<Labeled<RawConnection>>,
}

/// A reusable protocol schema defined at the top level.
#[derive(Debug, Clone)]
struct RawProtocol {
    description: Option<String>,
    tags: Option<Vec<String>>,
    roles: Option<Vec<String>>,
    messages: Vec<Labeled<RawMessage>>,
}

/// A port declared on a component. Binds to a protocol and declares port-specific metadata.
#[derive(Debug, Clone)]
struct RawPort {
    description: Option<String>,
    protocol: Option<String>,
    role: Option<String>,   // "provider" | "consumer" | "peer"
    external: Option<bool>, // true if intended to interface outside this component
    required: Option<bool>, // true if mandatory when instantiated in a system
    tags: Option<Vec<String>>,
}

/// A connection wiring components/ports together.
/// `from` and `to` are UNIX-style path strings (e.g. `"comp"`, `"comp/port"`, `"../sibling/port"`, `"/system/comp/port"`).
#[derive(Debug, Clone)]
struct RawConnection {
    description: Option<String>,
    tags: Option<Vec<String>>,
    level: Option<i32>,
    from: String,
    to: String,
    encapsulates: Option<Vec<String>>,
}

#[derive(Debug, Clone)]
struct RawMessage {
    description: Option<String>,
    tags: Option<Vec<String>>,
    level: Option<i32>,
    fields: Vec<Labeled<RawField>>,
}

#[derive(Debug, Clone)]
struct RawField {
    r#type: String,           // required
    description: Option<String>,
    unit: Option<String>,
    required: Option<bool>,
}
```

### HCL deserialization strategy

`hcl::Body` is the entry point. Walk its blocks/attributes:

```rust
fn parse_file(src: &str) -> Result<RawFile> {
    let body: hcl::Body = hcl::from_str(src)?;
    let mut file = RawFile::default();
    for block in body.blocks() {
        match block.identifier() {
            "project"   => file.project = Some(parse_project(block)?),
            "system"    => file.systems.push(parse_labeled_system(block)?),
            "component" => file.components.push(parse_labeled_component(block)?),
            "view"      => file.views.push(parse_labeled_view(block)?),
            other       => return Err(/* unknown top-level block */),
        }
    }
    Ok(file)
}
```

Each `parse_*` function extracts attributes via `block.body().attributes()` and
recurses into child blocks. Wrap this in a trait or macro if the boilerplate
becomes excessive.

### Source resolution (during the resolution pass)

The `source` attribute on a component is a **label reference** to a top-level
component. It is resolved during the resolution pass (not during parsing), after
all files have been merged.

When the resolver encounters a component with `source`:

1. **Validate exclusivity** — if any other attribute (`description`, `tags`,
   `level`, `leaf`) or child block (`port`, `component`, `connection`) is
   present alongside `source`, emit E012.
2. **Look up the label** — find the top-level component with the matching label
   in `RawFile.components`. If not found, emit E014.
3. **Detect cycles** — maintain an ancestor set of source labels currently being
   expanded. If the label is already in the set, emit E013.
4. **Clone the body** — copy the top-level component's attributes and children
   into the sourced component slot. The label at the usage site replaces the
   top-level label.
5. **Recurse** — the cloned body may itself contain children with `source`,
   which are resolved depth-first.

This approach keeps `rhizz-core` free of I/O dependencies — no `FileLoader`
trait needed. The `compile` signature remains unchanged:

```rust
pub fn compile(sources: &[Source]) -> CompileResult
```

---

## Merge

Straightforward: accumulate `RawFile`s (the single `system.hcl` model file and any view definition files) into a unified `RawFile`.

- `project`: at most one across all files (error E010 if >1).
- `systems`, `components`, `views`: concatenate vecs.

While canonical projects maintain a single `system.hcl` architecture model file alongside view definitions, `rhizz-core`'s compiler accepts multiple `Source` inputs and merges their raw representations before resolution, keeping the core parser decoupled from physical file storage conventions.

No deduplication logic — duplicate detection happens during
resolution/validation.

---

## Resolved Models

Interned, cross-referenced. Use arena indices (`usize` newtyped) or
`slotmap::SlotMap` keys for relationships. Avoid `Rc`/`Arc` — the model is built
once and then read.

### Identity

```rust
/// Newtype indices for each entity kind.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
struct ComponentId(usize);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
struct PortId(usize);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
struct ProtocolId(usize);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
struct ConnectionId(usize);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
struct MessageId(usize);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
struct FieldId(usize);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
struct SystemId(usize);
```

### Core resolved structs

```rust
#[derive(Debug)]
struct Model {
    project: Project,
    systems: Vec<System>,         // indexed by SystemId
    components: Vec<Component>,   // indexed by ComponentId
    protocols: Vec<Protocol>,     // indexed by ProtocolId
    ports: Vec<Port>,             // indexed by PortId
    connections: Vec<Connection>, // indexed by ConnectionId
    messages: Vec<Message>,       // indexed by MessageId
    fields: Vec<Field>,           // indexed by FieldId
    views: Vec<View>,
}

#[derive(Debug)]
struct Protocol {
    label: String,
    description: String,
    tags: Vec<String>,
    roles: Vec<String>,
    messages: Vec<MessageId>,
}

#[derive(Debug)]
struct Project {
    name: String,
    version: String,
    authors: Vec<String>,
}

#[derive(Debug)]
struct System {
    label: String,
    description: String,
    tags: Vec<String>,
    level: i32,
    components: Vec<ComponentId>,    // direct children
    connections: Vec<ConnectionId>,  // direct children
}

#[derive(Debug)]
enum ComponentParent {
    System(SystemId),
    Component(ComponentId),
}

#[derive(Debug)]
struct Component {
    label: String,
    description: String,
    tags: Vec<String>,
    level: i32,
    leaf: bool,
    parent: ComponentParent,
    children: Vec<ComponentId>,
    ports: Vec<PortId>,
    connections: Vec<ConnectionId>,
}

/// The role a port plays in a connection.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Port {
    label: String,
    description: String,
    protocol: String,
    protocol_id: Option<ProtocolId>, // Resolved reference to top-level protocol (if matching)
    role: Option<String>,
    external: bool,                  // Whether port is an external boundary interface
    required: bool,                  // Whether port is required when instantiated in a system
    tags: Vec<String>,
    owner: ComponentId,
}

/// One endpoint of a connection — a component and an optional port on that component.
#[derive(Debug)]
struct ConnectionEndpoint {
    component: ComponentId,
    port: Option<PortId>,   // None when the reference was a bare component label
}

#[derive(Debug)]
struct Connection {
    label: String,
    description: String,
    tags: Vec<String>,
    level: i32,
    from: ConnectionEndpoint,
    to: ConnectionEndpoint,
    encapsulates: Vec<ConnectionId>,
}

#[derive(Debug)]
struct Message {
    label: String,
    description: String,
    tags: Vec<String>,
    level: i32,
    fields: Vec<FieldId>,
}

#[derive(Debug)]
struct Field {
    label: String,
    field_type: String,
    description: String,
    unit: String,
    required: bool,
}
```

### Resolution pass

`fn resolve(raw: RawFile) -> Result<Model, Vec<Diagnostic>>`

1. Index top-level `protocol` blocks by label. Detect duplicate labels (E001).
   - Walk messages and fields defined inside top-level protocols; allocate `MessageId` and `FieldId`.
2. Index top-level `component` blocks by label. Detect duplicate labels (E001).
3. Register all systems (allocate `SystemId`). Detect duplicate labels (E001).
4. Walk each system's components depth-first:
   - If a component has `source`, validate exclusivity (E012), look up the
     top-level component (E014 if missing), check for cycles (E013), and clone
     its body.
   - Allocate `ComponentId`, set `parent`, resolve `level` (inherit
     `parent.level + 1` if unset).
5. Walk each component's `port` blocks:
   - Allocate `PortId`, validate `role` string (E009), link to owner `ComponentId`.
   - Resolve `protocol` string: if it matches a registered `protocol` block, link `protocol_id`.
   - Set `external` (default `false`) and `required` (default `true`).
6. Walk `connection` blocks in each scope:
   - Parse `from` and `to` paths relative to the declaring scope.
   - Validate **Lowest Common Ancestor (LCA)**: ensure declaring scope is an ancestor (or LCA) of both `from` and `to` target components.
   - Resolve target components and optional ports (E011 for missing component, E010 for missing port).
7. Resolve `encapsulates` — same-scope connection label lookup (E003; E004 for cycles).
8. Resolve views — look up `system` label → `SystemId` (E006 if missing).
9. Validation checks:
   - Unconnected port verification (applies to **placed instances only**;
     a definition's ports are part of its contract and cannot be connected):
     - In isolated components: unconnected `external = true` ports are permitted. Unconnected internal (`external = false`) ports emit W010.
     - In instantiated systems: unconnected `external = true, required = true` ports emit W010.
   - Protocol / role compatibility on typed connections (W008, W009).
10. Detect orphan top-level components/protocols — any top-level component not referenced by `source` → W012.

Collect errors/warnings as `Diagnostic` values. If any errors exist, return
`Err`. Warnings are returned alongside the model.

### Scope lookup helper

```rust
/// A scope is either a system or a component. Used for resolving
/// sibling references in `from`, `to`, and `encapsulates`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum Scope {
    System(SystemId),
    Component(ComponentId),
}

/// Built during resolution. Maps (scope, label) → entity id.
struct ScopeIndex {
    components:  HashMap<(Scope, String), ComponentId>,
    connections: HashMap<(Scope, String), ConnectionId>,
    /// Maps (component_id, port_label) → PortId for `comp/port` resolution.
    ports:       HashMap<(ComponentId, String), PortId>,
}
```

---

## View models

Views don't need their own arena — they're lightweight config referencing into
the `Model`:

```rust
#[derive(Debug)]
struct View {
    label: String,
    description: String,
    tags: Vec<String>,
    system: SystemId,
    filter: ViewFilter,
}

#[derive(Debug)]
struct ViewFilter {
    include_tags: Vec<String>,
    exclude_tags: Vec<String>,
    max_level: Option<i32>,
    components: Vec<String>,   // whitelist by label, empty = all
    show_messages: bool,
}
```

---

## Design Notes

- **No lifetimes in the model** — all data is owned. Avoids borrow complexity
  for a model that's built once and lives for the program's duration.
- **Arena-indexed rather than nested** — flattening the tree into indexed vecs
  makes iteration, filtering, and scoring trivial. Parent/child relationships
  are explicit via ids.
- **`roles` as free-form strings** — defined at protocol level and validated
  per port against the referenced protocol. The `from`/`to` strings in `RawConnection` are parsed into
  `ConnectionEndpoint` (component id + optional port id) during the resolution
  pass.
- **`ConnectionEndpoint.port` is `Option<PortId>`** — `None` means a bare
  (untyped) reference; `Some` means a fully resolved typed reference. Warnings
  W007–W009 fire based on the combination.
- **Defaults applied during resolution**, not during deserialization. The raw
  layer preserves what the user wrote; the resolved layer is fully populated.
- **`String` over `&str`** everywhere — the raw HCL source doesn't outlive
  parsing, so borrowed slices aren't viable without an arena allocator for
  source text.
