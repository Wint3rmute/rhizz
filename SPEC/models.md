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

/// A port declared on a component. Carries protocol schema via `message` children.
#[derive(Debug, Clone)]
struct RawPort {
    description: Option<String>,
    protocol: Option<String>,
    role: Option<String>,   // "provider" | "consumer" | "peer"
    tags: Option<Vec<String>>,
    messages: Vec<Labeled<RawMessage>>,
}

/// A connection wiring two sibling components together.
/// `from` and `to` are either `"comp"` (bare) or `"comp:port"` (typed).
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
    ports: Vec<Port>,             // indexed by PortId
    connections: Vec<Connection>, // indexed by ConnectionId
    messages: Vec<Message>,       // indexed by MessageId
    fields: Vec<Field>,           // indexed by FieldId
    views: Vec<View>,
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
enum PortRole {
    Provider,
    Consumer,
    Peer,
}

#[derive(Debug)]
struct Port {
    label: String,
    description: String,
    protocol: String,
    role: PortRole,
    tags: Vec<String>,
    owner: ComponentId,
    messages: Vec<MessageId>,
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

1. Index top-level components by label. Detect duplicate labels (E001).
2. Register all systems (allocate `SystemId`). Detect duplicate labels (E001).
3. Walk each system's components depth-first:
   - If a component has `source`, validate exclusivity (E012), look up the
     top-level component (E014 if missing), check for cycles (E013), and clone
     its body.
   - Allocate `ComponentId`, set `parent`, resolve `level` (inherit
     `parent.level + 1` if unset).
4. Walk each component's `port` blocks — allocate `PortId`, validate `role`
   string (E009), link to owner `ComponentId`.
5. Walk `connection` blocks in each scope — parse `from`/`to` strings:
   - If the string contains `:`, split on the first `:` to get
     `(comp_label, port_label)`; resolve `comp_label` to a sibling `ComponentId`
     (E011 if missing), then look up `port_label` on that component (E010 if
     missing).
   - If the string is a bare label, resolve to a sibling `ComponentId` (E002 if
     missing). The `port` field of `ConnectionEndpoint` is `None`.
6. Resolve `encapsulates` — same-scope connection label lookup (E003; E004 for
   cycles).
7. Walk messages/fields inside ports — allocate ids. Validate `field.type`
   presence (E007).
8. Resolve views — look up `system` label → `SystemId` (E006 if missing).
9. Detect orphan top-level components — any top-level component not referenced
   by `source` in any system → W012.

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
    /// Maps (component_id, port_label) → PortId for `comp:port` resolution.
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
- **`PortRole` as enum, not string** — parse once during resolution, enforce at
  the type level. The `from`/`to` strings in `RawConnection` are parsed into
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
