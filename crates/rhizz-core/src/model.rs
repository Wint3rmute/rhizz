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

/// Arena index for an interface.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct InterfaceId(
    /// Inner index into [`Model::interfaces`].
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
    /// Interface lookup: `(parent_scope, label) → InterfaceId`.
    pub(crate) interfaces: HashMap<(Scope, String), InterfaceId>,
}

// ── Direction ─────────────────────────────────────────────────────────────────

/// Directionality of an interface connection.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Direction {
    /// One-way data flow (`from → to`).
    Unidirectional,
    /// Two-way data flow.
    Bidirectional,
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
    /// All interfaces, indexed by [`InterfaceId`].
    pub interfaces: Vec<Interface>,
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
            interfaces: vec![],
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
    /// Direct child interfaces.
    pub interfaces: Vec<InterfaceId>,
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
    /// Interfaces defined inside this component's scope.
    pub interfaces: Vec<InterfaceId>,
}

/// A resolved interface connecting two sibling components.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Interface {
    /// Unique label within its parent scope.
    pub label: String,
    /// Human-readable description.
    pub description: String,
    /// Filtering tags.
    pub tags: Vec<String>,
    /// Abstraction level.
    pub level: i32,
    /// If `true`, the interface is atomic (no messages).
    pub leaf: bool,
    /// Unidirectional or bidirectional.
    pub direction: Direction,
    /// Source component.
    pub from: ComponentId,
    /// Target component.
    pub to: ComponentId,
    /// Sibling interfaces this one runs on top of.
    pub encapsulates: Vec<InterfaceId>,
    /// Messages carried by this interface.
    pub messages: Vec<MessageId>,
}

/// A resolved message exchanged over an interface.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    /// Unique label within its parent interface.
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
    /// Whether to list messages on interface edges.
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

// ── Diagnostic ────────────────────────────────────────────────────────────────

/// A diagnostic message emitted during parsing, resolution, or validation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Diagnostic {
    /// Diagnostic code (e.g. `"E001"`, `"W003"`).
    pub code: String,
    /// Source file path, if known.
    pub file: Option<std::path::PathBuf>,
    /// Source line number, if known.
    pub line: Option<u32>,
    /// Human-readable diagnostic message.
    pub message: String,
}

impl Diagnostic {
    /// Create an error-level diagnostic (code starts with `E`).
    pub fn error(code: &str, message: impl Into<String>) -> Self {
        Diagnostic {
            code: code.to_owned(),
            file: None,
            line: None,
            message: message.into(),
        }
    }

    /// Create a warning-level diagnostic (code starts with `W`).
    pub fn warning(code: &str, message: impl Into<String>) -> Self {
        Diagnostic {
            code: code.to_owned(),
            file: None,
            line: None,
            message: message.into(),
        }
    }

    /// Returns `true` if this is an error diagnostic.
    pub fn is_error(&self) -> bool {
        self.code.starts_with('E')
    }

    /// Returns `true` if this is a warning diagnostic.
    pub fn is_warning(&self) -> bool {
        self.code.starts_with('W')
    }
}
