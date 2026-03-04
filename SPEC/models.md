# Core Data Models

## Overview

Two model layers:

1. **Raw (deserialization) models** — `serde::Deserialize` structs mirroring HCL structure. Used for parsing only.
2. **Resolved models** — validated, cross-referenced IR used by all downstream passes (validation, scoring, view generation).

Parsing pipeline: `.hcl` files → `hcl::from_str` → raw models → merge → resolve → resolved models.

---

## Raw Models

These map 1:1 to the HCL schema. All fields `Option` or defaulted. Block labels become the key in a `BTreeMap` (or `Vec` of labeled items — see below).

HCL body blocks with labels (e.g. `component "foo" { ... }`) don't deserialize directly into a `HashMap<String, T>` with the `hcl` crate. Use the `hcl::Body` type and walk blocks manually, **or** use `hcl-rs`'s labeled block support via `#[serde(rename = "component")]` on a wrapper. The pragmatic approach: deserialize into `hcl::Body`, then extract blocks by type into typed structs with a thin conversion layer.

```rust
/// Top-level file content — the result of parsing one .hcl file.
/// Multiple `RawFile`s are merged before resolution.
#[derive(Debug, Default)]
struct RawFile {
    project: Option<RawProject>,
    systems: Vec<Labeled<RawSystem>>,
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
    interfaces: Vec<Labeled<RawInterface>>,
}

#[derive(Debug, Clone)]
struct RawComponent {
    description: Option<String>,
    tags: Option<Vec<String>>,
    level: Option<i32>,
    leaf: Option<bool>,
    components: Vec<Labeled<RawComponent>>,  // recursive
    interfaces: Vec<Labeled<RawInterface>>,
}

#[derive(Debug, Clone)]
struct RawInterface {
    description: Option<String>,
    tags: Option<Vec<String>>,
    level: Option<i32>,
    leaf: Option<bool>,
    direction: Option<String>,
    from: String,
    to: String,
    encapsulates: Option<Vec<String>>,
    messages: Vec<Labeled<RawMessage>>,
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
            "project" => file.project = Some(parse_project(block)?),
            "system"  => file.systems.push(parse_labeled_system(block)?),
            "view"    => file.views.push(parse_labeled_view(block)?),
            other     => return Err(/* unknown top-level block */),
        }
    }
    Ok(file)
}
```

Each `parse_*` function extracts attributes via `block.body().attributes()` and recurses into child blocks. Wrap this in a trait or macro if the boilerplate becomes excessive.

---

## Merge

Straightforward: accumulate all `RawFile`s into a single `RawFile`.

- `project`: at most one across all files (error E010 if >1).
- `systems`, `views`: concatenate vecs.

No deduplication logic — duplicate detection happens during resolution/validation.

---

## Resolved Models

Interned, cross-referenced. Use arena indices (`usize` newtyped) or `slotmap::SlotMap` keys for relationships. Avoid `Rc`/`Arc` — the model is built once and then read.

### Identity

```rust
/// Newtype indices for each entity kind.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
struct ComponentId(usize);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
struct InterfaceId(usize);

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
    systems: Vec<System>,       // indexed by SystemId
    components: Vec<Component>, // indexed by ComponentId
    interfaces: Vec<Interface>, // indexed by InterfaceId
    messages: Vec<Message>,     // indexed by MessageId
    fields: Vec<Field>,         // indexed by FieldId
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
    components: Vec<ComponentId>,   // direct children
    interfaces: Vec<InterfaceId>,   // direct children
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
    interfaces: Vec<InterfaceId>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Direction {
    Unidirectional,
    Bidirectional,
}

#[derive(Debug)]
struct Interface {
    label: String,
    description: String,
    tags: Vec<String>,
    level: i32,
    leaf: bool,
    direction: Direction,
    from: ComponentId,
    to: ComponentId,
    encapsulates: Vec<InterfaceId>,
    messages: Vec<MessageId>,
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

1. Register all systems (allocate `SystemId`).
2. Walk each system's components depth-first — allocate `ComponentId`, set `parent`, resolve `level` (inherit `parent.level + 1` if unset).
3. Walk interfaces — resolve `from`/`to` by looking up sibling component labels within the same parent scope. This is a `HashMap<(ParentScope, &str), ComponentId>` lookup.
4. Resolve `encapsulates` — same-scope interface label lookup.
5. Walk messages/fields — straightforward, allocate ids.
6. Resolve views — look up `system` label → `SystemId`.

Collect errors/warnings as `Diagnostic` values. If any errors exist, return `Err`. Warnings are attached to the `Model` or returned alongside it.

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
    components: HashMap<(Scope, String), ComponentId>,
    interfaces: HashMap<(Scope, String), InterfaceId>,
}
```

---

## View models

Views don't need their own arena — they're lightweight config referencing into the `Model`:

```rust
#[derive(Debug)]
struct View {
    label: String,
    description: String,
    tags: Vec<String>,
    system: SystemId,
    filter: ViewFilter,
    output: ViewOutput,
}

#[derive(Debug)]
struct ViewFilter {
    include_tags: Vec<String>,
    exclude_tags: Vec<String>,
    max_level: Option<i32>,
    components: Vec<String>,   // whitelist by label, empty = all
    show_messages: bool,
}

#[derive(Debug)]
struct ViewOutput {
    filename: String,
    rankdir: String,
}
```

---

## Design Notes

- **No lifetimes in the model** — all data is owned. Avoids borrow complexity for a model that's built once and lives for the program's duration.
- **Arena-indexed rather than nested** — flattening the tree into indexed vecs makes iteration, filtering, and scoring trivial. Parent/child relationships are explicit via ids.
- **`Direction` as enum, not string** — parse once during resolution, enforce at the type level.
- **Defaults applied during resolution**, not during deserialization. The raw layer preserves what the user wrote; the resolved layer is fully populated.
- **`String` over `&str`** everywhere — the raw HCL source doesn't outlive parsing, so borrowed slices aren't viable without an arena allocator for source text.
