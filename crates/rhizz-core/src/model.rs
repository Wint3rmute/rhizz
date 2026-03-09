//! Resolved model types, newtype indices, and diagnostic definitions.
//!
//! This module defines the fully-resolved in-memory representation of a
//! system model after parsing and name resolution.  All cross-references
//! use arena-indexed newtype IDs instead of raw strings.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ── Newtype indices ───────────────────────────────────────────────────────────

/// Arena index for a system.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct SystemId(
    /// Inner index into [`Model::systems`].
    pub usize,
);

/// Arena index for a component.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ComponentId(
    /// Inner index into [`Model::components`].
    pub usize,
);

/// Arena index for a port.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct PortId(
    /// Inner index into [`Model::ports`].
    pub usize,
);

/// Arena index for a connection.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ConnectionId(
    /// Inner index into [`Model::connections`].
    pub usize,
);

/// Arena index for a message.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct MessageId(
    /// Inner index into [`Model::messages`].
    pub usize,
);

/// Arena index for a field.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct FieldId(
    /// Inner index into [`Model::fields`].
    pub usize,
);

// ── Scope ─────────────────────────────────────────────────────────────────────

/// A scope is either a system or a component. Used for resolving sibling
/// references in `from`, `to`, and `encapsulates`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum Scope {
    /// Scope of a system block.
    System(SystemId),
    /// Scope of a component block.
    Component(ComponentId),
}

/// Built during resolution. Maps `(scope, label) → entity id`.
#[derive(Debug, Default)]
pub(crate) struct ScopeIndex {
    /// Component lookup: `(parent_scope, label) → ComponentId`.
    pub(crate) components: HashMap<(Scope, String), ComponentId>,
    /// Connection lookup: `(parent_scope, label) → ConnectionId`.
    pub(crate) connections: HashMap<(Scope, String), ConnectionId>,
    /// Port lookup: `(owner_component, label) → PortId`.
    pub(crate) ports: HashMap<(ComponentId, String), PortId>,
}

// ── PortRole ──────────────────────────────────────────────────────────────────

/// The role a port plays in a connection.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PortRole {
    /// Provides data / service.
    Provider,
    /// Consumes data / service.
    Consumer,
    /// Symmetric peer (bidirectional).
    Peer,
}

// ── ComponentParent ───────────────────────────────────────────────────────────

/// Identifies the direct parent of a component in the hierarchy.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum ComponentParent {
    /// Parent is a top-level system.
    System(SystemId),
    /// Parent is another component.
    Component(ComponentId),
}

// ── Resolved model ────────────────────────────────────────────────────────────

/// The fully-resolved system model, containing all arenas.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Model {
    /// Project-level metadata.
    pub project: Project,
    /// All systems, indexed by [`SystemId`].
    pub systems: Vec<System>,
    /// All components, indexed by [`ComponentId`].
    pub components: Vec<Component>,
    /// All ports, indexed by [`PortId`].
    pub ports: Vec<Port>,
    /// All connections, indexed by [`ConnectionId`].
    pub connections: Vec<Connection>,
    /// All messages, indexed by [`MessageId`].
    pub messages: Vec<Message>,
    /// All fields, indexed by [`FieldId`].
    pub fields: Vec<Field>,
    /// Resolved view definitions.
    pub views: Vec<View>,
}

impl Default for Model {
    fn default() -> Self {
        Model {
            project: Project {
                name: String::new(),
                version: String::new(),
                authors: vec![],
            },
            systems: vec![],
            components: vec![],
            ports: vec![],
            connections: vec![],
            messages: vec![],
            fields: vec![],
            views: vec![],
        }
    }
}

/// Optional project-level metadata (name, version, authors).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    /// Human-readable project name.
    pub name: String,
    /// Semantic version string.
    pub version: String,
    /// List of authors.
    pub authors: Vec<String>,
}

/// A resolved top-level system container.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct System {
    /// Unique identifier for this system.
    pub label: String,
    /// Human-readable description.
    pub description: String,
    /// Filtering tags.
    pub tags: Vec<String>,
    /// Abstraction level.
    pub level: i32,
    /// Direct child components.
    pub components: Vec<ComponentId>,
    /// Direct child connections.
    pub connections: Vec<ConnectionId>,
}

/// A resolved component (physical or logical building block).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Component {
    /// Unique label within its parent scope.
    pub label: String,
    /// Human-readable description.
    pub description: String,
    /// Filtering tags.
    pub tags: Vec<String>,
    /// Abstraction level.
    pub level: i32,
    /// If `true`, the component is atomic (no further decomposition).
    pub leaf: bool,
    /// Parent entity (system or component).
    pub parent: ComponentParent,
    /// Direct child components.
    pub children: Vec<ComponentId>,
    /// Ports declared on this component.
    pub ports: Vec<PortId>,
    /// Connections defined inside this component's scope.
    pub connections: Vec<ConnectionId>,
}

/// A resolved port on a component.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Port {
    /// Unique label within the parent component.
    pub label: String,
    /// Human-readable description.
    pub description: String,
    /// Free-form protocol name.
    pub protocol: String,
    /// Provider, consumer, or peer.
    pub role: PortRole,
    /// Filtering tags.
    pub tags: Vec<String>,
    /// The component that owns this port.
    pub owner: ComponentId,
    /// Messages carried by this port.
    pub messages: Vec<MessageId>,
}

/// One endpoint of a connection — a component and an optional port on that component.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionEndpoint {
    /// The referenced component.
    pub component: ComponentId,
    /// The referenced port, if a `comp:port` reference was used.
    pub port: Option<PortId>,
}

/// A resolved connection wiring two sibling components together.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Connection {
    /// Unique label within its parent scope.
    pub label: String,
    /// Human-readable description.
    pub description: String,
    /// Filtering tags.
    pub tags: Vec<String>,
    /// Abstraction level.
    pub level: i32,
    /// Source endpoint.
    pub from: ConnectionEndpoint,
    /// Target endpoint.
    pub to: ConnectionEndpoint,
    /// Sibling connections this one runs on top of.
    pub encapsulates: Vec<ConnectionId>,
}

/// A resolved message carried by a port.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    /// Unique label within its parent port.
    pub label: String,
    /// Human-readable description.
    pub description: String,
    /// Filtering tags.
    pub tags: Vec<String>,
    /// Abstraction level.
    pub level: i32,
    /// Data fields carried by this message.
    pub fields: Vec<FieldId>,
}

/// A resolved data field inside a message.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Field {
    /// Unique label within its parent message.
    pub label: String,
    /// Free-form type string (e.g. `"uint8"`, `"string"`).
    pub field_type: String,
    /// Human-readable description.
    pub description: String,
    /// Physical unit (e.g. `"m"`, `"Hz"`).
    pub unit: String,
    /// Whether this field is mandatory.
    pub required: bool,
}

// ── View models ───────────────────────────────────────────────────────────────

/// A resolved view definition (filtered perspective rendered as DOT).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct View {
    /// Unique view identifier.
    pub label: String,
    /// Human-readable description.
    pub description: String,
    /// Filtering tags.
    pub tags: Vec<String>,
    /// The system this view visualises.
    pub system: SystemId,
    /// Filter predicates controlling what appears in the view.
    pub filter: ViewFilter,
    /// Output settings (filename, layout direction).
    pub output: ViewOutput,
}

/// Filter predicates for a view.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ViewFilter {
    /// Only include entities with at least one of these tags (empty = all).
    pub include_tags: Vec<String>,
    /// Exclude entities with any of these tags.
    pub exclude_tags: Vec<String>,
    /// Maximum abstraction level to display.
    pub max_level: Option<i32>,
    /// Whitelist of component labels (empty = all).
    pub components: Vec<String>,
    /// Whether to list messages on connection edges.
    pub show_messages: bool,
}

/// Output settings for a view.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ViewOutput {
    /// Output file path.
    pub filename: String,
    /// Graphviz rank direction (`"TB"`, `"LR"`, etc.).
    pub rankdir: String,
}

// ── DiagnosticCode ────────────────────────────────────────────────────────────

/// Every diagnostic code the rhizz compiler can emit.
///
/// Error codes (`E…`) are blocking — they prevent a model from being produced.
/// Warning codes (`W…`) are non-blocking — compilation succeeds and a model is
/// returned alongside the warnings.
///
/// The string representation of each variant (e.g. `"E001"`) is stable and
/// forms part of the public API.  Renumbering is a breaking change.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum DiagnosticCode {
    // ── Errors ────────────────────────────────────────────────────────────────
    /// HCL parse failure, or an internal structural error forwarded by the frontend.
    E000,
    /// Duplicate label within the same scope and block type.
    E001,
    /// Connection `from`/`to` (bare label) references an undefined sibling component.
    E002,
    /// Connection `encapsulates` references an undefined sibling connection.
    E003,
    /// Circular encapsulation chain detected.
    E004,
    /// Leaf component contains child `component` or `connection` blocks.
    E005,
    /// `view` block references an undefined system.
    E006,
    /// `field` block is missing the required `type` attribute.
    E007,
    /// More than one `project` block defined across all source files.
    E008,
    /// `port.role` value is not `"provider"`, `"consumer"`, or `"peer"`.
    E009,
    /// `comp:port` reference — component exists but the named port does not.
    E010,
    /// `comp:port` reference — component label does not exist in the current scope.
    E011,

    // ── Warnings ──────────────────────────────────────────────────────────────
    /// Non-blocking frontend or runtime warning (e.g. live-reload unavailable).
    /// Used as an escape hatch by frontends for warnings that don't correspond
    /// to a specific model diagnostic.
    W000,
    /// Non-leaf component has no child components (decomposition pending).
    W001,
    /// Message has no fields defined.
    W002,
    /// Component is not referenced by any connection (orphan component).
    W003,
    /// Entity is missing a `description`.
    W004,
    /// Connection `from` and `to` point to the same component.
    W005,
    /// `level` value decreases relative to the parent (likely a mistake).
    W006,
    /// One side of a connection is typed (`comp:port`), the other is a bare label.
    W007,
    /// Both sides of a connection are typed but their `protocol` values differ.
    W008,
    /// Port roles are incompatible or ambiguous (see the role compatibility table in the spec).
    W009,
    /// Port is defined on a component but not referenced by any connection.
    W010,
    /// Port has no messages defined.
    W011,
}

impl DiagnosticCode {
    /// Returns `true` for error-level codes (`E…`).
    pub fn is_error(self) -> bool {
        matches!(
            self,
            Self::E000
                | Self::E001
                | Self::E002
                | Self::E003
                | Self::E004
                | Self::E005
                | Self::E006
                | Self::E007
                | Self::E008
                | Self::E009
                | Self::E010
                | Self::E011
        )
    }

    /// Returns `true` for warning-level codes (`W…`).
    pub fn is_warning(self) -> bool {
        !self.is_error()
    }
}

impl std::fmt::Display for DiagnosticCode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // The Debug representation of each variant is its string code (e.g. "E001").
        write!(f, "{self:?}")
    }
}

impl std::str::FromStr for DiagnosticCode {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "E000" => Ok(Self::E000),
            "E001" => Ok(Self::E001),
            "E002" => Ok(Self::E002),
            "E003" => Ok(Self::E003),
            "E004" => Ok(Self::E004),
            "E005" => Ok(Self::E005),
            "E006" => Ok(Self::E006),
            "E007" => Ok(Self::E007),
            "E008" => Ok(Self::E008),
            "E009" => Ok(Self::E009),
            "E010" => Ok(Self::E010),
            "E011" => Ok(Self::E011),
            "W000" => Ok(Self::W000),
            "W001" => Ok(Self::W001),
            "W002" => Ok(Self::W002),
            "W003" => Ok(Self::W003),
            "W004" => Ok(Self::W004),
            "W005" => Ok(Self::W005),
            "W006" => Ok(Self::W006),
            "W007" => Ok(Self::W007),
            "W008" => Ok(Self::W008),
            "W009" => Ok(Self::W009),
            "W010" => Ok(Self::W010),
            "W011" => Ok(Self::W011),
            other => Err(format!("unknown diagnostic code: {other}")),
        }
    }
}

impl serde::Serialize for DiagnosticCode {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

impl<'de> serde::Deserialize<'de> for DiagnosticCode {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let s = String::deserialize(d)?;
        s.parse().map_err(serde::de::Error::custom)
    }
}

// ── Diagnostic ────────────────────────────────────────────────────────────────

/// A diagnostic message emitted during parsing, resolution, or validation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Diagnostic {
    /// Diagnostic code identifying the class of error or warning.
    pub code: DiagnosticCode,
    /// Source file path, if known.
    pub file: Option<std::path::PathBuf>,
    /// Source line number, if known.
    pub line: Option<u32>,
    /// Human-readable diagnostic message.
    pub message: String,
}

impl Diagnostic {
    /// Create an error-level diagnostic.
    pub fn error(code: DiagnosticCode, message: impl Into<String>) -> Self {
        Diagnostic {
            code,
            file: None,
            line: None,
            message: message.into(),
        }
    }

    /// Create a warning-level diagnostic.
    pub fn warning(code: DiagnosticCode, message: impl Into<String>) -> Self {
        Diagnostic {
            code,
            file: None,
            line: None,
            message: message.into(),
        }
    }

    /// Returns `true` if this is an error diagnostic.
    pub fn is_error(&self) -> bool {
        self.code.is_error()
    }

    /// Returns `true` if this is a warning diagnostic.
    pub fn is_warning(&self) -> bool {
        self.code.is_warning()
    }
}
