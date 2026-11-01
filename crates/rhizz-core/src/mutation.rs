//! Declarative model mutations owned by `rhizz-core`.
//!
//! This is the structural follow-up to the architecture audit's duplicate
//! serializer finding: instead of every frontend reimplementing "load, tweak,
//! re-emit HCL", frontends send a [`ModelOp`] and get back canonical HCL.
//!
//! Execution model (single-file, mirroring what the web editor always did):
//! parse the primary file into a [`RawFile`], apply
//! the op to the label-based raw tree (no arena-index surgery — consistency
//! is re-established by the existing resolver), resolve, and serialize with
//! [`serialize_model`](crate::serialize::serialize_model). Anything the
//! resolver rejects (dangling `source` after a delete, duplicate labels,
//! …) refuses the whole op with diagnostics instead of persisting a broken
//! file.
//!
//! Every applied op also yields [`LoggedAction`]s in the exact JSON shape the
//! web action log records, so the TypeScript dispatcher can forward them to
//! its mutation observers without knowing what happened.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::diagnostics::{Diagnostic, DiagnosticCode};
use crate::model::{BorderStyle, Component, ConnectionRef, Model};
use crate::parse::{
    Labeled, RawComponent, RawConnection, RawFile, RawInstance, RawPort, RawProject, RawProtocol,
    RawSystem, parse_file,
};
use crate::{Source, resolve, serialize};

mod connect;

pub use connect::{ConnectEnd, NewPort, PortSpec};

// ── Op input (mirrors the TypeScript `ModelMutationOp` JSON 1:1) ─────────────

/// A single declarative model mutation for the frontend's op JSON.
///
/// Variant names match the TypeScript `kind` strings (`snake_case`);
/// variant fields match the TypeScript property names (`camelCase`).
#[derive(Debug, Deserialize)]
#[serde(tag = "kind")]
pub enum ModelOp {
    /// Add a system block; no-op when the label already exists.
    #[serde(rename = "add_system")]
    AddSystem {
        label: String,
        #[serde(default)]
        full_name: String,
    },
    /// Add a top-level component definition; no-op when it already exists.
    #[serde(rename = "add_component_definition")]
    AddDefinition {
        label: String,
        #[serde(default)]
        options: DefinitionOptions,
    },
    /// Add an `instance` of a definition inside a system or definition body.
    #[serde(rename = "add_instance")]
    #[serde(rename_all = "camelCase")]
    AddInstance {
        parent_path: String,
        label: String,
        source: String,
    },
    /// UI-level create: definition mode (empty `source_label`) or instance
    /// mode with container fallback (first system, else a fresh system).
    #[serde(rename = "create_component")]
    #[serde(rename_all = "camelCase")]
    CreateComponent {
        label: String,
        #[serde(default)]
        parent_key: String,
        #[serde(default)]
        source_label: String,
        #[serde(default)]
        leaf: Option<bool>,
        #[serde(default)]
        full_name: Option<String>,
        #[serde(default)]
        tags: Option<Vec<String>>,
        #[serde(default)]
        ports: Option<Vec<PortJson>>,
    },
    /// Move a placed instance between containers.
    #[serde(rename = "reparent_component")]
    #[serde(rename_all = "camelCase")]
    Reparent {
        source_path: String,
        target_parent_path: String,
    },
    /// Rename a placed instance (definitions are never renamed in place).
    #[serde(rename = "rename_component")]
    #[serde(rename_all = "camelCase")]
    Rename { path: String, new_label: String },
    /// Patch attributes on a definition (instance paths redirect to their
    /// definition, mirroring the old TypeScript store).
    #[serde(rename = "update_component")]
    Update { path: String, patch: PatchJson },
    /// Patch attributes on a system (bare system label; only `full_name`
    /// and `icon` are honored — systems carry no other style attributes).
    #[serde(rename = "update_system")]
    UpdateSystem {
        path: String,
        patch: SystemPatchJson,
    },
    /// Delete a definition (bare label) or a placed instance.
    #[serde(rename = "delete_component")]
    Delete { path: String },
    /// Delete a system (bare system label). Refuses when the label is not
    /// a system; a label colliding with a definition deletes the system,
    /// never the definition.
    #[serde(rename = "delete_system")]
    DeleteSystem { path: String },
    /// Add a connection inside a scope. Both endpoints name port paths
    /// (`comp/port` or a relative path ending in a port).
    #[serde(rename = "add_connection")]
    #[serde(rename_all = "camelCase")]
    AddConnection {
        scope_path: String,
        label: String,
        from: String,
        to: String,
    },
    /// Create a connection together with the ports it ends on, and
    /// optionally a stub protocol for them, as one atomic op.
    ///
    /// Ports are created on the component *definitions* the endpoint
    /// instances were sourced from. Any refusal (a taken label, an unknown
    /// component, a role the protocol does not permit, …) leaves the model
    /// untouched.
    #[serde(rename = "connect_components")]
    #[serde(rename_all = "camelCase")]
    ConnectComponents {
        scope_path: String,
        label: String,
        from: ConnectEnd,
        to: ConnectEnd,
        #[serde(default)]
        create_protocol: Option<String>,
    },
    /// Delete a connection by label, searching systems then definitions.
    ///
    /// With `remove_ports`, also delete the endpoint ports it was the only
    /// user of. Ports live on component *definitions*, so a port another
    /// connection still uses is kept while the unshared endpoint ports are
    /// removed. Pass `ports` (`definition/port` entries) to delete only a
    /// subset of the unshared endpoint ports.
    #[serde(rename = "delete_connection_by_label")]
    #[serde(rename_all = "camelCase")]
    DeleteConnectionByLabel {
        label: String,
        #[serde(default)]
        remove_ports: bool,
        #[serde(default)]
        ports: Option<Vec<String>>,
    },
    /// Patch a connection's attributes, addressed like `add_connection`
    /// (`scope_path` + `label`).
    ///
    /// An instance path redirects to the definition the connection is
    /// declared in, so editing a connection of a reusable definition changes
    /// the definition and therefore every copy of it. Entries of
    /// `realized_by` are written from the declaring scope (see
    /// [`ConnectionRef`]); a refusal (`E017`, `E018`, `E019`) leaves the
    /// model untouched, warnings never refuse.
    #[serde(rename = "update_connection")]
    #[serde(rename_all = "camelCase")]
    UpdateConnection {
        scope_path: String,
        label: String,
        patch: ConnectionPatch,
    },
    /// Add a top-level protocol. A blank label, a label containing `/`, or
    /// a label that already exists is refused with `E000`.
    #[serde(rename = "add_protocol")]
    AddProtocol {
        label: String,
        #[serde(default)]
        options: ProtocolPatch,
    },
    /// Patch a protocol's attributes; `path` is its label (labels never
    /// change here). Messages are kept as they are.
    #[serde(rename = "update_protocol")]
    UpdateProtocol { path: String, patch: ProtocolPatch },
    /// Delete a top-level protocol. Refused with `E000` while a port names
    /// it or another protocol lists it in `encapsulates`; its messages go
    /// with it.
    #[serde(rename = "delete_protocol")]
    DeleteProtocol { path: String },
}

/// Options for [`ModelOp::AddDefinition`] / definition-mode creates.
#[derive(Debug, Default, Deserialize)]
pub struct DefinitionOptions {
    /// Atomic flag.
    pub leaf: Option<bool>,
    /// Full official name, expanding abbreviations.
    pub full_name: Option<String>,
    /// Filtering tags.
    pub tags: Option<Vec<String>>,
    /// Optional icon name.
    pub icon: Option<String>,
    /// Optional border color.
    pub color: Option<String>,
    /// Border style (`"dashed"` / `"dotted"`; `"solid"` and empty clear it).
    pub border: Option<String>,
    /// Optional font style.
    pub font: Option<String>,
    /// Ports declared on the definition.
    pub ports: Option<Vec<PortJson>>,
}

/// A port block carried inside op JSON (creation and full-list replacement).
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct PortJson {
    /// Port label (required).
    pub label: String,
    /// Optional full name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub full_name: Option<String>,
    /// Protocol name; empty clears it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub protocol: Option<String>,
    /// Role string; defaults to `"peer"` when missing.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    /// External boundary flag.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub external: Option<bool>,
    /// Required flag.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub required: Option<bool>,
    /// Filtering tags.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
}

/// Attribute patch for [`ModelOp::Update`].
///
/// `None` means untouched; empty strings clear their field (back-compat
/// with hand-written HCL). The web inspector's reset options send explicit
/// defaults instead — `"default"` (color), `"solid"` (border),
/// `"unstyled"` (font) — so a clear is always spelled out, never an absent
/// value or an empty string.
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
pub struct PatchJson {
    /// Full official name, expanding abbreviations.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub full_name: Option<String>,
    /// Optional icon name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    /// Optional border color; `"default"` clears it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// Border style; `"solid"` and empty clear it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub border: Option<String>,
    /// Optional font style; `"unstyled"` clears it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font: Option<String>,
    /// Filtering tags (full replacement).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    /// Atomic flag.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub leaf: Option<bool>,
    /// Ports (full replacement).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ports: Option<Vec<PortJson>>,
}

/// Attribute patch for [`ModelOp::UpdateConnection`].
///
/// `None` means untouched. An empty `full_name` clears it, while `tags` and
/// `realized_by` are full replacements, like `ports` on components.
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ConnectionPatch {
    /// Full official name, expanding abbreviations.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub full_name: Option<String>,
    /// Filtering tags (full replacement).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    /// Abstraction level.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub level: Option<i32>,
    /// Connections that realize this one (full replacement).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub realized_by: Option<Vec<ConnectionRef>>,
}

/// Attributes of a protocol, as sent to [`ModelOp::AddProtocol`] (options)
/// and [`ModelOp::UpdateProtocol`] (patch).
///
/// `None` means untouched. `tags`, `roles` and `encapsulates` are full
/// replacements, so an empty list clears them (empty `roles` means the
/// protocol permits any role). An empty `full_name` clears it.
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProtocolPatch {
    /// Full official name, expanding abbreviations.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub full_name: Option<String>,
    /// Filtering tags (full replacement).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    /// Port roles the protocol permits (full replacement).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub roles: Option<Vec<String>>,
    /// Whether the protocol is concrete enough to need no realization.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub leaf: Option<bool>,
    /// Labels of protocols this one can carry (full replacement).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub encapsulates: Option<Vec<String>>,
}

/// Attribute patch for [`ModelOp::UpdateSystem`].
///
/// Systems carry only `full_name` and `icon` — every other key is rejected
/// as unknown during op deserialization (same `deny_unknown_fields` story
/// as `SystemAttrs` in the HCL parser), so callers cannot smuggle
/// component-only style into a system block.
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct SystemPatchJson {
    /// Full official name, expanding abbreviations.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub full_name: Option<String>,
    /// Optional icon name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
}

// ── Logged actions (mirrors the TypeScript `ModelAction` JSON) ───────────────

/// Actions an applied op reports, in the exact JSON shape the web action log
/// records. The TypeScript dispatcher forwards these to its mutation
/// observers untouched.
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(tag = "op")]
pub enum LoggedAction {
    /// A system block was added.
    #[serde(rename = "add_system")]
    AddSystem { label: String, full_name: String },
    /// A component definition was added.
    #[serde(rename = "add_component_definition")]
    #[serde(rename_all = "camelCase")]
    AddDefinition {
        label: String,
        leaf: bool,
        full_name: String,
        tags: Vec<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        icon: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        color: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        border: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        font: Option<String>,
        ports: Vec<PortJson>,
    },
    /// An instance was placed.
    #[serde(rename = "add_instance")]
    #[serde(rename_all = "camelCase")]
    AddInstance {
        parent_path: String,
        label: String,
        source: String,
    },
    /// A placed instance was renamed.
    #[serde(rename = "rename_component")]
    #[serde(rename_all = "camelCase")]
    RenameComponent { path: String, new_label: String },
    /// A definition or placed instance was deleted.
    #[serde(rename = "delete_component")]
    DeleteComponent { path: String },
    /// A system was deleted.
    #[serde(rename = "delete_system")]
    DeleteSystem { path: String },
    /// A placed instance moved containers.
    #[serde(rename = "reparent_component")]
    #[serde(rename_all = "camelCase")]
    ReparentComponent {
        source_path: String,
        target_parent_path: String,
    },
    /// Definition attributes were patched (`path` is the definition the
    /// update landed on after instance→definition redirect).
    #[serde(rename = "update_component")]
    UpdateComponent { path: String, patch: PatchJson },
    /// System attributes were patched (`full_name` / `icon` only).
    #[serde(rename = "update_system")]
    UpdateSystem {
        path: String,
        patch: SystemPatchJson,
    },
    /// A connection was added.
    #[serde(rename = "add_connection")]
    #[serde(rename_all = "camelCase")]
    AddConnection {
        scope_path: String,
        label: String,
        from: String,
        to: String,
    },
    /// A connection was created together with its ports (and optionally a
    /// stub protocol). Logged as the single gesture it was, in the op's own
    /// shape, so replaying it re-runs the same op.
    #[serde(rename = "connect_components")]
    #[serde(rename_all = "camelCase")]
    ConnectComponents {
        scope_path: String,
        label: String,
        from: ConnectEnd,
        to: ConnectEnd,
        #[serde(skip_serializing_if = "Option::is_none")]
        create_protocol: Option<String>,
    },
    /// A connection was deleted, optionally together with its endpoint ports
    /// (one gesture, one action). `ports` (as `definition/port`) records a
    /// selective port cleanup; absent means every unshared endpoint port went.
    #[serde(rename = "delete_connection")]
    #[serde(rename_all = "camelCase")]
    DeleteConnection {
        scope_path: String,
        label: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        remove_ports: Option<bool>,
        #[serde(skip_serializing_if = "Option::is_none")]
        ports: Option<Vec<String>>,
    },
    /// A connection was patched (`scope_path` / `label` as addressed, the
    /// patch as sent: `realized_by` entries stay as [`ConnectionRef`]s).
    #[serde(rename = "update_connection")]
    #[serde(rename_all = "camelCase")]
    UpdateConnection {
        scope_path: String,
        label: String,
        patch: ConnectionPatch,
    },
    /// A protocol was added (`options` as sent; absent fields are `{}`).
    #[serde(rename = "add_protocol")]
    AddProtocol {
        label: String,
        options: ProtocolPatch,
    },
    /// A protocol was patched (`path` as addressed, the patch as sent).
    #[serde(rename = "update_protocol")]
    UpdateProtocol { path: String, patch: ProtocolPatch },
    /// A protocol was deleted.
    #[serde(rename = "delete_protocol")]
    DeleteProtocol { path: String },
}

// ── Outcome types ─────────────────────────────────────────────────────────────

/// What applying one op to a [`RawFile`] decided.
#[derive(Debug)]
pub struct ApplyOutcome {
    /// Whether the model changed (guard failures refuse without an error).
    pub applied: bool,
    /// Created component path (`CreateComponent` only).
    pub path: Option<String>,
    /// Actions for the web action log.
    pub actions: Vec<LoggedAction>,
}

/// Malformed op input (as opposed to guard refusals, which are `applied:
/// false`). Surfaces as a blocking `E000` diagnostic.
#[derive(Debug)]
pub enum MutationError {
    /// The op itself is unusable (empty label, unknown border, …).
    InvalidInput(String),
}

impl MutationError {
    fn into_diagnostic(self) -> Diagnostic {
        match self {
            Self::InvalidInput(message) => Diagnostic::error(DiagnosticCode::E000, message),
        }
    }
}

/// Successful [`mutate_to_hcl`] run.
#[derive(Debug)]
pub struct MutationResult {
    /// Whether the op applied (guard refusals carry no HCL).
    pub applied: bool,
    /// Canonical HCL to persist (`None` when refused).
    pub hcl: Option<String>,
    /// Created component path (`CreateComponent` only).
    pub path: Option<String>,
    /// Actions for the web action log.
    pub actions: Vec<LoggedAction>,
    /// Non-blocking resolve warnings accompanying the new model.
    pub warnings: Vec<Diagnostic>,
}

// ── Entry point ───────────────────────────────────────────────────────────────

/// Parse one primary file, apply `op` to the raw tree, resolve, and return
/// canonical HCL plus logged actions.
///
/// # Errors
///
/// Returns diagnostics (leaving the file untouched) when the baseline fails
/// to parse, the op input is malformed, or the mutated model no longer
/// resolves — e.g. deleting a definition that is still instanced.
#[must_use = "refused ops still need handling"]
pub fn mutate_to_hcl(
    filename: &str,
    content: &str,
    op: &ModelOp,
) -> Result<MutationResult, Vec<Diagnostic>> {
    let path = Path::new(filename);
    let mut raw =
        parse_file(content, path).map_err(|e| vec![Diagnostic::error(e.code, e.message)])?;

    let outcome = apply_to_raw(&mut raw, op).map_err(|e| vec![e.into_diagnostic()])?;
    if !outcome.applied {
        return Ok(MutationResult {
            applied: false,
            hcl: None,
            path: None,
            actions: Vec::new(),
            warnings: Vec::new(),
        });
    }
    if removes_connections(op) {
        drop_unresolved_realized_by(&mut raw);
    }

    // Same default project-name behavior as `compile` for single sources.
    let source = Source {
        filename: filename.to_owned(),
        content: content.to_owned(),
    };
    if let Some(project_name) = crate::default_project_name(&[&source]) {
        let project = raw.project.get_or_insert_with(RawProject::default);
        if project.name.is_none() {
            project.name = Some(project_name);
        }
    }

    match resolve::resolve(raw) {
        Ok((model, warnings)) => Ok(MutationResult {
            applied: true,
            hcl: Some(serialize::serialize_model(&model)),
            path: outcome.path,
            actions: outcome.actions,
            warnings,
        }),
        Err(diagnostics) => Err(diagnostics),
    }
}

/// Whether `op` can remove a connection that other connections may realize.
const fn removes_connections(op: &ModelOp) -> bool {
    matches!(
        op,
        ModelOp::Delete { .. } | ModelOp::DeleteConnectionByLabel { .. }
    )
}

/// Remove the `realized_by` entries that a deletion left dangling, so the
/// delete is not refused by its own `E017`. The resolver reports the entries
/// that no longer resolve, each with the raw block that declares it. Only
/// those exact entries are removed.
fn drop_unresolved_realized_by(raw: &mut RawFile) {
    for dangling in resolve::unresolved_realized_by(raw.clone()) {
        let connections = match &dangling.owner {
            resolve::RawOwner::System(label) => raw
                .systems
                .iter_mut()
                .find(|s| &s.label == label)
                .map(|s| &mut s.inner.connections),
            resolve::RawOwner::Definition(label) => raw
                .components
                .iter_mut()
                .find(|c| &c.label == label)
                .map(|c| &mut c.inner.connections),
        };
        if let Some(connection) =
            connections.and_then(|cs| cs.iter_mut().find(|c| c.label == dangling.label))
        {
            connection
                .inner
                .realized_by
                .retain(|e| *e != dangling.entry);
        }
    }
}

// ── Raw-tree navigation ───────────────────────────────────────────────────────

/// A mutation scope: a system body or a reusable definition body. Nested
/// instance paths (`"demo/sub"`) resolve through the instance's `source`
/// definition, mirroring the old TypeScript container lookup.
#[derive(Debug, Clone, Copy)]
enum Scope {
    System(usize),
    Definition(usize),
}

fn find_system(raw: &RawFile, label: &str) -> Option<usize> {
    raw.systems.iter().position(|s| s.label == label)
}

fn find_definition(raw: &RawFile, label: &str) -> Option<usize> {
    raw.components.iter().position(|c| c.label == label)
}

fn scope_instances(raw: &RawFile, scope: Scope) -> &[Labeled<RawInstance>] {
    match scope {
        Scope::System(i) => raw
            .systems
            .get(i)
            .map_or(&[], |s| s.inner.instances.as_slice()),
        Scope::Definition(i) => raw
            .components
            .get(i)
            .map_or(&[], |c| c.inner.instances.as_slice()),
    }
}

/// Resolve a `/`-separated container path to a mutation scope. A bare label
/// addresses a top-level definition first, then a system; longer paths walk
/// through instance `source` references.
///
/// # Errors
///
/// Returns [`MutationError`] when the path is empty or unresolvable. Most
/// callers treat that as a guard refusal rather than a failure.
fn resolve_scope(raw: &RawFile, path: &str) -> Result<Scope, MutationError> {
    let segments: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    let Some((&first, rest)) = segments.split_first() else {
        return Err(unknown_container(path));
    };
    let mut scope = if rest.is_empty() {
        if let Some(i) = find_definition(raw, first) {
            Scope::Definition(i)
        } else if let Some(i) = find_system(raw, first) {
            Scope::System(i)
        } else {
            return Err(unknown_container(path));
        }
    } else if let Some(i) = find_system(raw, first) {
        Scope::System(i)
    } else {
        return Err(unknown_container(path));
    };
    for segment in rest {
        let source = scope_instances(raw, scope)
            .iter()
            .find(|i| i.label == *segment)
            .and_then(|i| i.inner.source.clone())
            .ok_or_else(|| unknown_container(path))?;
        let definition = find_definition(raw, &source).ok_or_else(|| unknown_container(path))?;
        scope = Scope::Definition(definition);
    }
    Ok(scope)
}

fn unknown_container(path: &str) -> MutationError {
    MutationError::InvalidInput(format!("unknown container `{path}`"))
}

/// Explicit "no value" sentinels the web inspector sends for its reset
/// options. `None` on the wire means "leave untouched" and empty strings
/// predate the inspector, so neither can spell a clear — these do.
const DEFAULT_COLOR: &str = "default";
const DEFAULT_FONT: &str = "unstyled";

fn non_empty(value: &str) -> Option<String> {
    if value.is_empty() {
        None
    } else {
        Some(value.to_owned())
    }
}

fn parse_border(value: &str) -> Result<Option<BorderStyle>, MutationError> {
    match value {
        "" | "solid" => Ok(None),
        "dashed" => Ok(Some(BorderStyle::Dashed)),
        "dotted" => Ok(Some(BorderStyle::Dotted)),
        other => Err(MutationError::InvalidInput(format!(
            "unknown border style '{other}'"
        ))),
    }
}

fn port_from_json(port: &PortJson) -> Result<Labeled<RawPort>, MutationError> {
    if port.label.is_empty() {
        return Err(MutationError::InvalidInput(
            "port label must not be empty".to_owned(),
        ));
    }
    let role = match port.role.as_deref() {
        None | Some("") => "peer".to_owned(),
        Some(role) => role.to_owned(),
    };
    Ok(Labeled {
        label: port.label.clone(),
        inner: RawPort {
            full_name: port.full_name.clone().and_then(|d| non_empty(&d)),
            protocol: port.protocol.clone().and_then(|p| non_empty(&p)),
            role: Some(role),
            external: port.external,
            required: port.required,
            tags: port.tags.clone().unwrap_or_default(),
        },
    })
}

// ── Op application ────────────────────────────────────────────────────────────

fn apply_to_raw(raw: &mut RawFile, op: &ModelOp) -> Result<ApplyOutcome, MutationError> {
    match op {
        ModelOp::AddSystem { label, full_name } => {
            let action = add_system(raw, label, full_name)?;
            Ok(ApplyOutcome {
                applied: true,
                path: None,
                actions: action.into_iter().collect(),
            })
        }
        ModelOp::AddDefinition { label, options } => {
            let action = add_definition(raw, label, options)?;
            Ok(ApplyOutcome {
                applied: true,
                path: None,
                actions: action.into_iter().collect(),
            })
        }
        ModelOp::AddInstance {
            parent_path,
            label,
            source,
        } => {
            let Some(scope) = resolve_scope_or_idle(raw, parent_path) else {
                return Ok(idle());
            };
            let action = add_instance(raw, scope, label, source)?;
            Ok(ApplyOutcome {
                applied: true,
                path: Some(format!("{parent_path}/{label}")),
                actions: action.into_iter().collect(),
            })
        }
        ModelOp::CreateComponent {
            label,
            parent_key,
            source_label,
            leaf,
            full_name,
            tags,
            ports,
        } => create_component(
            raw,
            &CreateParams {
                label,
                parent_key,
                source_label,
                leaf: *leaf,
                full_name: full_name.clone(),
                tags: tags.clone(),
                ports: ports.clone(),
            },
        ),
        ModelOp::Reparent {
            source_path,
            target_parent_path,
        } => reparent(raw, source_path, target_parent_path),
        ModelOp::Rename { path, new_label } => rename(raw, path, new_label),
        ModelOp::Update { path, patch } => update(raw, path, patch),
        ModelOp::UpdateSystem { path, patch } => Ok(update_system(raw, path, patch)),
        ModelOp::Delete { path } => delete(raw, path),
        ModelOp::DeleteSystem { path } => Ok(delete_system(raw, path)),
        ModelOp::AddConnection {
            scope_path,
            label,
            from,
            to,
        } => add_connection(raw, scope_path, label, from, to),
        ModelOp::ConnectComponents {
            scope_path,
            label,
            from,
            to,
            create_protocol,
        } => connect::connect_components(
            raw,
            scope_path,
            label,
            from,
            to,
            create_protocol.as_deref(),
        ),
        ModelOp::DeleteConnectionByLabel {
            label,
            remove_ports,
            ports,
        } => delete_connection_by_label(raw, label, *remove_ports, ports.as_deref()),
        ModelOp::UpdateConnection {
            scope_path,
            label,
            patch,
        } => update_connection(raw, scope_path, label, patch),
        ModelOp::AddProtocol { label, options } => add_protocol(raw, label, options),
        ModelOp::UpdateProtocol { path, patch } => Ok(update_protocol(raw, path, patch)),
        ModelOp::DeleteProtocol { path } => delete_protocol(raw, path),
    }
}

const fn idle() -> ApplyOutcome {
    ApplyOutcome {
        applied: false,
        path: None,
        actions: Vec::new(),
    }
}

const fn applied_none() -> ApplyOutcome {
    ApplyOutcome {
        applied: true,
        path: None,
        actions: Vec::new(),
    }
}

const fn applied(actions: Vec<LoggedAction>) -> ApplyOutcome {
    ApplyOutcome {
        applied: true,
        path: None,
        actions,
    }
}

/// `None` when the container is unknown (guard refusal, not an error).
fn resolve_scope_or_idle(raw: &RawFile, path: &str) -> Option<Scope> {
    resolve_scope(raw, path).ok()
}

fn scope_instances_mut(
    raw: &mut RawFile,
    scope: Scope,
) -> Result<&mut Vec<Labeled<RawInstance>>, MutationError> {
    match scope {
        Scope::System(i) => raw
            .systems
            .get_mut(i)
            .map(|s| &mut s.inner.instances)
            .ok_or_else(|| MutationError::InvalidInput("stale system scope".to_owned())),
        Scope::Definition(i) => raw
            .components
            .get_mut(i)
            .map(|c| &mut c.inner.instances)
            .ok_or_else(|| MutationError::InvalidInput("stale definition scope".to_owned())),
    }
}

fn scope_connections_mut(
    raw: &mut RawFile,
    scope: Scope,
) -> Result<&mut Vec<Labeled<RawConnection>>, MutationError> {
    match scope {
        Scope::System(i) => raw
            .systems
            .get_mut(i)
            .map(|s| &mut s.inner.connections)
            .ok_or_else(|| MutationError::InvalidInput("stale system scope".to_owned())),
        Scope::Definition(i) => raw
            .components
            .get_mut(i)
            .map(|c| &mut c.inner.connections)
            .ok_or_else(|| MutationError::InvalidInput("stale definition scope".to_owned())),
    }
}

fn delete_connection(raw: &mut RawFile, scope: Scope, label: &str) {
    if let Ok(connections) = scope_connections_mut(raw, scope) {
        connections.retain(|c| c.label != label);
    }
}

fn add_system(
    raw: &mut RawFile,
    label: &str,
    full_name: &str,
) -> Result<Option<LoggedAction>, MutationError> {
    if find_system(raw, label).is_some() {
        return Ok(None);
    }
    if label.is_empty() {
        return Err(MutationError::InvalidInput(
            "system label must not be empty".to_owned(),
        ));
    }
    raw.systems.push(Labeled {
        label: label.to_owned(),
        inner: RawSystem {
            full_name: non_empty(full_name),
            ..Default::default()
        },
    });
    Ok(Some(LoggedAction::AddSystem {
        label: label.to_owned(),
        full_name: full_name.to_owned(),
    }))
}

fn add_definition(
    raw: &mut RawFile,
    label: &str,
    options: &DefinitionOptions,
) -> Result<Option<LoggedAction>, MutationError> {
    if find_definition(raw, label).is_some() {
        return Ok(None);
    }
    if label.is_empty() {
        return Err(MutationError::InvalidInput(
            "component label must not be empty".to_owned(),
        ));
    }
    let mut ports = Vec::new();
    if let Some(definition_ports) = &options.ports {
        for port in definition_ports {
            ports.push(port_from_json(port)?);
        }
    }
    raw.components.push(Labeled {
        label: label.to_owned(),
        inner: RawComponent {
            full_name: options.full_name.clone().and_then(|d| non_empty(&d)),
            icon: options.icon.clone().and_then(|i| non_empty(&i)),
            color: options.color.clone().and_then(|c| non_empty(&c)),
            border: match &options.border {
                None => None,
                Some(border) => parse_border(border)?,
            },
            font: options.font.clone().and_then(|f| non_empty(&f)),
            tags: options.tags.clone().unwrap_or_default(),
            level: None,
            leaf: options.leaf,
            ports,
            ..Default::default()
        },
    });
    Ok(Some(LoggedAction::AddDefinition {
        label: label.to_owned(),
        leaf: options.leaf.unwrap_or(false),
        full_name: options.full_name.clone().unwrap_or_default(),
        tags: options.tags.clone().unwrap_or_default(),
        icon: options.icon.clone().and_then(|i| non_empty(&i)),
        color: options.color.clone().and_then(|c| non_empty(&c)),
        border: options.border.clone().and_then(|b| non_empty(&b)),
        font: options.font.clone().and_then(|f| non_empty(&f)),
        ports: options.ports.clone().unwrap_or_default(),
    }))
}

fn add_instance(
    raw: &mut RawFile,
    scope: Scope,
    label: &str,
    source: &str,
) -> Result<Option<LoggedAction>, MutationError> {
    if label.is_empty() || source.is_empty() {
        return Err(MutationError::InvalidInput(
            "instance label and source must not be empty".to_owned(),
        ));
    }
    // A scope that gains a child is not atomic anymore.
    if let Scope::Definition(i) = scope
        && let Some(definition) = raw.components.get_mut(i)
    {
        definition.inner.leaf = Some(false);
    }
    let instances = scope_instances_mut(raw, scope)?;
    if instances.iter().any(|i| i.label == label) {
        return Ok(None);
    }
    instances.push(Labeled {
        label: label.to_owned(),
        inner: RawInstance {
            source: Some(source.to_owned()),
        },
    });
    let parent_path = match scope {
        Scope::System(i) => raw
            .systems
            .get(i)
            .map_or_else(String::new, |s| s.label.clone()),
        Scope::Definition(i) => raw
            .components
            .get(i)
            .map_or_else(String::new, |c| c.label.clone()),
    };
    Ok(Some(LoggedAction::AddInstance {
        parent_path,
        label: label.to_owned(),
        source: source.to_owned(),
    }))
}

struct CreateParams<'a> {
    label: &'a str,
    parent_key: &'a str,
    source_label: &'a str,
    leaf: Option<bool>,
    full_name: Option<String>,
    tags: Option<Vec<String>>,
    ports: Option<Vec<PortJson>>,
}

/// Fallback system created when a create has nowhere to place, mirroring
/// the web editor (`EMPTY_PROJECT_HCL` / the create fallback).
const FALLBACK_SYSTEM_FULL_NAME: &str = "Main system";

fn create_component(
    raw: &mut RawFile,
    params: &CreateParams<'_>,
) -> Result<ApplyOutcome, MutationError> {
    if params.label.is_empty() {
        return Err(MutationError::InvalidInput(
            "component label must not be empty".to_owned(),
        ));
    }
    let mut actions = Vec::new();
    let mut parent = params.parent_key.to_owned();
    let container_known = !parent.is_empty() && resolve_scope(raw, &parent).is_ok();
    if !container_known {
        // Both modes need a real container: fall back to the first system,
        // creating a "main" system when the model has none yet.
        if raw.systems.is_empty() {
            actions.extend(add_system(raw, "main", FALLBACK_SYSTEM_FULL_NAME)?);
            "main".clone_into(&mut parent);
        } else {
            parent = raw
                .systems
                .first()
                .map_or_else(String::new, |s| s.label.clone());
        }
    }
    // Children of an instance persist in that instance's definition body:
    // `resolve_scope` walks instance paths through their `source`
    // definition, which is exactly the store location. The returned path
    // stays on the canvas path (`parent` as given).
    // New-definition mode also places an instance — otherwise creation
    // closes with nothing visibly changing on the canvas.
    let source = if params.source_label.is_empty() {
        actions.extend(add_definition(
            raw,
            params.label,
            &DefinitionOptions {
                leaf: params.leaf,
                full_name: params.full_name.clone(),
                tags: params.tags.clone(),
                ports: params.ports.clone(),
                ..Default::default()
            },
        )?);
        params.label
    } else {
        params.source_label
    };
    let scope = resolve_scope(raw, &parent)
        .map_err(|_| MutationError::InvalidInput(format!("unknown container `{parent}`")))?;
    actions.extend(add_instance(raw, scope, params.label, source)?);
    let label = params.label;
    Ok(ApplyOutcome {
        applied: true,
        path: Some(format!("{parent}/{label}")),
        actions,
    })
}

fn reparent(
    raw: &mut RawFile,
    source_path: &str,
    target_parent_path: &str,
) -> Result<ApplyOutcome, MutationError> {
    let segments: Vec<&str> = source_path.split('/').filter(|s| !s.is_empty()).collect();
    let Some((&leaf, parent_segments)) = segments.split_last() else {
        return Ok(idle());
    };
    if parent_segments.is_empty() {
        return Ok(idle());
    }
    let source_parent: String = parent_segments.join("/");
    if source_parent == target_parent_path
        || target_parent_path == source_path
        || target_parent_path.starts_with(&format!("{source_path}/"))
    {
        return Ok(idle());
    }
    let source_scope = resolve_scope_or_idle(raw, &source_parent);
    let target_scope = resolve_scope_or_idle(raw, target_parent_path);
    let (Some(source_scope), Some(target_scope)) = (source_scope, target_scope) else {
        return Ok(idle());
    };
    if scope_instances(raw, target_scope)
        .iter()
        .any(|i| i.label == leaf)
    {
        return Ok(idle());
    }
    let position = scope_instances(raw, source_scope)
        .iter()
        .position(|i| i.label == leaf);
    let Some(position) = position else {
        return Ok(idle());
    };
    let moved = scope_instances_mut(raw, source_scope)?.remove(position);
    // A scope that gains a child is not atomic anymore.
    if let Scope::Definition(i) = target_scope
        && let Some(definition) = raw.components.get_mut(i)
    {
        definition.inner.leaf = Some(false);
    }
    scope_instances_mut(raw, target_scope)?.push(moved);
    Ok(applied(vec![LoggedAction::ReparentComponent {
        source_path: source_path.to_owned(),
        target_parent_path: target_parent_path.to_owned(),
    }]))
}

fn rename(raw: &mut RawFile, path: &str, new_label: &str) -> Result<ApplyOutcome, MutationError> {
    if new_label.is_empty() {
        return Err(MutationError::InvalidInput(
            "new label must not be empty".to_owned(),
        ));
    }
    let segments: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    let Some((&old_label, parent_segments)) = segments.split_last() else {
        return Ok(idle());
    };
    if parent_segments.is_empty() {
        // Bare labels address definitions, which are never renamed in place.
        return Ok(idle());
    }
    if old_label == new_label {
        return Ok(idle());
    }
    let parent_path: String = parent_segments.join("/");
    let Some(scope) = resolve_scope_or_idle(raw, &parent_path) else {
        return Ok(idle());
    };
    let instances = scope_instances_mut(raw, scope)?;
    if instances.iter().any(|i| i.label == new_label) {
        return Ok(idle());
    }
    let Some(entry) = instances.iter_mut().find(|i| i.label == old_label) else {
        return Ok(idle());
    };
    new_label.clone_into(&mut entry.label);
    // Connections name instances textually (`a/p`, `/demo/a/p`, …), so a
    // rename must rewrite the endpoints in this scope or the re-resolve
    // refuses the whole op with E002/E011 (undefined component).
    rewrite_connections_for_rename(raw, scope, old_label, new_label)?;
    // Ancestor system connections can reach the renamed instance through a
    // longer path (`outer/inner/p`); rewrite those too.
    rewrite_ancestor_connections_for_rename(raw, &parent_path, old_label, new_label);
    Ok(applied(vec![LoggedAction::RenameComponent {
        path: path.to_owned(),
        new_label: new_label.to_owned(),
    }]))
}

/// Rewrite one endpoint that names `old` as its first component segment.
/// Handles relative (`a/p`, `a/b/p`, bare `a`), `./`-prefixed (`./a/p`),
/// and absolute (`/sys/a/p`) spellings. `..`-prefixed paths name the parent,
/// not a child, so they never match.
fn rewrite_endpoint_for_rename(
    endpoint: &str,
    scope_system: Option<&str>,
    old: &str,
    new: &str,
) -> Option<String> {
    let ep = endpoint.trim();
    if ep.is_empty() {
        return None;
    }
    if ep.starts_with('/') {
        let segments: Vec<&str> = ep.split('/').filter(|s| !s.is_empty()).collect();
        let sys = scope_system?;
        if segments.len() >= 2 && segments.first() == Some(&sys) && segments.get(1) == Some(&old) {
            let mut owned: Vec<String> = segments.iter().map(|s| (*s).to_owned()).collect();
            if let Some(slot) = owned.get_mut(1) {
                new.clone_into(slot);
            }
            return Some(format!("/{}", owned.join("/")));
        }
        return None;
    }
    if let Some(rest) = ep.strip_prefix("./") {
        if rest == old {
            return Some(format!("./{new}"));
        }
        if let Some(suffix) = rest.strip_prefix(&format!("{old}/")) {
            return Some(format!("./{new}/{suffix}"));
        }
        return None;
    }
    if ep == old {
        return Some(new.to_owned());
    }
    if let Some(suffix) = ep.strip_prefix(&format!("{old}/")) {
        return Some(format!("{new}/{suffix}"));
    }
    None
}

/// Rewrite one `realized_by` entry that routes through `old`. Unlike
/// endpoints, a bare entry names a connection (not an instance), so only
/// entries with a component prefix (`a/conn`, `./a/conn`, `/sys/a/conn`)
/// can match.
fn rewrite_realized_by_entry_for_rename(
    entry: &str,
    scope_system: Option<&str>,
    old: &str,
    new: &str,
) -> Option<String> {
    let ep = entry.trim();
    if ep.is_empty() || !ep.contains('/') {
        return None;
    }
    if ep.starts_with('/') {
        let segments: Vec<&str> = ep.split('/').filter(|s| !s.is_empty()).collect();
        let sys = scope_system?;
        // `/sys/old/conn` or deeper; last segment is always the connection.
        if segments.len() >= 3 && segments.first() == Some(&sys) && segments.get(1) == Some(&old) {
            let mut owned: Vec<String> = segments.iter().map(|s| (*s).to_owned()).collect();
            if let Some(slot) = owned.get_mut(1) {
                new.clone_into(slot);
            }
            return Some(format!("/{}", owned.join("/")));
        }
        return None;
    }
    if let Some(rest) = ep.strip_prefix("./") {
        if let Some(suffix) = rest.strip_prefix(&format!("{old}/")) {
            return Some(format!("./{new}/{suffix}"));
        }
        return None;
    }
    if ep.starts_with("../") || ep == ".." || ep == "." {
        return None;
    }
    if let Some(suffix) = ep.strip_prefix(&format!("{old}/")) {
        return Some(format!("{new}/{suffix}"));
    }
    None
}

/// Rewrite `from`/`to`/`realized_by` in the renamed instance's own scope.
fn rewrite_connections_for_rename(
    raw: &mut RawFile,
    scope: Scope,
    old: &str,
    new: &str,
) -> Result<(), MutationError> {
    let scope_system = match scope {
        Scope::System(i) => raw.systems.get(i).map(|s| s.label.clone()),
        Scope::Definition(_) => None,
    };
    let connections = scope_connections_mut(raw, scope)?;
    for connection in &mut *connections {
        if let Some(from) = connection.inner.from.clone()
            && let Some(rewritten) =
                rewrite_endpoint_for_rename(&from, scope_system.as_deref(), old, new)
        {
            connection.inner.from = Some(rewritten);
        }
        if let Some(to) = connection.inner.to.clone()
            && let Some(rewritten) =
                rewrite_endpoint_for_rename(&to, scope_system.as_deref(), old, new)
        {
            connection.inner.to = Some(rewritten);
        }
        for entry in &mut connection.inner.realized_by {
            if let Some(rewritten) =
                rewrite_realized_by_entry_for_rename(entry, scope_system.as_deref(), old, new)
            {
                *entry = rewritten;
            }
        }
    }
    Ok(())
}

/// Rewrite ancestor system connections that reach the renamed instance via a
/// longer path. E.g. renaming `demo/outer/inner` to `z` rewrites system
/// `demo` endpoints `outer/inner/p` and `/demo/outer/inner/p` to
/// `outer/z/p` and `/demo/outer/z/p`.
fn rewrite_ancestor_connections_for_rename(
    raw: &mut RawFile,
    parent_path: &str,
    old: &str,
    new: &str,
) {
    let parent_segments: Vec<&str> = parent_path.split('/').filter(|s| !s.is_empty()).collect();
    let Some((system_label, parent_rest)) = parent_segments.split_first() else {
        return;
    };
    // Parent is a bare definition (no system prefix): no ancestor system path
    // to rewrite. Shared-definition siblings across systems stay as-is.
    let Some(system_index) = find_system(raw, system_label) else {
        return;
    };
    if parent_rest.is_empty() {
        return;
    }
    let Some(system) = raw.systems.get_mut(system_index) else {
        return;
    };
    for connection in &mut system.inner.connections {
        for endpoint in [&mut connection.inner.from, &mut connection.inner.to] {
            let Some(current) = endpoint.clone() else {
                continue;
            };
            if let Some(rewritten) =
                rewrite_nested_endpoint(&current, system_label, parent_rest, old, new)
            {
                *endpoint = Some(rewritten);
            }
        }
        for entry in &mut connection.inner.realized_by {
            if let Some(rewritten) =
                rewrite_nested_realized_by(entry, system_label, parent_rest, old, new)
            {
                *entry = rewritten;
            }
        }
    }
}

/// Rewrite `outer/inner/p` (relative to the ancestor system) or
/// `/sys/outer/inner/p` (absolute) when `parent_rest` is `["outer"]` and
/// `old` is `"inner"`.
fn rewrite_nested_endpoint(
    endpoint: &str,
    system_label: &str,
    parent_rest: &[&str],
    old: &str,
    new: &str,
) -> Option<String> {
    let ep = endpoint.trim();
    if ep.is_empty() {
        return None;
    }
    if ep.starts_with('/') {
        let segments: Vec<&str> = ep.split('/').filter(|s| !s.is_empty()).collect();
        if segments.first() != Some(&system_label) {
            return None;
        }
        let after_system: &[&str] = segments.get(1..)?;
        let needed = parent_rest.len().saturating_add(2);
        if after_system.len() < needed {
            return None;
        }
        if after_system.get(..parent_rest.len()) != Some(parent_rest) {
            return None;
        }
        if after_system.get(parent_rest.len()) != Some(&old) {
            return None;
        }
        let mut owned: Vec<String> = segments.iter().map(|s| (*s).to_owned()).collect();
        let idx = 1_usize.saturating_add(parent_rest.len());
        if let Some(slot) = owned.get_mut(idx) {
            new.clone_into(slot);
        }
        return Some(format!("/{}", owned.join("/")));
    }
    if ep.starts_with("./") || ep.starts_with("../") || ep == "." || ep == ".." {
        return None;
    }
    let segments: Vec<&str> = ep.split('/').collect();
    let needed = parent_rest.len().saturating_add(2);
    if segments.len() < needed {
        return None;
    }
    if segments.get(..parent_rest.len()) != Some(parent_rest) {
        return None;
    }
    if segments.get(parent_rest.len()) != Some(&old) {
        return None;
    }
    let mut owned: Vec<String> = segments.iter().map(|s| (*s).to_owned()).collect();
    if let Some(slot) = owned.get_mut(parent_rest.len()) {
        new.clone_into(slot);
    }
    Some(owned.join("/"))
}

/// Rewrite `outer/inner-conn` style `realized_by` entries in ancestor systems.
/// The last segment is always the connection label, so at least one segment
/// must remain after the renamed instance.
fn rewrite_nested_realized_by(
    entry: &str,
    system_label: &str,
    parent_rest: &[&str],
    old: &str,
    new: &str,
) -> Option<String> {
    let ep = entry.trim();
    if ep.is_empty() || !ep.contains('/') {
        return None;
    }
    if ep.starts_with('/') {
        let segments: Vec<&str> = ep.split('/').filter(|s| !s.is_empty()).collect();
        if segments.first() != Some(&system_label) {
            return None;
        }
        let after_system: &[&str] = segments.get(1..)?;
        let needed = parent_rest.len().saturating_add(2);
        if after_system.len() < needed {
            return None;
        }
        if after_system.get(..parent_rest.len()) != Some(parent_rest) {
            return None;
        }
        if after_system.get(parent_rest.len()) != Some(&old) {
            return None;
        }
        let mut owned: Vec<String> = segments.iter().map(|s| (*s).to_owned()).collect();
        let idx = 1_usize.saturating_add(parent_rest.len());
        if let Some(slot) = owned.get_mut(idx) {
            new.clone_into(slot);
        }
        return Some(format!("/{}", owned.join("/")));
    }
    if ep.starts_with("./") || ep.starts_with("../") || ep == "." || ep == ".." {
        return None;
    }
    let segments: Vec<&str> = ep.split('/').collect();
    let needed = parent_rest.len().saturating_add(2);
    if segments.len() < needed {
        return None;
    }
    if segments.get(..parent_rest.len()) != Some(parent_rest) {
        return None;
    }
    if segments.get(parent_rest.len()) != Some(&old) {
        return None;
    }
    let mut owned: Vec<String> = segments.iter().map(|s| (*s).to_owned()).collect();
    if let Some(slot) = owned.get_mut(parent_rest.len()) {
        new.clone_into(slot);
    }
    Some(owned.join("/"))
}

fn update(
    raw: &mut RawFile,
    path: &str,
    changes: &PatchJson,
) -> Result<ApplyOutcome, MutationError> {
    let Some((definition_label, notified_path)) = update_target(raw, path) else {
        return Ok(idle());
    };
    let Some(definition) = find_definition(raw, &definition_label) else {
        return Ok(idle());
    };
    let Some(body) = raw.components.get_mut(definition) else {
        return Ok(idle());
    };
    apply_patch(&mut body.inner, changes)?;
    Ok(applied(vec![LoggedAction::UpdateComponent {
        path: notified_path,
        patch: changes.clone(),
    }]))
}

/// Patch `full_name` / `icon` on a system. Only bare system labels address
/// a system — anything with a `/` (an instance path), or a bare definition
/// label, refuses. Mirrors the `update` guard behavior: unknown targets are
/// a refusal, not an error.
fn update_system(raw: &mut RawFile, path: &str, changes: &SystemPatchJson) -> ApplyOutcome {
    let mut segments = path.split('/').filter(|s| !s.is_empty());
    let (Some(label), None) = (segments.next(), segments.next()) else {
        return idle();
    };
    let Some(body) = find_system(raw, label).and_then(|i| raw.systems.get_mut(i)) else {
        return idle();
    };
    if let Some(full_name) = &changes.full_name {
        body.inner.full_name = non_empty(full_name);
    }
    if let Some(icon) = &changes.icon {
        body.inner.icon = non_empty(icon);
    }
    applied(vec![LoggedAction::UpdateSystem {
        path: path.to_owned(),
        patch: changes.clone(),
    }])
}

/// Resolve an update path to `(definition label, notified path)`. Instance
/// paths redirect to their reused definition, since body edits land there
/// rather than on the instance. `None` refuses the op.
fn update_target(raw: &RawFile, path: &str) -> Option<(String, String)> {
    let segments: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    if segments.len() == 1 {
        // Bare labels address top-level definitions.
        let (&only, _) = segments.split_first()?;
        return Some((only.to_owned(), path.to_owned()));
    }
    let (&leaf, parent_segments) = segments.split_last()?;
    if parent_segments.is_empty() {
        return None;
    }
    let parent_path: String = parent_segments.join("/");
    let scope = resolve_scope_or_idle(raw, &parent_path)?;
    let source = scope_instances(raw, scope)
        .iter()
        .find(|i| i.label == leaf)?
        .inner
        .source
        .clone()?;
    Some((source.clone(), source))
}

fn apply_patch(body: &mut RawComponent, patch: &PatchJson) -> Result<(), MutationError> {
    if let Some(full_name) = &patch.full_name {
        body.full_name = non_empty(full_name);
    }
    if let Some(icon) = &patch.icon {
        body.icon = non_empty(icon);
    }
    if let Some(color) = &patch.color {
        body.color = if color == DEFAULT_COLOR {
            None
        } else {
            non_empty(color)
        };
    }
    if let Some(border) = &patch.border {
        body.border = parse_border(border)?;
    }
    if let Some(font) = &patch.font {
        body.font = if font == DEFAULT_FONT {
            None
        } else {
            non_empty(font)
        };
    }
    if let Some(tags) = &patch.tags {
        body.tags.clone_from(tags);
    }
    if let Some(leaf) = patch.leaf {
        body.leaf = Some(leaf);
    }
    if let Some(ports) = &patch.ports {
        let mut raw_ports = Vec::with_capacity(ports.len());
        for port in ports {
            raw_ports.push(port_from_json(port)?);
        }
        body.ports = raw_ports;
    }
    Ok(())
}

/// True when a connection endpoint names instance `label` inside the scope at
/// `scope_path`. Endpoints come in two spellings: relative to the scope
/// (`"comp"`, `"comp/port"`) and absolute (`"/system/comp/port"`), so both are
/// normalized to a scope-relative path before the first segment is compared.
fn endpoint_uses(endpoint: Option<&str>, scope_path: &str, label: &str) -> bool {
    let Some(endpoint) = endpoint else {
        return false;
    };
    let endpoint = endpoint.trim_start_matches('/');
    let relative = endpoint
        .strip_prefix(scope_path)
        .and_then(|rest| rest.strip_prefix('/'))
        .unwrap_or(endpoint);
    relative.split('/').next() == Some(label)
}

fn delete(raw: &mut RawFile, path: &str) -> Result<ApplyOutcome, MutationError> {
    let segments: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    let Some((&first, _)) = segments.split_first() else {
        return Ok(idle());
    };
    if segments.len() == 1 {
        let Some(position) = raw.components.iter().position(|c| c.label == first) else {
            return Ok(idle());
        };
        raw.components.remove(position);
    } else {
        let Some((&leaf, parent_segments)) = segments.split_last() else {
            return Ok(idle());
        };
        let parent_path: String = parent_segments.join("/");
        let Some(scope) = resolve_scope_or_idle(raw, &parent_path) else {
            return Ok(idle());
        };
        let instances = scope_instances_mut(raw, scope)?;
        let Some(position) = instances.iter().position(|i| i.label == leaf) else {
            return Ok(idle());
        };
        instances.remove(position);
        // A connection cannot outlive one of its endpoints: drop the ones in
        // this scope that reach the removed instance (`leaf` or `leaf/port`).
        scope_connections_mut(raw, scope)?.retain(|connection| {
            !endpoint_uses(connection.inner.from.as_deref(), &parent_path, leaf)
                && !endpoint_uses(connection.inner.to.as_deref(), &parent_path, leaf)
        });
    }
    Ok(applied(vec![LoggedAction::DeleteComponent {
        path: path.to_owned(),
    }]))
}

/// Delete a system by bare label. Only bare labels address a system —
/// anything with a `/` refuses, as does a label naming no system. A label
/// colliding with a definition deletes the system, never the definition.
/// Like `delete`, the resolver re-validates afterwards, so dangling
/// references refuse the whole op instead of persisting a broken file.
fn delete_system(raw: &mut RawFile, path: &str) -> ApplyOutcome {
    let mut segments = path.split('/').filter(|s| !s.is_empty());
    let (Some(label), None) = (segments.next(), segments.next()) else {
        return idle();
    };
    let Some(position) = raw.systems.iter().position(|s| s.label == label) else {
        return idle();
    };
    raw.systems.remove(position);
    applied(vec![LoggedAction::DeleteSystem {
        path: path.to_owned(),
    }])
}

/// Endpoints name port paths (`comp/port` or a relative path ending in a
/// port). A single-segment value cannot name a port, so it is refused here;
/// longer values that still resolve to a component without a port are
/// refused by the resolver as E003.
fn require_port_path(label: &str, field: &str, value: &str) -> Result<(), MutationError> {
    let segments: Vec<&str> = value.split('/').filter(|s| !s.is_empty()).collect();
    let port_like = segments.len() >= 2
        && segments
            .last()
            .is_none_or(|last| *last != "." && *last != "..");
    if port_like {
        return Ok(());
    }
    Err(MutationError::InvalidInput(format!(
        "connection `{label}` requires a port path in '{field}' (e.g. `comp/port`)"
    )))
}

fn add_connection(
    raw: &mut RawFile,
    scope_path: &str,
    label: &str,
    from: &str,
    to: &str,
) -> Result<ApplyOutcome, MutationError> {
    require_port_path(label, "from", from)?;
    require_port_path(label, "to", to)?;
    let Some(scope) = resolve_scope_or_idle(raw, scope_path) else {
        return Ok(idle());
    };
    let connections = scope_connections_mut(raw, scope)?;
    if connections.iter().any(|c| c.label == label) {
        return Ok(applied_none());
    }
    connections.push(Labeled {
        label: label.to_owned(),
        inner: RawConnection {
            from: non_empty(from),
            to: non_empty(to),
            ..Default::default()
        },
    });
    Ok(ApplyOutcome {
        applied: true,
        path: None,
        actions: vec![LoggedAction::AddConnection {
            scope_path: scope_path.to_owned(),
            label: label.to_owned(),
            from: from.to_owned(),
            to: to.to_owned(),
        }],
    })
}

/// The scope that declares `label` (systems first, then definitions, matching
/// the dispatcher's search order) and that scope's label.
fn find_connection(raw: &RawFile, label: &str) -> Option<(Scope, String)> {
    if let Some(index) = raw
        .systems
        .iter()
        .position(|s| s.inner.connections.iter().any(|c| c.label == label))
    {
        let system = raw
            .systems
            .get(index)
            .map_or_else(String::new, |s| s.label.clone());
        return Some((Scope::System(index), system));
    }
    if let Some(index) = raw
        .components
        .iter()
        .position(|c| c.inner.connections.iter().any(|c| c.label == label))
    {
        let definition = raw
            .components
            .get(index)
            .map_or_else(String::new, |c| c.label.clone());
        return Some((Scope::Definition(index), definition));
    }
    None
}

/// Delete connection `label`; optionally its endpoint ports too.
///
/// A port is removable only when no connection outside the deleted declaration
/// uses it. Ports live on component *definitions*, so deleting one affects
/// every instance of that definition. A port still in use is kept while the
/// unshared endpoint ports are removed. `only_ports` (`definition/port`
/// entries) narrows the cleanup to a user-selected subset.
fn delete_connection_by_label(
    raw: &mut RawFile,
    label: &str,
    remove_ports: bool,
    only_ports: Option<&[String]>,
) -> Result<ApplyOutcome, MutationError> {
    let Some((scope, scope_label)) = find_connection(raw, label) else {
        return Ok(idle());
    };
    let ports = if remove_ports || only_ports.is_some_and(|ports| !ports.is_empty()) {
        let kind = if matches!(scope, Scope::System(_)) {
            "system"
        } else {
            "component"
        };
        removable_endpoint_ports(raw, &format!("{kind}:{scope_label}"), label, only_ports)?
    } else {
        Vec::new()
    };
    delete_connection(raw, scope, label);
    for (definition, port) in &ports {
        if let Some(component) = raw.components.iter_mut().find(|c| c.label == *definition) {
            component.inner.ports.retain(|p| p.label != *port);
        }
    }
    let wants_cleanup = remove_ports || only_ports.is_some_and(|ports| !ports.is_empty());
    Ok(applied(vec![LoggedAction::DeleteConnection {
        scope_path: scope_label,
        label: label.to_owned(),
        remove_ports: wants_cleanup.then_some(true),
        ports: only_ports
            .filter(|ports| !ports.is_empty())
            .map(<[String]>::to_vec),
    }]))
}

/// The `(definition, port)` pairs the deleted connection ends on, if nothing
/// else still uses them. Shared ports are skipped, not refused, so the caller
/// can delete the unshared endpoint ports while keeping the shared ones.
/// `only_ports` (`definition/port` entries) narrows the result to a
/// user-selected subset; an entry naming no endpoint port of this connection
/// is refused.
fn removable_endpoint_ports(
    raw: &RawFile,
    decl: &str,
    label: &str,
    only_ports: Option<&[String]>,
) -> Result<Vec<(String, String)>, MutationError> {
    let (model, _) = resolve::resolve(raw.clone()).map_err(|_| {
        MutationError::InvalidInput(format!(
            "cannot inspect ports of connection `{label}` in an invalid model"
        ))
    })?;
    let Some(connection) = model
        .connections
        .iter()
        .find(|c| c.decl == decl && c.label == label)
    else {
        return Ok(Vec::new());
    };

    let mut targets: Vec<(String, String)> = Vec::new();
    for endpoint in [&connection.from, &connection.to] {
        let Some(target) = endpoint_port_target(&model, endpoint) else {
            continue;
        };
        if !targets.contains(&target) {
            targets.push(target);
        }
    }

    // Copies of the deleted connection share the scope `decl` and its label,
    // and disappear with it; another connection in the same scope has a
    // different label and still needs its ports. Shared endpoint ports are
    // kept; only the unshared ones come out.
    let mut shared: Vec<(String, String)> = Vec::new();
    for other in &model.connections {
        if other.decl == decl && other.label == label {
            continue;
        }
        for endpoint in [&other.from, &other.to] {
            let Some(target) = endpoint_port_target(&model, endpoint) else {
                continue;
            };
            if targets.contains(&target) && !shared.contains(&target) {
                shared.push(target);
            }
        }
    }
    let mut removable: Vec<(String, String)> = targets
        .into_iter()
        .filter(|target| !shared.contains(target))
        .collect();

    if let Some(only) = only_ports.filter(|only| !only.is_empty()) {
        let mut selected: Vec<(String, String)> = Vec::new();
        for entry in only {
            let Some((definition, port)) = entry.rsplit_once('/') else {
                return Err(MutationError::InvalidInput(format!(
                    "cannot remove port `{entry}`: expected `definition/port`"
                )));
            };
            let wanted = (definition.to_owned(), port.to_owned());
            if !removable.contains(&wanted) {
                // Shared endpoint ports are quietly kept so the unshared
                // selection can still apply; anything else is a caller bug.
                let is_endpoint = model.connections.iter().any(|c| {
                    c.decl == decl
                        && c.label == label
                        && [&c.from, &c.to].iter().any(|endpoint| {
                            endpoint_port_target(&model, endpoint)
                                .is_some_and(|target| target == wanted)
                        })
                });
                if is_endpoint {
                    continue;
                }
                return Err(MutationError::InvalidInput(format!(
                    "cannot remove port `{port}` on component `{definition}`: it is not an endpoint port of connection `{label}`"
                )));
            }
            if !selected.contains(&wanted) {
                selected.push(wanted);
            }
        }
        removable = selected;
    }
    Ok(removable)
}

/// The `(definition label, port label)` an endpoint lands on. A placed
/// instance resolves to the top-level definition its `source` names, because
/// ports are declared (and deleted) there.
fn endpoint_port_target(
    model: &Model,
    endpoint: &crate::model::ConnectionEndpoint,
) -> Option<(String, String)> {
    let port = model.port(endpoint.port?)?;
    let component = model.component(endpoint.component)?;
    let definition = match component.source.as_deref() {
        Some(source) => definition_by_label(model, source)?,
        None => component,
    };
    Some((definition.label.clone(), port.label.clone()))
}

fn definition_by_label<'a>(model: &'a Model, label: &str) -> Option<&'a Component> {
    model
        .definitions
        .iter()
        .filter_map(|id| model.component(*id))
        .find(|definition| definition.label == label)
}

/// Patch the connection `label` declared in `scope_path`. A guard miss (unknown
/// scope or label) is a refusal without an error.
fn update_connection(
    raw: &mut RawFile,
    scope_path: &str,
    label: &str,
    patch: &ConnectionPatch,
) -> Result<ApplyOutcome, MutationError> {
    let Some(scope) = resolve_scope_or_idle(raw, scope_path) else {
        return Ok(idle());
    };
    let realized_by = patch
        .realized_by
        .as_deref()
        .map(|refs| realized_by_entries(scope_path, scope, refs));
    let connections = scope_connections_mut(raw, scope)?;
    let Some(connection) = connections.iter_mut().find(|c| c.label == label) else {
        return Ok(idle());
    };
    if let Some(full_name) = &patch.full_name {
        connection.inner.full_name = non_empty(full_name);
    }
    if let Some(tags) = &patch.tags {
        connection.inner.tags.clone_from(tags);
    }
    if let Some(level) = patch.level {
        connection.inner.level = Some(level);
    }
    if let Some(entries) = realized_by {
        connection.inner.realized_by = entries;
    }
    Ok(applied(vec![LoggedAction::UpdateConnection {
        scope_path: scope_path.to_owned(),
        label: label.to_owned(),
        patch: patch.clone(),
    }]))
}

/// Canonical `realized_by` entries for `targets`, written from the scope that
/// declares the connection. Duplicates collapse, keeping first occurrence.
fn realized_by_entries(declaring: &str, scope: Scope, targets: &[ConnectionRef]) -> Vec<String> {
    let in_definition = matches!(scope, Scope::Definition(_));
    let mut entries: Vec<String> = Vec::new();
    for target in targets {
        let entry = realized_by_entry(declaring, in_definition, target);
        if !entries.contains(&entry) {
            entries.push(entry);
        }
    }
    entries
}

/// One `realized_by` entry (see the reference syntax in proposal 0002).
///
/// A target in the declaring scope is a bare label. Inside a system the entry
/// is always absolute (`/system/instance/label`). Inside a top-level
/// definition it is relative to the definition, using `..` to go up and
/// instance labels to go down. A target in another tree is written absolute
/// and refused by the resolver, since a definition can only realize within its
/// own tree.
fn realized_by_entry(declaring: &str, in_definition: bool, target: &ConnectionRef) -> String {
    let from = path_segments(declaring);
    let to = path_segments(&target.scope_path);
    if from == to {
        return target.label.clone();
    }
    let absolute = || format!("/{}/{}", to.join("/"), target.label);
    if !in_definition {
        return absolute();
    }
    let common = from.iter().zip(&to).take_while(|(a, b)| a == b).count();
    if common == 0 {
        return absolute();
    }
    let mut parts: Vec<&str> = vec![".."; from.len().saturating_sub(common)];
    parts.extend(to.get(common..).unwrap_or_default());
    parts.push(&target.label);
    parts.join("/")
}

fn path_segments(path: &str) -> Vec<&str> {
    path.split('/').filter(|s| !s.is_empty()).collect()
}

// ── Protocols ─────────────────────────────────────────────────────────────────

fn find_protocol(raw: &RawFile, label: &str) -> Option<usize> {
    raw.protocols.iter().position(|p| p.label == label)
}

/// `roles` as stored: an empty list means "any role", which is no attribute.
fn roles_option(roles: &[String]) -> Option<Vec<String>> {
    (!roles.is_empty()).then(|| roles.to_vec())
}

fn add_protocol(
    raw: &mut RawFile,
    label: &str,
    options: &ProtocolPatch,
) -> Result<ApplyOutcome, MutationError> {
    if label.is_empty() {
        return Err(MutationError::InvalidInput(
            "protocol label must not be empty".to_owned(),
        ));
    }
    if label.contains('/') {
        return Err(MutationError::InvalidInput(format!(
            "protocol label `{label}` must not contain `/`"
        )));
    }
    if find_protocol(raw, label).is_some() {
        return Err(MutationError::InvalidInput(format!(
            "protocol `{label}` already exists"
        )));
    }
    raw.protocols.push(Labeled {
        label: label.to_owned(),
        inner: RawProtocol {
            full_name: options.full_name.as_deref().and_then(non_empty),
            tags: options.tags.clone().unwrap_or_default(),
            roles: options.roles.as_deref().and_then(roles_option),
            leaf: options.leaf.unwrap_or(false),
            encapsulates: options.encapsulates.clone().unwrap_or_default(),
            messages: Vec::new(),
        },
    });
    Ok(applied(vec![LoggedAction::AddProtocol {
        label: label.to_owned(),
        options: options.clone(),
    }]))
}

/// Patch the protocol `path`. A guard miss (unknown label) is a refusal
/// without an error; the resolver refuses the rest (`E009`, `E020`).
fn update_protocol(raw: &mut RawFile, label: &str, patch: &ProtocolPatch) -> ApplyOutcome {
    let Some(index) = find_protocol(raw, label) else {
        return idle();
    };
    let Some(labeled) = raw.protocols.get_mut(index) else {
        return idle();
    };
    let protocol = &mut labeled.inner;
    if let Some(full_name) = &patch.full_name {
        protocol.full_name = non_empty(full_name);
    }
    if let Some(tags) = &patch.tags {
        protocol.tags.clone_from(tags);
    }
    if let Some(roles) = &patch.roles {
        protocol.roles = roles_option(roles);
    }
    if let Some(leaf) = patch.leaf {
        protocol.leaf = leaf;
    }
    if let Some(encapsulates) = &patch.encapsulates {
        protocol.encapsulates.clone_from(encapsulates);
    }
    applied(vec![LoggedAction::UpdateProtocol {
        path: label.to_owned(),
        patch: patch.clone(),
    }])
}

/// Delete the protocol `path`, refusing while it is still used. The resolver
/// would only warn (`W014`, `W022`) about dangling references, so the usage
/// is checked here.
fn delete_protocol(raw: &mut RawFile, path: &str) -> Result<ApplyOutcome, MutationError> {
    let Some(index) = find_protocol(raw, path) else {
        return Ok(idle());
    };
    let users = protocol_users(raw, path);
    if !users.is_empty() {
        return Err(MutationError::InvalidInput(format!(
            "protocol `{path}` is still used by {}; remove those first",
            users.join(", ")
        )));
    }
    raw.protocols.remove(index);
    Ok(applied(vec![LoggedAction::DeleteProtocol {
        path: path.to_owned(),
    }]))
}

/// Every place that keeps `label` in use: ports naming it and other
/// protocols listing it in `encapsulates`. Connections are typed through
/// their ports, so they need no separate entry.
fn protocol_users(raw: &RawFile, label: &str) -> Vec<String> {
    let mut users = Vec::new();
    for component in &raw.components {
        for port in &component.inner.ports {
            if port.inner.protocol.as_deref() == Some(label) {
                users.push(format!("port `{}` of `{}`", port.label, component.label));
            }
        }
    }
    for protocol in &raw.protocols {
        if protocol.label != label && protocol.inner.encapsulates.iter().any(|e| e == label) {
            users.push(format!("protocol `{}`", protocol.label));
        }
    }
    users
}

#[cfg(test)]
mod tests {
    use super::*;

    fn op(json: &str) -> ModelOp {
        serde_json::from_str(json).expect("op JSON must parse")
    }

    fn mutate(content: &str, json: &str) -> Result<MutationResult, Vec<Diagnostic>> {
        mutate_to_hcl("system.hcl", content, &op(json))
    }

    #[test]
    fn op_json_contract_matches_typescript_shapes() {
        // Every `kind` deserializes from the exact JSON the TS dispatcher sends.
        let cases = [
            r#"{"kind":"add_system","label":"demo","full_name":"d"}"#,
            r#"{"kind":"add_component_definition","label":"cpu","options":{"leaf":true}}"#,
            r#"{"kind":"add_instance","parentPath":"demo","label":"a","source":"cpu"}"#,
            r#"{"kind":"create_component","label":"a","parentKey":"demo","sourceLabel":"cpu"}"#,
            r#"{"kind":"reparent_component","sourcePath":"demo/a","targetParentPath":"demo/sub"}"#,
            r#"{"kind":"rename_component","path":"demo/a","newLabel":"b"}"#,
            r#"{"kind":"update_component","path":"demo/a","patch":{"full_name":"x"}}"#,
            r#"{"kind":"update_system","path":"demo","patch":{"full_name":"x"}}"#,
            r#"{"kind":"delete_component","path":"demo/a"}"#,
            r#"{"kind":"delete_system","path":"demo"}"#,
            r#"{"kind":"add_connection","scopePath":"demo","label":"l","from":"a/out","to":"b/in"}"#,
            r#"{"kind":"connect_components","scopePath":"demo","label":"l","createProtocol":"spi","from":{"component":"a","port":{"new":{"label":"p","protocol":"spi","role":"provider","external":false,"required":true}}},"to":{"component":"b","port":{"existing":"q"}}}"#,
            r#"{"kind":"delete_connection_by_label","label":"l"}"#,
            r#"{"kind":"delete_connection_by_label","label":"l","removePorts":true,"ports":["a/out"]}"#,
            r#"{"kind":"update_connection","scopePath":"demo","label":"l","patch":{"full_name":"x","realized_by":[{"scopePath":"demo","label":"m"}]}}"#,
            r#"{"kind":"add_protocol","label":"spi","options":{"full_name":"x","tags":["t"],"roles":["provider"],"leaf":true,"encapsulates":["p"]}}"#,
            r#"{"kind":"update_protocol","path":"spi","patch":{"full_name":"x","tags":[],"roles":[],"leaf":false,"encapsulates":[]}}"#,
            r#"{"kind":"delete_protocol","path":"spi"}"#,
        ];
        for json in cases {
            op(json);
        }
    }

    #[test]
    fn add_flow_produces_canonical_hcl() {
        let result = mutate("", r#"{"kind":"add_system","label":"demo"}"#).expect("ok");
        assert!(result.applied);
        let hcl = result.hcl.expect("hcl");
        assert!(hcl.contains(r#"system "demo""#));

        let result = mutate(
            &hcl,
            r#"{"kind":"add_component_definition","label":"cpu","options":{"leaf":true}}"#,
        )
        .expect("ok");
        let hcl = result.hcl.expect("hcl");
        assert!(hcl.contains(r#"component "cpu""#));

        let result = mutate(
            &hcl,
            r#"{"kind":"add_instance","parentPath":"demo","label":"a","source":"cpu"}"#,
        )
        .expect("ok");
        let hcl = result.hcl.expect("hcl");
        assert!(hcl.contains(r#"instance "a" { source = "cpu" }"#));
        assert_eq!(result.actions.len(), 1);
    }

    #[test]
    fn duplicate_adds_are_idempotent_without_actions() {
        let first = mutate("", r#"{"kind":"add_system","label":"demo"}"#).expect("ok");
        let hcl = first.hcl.expect("hcl");
        assert_eq!(first.actions.len(), 1);
        let second = mutate(&hcl, r#"{"kind":"add_system","label":"demo"}"#).expect("ok");
        assert!(second.applied);
        assert!(second.actions.is_empty());
    }

    #[test]
    fn rename_refuses_collisions() {
        let hcl = mutate("", r#"{"kind":"add_system","label":"demo"}"#)
            .expect("ok")
            .hcl
            .expect("hcl");
        let hcl = mutate(&hcl, r#"{"kind":"add_component_definition","label":"c"}"#)
            .expect("ok")
            .hcl
            .expect("hcl");
        let hcl = mutate(
            &hcl,
            r#"{"kind":"add_instance","parentPath":"demo","label":"a","source":"c"}"#,
        )
        .expect("ok")
        .hcl
        .expect("hcl");
        let hcl = mutate(
            &hcl,
            r#"{"kind":"add_instance","parentPath":"demo","label":"b","source":"c"}"#,
        )
        .expect("ok")
        .hcl
        .expect("hcl");

        let refused = mutate(
            &hcl,
            r#"{"kind":"rename_component","path":"demo/a","newLabel":"b"}"#,
        )
        .expect("ok");
        assert!(!refused.applied);

        let renamed = mutate(
            &hcl,
            r#"{"kind":"rename_component","path":"demo/a","newLabel":"z"}"#,
        )
        .expect("ok");
        assert!(renamed.applied);
        let hcl = renamed.hcl.expect("hcl");
        assert!(hcl.contains(r#"instance "z" { source = "c" }"#));
        assert_eq!(renamed.actions.len(), 1);
    }

    #[test]
    fn rename_rewrites_connections_in_same_scope() {
        let hcl = mutate(
            "",
            r#"{"kind":"add_component_definition","label":"cpu","options":{"leaf":true,"ports":[{"label":"p"}]}}"#,
        )
        .expect("ok")
        .hcl
        .expect("hcl");
        let hcl = mutate(&hcl, r#"{"kind":"add_system","label":"demo"}"#)
            .expect("ok")
            .hcl
            .expect("hcl");
        let hcl = mutate(
            &hcl,
            r#"{"kind":"add_instance","parentPath":"demo","label":"a","source":"cpu"}"#,
        )
        .expect("ok")
        .hcl
        .expect("hcl");
        let hcl = mutate(
            &hcl,
            r#"{"kind":"add_instance","parentPath":"demo","label":"b","source":"cpu"}"#,
        )
        .expect("ok")
        .hcl
        .expect("hcl");
        let hcl = mutate(
            &hcl,
            r#"{"kind":"add_connection","scopePath":"demo","label":"link","from":"a/p","to":"b/p"}"#,
        )
        .expect("ok")
        .hcl
        .expect("hcl");

        let renamed = mutate(
            &hcl,
            r#"{"kind":"rename_component","path":"demo/a","newLabel":"z"}"#,
        )
        .expect("rename with connections must apply");
        assert!(renamed.applied);
        let hcl = renamed.hcl.expect("hcl");
        assert!(
            hcl.contains(r#"instance "z" { source = "cpu" }"#),
            "hcl:\n{hcl}"
        );
        // Serialization emits absolute endpoint paths (spacing is aligned).
        assert!(hcl.contains("/demo/z/p"), "hcl:\n{hcl}");
        assert!(hcl.contains("/demo/b/p"), "hcl:\n{hcl}");
        assert!(!hcl.contains("/demo/a/p"), "hcl:\n{hcl}");
    }

    #[test]
    fn rename_rewrites_to_side_and_absolute_and_dotslash() {
        // Table-driven: same setup, different `from` spellings + renaming the
        // `to` side. Serialization is always absolute, so assertions check the
        // absolute form.
        let cases = [
            ("a/p", "b/p", "demo/a", "z", "/demo/z/p", "/demo/b/p"),
            (
                "/demo/a/p",
                "/demo/b/p",
                "demo/a",
                "z",
                "/demo/z/p",
                "/demo/b/p",
            ),
            ("./a/p", "./b/p", "demo/a", "z", "/demo/z/p", "/demo/b/p"),
            ("a/p", "b/p", "demo/b", "y", "/demo/a/p", "/demo/y/p"),
        ];
        for (from, to, path, new_label, expect_from, expect_to) in cases {
            let hcl = mutate(
                "",
                r#"{"kind":"add_component_definition","label":"cpu","options":{"leaf":true,"ports":[{"label":"p"}]}}"#,
            )
            .expect("ok")
            .hcl
            .expect("hcl");
            let hcl = mutate(&hcl, r#"{"kind":"add_system","label":"demo"}"#)
                .expect("ok")
                .hcl
                .expect("hcl");
            let hcl = mutate(
                &hcl,
                r#"{"kind":"add_instance","parentPath":"demo","label":"a","source":"cpu"}"#,
            )
            .expect("ok")
            .hcl
            .expect("hcl");
            let hcl = mutate(
                &hcl,
                r#"{"kind":"add_instance","parentPath":"demo","label":"b","source":"cpu"}"#,
            )
            .expect("ok")
            .hcl
            .expect("hcl");
            let hcl = mutate(
                &hcl,
                &format!(
                    r#"{{"kind":"add_connection","scopePath":"demo","label":"link","from":"{from}","to":"{to}"}}"#
                ),
            )
            .expect("ok")
            .hcl
            .expect("hcl");

            let renamed = mutate(
                &hcl,
                &format!(
                    r#"{{"kind":"rename_component","path":"{path}","newLabel":"{new_label}"}}"#
                ),
            )
            .unwrap_or_else(|e| panic!("rename {path} -> {new_label} must apply: {e:?}"));
            assert!(renamed.applied, "from {from} to {to}");
            let hcl = renamed.hcl.expect("hcl");
            assert!(hcl.contains(expect_from), "hcl:\n{hcl}");
            assert!(hcl.contains(expect_to), "hcl:\n{hcl}");
        }
    }

    #[test]
    fn rename_rewrites_nested_ancestor_endpoints() {
        // outer-def contains inner; system demo connects outer/inner/p.
        // Renaming demo/outer/inner must rewrite the system connection.
        let hcl = mutate(
            "",
            r#"{"kind":"add_component_definition","label":"inner-def","options":{"leaf":true,"ports":[{"label":"p"}]}}"#,
        )
        .expect("ok")
        .hcl
        .expect("hcl");
        let hcl = mutate(
            &hcl,
            r#"{"kind":"add_component_definition","label":"outer-def"}"#,
        )
        .expect("ok")
        .hcl
        .expect("hcl");
        let hcl = mutate(
            &hcl,
            r#"{"kind":"add_instance","parentPath":"outer-def","label":"inner","source":"inner-def"}"#,
        )
        .expect("ok")
        .hcl
        .expect("hcl");
        let hcl = mutate(&hcl, r#"{"kind":"add_system","label":"demo"}"#)
            .expect("ok")
            .hcl
            .expect("hcl");
        let hcl = mutate(
            &hcl,
            r#"{"kind":"add_instance","parentPath":"demo","label":"outer","source":"outer-def"}"#,
        )
        .expect("ok")
        .hcl
        .expect("hcl");
        let hcl = mutate(
            &hcl,
            r#"{"kind":"add_instance","parentPath":"demo","label":"other","source":"inner-def"}"#,
        )
        .expect("ok")
        .hcl
        .expect("hcl");
        let hcl = mutate(
            &hcl,
            r#"{"kind":"add_connection","scopePath":"demo","label":"link","from":"outer/inner/p","to":"other/p"}"#,
        )
        .expect("ok")
        .hcl
        .expect("hcl");

        let renamed = mutate(
            &hcl,
            r#"{"kind":"rename_component","path":"demo/outer/inner","newLabel":"z"}"#,
        )
        .expect("nested rename must apply");
        assert!(renamed.applied);
        let hcl = renamed.hcl.expect("hcl");
        assert!(hcl.contains("/demo/outer/z/p"), "hcl:\n{hcl}");
        assert!(!hcl.contains("outer/inner/p"), "hcl:\n{hcl}");
    }

    #[test]
    fn rename_rewrites_realized_by_through_instance() {
        // outer-def declares connection sub; system demo realizes top via
        // outer/sub. Renaming outer must rewrite the realized_by entry.
        let hcl = mutate(
            "",
            r#"{"kind":"add_component_definition","label":"cpu","options":{"leaf":true,"ports":[{"label":"p"}]}}"#,
        )
        .expect("ok")
        .hcl
        .expect("hcl");
        let hcl = mutate(
            &hcl,
            r#"{"kind":"add_component_definition","label":"outer-def"}"#,
        )
        .expect("ok")
        .hcl
        .expect("hcl");
        let hcl = mutate(
            &hcl,
            r#"{"kind":"add_instance","parentPath":"outer-def","label":"x","source":"cpu"}"#,
        )
        .expect("ok")
        .hcl
        .expect("hcl");
        let hcl = mutate(
            &hcl,
            r#"{"kind":"add_instance","parentPath":"outer-def","label":"y","source":"cpu"}"#,
        )
        .expect("ok")
        .hcl
        .expect("hcl");
        let hcl = mutate(
            &hcl,
            r#"{"kind":"add_connection","scopePath":"outer-def","label":"sub","from":"x/p","to":"y/p"}"#,
        )
        .expect("ok")
        .hcl
        .expect("hcl");
        let hcl = mutate(&hcl, r#"{"kind":"add_system","label":"demo"}"#)
            .expect("ok")
            .hcl
            .expect("hcl");
        let hcl = mutate(
            &hcl,
            r#"{"kind":"add_instance","parentPath":"demo","label":"outer","source":"outer-def"}"#,
        )
        .expect("ok")
        .hcl
        .expect("hcl");
        let hcl = mutate(
            &hcl,
            r#"{"kind":"add_instance","parentPath":"demo","label":"a","source":"cpu"}"#,
        )
        .expect("ok")
        .hcl
        .expect("hcl");
        let hcl = mutate(
            &hcl,
            r#"{"kind":"add_instance","parentPath":"demo","label":"b","source":"cpu"}"#,
        )
        .expect("ok")
        .hcl
        .expect("hcl");
        let hcl = mutate(
            &hcl,
            r#"{"kind":"add_connection","scopePath":"demo","label":"top","from":"a/p","to":"b/p"}"#,
        )
        .expect("ok")
        .hcl
        .expect("hcl");
        // Attach realized_by via update_connection.
        let hcl = mutate(
            &hcl,
            r#"{"kind":"update_connection","scopePath":"demo","label":"top","patch":{"realized_by":[{"scopePath":"demo/outer","label":"sub"}]}}"#,
        )
        .expect("realized_by attach must apply")
        .hcl
        .expect("hcl");
        assert!(
            hcl.contains("outer/sub") || hcl.contains("/demo/outer/sub"),
            "hcl:\n{hcl}"
        );

        let renamed = mutate(
            &hcl,
            r#"{"kind":"rename_component","path":"demo/outer","newLabel":"z"}"#,
        )
        .expect("rename outer with realized_by must apply");
        assert!(renamed.applied);
        let hcl = renamed.hcl.expect("hcl");
        assert!(
            hcl.contains("z/sub") || hcl.contains("/demo/z/sub"),
            "hcl:\n{hcl}"
        );
        assert!(!hcl.contains("outer/sub"), "hcl:\n{hcl}");
    }

    #[test]
    fn update_redirects_to_definition_and_reports_definition_path() {
        let hcl = mutate(
            "",
            r#"{"kind":"add_component_definition","label":"cpu","options":{"leaf":true}}"#,
        )
        .expect("ok")
        .hcl
        .expect("hcl");
        let hcl = mutate(&hcl, r#"{"kind":"add_system","label":"demo"}"#)
            .expect("ok")
            .hcl
            .expect("hcl");
        let hcl = mutate(
            &hcl,
            r#"{"kind":"add_instance","parentPath":"demo","label":"a","source":"cpu"}"#,
        )
        .expect("ok")
        .hcl
        .expect("hcl");

        let updated = mutate(
            &hcl,
            r#"{"kind":"update_component","path":"demo/a","patch":{"full_name":"hot chip"}}"#,
        )
        .expect("ok");
        assert!(updated.applied);
        let hcl = updated.hcl.expect("hcl");
        assert!(hcl.contains(r#"full_name = "hot chip""#));
        // The logged path is the definition, matching the old TS store.
        let action = serde_json::to_value(&updated.actions).expect("json");
        assert_eq!(action[0]["op"], "update_component");
        assert_eq!(action[0]["path"], "cpu");
    }

    #[test]
    fn update_system_patches_full_name_and_icon() {
        let hcl = mutate("", r#"{"kind":"add_system","label":"demo"}"#)
            .expect("ok")
            .hcl
            .expect("hcl");

        let updated = mutate(
            &hcl,
            r#"{"kind":"update_system","path":"demo","patch":{"full_name":"Demo system","icon":"microchip"}}"#,
        )
        .expect("ok");
        assert!(updated.applied);
        let hcl = updated.hcl.expect("hcl");
        assert!(hcl.contains(r#"full_name = "Demo system""#));
        assert!(hcl.contains(r#"icon        = "microchip""#));
        let action = serde_json::to_value(&updated.actions).expect("json");
        assert_eq!(action[0]["op"], "update_system");
        assert_eq!(action[0]["path"], "demo");
    }

    #[test]
    fn update_system_refuses_non_system_paths() {
        let hcl = mutate("", r#"{"kind":"add_system","label":"demo"}"#)
            .expect("ok")
            .hcl
            .expect("hcl");
        let hcl = mutate(
            &hcl,
            r#"{"kind":"add_component_definition","label":"cpu","options":{"leaf":true}}"#,
        )
        .expect("ok")
        .hcl
        .expect("hcl");
        let hcl = mutate(
            &hcl,
            r#"{"kind":"add_instance","parentPath":"demo","label":"a","source":"cpu"}"#,
        )
        .expect("ok")
        .hcl
        .expect("hcl");

        // Instance paths and definition labels are not systems.
        for path in ["demo/a", "cpu", "missing"] {
            let refused = mutate(
                &hcl,
                &format!(
                    r#"{{"kind":"update_system","path":"{path}","patch":{{"icon":"microchip"}}}}"#
                ),
            )
            .expect("ok");
            assert!(!refused.applied, "path {path} must refuse");
        }
    }

    #[test]
    fn update_system_rejects_component_only_keys() {
        // `deny_unknown_fields` on the system patch: color/border/font/tags
        // are component-only and must not smuggle into a system block.
        let result: Result<ModelOp, _> = serde_json::from_str(
            r#"{"kind":"update_system","path":"demo","patch":{"color":"red"}}"#,
        );
        assert!(result.is_err(), "component-only keys must be rejected");
    }

    #[test]
    fn delete_instance_also_removes_connections_using_it() {
        let hcl = mutate(
            "",
            r#"{"kind":"add_component_definition","label":"cpu","options":{"leaf":true,"ports":[{"label":"p"}]}}"#,
        )
        .expect("ok")
        .hcl
        .expect("hcl");
        let hcl = mutate(&hcl, r#"{"kind":"add_system","label":"demo"}"#)
            .expect("ok")
            .hcl
            .expect("hcl");
        let hcl = mutate(
            &hcl,
            r#"{"kind":"add_instance","parentPath":"demo","label":"a","source":"cpu"}"#,
        )
        .expect("ok")
        .hcl
        .expect("hcl");
        let hcl = mutate(
            &hcl,
            r#"{"kind":"add_instance","parentPath":"demo","label":"b","source":"cpu"}"#,
        )
        .expect("ok")
        .hcl
        .expect("hcl");
        let hcl = mutate(
            &hcl,
            r#"{"kind":"add_connection","scopePath":"demo","label":"link","from":"a/p","to":"b/p"}"#,
        )
        .expect("ok")
        .hcl
        .expect("hcl");

        let deleted = mutate(&hcl, r#"{"kind":"delete_component","path":"demo/a"}"#)
            .expect("deleting an instance with connections must apply");
        assert!(deleted.applied);
        let hcl = deleted.hcl.expect("hcl");
        assert!(!hcl.contains(r#"connection "link""#));
        assert!(!hcl.contains(r#"instance "a""#));
        assert!(hcl.contains(r#"instance "b""#));
    }

    #[test]
    fn delete_definition_in_use_refuses_with_diagnostics() {
        let hcl = mutate(
            "",
            r#"{"kind":"add_component_definition","label":"cpu","options":{"leaf":true}}"#,
        )
        .expect("ok")
        .hcl
        .expect("hcl");
        let hcl = mutate(&hcl, r#"{"kind":"add_system","label":"demo"}"#)
            .expect("ok")
            .hcl
            .expect("hcl");
        let hcl = mutate(
            &hcl,
            r#"{"kind":"add_instance","parentPath":"demo","label":"a","source":"cpu"}"#,
        )
        .expect("ok")
        .hcl
        .expect("hcl");

        let refused = mutate(&hcl, r#"{"kind":"delete_component","path":"cpu"}"#);
        let diagnostics = refused.expect_err("must refuse dangling delete");
        assert!(diagnostics.iter().any(|d| d.code == DiagnosticCode::E014));
    }

    #[test]
    fn delete_system_removes_the_block_and_logs() {
        let hcl = mutate("", r#"{"kind":"add_system","label":"demo"}"#)
            .expect("ok")
            .hcl
            .expect("hcl");
        let hcl = mutate(&hcl, r#"{"kind":"add_system","label":"other"}"#)
            .expect("ok")
            .hcl
            .expect("hcl");

        let deleted = mutate(&hcl, r#"{"kind":"delete_system","path":"demo"}"#).expect("ok");
        assert!(deleted.applied);
        let hcl = deleted.hcl.expect("hcl");
        assert!(!hcl.contains(r#"system "demo""#));
        assert!(hcl.contains(r#"system "other""#));
        let action = serde_json::to_value(&deleted.actions).expect("json");
        assert_eq!(action[0]["op"], "delete_system");
        assert_eq!(action[0]["path"], "demo");
    }

    #[test]
    fn delete_system_refuses_non_system_paths() {
        let hcl = mutate("", r#"{"kind":"add_system","label":"demo"}"#)
            .expect("ok")
            .hcl
            .expect("hcl");
        let hcl = mutate(
            &hcl,
            r#"{"kind":"add_component_definition","label":"cpu","options":{"leaf":true}}"#,
        )
        .expect("ok")
        .hcl
        .expect("hcl");
        let hcl = mutate(
            &hcl,
            r#"{"kind":"add_instance","parentPath":"demo","label":"a","source":"cpu"}"#,
        )
        .expect("ok")
        .hcl
        .expect("hcl");

        // Instance paths, definition labels, and unknown labels refuse.
        for path in ["demo/a", "cpu", "missing"] {
            let refused = mutate(
                &hcl,
                &format!(r#"{{"kind":"delete_system","path":"{path}"}}"#),
            )
            .expect("ok");
            assert!(!refused.applied, "path {path} must refuse");
        }
    }

    #[test]
    fn broken_baseline_refuses() {
        let result = mutate(
            "system \"demo\" {\n  this is not valid hcl!!!\n}\n",
            r#"{"kind":"add_system","label":"other"}"#,
        );
        assert!(result.is_err());
    }

    #[test]
    fn reparent_guards_reject_cycles_and_collisions() {
        let hcl = mutate("", r#"{"kind":"add_component_definition","label":"sub"}"#)
            .expect("ok")
            .hcl
            .expect("hcl");
        let hcl = mutate(
            &hcl,
            r#"{"kind":"add_component_definition","label":"leaf","options":{"leaf":true}}"#,
        )
        .expect("ok")
        .hcl
        .expect("hcl");
        let hcl = mutate(&hcl, r#"{"kind":"add_system","label":"demo"}"#)
            .expect("ok")
            .hcl
            .expect("hcl");
        let hcl = mutate(
            &hcl,
            r#"{"kind":"add_instance","parentPath":"demo","label":"sub","source":"sub"}"#,
        )
        .expect("ok")
        .hcl
        .expect("hcl");
        let hcl = mutate(
            &hcl,
            r#"{"kind":"add_instance","parentPath":"demo","label":"leaf","source":"leaf"}"#,
        )
        .expect("ok")
        .hcl
        .expect("hcl");

        // Reparent into own subtree is refused.
        let cycled = mutate(
            &hcl,
            r#"{"kind":"reparent_component","sourcePath":"demo/sub","targetParentPath":"demo/sub/leaf"}"#,
        )
        .expect("ok");
        assert!(!cycled.applied);

        // A real move applies and logs.
        let moved = mutate(
            &hcl,
            r#"{"kind":"reparent_component","sourcePath":"demo/leaf","targetParentPath":"demo/sub"}"#,
        )
        .expect("ok");
        assert!(moved.applied);
        assert_eq!(moved.actions.len(), 1);
    }

    #[test]
    fn create_component_places_definition_instance_in_fresh_system() {
        // Definition mode on an empty model: definition + "main" system +
        // placed instance, mirroring the web place-on-create flow.
        let created = mutate(
            "",
            r#"{"kind":"create_component","label":"sensor","leaf":true}"#,
        )
        .expect("ok");
        assert!(created.applied);
        let hcl = created.hcl.expect("hcl");
        assert!(hcl.contains(r#"component "sensor""#));
        assert!(hcl.contains(r#"system "main""#));
        assert!(hcl.contains(r#"instance "sensor" { source = "sensor" }"#));
    }

    #[test]
    fn create_component_under_instance_persists_in_definition_body() {
        let hcl = mutate(
            "",
            r#"{"kind":"add_component_definition","label":"sensor"}"#,
        )
        .expect("ok")
        .hcl
        .expect("hcl");
        let hcl = mutate(&hcl, r#"{"kind":"add_system","label":"main"}"#)
            .expect("ok")
            .hcl
            .expect("hcl");
        let hcl = mutate(
            &hcl,
            r#"{"kind":"add_instance","parentPath":"main","label":"sensor","source":"sensor"}"#,
        )
        .expect("ok")
        .hcl
        .expect("hcl");

        let created = mutate(
            &hcl,
            r#"{"kind":"create_component","label":"imu","parentKey":"main/sensor","leaf":true}"#,
        )
        .expect("ok");
        assert!(created.applied);
        let hcl = created.hcl.expect("hcl");
        // Stored in the sensor definition body (instance blocks carry only
        // `source`), while the reported path stays on the canvas path.
        assert!(hcl.contains(r#"instance "imu""#));
    }

    #[test]
    fn delete_connection_by_label_searches_definitions() {
        let hcl = mutate("", r#"{"kind":"add_component_definition","label":"bus"}"#)
            .expect("ok")
            .hcl
            .expect("hcl");
        let hcl = mutate(&hcl, r#"{"kind":"add_system","label":"demo"}"#)
            .expect("ok")
            .hcl
            .expect("hcl");
        // Endpoints must resolve: an instance inside the definition scope.
        let hcl = mutate(
            &hcl,
            r#"{"kind":"add_component_definition","label":"a","options":{"leaf":true,"ports":[{"label":"p"}]}}"#,
        )
        .expect("ok")
        .hcl
        .expect("hcl");
        let hcl = mutate(
            &hcl,
            r#"{"kind":"add_instance","parentPath":"bus","label":"x","source":"a"}"#,
        )
        .expect("ok")
        .hcl
        .expect("hcl");
        let hcl = mutate(
            &hcl,
            r#"{"kind":"add_connection","scopePath":"bus","label":"link","from":"x/p","to":"x/p"}"#,
        )
        .expect("ok")
        .hcl
        .expect("hcl");
        assert!(hcl.contains(r#"connection "link""#));

        let deleted = mutate(
            &hcl,
            r#"{"kind":"delete_connection_by_label","label":"link"}"#,
        )
        .expect("ok");
        assert!(deleted.applied);
        let hcl = deleted.hcl.expect("hcl");
        assert!(!hcl.contains(r#"connection "link""#));

        let missing = mutate(
            &hcl,
            r#"{"kind":"delete_connection_by_label","label":"nope"}"#,
        )
        .expect("ok");
        assert!(!missing.applied);
    }

    #[test]
    fn add_connection_refuses_endpoints_without_port_path() {
        for (from, to, field) in [
            ("a", "b/in", "from"),
            ("a/out", "b", "to"),
            ("a", "b", "from"),
        ] {
            let json = format!(
                r#"{{"kind":"add_connection","scopePath":"demo","label":"l","from":"{from}","to":"{to}"}}"#
            );
            let diagnostics = mutate("", &json).expect_err("must refuse");
            assert!(
                diagnostics.iter().any(|d| d.code == DiagnosticCode::E000
                    && d.message.contains("requires a port path")
                    && d.message.contains(field)),
                "expected E000 port-path refusal for {from}/{to}, got: {diagnostics:?}"
            );
        }
    }

    const LINKED: &str = r#"
component "a" {
  leaf = true
  port "out" {}
}
component "b" {
  leaf = true
  port "in" {}
}
system "demo" {
  instance "a" { source = "a" }
  instance "b" { source = "b" }
  connection "link" {
    from = "a/out"
    to   = "b/in"
  }
}
"#;

    /// Port labels of the definition `component`, from the emitted HCL.
    fn ports_in(hcl: &str, component: &str) -> Vec<String> {
        let model = crate::compile(&[Source {
            filename: "system.hcl".to_owned(),
            content: hcl.to_owned(),
        }]);
        let model = model.model.expect("model");
        model
            .definitions
            .iter()
            .filter_map(|id| model.component(*id))
            .find(|c| c.label == component)
            .map(|c| {
                c.ports
                    .iter()
                    .filter_map(|id| model.port(*id))
                    .map(|p| p.label.clone())
                    .collect()
            })
            .unwrap_or_default()
    }

    #[test]
    fn delete_connection_keeps_ports_by_default() {
        let result = mutate(
            LINKED,
            r#"{"kind":"delete_connection_by_label","label":"link"}"#,
        )
        .expect("ok");
        assert!(result.applied);
        let hcl = result.hcl.expect("hcl");
        assert!(!hcl.contains(r#"connection "link""#));
        assert_eq!(ports_in(&hcl, "a"), ["out"]);
        assert_eq!(ports_in(&hcl, "b"), ["in"]);
    }

    #[test]
    fn delete_connection_can_remove_its_endpoint_ports() {
        let result = mutate(
            LINKED,
            r#"{"kind":"delete_connection_by_label","label":"link","removePorts":true}"#,
        )
        .expect("ok");
        assert!(result.applied);
        let hcl = result.hcl.expect("hcl");
        assert!(!hcl.contains(r#"connection "link""#));
        assert!(ports_in(&hcl, "a").is_empty(), "{hcl}");
        assert!(ports_in(&hcl, "b").is_empty(), "{hcl}");
    }

    #[test]
    fn delete_connection_nested_endpoint_ports_are_removed_from_definitions() {
        let baseline = r#"
component "child" {
  leaf = true
  port "inner" {}
}
component "parent" {
  port "outer" {}
  instance "c" { source = "child" }
}
system "demo" {
  instance "p" { source = "parent" }
  connection "cross" {
    from = "p/c/inner"
    to   = "p/outer"
  }
}
"#;
        let result = mutate(
            baseline,
            r#"{"kind":"delete_connection_by_label","label":"cross","removePorts":true}"#,
        )
        .expect("ok");
        let hcl = result.hcl.expect("hcl");
        assert!(ports_in(&hcl, "child").is_empty(), "{hcl}");
        assert!(ports_in(&hcl, "parent").is_empty(), "{hcl}");
    }

    #[test]
    fn delete_connection_keeps_a_shared_port_and_removes_the_other() {
        let baseline = r#"
component "a" {
  leaf = true
  port "out" {}
}
component "b" {
  leaf = true
  port "in" {}
  port "spare" {}
}
system "demo" {
  instance "a" { source = "a" }
  instance "b" { source = "b" }
  connection "one" {
    from = "a/out"
    to   = "b/in"
  }
  connection "two" {
    from = "a/out"
    to   = "b/spare"
  }
}
"#;
        let result = mutate(
            baseline,
            r#"{"kind":"delete_connection_by_label","label":"one","removePorts":true}"#,
        )
        .expect("ok");
        assert!(result.applied);
        let hcl = result.hcl.expect("hcl");
        assert!(!hcl.contains(r#"connection "one""#));
        // `a/out` stays: `two` still uses it. `b/in` goes: nothing else uses it.
        assert_eq!(ports_in(&hcl, "a"), ["out"]);
        assert_eq!(ports_in(&hcl, "b"), ["spare"]);
    }

    #[test]
    fn delete_connection_selective_ports_remove_only_the_chosen_unshared_port() {
        let result = mutate(
            LINKED,
            r#"{"kind":"delete_connection_by_label","label":"link","removePorts":true,"ports":["a/out"]}"#,
        )
        .expect("ok");
        assert!(result.applied);
        let hcl = result.hcl.expect("hcl");
        assert!(!hcl.contains(r#"connection "link""#));
        assert!(ports_in(&hcl, "a").is_empty(), "{hcl}");
        assert_eq!(ports_in(&hcl, "b"), ["in"]);
    }

    #[test]
    fn delete_connection_selective_ports_skip_a_shared_port_without_refusal() {
        let baseline = r#"
component "a" {
  leaf = true
  port "out" {}
}
component "b" {
  leaf = true
  port "in" {}
  port "spare" {}
}
system "demo" {
  instance "a" { source = "a" }
  instance "b" { source = "b" }
  connection "one" {
    from = "a/out"
    to   = "b/in"
  }
  connection "two" {
    from = "a/out"
    to   = "b/spare"
  }
}
"#;
        let result = mutate(
            baseline,
            r#"{"kind":"delete_connection_by_label","label":"one","removePorts":true,"ports":["a/out","b/in"]}"#,
        )
        .expect("ok");
        assert!(result.applied);
        let hcl = result.hcl.expect("hcl");
        assert!(!hcl.contains(r#"connection "one""#));
        assert_eq!(ports_in(&hcl, "a"), ["out"]);
        assert_eq!(ports_in(&hcl, "b"), ["spare"]);
    }

    #[test]
    fn delete_connection_selective_ports_refuse_a_non_endpoint_port() {
        let diagnostics = mutate(
            LINKED,
            r#"{"kind":"delete_connection_by_label","label":"link","removePorts":true,"ports":["a/bogus"]}"#,
        )
        .expect_err("refused");
        let errors: Vec<_> = diagnostics
            .iter()
            .filter(|d| d.is_error())
            .map(|d| d.code)
            .collect();
        assert_eq!(errors, [DiagnosticCode::E000]);
    }

    #[test]
    fn delete_connection_logs_port_cleanup_as_one_action() {
        let removed = mutate(
            LINKED,
            r#"{"kind":"delete_connection_by_label","label":"link","removePorts":true}"#,
        )
        .expect("ok");
        assert_eq!(removed.actions.len(), 1);
        let json = serde_json::to_value(&removed.actions).expect("json");
        assert_eq!(json[0]["op"], "delete_connection");
        assert_eq!(json[0]["removePorts"], true);
        assert!(json[0].get("ports").is_none());

        let selective = mutate(
            LINKED,
            r#"{"kind":"delete_connection_by_label","label":"link","removePorts":true,"ports":["a/out"]}"#,
        )
        .expect("ok");
        let json = serde_json::to_value(&selective.actions).expect("json");
        assert_eq!(json[0]["ports"], serde_json::json!(["a/out"]));

        let plain = mutate(
            LINKED,
            r#"{"kind":"delete_connection_by_label","label":"link"}"#,
        )
        .expect("ok");
        let json = serde_json::to_value(&plain.actions).expect("json");
        assert!(json[0].get("removePorts").is_none());
    }

    #[test]
    fn logged_actions_match_typescript_model_action_json() {
        let action = LoggedAction::RenameComponent {
            path: "demo/a".to_owned(),
            new_label: "c".to_owned(),
        };
        let json = serde_json::to_value(&action).expect("json");
        assert_eq!(json["op"], "rename_component");
        assert_eq!(json["path"], "demo/a");
        assert_eq!(json["newLabel"], "c");

        let action = LoggedAction::AddDefinition {
            label: "cpu".to_owned(),
            leaf: true,
            full_name: String::new(),
            tags: Vec::new(),
            icon: None,
            color: None,
            border: None,
            font: None,
            ports: vec![PortJson {
                label: "p".to_owned(),
                full_name: None,
                protocol: Some("spi".to_owned()),
                role: Some("provider".to_owned()),
                external: None,
                required: None,
                tags: None,
            }],
        };
        let json = serde_json::to_value(&action).expect("json");
        assert_eq!(json["op"], "add_component_definition");
        assert_eq!(json["leaf"], true);
        assert_eq!(json["ports"][0]["protocol"], "spi");
        // Absent optionals are skipped, matching the TS `ModelAction` shape.
        assert!(json.get("icon").is_none());

        let action = LoggedAction::UpdateConnection {
            scope_path: "banking/bank-a".to_owned(),
            label: "tls".to_owned(),
            patch: ConnectionPatch {
                realized_by: Some(vec![ConnectionRef {
                    scope_path: "banking".to_owned(),
                    label: "http".to_owned(),
                }]),
                ..Default::default()
            },
        };
        let json = serde_json::to_value(&action).expect("json");
        assert_eq!(json["op"], "update_connection");
        assert_eq!(json["scopePath"], "banking/bank-a");
        assert_eq!(json["label"], "tls");
        assert_eq!(json["patch"]["realized_by"][0]["scopePath"], "banking");
        assert_eq!(json["patch"]["realized_by"][0]["label"], "http");
        // Untouched patch fields are skipped, matching `ModelAction`.
        assert!(json["patch"].get("full_name").is_none());

        let action = LoggedAction::AddProtocol {
            label: "spi".to_owned(),
            options: ProtocolPatch {
                full_name: Some("Serial".to_owned()),
                leaf: Some(true),
                ..Default::default()
            },
        };
        let json = serde_json::to_value(&action).expect("json");
        assert_eq!(json["op"], "add_protocol");
        assert_eq!(json["label"], "spi");
        assert_eq!(json["options"]["full_name"], "Serial");
        assert_eq!(json["options"]["leaf"], true);
        assert!(json["options"].get("roles").is_none());

        let action = LoggedAction::UpdateProtocol {
            path: "spi".to_owned(),
            patch: ProtocolPatch {
                encapsulates: Some(vec!["frame".to_owned()]),
                ..Default::default()
            },
        };
        let json = serde_json::to_value(&action).expect("json");
        assert_eq!(json["op"], "update_protocol");
        assert_eq!(json["path"], "spi");
        assert_eq!(json["patch"]["encapsulates"][0], "frame");

        let action = LoggedAction::DeleteProtocol {
            path: "spi".to_owned(),
        };
        let json = serde_json::to_value(&action).expect("json");
        assert_eq!(json["op"], "delete_protocol");
        assert_eq!(json["path"], "spi");
    }
}

#[cfg(test)]
mod leaf_and_visual_tests {
    use super::{DEFAULT_COLOR, DEFAULT_FONT};
    use super::{DefinitionOptions, ModelOp, PatchJson, mutate_to_hcl};

    #[test]
    fn adding_child_clears_definition_leaf() {
        let hcl = mutate_to_hcl(
            "system.hcl",
            "",
            &ModelOp::AddDefinition {
                label: "parent".to_owned(),
                options: DefinitionOptions {
                    leaf: Some(true),
                    ..Default::default()
                },
            },
        )
        .expect("ok")
        .hcl
        .expect("hcl");
        let hcl = mutate_to_hcl(
            "system.hcl",
            &hcl,
            &ModelOp::AddDefinition {
                label: "child".to_owned(),
                options: DefinitionOptions {
                    leaf: Some(true),
                    ..Default::default()
                },
            },
        )
        .expect("ok")
        .hcl
        .expect("hcl");
        let hcl = mutate_to_hcl(
            "system.hcl",
            &hcl,
            &ModelOp::AddInstance {
                parent_path: "parent".to_owned(),
                label: "child".to_owned(),
                source: "child".to_owned(),
            },
        )
        .expect("ok")
        .hcl
        .expect("hcl");
        // Only the child keeps its leaf flag; the parent lost it on gaining
        // a child.
        assert_eq!(hcl.matches("leaf        = true").count(), 1);
    }

    #[test]
    fn update_maps_visuals_and_clears_empties() {
        let hcl = mutate_to_hcl(
            "system.hcl",
            "",
            &ModelOp::AddDefinition {
                label: "comp".to_owned(),
                options: DefinitionOptions {
                    leaf: Some(true),
                    ..Default::default()
                },
            },
        )
        .expect("ok")
        .hcl
        .expect("hcl");
        let hcl = mutate_to_hcl(
            "system.hcl",
            &hcl,
            &ModelOp::Update {
                path: "comp".to_owned(),
                patch: PatchJson {
                    color: Some("#00ff00".to_owned()),
                    border: Some("dotted".to_owned()),
                    font: Some("italic".to_owned()),
                    ..Default::default()
                },
            },
        )
        .expect("ok")
        .hcl
        .expect("hcl");
        assert!(hcl.contains(r##"color       = "#00ff00""##));
        assert!(hcl.contains(r#"border      = "dotted""#));
        assert!(hcl.contains(r#"font        = "italic""#));

        let hcl = mutate_to_hcl(
            "system.hcl",
            &hcl,
            &ModelOp::Update {
                path: "comp".to_owned(),
                patch: PatchJson {
                    color: Some(String::new()),
                    border: Some("solid".to_owned()),
                    font: None,
                    ..Default::default()
                },
            },
        )
        .expect("ok")
        .hcl
        .expect("hcl");
        assert!(!hcl.contains("color       ="));
        assert!(!hcl.contains("border      ="));

        let bad = mutate_to_hcl(
            "system.hcl",
            &hcl,
            &ModelOp::Update {
                path: "comp".to_owned(),
                patch: PatchJson {
                    border: Some("groovy".to_owned()),
                    ..Default::default()
                },
            },
        );
        assert!(bad.is_err());
    }

    #[test]
    fn update_clears_visuals_on_explicit_defaults() {
        let hcl = mutate_to_hcl(
            "system.hcl",
            "",
            &ModelOp::AddDefinition {
                label: "comp".to_owned(),
                options: DefinitionOptions {
                    leaf: Some(true),
                    ..Default::default()
                },
            },
        )
        .expect("ok")
        .hcl
        .expect("hcl");
        let hcl = mutate_to_hcl(
            "system.hcl",
            &hcl,
            &ModelOp::Update {
                path: "comp".to_owned(),
                patch: PatchJson {
                    color: Some("warning".to_owned()),
                    border: Some("dotted".to_owned()),
                    font: Some("bold".to_owned()),
                    ..Default::default()
                },
            },
        )
        .expect("ok")
        .hcl
        .expect("hcl");
        assert!(hcl.contains(r#"color       = "warning""#));
        assert!(hcl.contains(r#"border      = "dotted""#));
        assert!(hcl.contains(r#"font        = "bold""#));

        // The web inspector's reset options send explicit defaults —
        // `"default"` (color), `"solid"` (border), `"unstyled"` (font) —
        // which must clear the attribute, never persist literally.
        let hcl = mutate_to_hcl(
            "system.hcl",
            &hcl,
            &ModelOp::Update {
                path: "comp".to_owned(),
                patch: PatchJson {
                    color: Some(DEFAULT_COLOR.to_owned()),
                    border: Some("solid".to_owned()),
                    font: Some(DEFAULT_FONT.to_owned()),
                    ..Default::default()
                },
            },
        )
        .expect("ok")
        .hcl
        .expect("hcl");
        assert!(!hcl.contains("color       ="));
        assert!(!hcl.contains("border      ="));
        assert!(!hcl.contains("font        ="));
    }

    fn mutate_op(
        content: &str,
        json: &str,
    ) -> Result<super::MutationResult, Vec<super::Diagnostic>> {
        mutate_to_hcl(
            "system.hcl",
            content,
            &serde_json::from_str::<ModelOp>(json).expect("op JSON must parse"),
        )
    }

    /// Definition `bank` declares `low` and `high` (which realizes `low`), and
    /// system `banking` holds one copy of it.
    const REALIZED_BANK: &str = r#"
component "stack" {
  leaf = true

  port "p" {}
}
component "bank" {
  port "p" {}

  instance "stack" { source = "stack" }
  connection "low" {
    from = "stack/p"
    to = "stack/p"
  }
  connection "high" {
    from = "stack/p"
    to = "stack/p"
    realized_by = ["low"]
  }
}
system "banking" {
  instance "bank-a" { source = "bank" }
}
"#;

    #[test]
    fn delete_connection_drops_realized_by_entries_that_target_it() {
        let result = mutate_op(
            REALIZED_BANK,
            r#"{"kind":"delete_connection_by_label","label":"low"}"#,
        )
        .expect("deleting a realized connection must succeed");
        let hcl = result.hcl.expect("hcl");
        assert!(!hcl.contains("realized_by"), "dangling entry kept:\n{hcl}");
        assert!(hcl.contains("connection \"high\""), "{hcl}");
    }

    #[test]
    fn delete_instance_drops_realized_by_entries_into_it() {
        let src = r#"
component "stack" {
  leaf = true

  port "p" {}
}
component "bank" {
  port "p" {}

  instance "stack" { source = "stack" }
  connection "http-request" {
    from = "stack/p"
    to = "stack/p"
  }
}
system "banking" {
  instance "bank-a" { source = "bank" }
  instance "ext" { source = "stack" }
  connection "tls" {
    from = "ext/p"
    to = "ext/p"
    realized_by = ["bank-a/http-request"]
  }
}
"#;
        let result = mutate_op(
            src,
            r#"{"kind":"delete_component","path":"banking/bank-a"}"#,
        )
        .expect("deleting an instance must succeed");
        let hcl = result.hcl.expect("hcl");
        assert!(!hcl.contains("realized_by"), "dangling entry kept:\n{hcl}");
        assert!(hcl.contains("connection \"tls\""), "{hcl}");
    }

    #[test]
    fn delete_keeps_realized_by_entries_that_still_resolve() {
        let src = r#"
component "stack" {
  leaf = true

  port "p" {}
}
system "banking" {
  instance "ext" { source = "stack" }
  connection "uplink" {
    from = "ext/p"
    to = "ext/p"
  }
  connection "tls" {
    from = "ext/p"
    to = "ext/p"
    realized_by = ["uplink"]
  }
  connection "spare" {
    from = "ext/p"
    to = "ext/p"
  }
}
"#;
        let result = mutate_op(
            src,
            r#"{"kind":"delete_connection_by_label","label":"spare"}"#,
        )
        .expect("ok");
        let hcl = result.hcl.expect("hcl");
        assert!(hcl.contains("realized_by"), "live entry removed:\n{hcl}");
    }
}

#[cfg(test)]
mod update_connection_tests {
    use super::{ConnectionPatch, ConnectionRef, ModelOp, mutate_to_hcl};
    use crate::diagnostics::{Diagnostic, DiagnosticCode};

    fn mutate_op(content: &str, json: &str) -> Result<super::MutationResult, Vec<Diagnostic>> {
        mutate_to_hcl(
            "system.hcl",
            content,
            &serde_json::from_str::<ModelOp>(json).expect("op JSON must parse"),
        )
    }

    /// System `banking` with two connections between the same instance.
    const TWO_LINKS: &str = r#"
component "stack" {
  leaf = true

  port "p" {}
}
system "banking" {
  instance "ext" { source = "stack" }
  connection "uplink" {
    from = "ext/p"
    to = "ext/p"
  }
  connection "tls" {
    from = "ext/p"
    to = "ext/p"
  }
}
"#;

    /// Definition `bank` declares `low` and `high`; system `banking` holds
    /// instance `bank-a` of it and a connection `tls` to that instance.
    const BANK_WITH_TLS: &str = r#"
component "stack" {
  leaf = true

  port "p" {}
}
component "bank" {
  port "p" {}

  instance "stack" { source = "stack" }
  connection "low" {
    from = "stack/p"
    to = "stack/p"
  }
  connection "high" {
    from = "stack/p"
    to = "stack/p"
  }
}
system "banking" {
  instance "bank-a" { source = "bank" }
  connection "tls" {
    from = "bank-a/p"
    to = "bank-a/p"
  }
}
"#;

    #[test]
    fn full_name_tags_and_level_are_patched() {
        let result = mutate_op(
            TWO_LINKS,
            r#"{"kind":"update_connection","scopePath":"banking","label":"tls",
                "patch":{"full_name":"Transport layer","tags":["secure"],"level":2}}"#,
        )
        .expect("ok");
        assert!(result.applied);
        let hcl = result.hcl.expect("hcl");
        assert!(hcl.contains(r#""Transport layer""#), "{hcl}");
        assert!(hcl.contains(r#"["secure"]"#), "{hcl}");
        assert!(hcl.contains("= 2"), "{hcl}");
        assert_eq!(
            result.actions,
            vec![super::LoggedAction::UpdateConnection {
                scope_path: "banking".to_owned(),
                label: "tls".to_owned(),
                patch: ConnectionPatch {
                    full_name: Some("Transport layer".to_owned()),
                    tags: Some(vec!["secure".to_owned()]),
                    level: Some(2),
                    realized_by: None,
                },
            }]
        );
    }

    #[test]
    fn empty_full_name_clears_it() {
        let named = mutate_op(
            TWO_LINKS,
            r#"{"kind":"update_connection","scopePath":"banking","label":"tls",
                "patch":{"full_name":"Transport"}}"#,
        )
        .expect("ok")
        .hcl
        .expect("hcl");
        let cleared = mutate_op(
            &named,
            r#"{"kind":"update_connection","scopePath":"banking","label":"tls",
                "patch":{"full_name":""}}"#,
        )
        .expect("ok")
        .hcl
        .expect("hcl");
        assert!(!cleared.contains("Transport"), "{cleared}");
    }

    #[test]
    fn same_scope_realized_by_is_a_bare_label() {
        let result = mutate_op(
            TWO_LINKS,
            r#"{"kind":"update_connection","scopePath":"banking","label":"tls",
                "patch":{"realized_by":[{"scopePath":"banking","label":"uplink"}]}}"#,
        )
        .expect("ok");
        let hcl = result.hcl.expect("hcl");
        assert!(
            hcl.contains(r#"realized_by  = ["uplink"]"#),
            "expected a bare label:\n{hcl}"
        );
    }

    #[test]
    fn realized_by_into_an_instance_is_an_absolute_path_in_a_system() {
        let result = mutate_op(
            BANK_WITH_TLS,
            r#"{"kind":"update_connection","scopePath":"banking","label":"tls",
                "patch":{"realized_by":[{"scopePath":"banking/bank-a","label":"low"}]}}"#,
        )
        .expect("ok");
        let hcl = result.hcl.expect("hcl");
        assert!(
            hcl.contains(r#"realized_by  = ["/banking/bank-a/low"]"#),
            "{hcl}"
        );
    }

    #[test]
    fn realized_by_replaces_the_whole_list_and_collapses_duplicates() {
        let with_two = mutate_op(
            TWO_LINKS,
            r#"{"kind":"update_connection","scopePath":"banking","label":"tls",
                "patch":{"realized_by":[{"scopePath":"banking","label":"uplink"},
                                        {"scopePath":"banking","label":"uplink"}]}}"#,
        )
        .expect("ok")
        .hcl
        .expect("hcl");
        assert!(
            with_two.contains(r#"realized_by  = ["uplink"]"#),
            "{with_two}"
        );

        let cleared = mutate_op(
            &with_two,
            r#"{"kind":"update_connection","scopePath":"banking","label":"tls",
                "patch":{"realized_by":[]}}"#,
        )
        .expect("ok")
        .hcl
        .expect("hcl");
        assert!(!cleared.contains("realized_by"), "{cleared}");
    }

    #[test]
    fn realized_by_cycle_is_refused_with_e018() {
        let src = r#"
component "stack" {
  leaf = true

  port "p" {}
}
system "banking" {
  instance "ext" { source = "stack" }
  connection "a" {
    from = "ext/p"
    to = "ext/p"
    realized_by = ["b"]
  }
  connection "b" {
    from = "ext/p"
    to = "ext/p"
  }
}
"#;
        let diagnostics = mutate_op(
            src,
            r#"{"kind":"update_connection","scopePath":"banking","label":"b",
                "patch":{"realized_by":[{"scopePath":"banking","label":"a"}]}}"#,
        )
        .expect_err("a realized_by cycle must be refused");
        assert!(
            diagnostics.iter().any(|d| d.code == DiagnosticCode::E018),
            "{diagnostics:?}"
        );
    }

    #[test]
    fn unknown_target_is_refused_with_e017() {
        let diagnostics = mutate_op(
            TWO_LINKS,
            r#"{"kind":"update_connection","scopePath":"banking","label":"tls",
                "patch":{"realized_by":[{"scopePath":"banking","label":"nope"}]}}"#,
        )
        .expect_err("an unresolved entry must be refused");
        assert!(
            diagnostics.iter().any(|d| d.code == DiagnosticCode::E017),
            "{diagnostics:?}"
        );
    }

    #[test]
    fn edit_to_a_definition_connection_applies_to_the_definition() {
        let result = mutate_op(
            REALIZED_BANK_FOR_COPIES,
            r#"{"kind":"update_connection","scopePath":"banking/bank-a","label":"high",
                "patch":{"full_name":"High tier"}}"#,
        )
        .expect("ok");
        let hcl = result.hcl.expect("hcl");
        let definition = hcl.find(r#"component "bank""#).expect("definition");
        let system = hcl.find(r#"system "banking""#).expect("system");
        let name = hcl.find("High tier").expect("name written");
        assert!(
            definition < name && name < system,
            "name must land in the definition body:\n{hcl}"
        );
        assert_eq!(hcl.matches("High tier").count(), 1, "{hcl}");
    }

    const REALIZED_BANK_FOR_COPIES: &str = r#"
component "stack" {
  leaf = true

  port "p" {}
}
component "bank" {
  port "p" {}

  instance "stack" { source = "stack" }
  connection "low" {
    from = "stack/p"
    to = "stack/p"
  }
  connection "high" {
    from = "stack/p"
    to = "stack/p"
    realized_by = ["low"]
  }
}
system "banking" {
  instance "bank-a" { source = "bank" }
}
"#;

    #[test]
    fn empty_patch_keeps_canonical_output() {
        let once = mutate_op(
            TWO_LINKS,
            r#"{"kind":"update_connection","scopePath":"banking","label":"tls","patch":{}}"#,
        )
        .expect("ok")
        .hcl
        .expect("hcl");
        let twice = mutate_op(
            &once,
            r#"{"kind":"update_connection","scopePath":"banking","label":"tls","patch":{}}"#,
        )
        .expect("ok")
        .hcl
        .expect("hcl");
        assert_eq!(once, twice, "an empty patch must not change canonical HCL");
        assert!(!once.contains("realized_by"), "{once}");
    }

    #[test]
    fn unknown_connection_is_a_guard_refusal() {
        let result = mutate_op(
            TWO_LINKS,
            r#"{"kind":"update_connection","scopePath":"banking","label":"missing","patch":{}}"#,
        )
        .expect("a guard miss is not an error");
        assert!(!result.applied);
        assert!(result.hcl.is_none());
    }

    #[test]
    fn unknown_patch_fields_are_rejected() {
        let parsed = serde_json::from_str::<ModelOp>(
            r#"{"kind":"update_connection","scopePath":"banking","label":"tls","patch":{"from":"x"}}"#,
        );
        assert!(parsed.is_err());
    }

    #[test]
    fn realized_by_entry_is_relative_inside_a_definition() {
        use super::realized_by_entry;
        let target = |scope: &str, label: &str| ConnectionRef {
            scope_path: scope.to_owned(),
            label: label.to_owned(),
        };
        // Same scope: bare label.
        assert_eq!(
            realized_by_entry("bank", true, &target("bank", "low")),
            "low"
        );
        // Child instance of the definition: walk down.
        assert_eq!(
            realized_by_entry("bank", true, &target("bank/stack", "tcp")),
            "stack/tcp"
        );
        // Parent scope: walk up.
        assert_eq!(
            realized_by_entry("bank/stack", true, &target("bank", "low")),
            "../low"
        );
        // Sideways: up, then down.
        assert_eq!(
            realized_by_entry("bank/stack", true, &target("bank/other", "x")),
            "../other/x"
        );
        // Different tree: absolute, and the resolver refuses it.
        assert_eq!(
            realized_by_entry("bank", true, &target("banking/bank-a", "x")),
            "/banking/bank-a/x"
        );
    }

    #[test]
    fn realized_by_entry_is_absolute_inside_a_system() {
        use super::realized_by_entry;
        let target = ConnectionRef {
            scope_path: "banking/bank-a".to_owned(),
            label: "low".to_owned(),
        };
        assert_eq!(
            realized_by_entry("banking", false, &target),
            "/banking/bank-a/low"
        );
        let sibling = ConnectionRef {
            scope_path: "banking".to_owned(),
            label: "uplink".to_owned(),
        };
        assert_eq!(
            realized_by_entry("banking", false, &sibling),
            "uplink",
            "the declaring scope itself is always a bare label"
        );
    }
}

#[cfg(test)]
mod protocol_ops_tests {
    use super::{ModelOp, mutate_to_hcl};
    use crate::diagnostics::{Diagnostic, DiagnosticCode};

    fn mutate_op(content: &str, json: &str) -> Result<super::MutationResult, Vec<Diagnostic>> {
        let op: ModelOp = serde_json::from_str(json).expect("op JSON must parse");
        mutate_to_hcl("system.hcl", content, &op)
    }

    /// Adds a protocol through the op itself, so the baseline is canonical.
    fn with_protocol(content: &str, json: &str) -> String {
        mutate_op(content, json)
            .expect("baseline op must apply")
            .hcl
            .expect("baseline op must write HCL")
    }

    fn codes(diagnostics: &[Diagnostic]) -> Vec<DiagnosticCode> {
        diagnostics.iter().map(|d| d.code).collect()
    }

    #[test]
    fn add_protocol_writes_every_attribute() {
        let result = mutate_op(
            "",
            r#"{"kind":"add_protocol","label":"spi","options":{"full_name":"Serial Peripheral","tags":["bus"],"roles":["provider","consumer"],"leaf":true,"encapsulates":["frame"]}}"#,
        )
        .expect("ok");
        assert!(result.applied);
        let hcl = result.hcl.expect("hcl");
        assert!(hcl.contains(r#"protocol "spi""#), "{hcl}");
        assert!(hcl.contains(r#"full_name = "Serial Peripheral""#), "{hcl}");
        assert!(hcl.contains(r#"tags        = ["bus"]"#), "{hcl}");
        assert!(
            hcl.contains(r#"roles       = ["provider", "consumer"]"#),
            "{hcl}"
        );
        assert!(hcl.contains("leaf        = true"), "{hcl}");
        assert!(hcl.contains(r#"encapsulates = ["frame"]"#), "{hcl}");
    }

    #[test]
    fn add_protocol_without_options_writes_a_bare_block() {
        let hcl = with_protocol("", r#"{"kind":"add_protocol","label":"bare"}"#);
        assert_eq!(hcl, "protocol \"bare\" {\n}\n");
    }

    #[test]
    fn add_protocol_logs_the_action_for_replay() {
        let result = mutate_op(
            "",
            r#"{"kind":"add_protocol","label":"spi","options":{"leaf":true}}"#,
        )
        .expect("ok");
        let json = serde_json::to_value(&result.actions).expect("json");
        assert_eq!(json[0]["op"], "add_protocol");
        assert_eq!(json[0]["label"], "spi");
        assert_eq!(json[0]["options"]["leaf"], true);
    }

    #[test]
    fn add_protocol_refuses_blank_slashed_and_existing_labels() {
        let base = with_protocol("", r#"{"kind":"add_protocol","label":"spi"}"#);
        for json in [
            r#"{"kind":"add_protocol","label":""}"#,
            r#"{"kind":"add_protocol","label":"a/b"}"#,
            r#"{"kind":"add_protocol","label":"spi"}"#,
        ] {
            let diagnostics = mutate_op(&base, json).expect_err("must refuse");
            assert_eq!(codes(&diagnostics), vec![DiagnosticCode::E000], "{json}");
        }
    }

    #[test]
    fn update_protocol_patches_only_the_given_fields() {
        let base = with_protocol(
            "",
            r#"{"kind":"add_protocol","label":"spi","options":{"full_name":"Old","tags":["bus"],"leaf":true}}"#,
        );
        let result = mutate_op(
            &base,
            r#"{"kind":"update_protocol","path":"spi","patch":{"full_name":"New","tags":[]}}"#,
        )
        .expect("ok");
        assert!(result.applied);
        let hcl = result.hcl.expect("hcl");
        assert!(hcl.contains(r#"full_name = "New""#), "{hcl}");
        assert!(!hcl.contains("tags"), "tags cleared by []:\n{hcl}");
        assert!(hcl.contains("leaf        = true"), "leaf kept:\n{hcl}");
    }

    #[test]
    fn update_protocol_clears_roles_and_leaf_and_replaces_encapsulates() {
        let base = with_protocol(
            "",
            r#"{"kind":"add_protocol","label":"spi","options":{"roles":["provider"],"leaf":true,"encapsulates":["a"]}}"#,
        );
        let result = mutate_op(
            &base,
            r#"{"kind":"update_protocol","path":"spi","patch":{"roles":[],"leaf":false,"encapsulates":["b"]}}"#,
        )
        .expect("ok");
        let hcl = result.hcl.expect("hcl");
        assert!(
            !hcl.contains("roles"),
            "empty roles means unrestricted:\n{hcl}"
        );
        assert!(!hcl.contains("leaf"), "leaf false is the default:\n{hcl}");
        assert!(hcl.contains(r#"encapsulates = ["b"]"#), "{hcl}");
        assert!(!hcl.contains(r#""a""#), "replacement, not merge:\n{hcl}");
    }

    #[test]
    fn update_protocol_with_nothing_to_change_keeps_the_canonical_output() {
        let base = with_protocol(
            "",
            r#"{"kind":"add_protocol","label":"spi","options":{"full_name":"Serial","tags":["bus"],"roles":["provider"],"leaf":true}}"#,
        );
        let result = mutate_op(
            &base,
            r#"{"kind":"update_protocol","path":"spi","patch":{}}"#,
        )
        .expect("ok");
        assert_eq!(result.hcl.as_deref(), Some(base.as_str()));
    }

    #[test]
    fn update_protocol_keeps_its_messages() {
        let base = r#"protocol "spi" {
  message "frame" {
    field "len" {
      type = "uint8"
    }
  }
}
"#;
        let result = mutate_op(
            base,
            r#"{"kind":"update_protocol","path":"spi","patch":{"leaf":true}}"#,
        )
        .expect("ok");
        let hcl = result.hcl.expect("hcl");
        assert!(hcl.contains(r#"message "frame""#), "{hcl}");
        assert!(hcl.contains(r#"field "len""#), "{hcl}");
    }

    #[test]
    fn update_protocol_rejects_unknown_fields_and_label_changes() {
        for json in [
            r#"{"kind":"update_protocol","path":"spi","patch":{"label":"other"}}"#,
            r#"{"kind":"update_protocol","path":"spi","patch":{"icon":"x"}}"#,
        ] {
            assert!(
                serde_json::from_str::<ModelOp>(json).is_err(),
                "must reject {json}"
            );
        }
    }

    #[test]
    fn update_protocol_on_an_unknown_label_is_a_guard_refusal() {
        let result = mutate_op(
            "",
            r#"{"kind":"update_protocol","path":"ghost","patch":{"leaf":true}}"#,
        )
        .expect("a guard miss is not an error");
        assert!(!result.applied);
        assert!(result.hcl.is_none());
    }

    #[test]
    fn update_protocol_refuses_an_encapsulates_cycle_with_e020() {
        let base = with_protocol("", r#"{"kind":"add_protocol","label":"a"}"#);
        let base = with_protocol(
            &base,
            r#"{"kind":"add_protocol","label":"b","options":{"encapsulates":["a"]}}"#,
        );
        let diagnostics = mutate_op(
            &base,
            r#"{"kind":"update_protocol","path":"a","patch":{"encapsulates":["b"]}}"#,
        )
        .expect_err("cycle must refuse");
        assert!(
            codes(&diagnostics).contains(&DiagnosticCode::E020),
            "{diagnostics:?}"
        );
    }

    #[test]
    fn update_protocol_refuses_a_role_that_a_port_no_longer_has_with_e009() {
        let base = r#"protocol "serial" {
  roles = ["provider", "consumer"]
}

component "mcu" {
  leaf = true
  port "uart" {
    protocol = "serial"
    role     = "consumer"
  }
}

system "drone" {
  instance "mcu" { source = "mcu" }
}
"#;
        let diagnostics = mutate_op(
            base,
            r#"{"kind":"update_protocol","path":"serial","patch":{"roles":["provider"]}}"#,
        )
        .expect_err("role must refuse");
        assert!(
            codes(&diagnostics).contains(&DiagnosticCode::E009),
            "{diagnostics:?}"
        );
    }

    #[test]
    fn delete_protocol_is_refused_while_a_port_uses_it() {
        let base = r#"protocol "serial" {}

component "mcu" {
  leaf = true
  port "uart" {
    protocol = "serial"
    role     = "peer"
  }
}
"#;
        let diagnostics = mutate_op(base, r#"{"kind":"delete_protocol","path":"serial"}"#)
            .expect_err("used protocol must refuse");
        assert_eq!(codes(&diagnostics), vec![DiagnosticCode::E000]);
        let message = &diagnostics[0].message;
        assert!(message.contains("port `uart` of `mcu`"), "{message}");
    }

    #[test]
    fn delete_protocol_is_refused_while_another_protocol_encapsulates_it() {
        let base = r#"protocol "frame" {}
protocol "tunnel" {
  encapsulates = ["frame"]
}
"#;
        let diagnostics = mutate_op(base, r#"{"kind":"delete_protocol","path":"frame"}"#)
            .expect_err("encapsulated protocol must refuse");
        assert_eq!(codes(&diagnostics), vec![DiagnosticCode::E000]);
        assert!(diagnostics[0].message.contains("protocol `tunnel`"));
    }

    #[test]
    fn delete_protocol_succeeds_once_nothing_uses_it_and_drops_its_messages() {
        let base = r#"protocol "frame" {
  message "header" {
    field "len" {
      type = "uint8"
    }
  }
}
protocol "tunnel" {
  encapsulates = ["frame"]
}
component "mcu" {
  leaf = true
  port "uart" {
    protocol = "tunnel"
    role     = "peer"
  }
}
"#;
        // `tunnel` still lists `frame`, so the delete is refused. Once
        // `tunnel` stops listing it, nothing uses `frame` and the delete goes
        // through.
        let trimmed = r#"protocol "frame" {
  message "header" {
    field "len" {
      type = "uint8"
    }
  }
}
protocol "tunnel" {
}
component "mcu" {
  leaf = true
  port "uart" {
    protocol = "tunnel"
    role     = "peer"
  }
}
"#;
        let refused = mutate_op(base, r#"{"kind":"delete_protocol","path":"frame"}"#);
        assert!(refused.is_err(), "still listed by tunnel");

        let result =
            mutate_op(trimmed, r#"{"kind":"delete_protocol","path":"frame"}"#).expect("ok");
        assert!(result.applied);
        let hcl = result.hcl.expect("hcl");
        assert!(!hcl.contains(r#"protocol "frame""#), "{hcl}");
        assert!(
            !hcl.contains("header"),
            "messages go with the protocol:\n{hcl}"
        );
        assert!(hcl.contains(r#"protocol "tunnel""#), "{hcl}");
    }

    #[test]
    fn delete_protocol_on_an_unknown_label_is_a_guard_refusal() {
        let result = mutate_op("", r#"{"kind":"delete_protocol","path":"ghost"}"#).expect("ok");
        assert!(!result.applied);
    }
}
