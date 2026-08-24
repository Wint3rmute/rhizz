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

/// Arena index for a protocol.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ProtocolId(
    /// Inner index into [`Model::protocols`].
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
#[serde(rename_all = "lowercase")]
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
    /// All protocols, indexed by [`ProtocolId`].
    pub protocols: Vec<Protocol>,
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
            protocols: vec![],
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
    /// Optional icon name (e.g. FontAwesome icon identifier).
    pub icon: Option<String>,
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

/// A resolved top-level protocol schema.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Protocol {
    /// Unique identifier for this protocol.
    pub label: String,
    /// Human-readable description.
    pub description: String,
    /// Filtering tags.
    pub tags: Vec<String>,
    /// Valid port roles permitted by this protocol.
    pub roles: Vec<PortRole>,
    /// Messages defined in this protocol.
    pub messages: Vec<MessageId>,
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
    /// Optional resolved reference to a top-level protocol.
    pub protocol_id: Option<ProtocolId>,
    /// Provider, consumer, or peer.
    pub role: PortRole,
    /// Whether this port is an external boundary interface.
    pub external: bool,
    /// Whether this port is required when instantiated in a system.
    pub required: bool,
    /// Filtering tags.
    pub tags: Vec<String>,
    /// The component that owns this port.
    pub owner: ComponentId,
}

/// One endpoint of a connection — a component and an optional port on that component.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionEndpoint {
    /// The referenced component.
    pub component: ComponentId,
    /// The referenced port, if a `comp/port` reference was used.
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

// ── View definitions and layout models ────────────────────────────────────────

/// Node layout metadata for visual diagrams.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NodeLayout {
    /// Component key/path or label identifying the node.
    pub component: String,
    /// X coordinate on canvas.
    pub x: f64,
    /// Y coordinate on canvas.
    pub y: f64,
    /// Optional width in world units.
    #[serde(default)]
    pub width: Option<f64>,
    /// Optional height in world units.
    #[serde(default)]
    pub height: Option<f64>,
    /// Optional text alignment ("center", "top-center", "top-left").
    #[serde(default)]
    pub text_align: Option<String>,
}

/// The boundary side of a component box where a connection attaches.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ConnectionSide {
    /// Top border midpoint.
    Top,
    /// Bottom border midpoint.
    Bottom,
    /// Left border midpoint.
    Left,
    /// Right border midpoint.
    Right,
}

impl ConnectionSide {
    /// Returns the lowercase string representation of this side.
    pub fn as_str(&self) -> &'static str {
        match self {
            ConnectionSide::Top => "top",
            ConnectionSide::Bottom => "bottom",
            ConnectionSide::Left => "left",
            ConnectionSide::Right => "right",
        }
    }
}

impl std::fmt::Display for ConnectionSide {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// Connection layout metadata for visual diagrams.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct ConnectionLayout {
    /// Connection label or key.
    pub connection: String,
    /// Optional starting side ("top", "bottom", "left", "right").
    #[serde(default)]
    pub start_side: Option<ConnectionSide>,
    /// Optional ending side ("top", "bottom", "left", "right").
    #[serde(default)]
    pub end_side: Option<ConnectionSide>,
}

/// A view definition containing filter, output settings, and node layouts.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct ViewDefinition {
    /// Unique view identifier.
    pub label: String,
    /// Human-readable description.
    #[serde(default)]
    pub description: String,
    /// Filtering tags.
    #[serde(default)]
    pub tags: Vec<String>,
    /// Target system label.
    #[serde(default)]
    pub system: String,
    /// Filter settings.
    #[serde(default)]
    pub filter: ViewFilterDefinition,
    /// Placed node layouts for this view.
    #[serde(default)]
    pub nodes: Vec<NodeLayout>,
    /// Placed connection layouts for this view.
    #[serde(default)]
    pub connections: Vec<ConnectionLayout>,
}

impl ViewDefinition {
    /// Constructs a `ViewDefinition` from a resolved `View` and its parent `Model`.
    pub fn from_resolved(view: &View, model: &Model) -> Self {
        let system_label = model
            .systems
            .get(view.system.0)
            .map(|s| s.label.clone())
            .unwrap_or_default();
        Self {
            label: view.label.clone(),
            description: view.description.clone(),
            tags: view.tags.clone(),
            system: system_label,
            filter: ViewFilterDefinition {
                include_tags: view.filter.include_tags.clone(),
                exclude_tags: view.filter.exclude_tags.clone(),
                max_level: view.filter.max_level,
                components: view.filter.components.clone(),
                show_messages: if view.filter.show_messages {
                    Some(true)
                } else {
                    None
                },
            },
            nodes: Vec::new(),
            connections: Vec::new(),
        }
    }
}

/// Filter settings for a view definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct ViewFilterDefinition {
    /// Tag whitelist (empty = match all).
    #[serde(default)]
    pub include_tags: Vec<String>,
    /// Tag blacklist.
    #[serde(default)]
    pub exclude_tags: Vec<String>,
    /// Maximum abstraction level to display.
    #[serde(default)]
    pub max_level: Option<i32>,
    /// Component whitelist.
    #[serde(default)]
    pub components: Vec<String>,
    /// Whether to show messages on connection edges.
    #[serde(default)]
    pub show_messages: Option<bool>,
}

// Diagnostic types live in their own module; re-export here so existing
// intra-crate imports (e.g. `use crate::model::Diagnostic`) keep working.
pub use crate::diagnostics::{Diagnostic, DiagnosticCode};
