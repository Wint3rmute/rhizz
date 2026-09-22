# Core Data Models

Two layers (see `crates/rhizz-core/src/{parse,model}.rs` as source of truth for
field lists — they are not duplicated here):

1. **Raw** — deserialization structs mirroring the HCL schema 1:1. All fields
   `Option` or defaulted; block labels become `Labeled<T> { label, inner }`.
   Used for parsing only.
2. **Resolved** — validated, cross-referenced IR used by validation and scoring.
   Arena-indexed (`ComponentId(usize)`-style newtypes, no lifetimes, no
   `Rc`/`Arc`), fully populated with defaults applied.

Pipeline: `.hcl` files → `hcl::from_str` → raw → merge → resolve → `Model`.
View files (`views/*.hcl`) are parsed and validated independently against the
resolved `Model`, never merged into it.

```rust
/// Top-level file content. System-model `RawFile`s are merged before
/// resolution; view files are not (one `view` per file, see below).
struct RawFile {
    project: Option<RawProject>,
    systems: Vec<Labeled<RawSystem>>,
    components: Vec<Labeled<RawComponent>>,  // top-level reusable definitions
    protocols: Vec<Labeled<RawProtocol>>,
}
```

## Parsing rules

- Top level accepts only `project | system | component | protocol`.
- `system` / `component` bodies accept only `instance` / `port` / `connection`
  children — any other nested block type is skipped with a W015 warning.
- Unknown attributes are rejected: blocking parse error (E000) — typos like
  `descripton` fail instead of being silently dropped. View files
  (`views/*.hcl`) follow the same rule.
- `instance` accepts only the required `source` attribute: missing `source` is a
  parse error, anything extra (attribute or child block) is rejected as an E012
  exclusivity violation.
- Raw preserves what the user wrote; defaults are applied during resolution.

## Source resolution

`instance.source` is a label reference to a top-level `component`, resolved
after all files are merged (no I/O during resolution; `compile(&[Source])`
signature unchanged):

1. Exclusivity (E012) — covered above.
2. Lookup in the top-level definition map (E014 if missing).
3. Cycle detection via an ancestor set of source labels (E013).
4. Clone the definition body into the instance slot; the usage-site label wins.
5. Recurse depth-first — cloned bodies may contain further `instance` children.

## Merge

System-model sources are concatenated into one `RawFile`:

- `project`: at most one (E010 if more).
- `systems`, `components`, `protocols`: concatenated. No dedup — duplicates are
  reported during resolution (E001).

## Resolved model

`Model` holds `systems`, `definitions` (roots of reusable top-level
components), and flat arenas for components / protocols / ports / connections /
messages / fields. Key semantics:

- `Component { kind: Definition | Instance, source: Option<String>, parent:
  Option<ComponentParent> }` — definitions have no parent and are excluded from
  scoring, view rendering, and connectivity warnings unless instantiated;
  instances record the definition label they were cloned from (used by the
  serializer to re-emit `instance` blocks).
- `Port { protocol: String, protocol_id: Option<ProtocolId>, external, required,
  owner }` — `protocol_id` links to a top-level protocol when the name matches.
- `Connection { from/to: ConnectionEndpoint { component, port: Option<PortId> },
  encapsulates }` — `port: None` is a bare (untyped) reference; W007–W009 fire
  on the typed/untyped and role combinations.

## Resolution pass

`resolve(raw) -> Result<Model, Vec<Diagnostic>>`:

1. Index top-level `protocol`s (E001); allocate messages/fields.
2. Index top-level `component`s (E001).
3. Register systems (E001).
4. Expand each system's `instance`s depth-first (E012/E014/E013, clone body).
5. Ports: allocate, validate `role` (E009), link `protocol_id`, default
   `external = false`, `required = true`.
6. Connections per scope: parse `from`/`to` paths relative to the declaring
   scope; enforce LCA placement (E015); resolve endpoints (E011/E010).
7. `encapsulates`: same-scope lookup (E003; E004 on cycles).
8. Views (separate pass): one `view` per file with label matching the filename
   (E016), `system` resolving to a real system (E006); every `node` path checked
   against component keys (W016).
9. Checks: unconnected ports on placed instances only (definitions never warn;
   `external` + `required` logic → W010), protocol/role compatibility (W008/W009).
10. Orphans: top-level component never named by an `instance.source` → W012.

Errors (`E*`) abort; warnings (`W*`) travel with the model. Scopes for
`from`/`to`/`encapsulates` resolution are `(System | Component, label)` pairs
held in a transient index built during resolution.

## View models

Views are not part of `Model`. Each `views/*.hcl` file yields one
`ViewDefinition` (see `serialize.rs`: label, system, filter, nodes, connection
layouts, annotations) validated per step 8 above. `filter` is parsed and
round-tripped but not applied by any renderer yet.

## Design notes

- Owned `String`s throughout — the HCL source doesn't outlive parsing.
- Flattened arenas make iteration/filtering/scoring trivial; hierarchy is explicit
  via ids rather than nesting.
- `roles` and field `type`s are free-form strings, validated against the
  referenced protocol where one exists.