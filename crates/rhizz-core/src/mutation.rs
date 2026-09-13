//! Declarative model mutations owned by `rhizz-core`.
//!
//! This is the structural follow-up to the architecture audit's duplicate
//! serializer finding: instead of every frontend reimplementing "load, tweak,
//! re-emit HCL", frontends send a [`ModelOp`] and get back canonical HCL.
//!
//! Execution model (single-file, mirroring what the web editor always did):
//! parse the primary file into a [`RawFile`](crate::parse::RawFile), apply
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
use crate::model::BorderStyle;
use crate::parse::{
    Labeled, RawComponent, RawConnection, RawFile, RawInstance, RawPort, RawProject, RawSystem,
    parse_file,
};
use crate::{Source, resolve, serialize};

// ── Op input (mirrors the TypeScript `ModelMutationOp` JSON 1:1) ─────────────

/// A single declarative model mutation, deserialized from the frontend's op
/// JSON. Variant names match the TypeScript `kind` strings (`snake_case`);
/// variant fields match the TypeScript property names (`camelCase`).
#[derive(Debug, Deserialize)]
#[serde(tag = "kind")]
pub enum ModelOp {
    /// Add a system block; no-op when the label already exists.
    #[serde(rename = "add_system")]
    AddSystem {
        label: String,
        #[serde(default)]
        description: String,
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
        description: Option<String>,
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
    Rename {
        path: String,
        new_label: String,
    },
    /// Patch attributes on a definition (instance paths redirect to their
    /// definition, mirroring the old TypeScript store).
    #[serde(rename = "update_component")]
    Update {
        path: String,
        patch: PatchJson,
    },
    /// Delete a definition (bare label) or a placed instance.
    #[serde(rename = "delete_component")]
    Delete {
        path: String,
    },
    /// Add a connection inside a scope.
    #[serde(rename = "add_connection")]
    #[serde(rename_all = "camelCase")]
    AddConnection {
        scope_path: String,
        label: String,
        from: String,
        to: String,
    },
    /// Delete a connection by label, searching systems then definitions.
    #[serde(rename = "delete_connection_by_label")]
    DeleteConnectionByLabel {
        label: String,
    },
}

/// Options for [`ModelOp::AddDefinition`] / definition-mode creates.
#[derive(Debug, Default, Deserialize)]
pub struct DefinitionOptions {
    /// Atomic flag.
    pub leaf: Option<bool>,
    /// Human-readable description.
    pub description: Option<String>,
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
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
pub struct PortJson {
    /// Port label (required).
    pub label: String,
    /// Optional description.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
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

/// Attribute patch for [`ModelOp::Update`]. `None` means untouched; empty
/// strings clear their field (mirroring the old TypeScript emitter, which
/// omitted defaults).
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq)]
pub struct PatchJson {
    /// Human-readable description.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Optional icon name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    /// Optional border color.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// Border style; `"solid"` and empty clear it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub border: Option<String>,
    /// Optional font style.
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

// ── Logged actions (mirrors the TypeScript `ModelAction` JSON) ───────────────

/// Actions an applied op reports, in the exact JSON shape the web action log
/// records. The TypeScript dispatcher forwards these to its mutation
/// observers untouched.
#[derive(Debug, Serialize, PartialEq)]
#[serde(tag = "op")]
pub enum LoggedAction {
    /// A system block was added.
    #[serde(rename = "add_system")]
    AddSystem {
        label: String,
        description: String,
    },
    /// A component definition was added.
    #[serde(rename = "add_component_definition")]
    #[serde(rename_all = "camelCase")]
    AddDefinition {
        label: String,
        leaf: bool,
        description: String,
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
    RenameComponent {
        path: String,
        new_label: String,
    },
    /// A definition or placed instance was deleted.
    #[serde(rename = "delete_component")]
    DeleteComponent {
        path: String,
    },
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
    UpdateComponent {
        path: String,
        patch: PatchJson,
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
    /// A connection was deleted.
    #[serde(rename = "delete_connection")]
    #[serde(rename_all = "camelCase")]
    DeleteConnection {
        scope_path: String,
        label: String,
    },
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
    MutationError::InvalidInput(format!("unknown container '{path}'"))
}

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
            description: port.description.clone().and_then(|d| non_empty(&d)),
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
        ModelOp::AddSystem { label, description } => {
            let action = add_system(raw, label, description)?;
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
            let Some(scope) = resolve_scope_or_idle(raw, parent_path)? else {
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
            description,
            tags,
            ports,
        } => create_component(raw, &CreateParams {
            label,
            parent_key,
            source_label,
            leaf: *leaf,
            description: description.clone(),
            tags: tags.clone(),
            ports: ports.clone(),
        }),
        ModelOp::Reparent {
            source_path,
            target_parent_path,
        } => reparent(raw, source_path, target_parent_path),
        ModelOp::Rename { path, new_label } => rename(raw, path, new_label),
        ModelOp::Update { path, patch } => update(raw, path, patch),
        ModelOp::Delete { path } => delete(raw, path),
        ModelOp::AddConnection {
            scope_path,
            label,
            from,
            to,
        } => {
            let Some(scope) = resolve_scope_or_idle(raw, scope_path)? else {
                return Ok(idle());
            };
            let connections = scope_connections_mut(raw, scope)?;
            if connections.iter().any(|c| c.label == *label) {
                return Ok(applied_none());
            }
            connections.push(Labeled {
                label: label.clone(),
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
                    scope_path: scope_path.clone(),
                    label: label.clone(),
                    from: from.clone(),
                    to: to.clone(),
                }],
            })
        }
        ModelOp::DeleteConnectionByLabel { label } => {
            if let Some(index) =
                raw.systems.iter().position(|s| {
                    s.inner.connections.iter().any(|c| c.label == *label)
                })
            {
                let system = raw
                    .systems
                    .get(index)
                    .map_or_else(String::new, |s| s.label.clone());
                delete_connection(raw, Scope::System(index), label);
                return Ok(ApplyOutcome {
                    applied: true,
                    path: None,
                    actions: vec![LoggedAction::DeleteConnection {
                        scope_path: system,
                        label: label.clone(),
                    }],
                });
            }
            if let Some(index) =
                raw.components.iter().position(|c| {
                    c.inner.connections.iter().any(|c| c.label == *label)
                })
            {
                let definition = raw
                    .components
                    .get(index)
                    .map_or_else(String::new, |c| c.label.clone());
                delete_connection(raw, Scope::Definition(index), label);
                return Ok(ApplyOutcome {
                    applied: true,
                    path: None,
                    actions: vec![LoggedAction::DeleteConnection {
                        scope_path: definition,
                        label: label.clone(),
                    }],
                });
            }
            Ok(idle())
        }
    }
}

fn idle() -> ApplyOutcome {
    ApplyOutcome {
        applied: false,
        path: None,
        actions: Vec::new(),
    }
}

fn applied_none() -> ApplyOutcome {
    ApplyOutcome {
        applied: true,
        path: None,
        actions: Vec::new(),
    }
}

fn applied(actions: Vec<LoggedAction>) -> ApplyOutcome {
    ApplyOutcome {
        applied: true,
        path: None,
        actions,
    }
}

/// `None` when the container is unknown (guard refusal, not an error).
fn resolve_scope_or_idle(raw: &RawFile, path: &str) -> Result<Option<Scope>, MutationError> {
    match resolve_scope(raw, path) {
        Ok(scope) => Ok(Some(scope)),
        Err(_) => Ok(None),
    }
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
    description: &str,
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
            description: non_empty(description),
            ..Default::default()
        },
    });
    Ok(Some(LoggedAction::AddSystem {
        label: label.to_owned(),
        description: description.to_owned(),
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
            description: options.description.clone().and_then(|d| non_empty(&d)),
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
        description: options.description.clone().unwrap_or_default(),
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
    if let Scope::Definition(i) = scope {
        if let Some(definition) = raw.components.get_mut(i) {
            definition.inner.leaf = Some(false);
        }
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
    description: Option<String>,
    tags: Option<Vec<String>>,
    ports: Option<Vec<PortJson>>,
}

/// Fallback system created when a create has nowhere to place, mirroring
/// the web editor (`EMPTY_PROJECT_HCL` / the create fallback).
const FALLBACK_SYSTEM_DESCRIPTION: &str = "Main system";

fn create_component(raw: &mut RawFile, params: &CreateParams<'_>) -> Result<ApplyOutcome, MutationError> {
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
            actions.extend(add_system(raw, "main", FALLBACK_SYSTEM_DESCRIPTION)?);
            parent = "main".to_owned();
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
    if params.source_label.is_empty() {
        // New-definition mode also places an instance — otherwise creation
        // closes with nothing visibly changing on the canvas.
        actions.extend(add_definition(raw, params.label, &DefinitionOptions {
            leaf: params.leaf,
            description: params.description.clone(),
            tags: params.tags.clone(),
            ports: params.ports.clone(),
            ..Default::default()
        })?);
        let scope = resolve_scope(raw, &parent).map_err(|_| {
            MutationError::InvalidInput(format!("unknown container '{parent}'"))
        })?;
        actions.extend(add_instance(raw, scope, params.label, params.label)?);
        let label = params.label;
        Ok(ApplyOutcome {
            applied: true,
            path: Some(format!("{parent}/{label}")),
            actions,
        })
    } else {
        let scope = resolve_scope(raw, &parent).map_err(|_| {
            MutationError::InvalidInput(format!("unknown container '{parent}'"))
        })?;
        actions.extend(add_instance(raw, scope, params.label, params.source_label)?);
        let label = params.label;
        Ok(ApplyOutcome {
            applied: true,
            path: Some(format!("{parent}/{label}")),
            actions,
        })
    }
}

fn reparent(
    raw: &mut RawFile,
    source_path: &str,
    target_parent_path: &str,
) -> Result<ApplyOutcome, MutationError> {
    let segments: Vec<&str> = source_path
        .split('/')
        .filter(|s| !s.is_empty())
        .collect();
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
    let source_scope = resolve_scope_or_idle(raw, &source_parent)?;
    let target_scope = resolve_scope_or_idle(raw, target_parent_path)?;
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
    if let Scope::Definition(i) = target_scope {
        if let Some(definition) = raw.components.get_mut(i) {
            definition.inner.leaf = Some(false);
        }
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
    let Some(scope) = resolve_scope_or_idle(raw, &parent_path)? else {
        return Ok(idle());
    };
    let instances = scope_instances_mut(raw, scope)?;
    if instances.iter().any(|i| i.label == new_label) {
        return Ok(idle());
    }
    let Some(entry) = instances.iter_mut().find(|i| i.label == old_label) else {
        return Ok(idle());
    };
    entry.label = new_label.to_owned();
    Ok(applied(vec![LoggedAction::RenameComponent {
        path: path.to_owned(),
        new_label: new_label.to_owned(),
    }]))
}

fn update(raw: &mut RawFile, path: &str, patch: &PatchJson) -> Result<ApplyOutcome, MutationError> {
    let segments: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    let Some((&first, _)) = segments.split_first() else {
        return Ok(idle());
    };
    let definition_label: String;
    let notified_path: String;
    if segments.len() == 1 {
        // Bare labels address top-level definitions.
        definition_label = first.to_owned();
        notified_path = path.to_owned();
    } else {
        let Some((&leaf, parent_segments)) = segments.split_last() else {
            return Ok(idle());
        };
        let parent_path: String = parent_segments.join("/");
        let Some(scope) = resolve_scope_or_idle(raw, &parent_path)? else {
            return Ok(idle());
        };
        let Some(source) = scope_instances(raw, scope)
            .iter()
            .find(|i| i.label == leaf)
            .and_then(|i| i.inner.source.clone())
        else {
            return Ok(idle());
        };
        // Body edits land on the reused definition, not the instance.
        definition_label = source.clone();
        notified_path = source;
    }
    let Some(definition) = find_definition(raw, &definition_label) else {
        return Ok(idle());
    };
    let Some(body) = raw.components.get_mut(definition) else {
        return Ok(idle());
    };
    apply_patch(&mut body.inner, patch)?;
    Ok(applied(vec![LoggedAction::UpdateComponent {
        path: notified_path,
        patch: patch.clone(),
    }]))
}

fn apply_patch(body: &mut RawComponent, patch: &PatchJson) -> Result<(), MutationError> {
    if let Some(description) = &patch.description {
        body.description = non_empty(description);
    }
    if let Some(icon) = &patch.icon {
        body.icon = non_empty(icon);
    }
    if let Some(color) = &patch.color {
        body.color = non_empty(color);
    }
    if let Some(border) = &patch.border {
        body.border = parse_border(border)?;
    }
    if let Some(font) = &patch.font {
        body.font = non_empty(font);
    }
    if let Some(tags) = &patch.tags {
        body.tags = tags.clone();
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
        let Some(scope) = resolve_scope_or_idle(raw, &parent_path)? else {
            return Ok(idle());
        };
        let instances = scope_instances_mut(raw, scope)?;
        let Some(position) = instances.iter().position(|i| i.label == leaf) else {
            return Ok(idle());
        };
        instances.remove(position);
    }
    Ok(applied(vec![LoggedAction::DeleteComponent {
        path: path.to_owned(),
    }]))
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
            r#"{"kind":"add_system","label":"demo","description":"d"}"#,
            r#"{"kind":"add_component_definition","label":"cpu","options":{"leaf":true}}"#,
            r#"{"kind":"add_instance","parentPath":"demo","label":"a","source":"cpu"}"#,
            r#"{"kind":"create_component","label":"a","parentKey":"demo","sourceLabel":"cpu"}"#,
            r#"{"kind":"reparent_component","sourcePath":"demo/a","targetParentPath":"demo/sub"}"#,
            r#"{"kind":"rename_component","path":"demo/a","newLabel":"b"}"#,
            r#"{"kind":"update_component","path":"demo/a","patch":{"description":"x"}}"#,
            r#"{"kind":"delete_component","path":"demo/a"}"#,
            r#"{"kind":"add_connection","scopePath":"demo","label":"l","from":"a","to":"b"}"#,
            r#"{"kind":"delete_connection_by_label","label":"l"}"#,
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
        let hcl = mutate(
            &hcl,
            r#"{"kind":"add_component_definition","label":"c"}"#,
        )
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
            r#"{"kind":"update_component","path":"demo/a","patch":{"description":"hot chip"}}"#,
        )
        .expect("ok");
        assert!(updated.applied);
        let hcl = updated.hcl.expect("hcl");
        assert!(hcl.contains(r#"description = "hot chip""#));
        // The logged path is the definition, matching the old TS store.
        let action = serde_json::to_value(&updated.actions).expect("json");
        assert_eq!(action[0]["op"], "update_component");
        assert_eq!(action[0]["path"], "cpu");
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
    fn broken_baseline_refuses() {
        let result = mutate(
            "system \"demo\" {\n  this is not valid hcl!!!\n}\n",
            r#"{"kind":"add_system","label":"other"}"#,
        );
        assert!(result.is_err());
    }

    #[test]
    fn reparent_guards_reject_cycles_and_collisions() {
        let hcl = mutate(
            "",
            r#"{"kind":"add_component_definition","label":"sub"}"#,
        )
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
        let hcl = mutate(
            "",
            r#"{"kind":"add_component_definition","label":"bus"}"#,
        )
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
            r#"{"kind":"add_component_definition","label":"a","options":{"leaf":true}}"#,
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
            r#"{"kind":"add_connection","scopePath":"bus","label":"link","from":"x","to":"x"}"#,
        )
        .expect("ok")
        .hcl
        .expect("hcl");
        assert!(hcl.contains(r#"connection "link""#));

        let deleted = mutate(&hcl, r#"{"kind":"delete_connection_by_label","label":"link"}"#)
            .expect("ok");
        assert!(deleted.applied);
        let hcl = deleted.hcl.expect("hcl");
        assert!(!hcl.contains(r#"connection "link""#));

        let missing = mutate(&hcl, r#"{"kind":"delete_connection_by_label","label":"nope"}"#)
            .expect("ok");
        assert!(!missing.applied);
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
            description: String::new(),
            tags: Vec::new(),
            icon: None,
            color: None,
            border: None,
            font: None,
            ports: vec![PortJson {
                label: "p".to_owned(),
                description: None,
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
    }
}
