// Public API consumed by downstream passes (Tasks 3–6).
#![allow(dead_code)]

use std::collections::HashMap;

// ── Newtype indices ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct SystemId(pub usize);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct ComponentId(pub usize);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct InterfaceId(pub usize);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct MessageId(pub usize);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct FieldId(pub usize);

// ── Scope ─────────────────────────────────────────────────────────────────────

/// A scope is either a system or a component. Used for resolving sibling
/// references in `from`, `to`, and `encapsulates`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Scope {
    System(SystemId),
    Component(ComponentId),
}

/// Built during resolution. Maps `(scope, label) → entity id`.
#[derive(Debug, Default)]
pub struct ScopeIndex {
    pub components: HashMap<(Scope, String), ComponentId>,
    pub interfaces: HashMap<(Scope, String), InterfaceId>,
}

// ── Direction ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Direction {
    Unidirectional,
    Bidirectional,
}

// ── ComponentParent ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy)]
pub enum ComponentParent {
    System(SystemId),
    Component(ComponentId),
}

// ── Resolved model ────────────────────────────────────────────────────────────

#[derive(Debug)]
pub struct Model {
    pub project: Project,
    pub systems: Vec<System>,       // indexed by SystemId
    pub components: Vec<Component>, // indexed by ComponentId
    pub interfaces: Vec<Interface>, // indexed by InterfaceId
    pub messages: Vec<Message>,     // indexed by MessageId
    pub fields: Vec<Field>,         // indexed by FieldId
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

#[derive(Debug)]
pub struct Project {
    pub name: String,
    pub version: String,
    pub authors: Vec<String>,
}

#[derive(Debug)]
pub struct System {
    pub label: String,
    pub description: String,
    pub tags: Vec<String>,
    pub level: i32,
    pub components: Vec<ComponentId>, // direct children
    pub interfaces: Vec<InterfaceId>, // direct children
}

#[derive(Debug)]
pub struct Component {
    pub label: String,
    pub description: String,
    pub tags: Vec<String>,
    pub level: i32,
    pub leaf: bool,
    pub parent: ComponentParent,
    pub children: Vec<ComponentId>,
    pub interfaces: Vec<InterfaceId>,
}

#[derive(Debug)]
pub struct Interface {
    pub label: String,
    pub description: String,
    pub tags: Vec<String>,
    pub level: i32,
    pub leaf: bool,
    pub direction: Direction,
    pub from: ComponentId,
    pub to: ComponentId,
    pub encapsulates: Vec<InterfaceId>,
    pub messages: Vec<MessageId>,
}

#[derive(Debug)]
pub struct Message {
    pub label: String,
    pub description: String,
    pub tags: Vec<String>,
    pub level: i32,
    pub fields: Vec<FieldId>,
}

#[derive(Debug)]
pub struct Field {
    pub label: String,
    pub field_type: String,
    pub description: String,
    pub unit: String,
    pub required: bool,
}

// ── View models ───────────────────────────────────────────────────────────────

#[derive(Debug)]
pub struct View {
    pub label: String,
    pub description: String,
    pub tags: Vec<String>,
    pub system: SystemId,
    pub filter: ViewFilter,
    pub output: ViewOutput,
}

#[derive(Debug)]
pub struct ViewFilter {
    pub include_tags: Vec<String>,
    pub exclude_tags: Vec<String>,
    pub max_level: Option<i32>,
    pub components: Vec<String>, // whitelist by label; empty = all
    pub show_messages: bool,
}

#[derive(Debug)]
pub struct ViewOutput {
    pub filename: String,
    pub rankdir: String,
}

// ── Diagnostic ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct Diagnostic {
    pub code: String,
    pub file: Option<std::path::PathBuf>,
    pub line: Option<u32>,
    pub message: String,
}

impl Diagnostic {
    pub fn error(code: &str, message: impl Into<String>) -> Self {
        Diagnostic {
            code: code.to_owned(),
            file: None,
            line: None,
            message: message.into(),
        }
    }

    pub fn warning(code: &str, message: impl Into<String>) -> Self {
        Diagnostic {
            code: code.to_owned(),
            file: None,
            line: None,
            message: message.into(),
        }
    }

    pub fn is_error(&self) -> bool {
        self.code.starts_with('E')
    }

    pub fn is_warning(&self) -> bool {
        self.code.starts_with('W')
    }
}
