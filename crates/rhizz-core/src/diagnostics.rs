//! Diagnostic types — codes, severity, and structured diagnostic messages.

use serde::Serialize;

// ── Level ─────────────────────────────────────────────────────────────────────

/// The severity level of a diagnostic, modelled after the Rust compiler's own
/// `Level` type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Level {
    /// An error that causes compilation to fail.
    Error,
    /// A warning — does not prevent compilation.
    Warning,
    /// A note — additional context attached to another diagnostic.
    Note,
    /// A help message — suggests how to fix something.
    Help,
}

impl Level {
    /// Returns `true` if this level blocks compilation.
    pub fn is_blocking(self) -> bool {
        self == Self::Error
    }
}

// ── DiagnosticCode ────────────────────────────────────────────────────────────

/// A named diagnostic code with its severity baked in as a field.
///
/// Each code is a `pub const` on this type, so the level is the single source
/// of truth — no separate match arm needed when adding a new code.
///
/// The `code` string (e.g. `"E001"`) is stable and forms part of the public
/// API.  Renumbering is a breaking change.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct DiagnosticCode {
    /// Short code string, e.g. `"E001"` or `"W003"`.
    pub code: &'static str,
    /// Severity level — baked in at definition time.
    pub level: Level,
}

impl DiagnosticCode {
    // ── Errors ────────────────────────────────────────────────────────────────
    /// HCL parse failure, or an internal structural error forwarded by the frontend.
    pub const E000: Self = Self {
        code: "E000",
        level: Level::Error,
    };
    /// Duplicate label within the same scope and block type.
    pub const E001: Self = Self {
        code: "E001",
        level: Level::Error,
    };
    /// Connection `from`/`to` (bare label) references an undefined sibling component.
    pub const E002: Self = Self {
        code: "E002",
        level: Level::Error,
    };
    /// Connection `encapsulates` references an undefined sibling connection.
    pub const E003: Self = Self {
        code: "E003",
        level: Level::Error,
    };
    /// Circular encapsulation chain detected.
    pub const E004: Self = Self {
        code: "E004",
        level: Level::Error,
    };
    /// Leaf component contains child `component` or `connection` blocks.
    pub const E005: Self = Self {
        code: "E005",
        level: Level::Error,
    };
    /// `view` block references an undefined system.
    pub const E006: Self = Self {
        code: "E006",
        level: Level::Error,
    };
    /// `field` block is missing the required `type` attribute.
    pub const E007: Self = Self {
        code: "E007",
        level: Level::Error,
    };
    /// More than one `project` block defined across all source files.
    pub const E008: Self = Self {
        code: "E008",
        level: Level::Error,
    };
    /// `port.role` value is not `"provider"`, `"consumer"`, or `"peer"`.
    pub const E009: Self = Self {
        code: "E009",
        level: Level::Error,
    };
    /// `comp:port` reference — component exists but the named port does not.
    pub const E010: Self = Self {
        code: "E010",
        level: Level::Error,
    };
    /// `comp:port` reference — component label does not exist in the current scope.
    pub const E011: Self = Self {
        code: "E011",
        level: Level::Error,
    };
    /// Component with `source` attribute also has other attributes or child blocks (exclusivity violation).
    pub const E012: Self = Self {
        code: "E012",
        level: Level::Error,
    };
    /// Circular `source` chain detected.
    pub const E013: Self = Self {
        code: "E013",
        level: Level::Error,
    };
    /// `source` references an undefined top-level component.
    pub const E014: Self = Self {
        code: "E014",
        level: Level::Error,
    };

    // ── Warnings ──────────────────────────────────────────────────────────────
    /// Non-blocking frontend or runtime warning (e.g. live-reload unavailable).
    /// Used as an escape hatch by frontends for warnings that don't correspond
    /// to a specific model diagnostic.
    pub const W000: Self = Self {
        code: "W000",
        level: Level::Warning,
    };
    /// Non-leaf component has no child components (decomposition pending).
    pub const W001: Self = Self {
        code: "W001",
        level: Level::Warning,
    };
    /// Message has no fields defined.
    pub const W002: Self = Self {
        code: "W002",
        level: Level::Warning,
    };
    /// Component is not referenced by any connection (orphan component).
    pub const W003: Self = Self {
        code: "W003",
        level: Level::Warning,
    };
    /// Entity is missing a `description`.
    pub const W004: Self = Self {
        code: "W004",
        level: Level::Warning,
    };
    /// Connection `from` and `to` point to the same component.
    pub const W005: Self = Self {
        code: "W005",
        level: Level::Warning,
    };
    /// `level` value decreases relative to the parent (likely a mistake).
    pub const W006: Self = Self {
        code: "W006",
        level: Level::Warning,
    };
    /// One side of a connection is typed (`comp:port`), the other is a bare label.
    pub const W007: Self = Self {
        code: "W007",
        level: Level::Warning,
    };
    /// Both sides of a connection are typed but their `protocol` values differ.
    pub const W008: Self = Self {
        code: "W008",
        level: Level::Warning,
    };
    /// Port roles are incompatible or ambiguous (see the role compatibility table in the spec).
    pub const W009: Self = Self {
        code: "W009",
        level: Level::Warning,
    };
    /// Port is defined on a component but not referenced by any connection.
    pub const W010: Self = Self {
        code: "W010",
        level: Level::Warning,
    };
    /// Port has no messages defined.
    pub const W011: Self = Self {
        code: "W011",
        level: Level::Warning,
    };

    /// Returns `true` if this code is error-level.
    pub fn is_error(self) -> bool {
        self.level == Level::Error
    }

    /// Returns `true` if this code is warning-level.
    pub fn is_warning(self) -> bool {
        self.level == Level::Warning
    }
}

impl std::fmt::Display for DiagnosticCode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.code)
    }
}

impl Serialize for DiagnosticCode {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

// ── Diagnostic ────────────────────────────────────────────────────────────────

/// A diagnostic message emitted during parsing, resolution, or validation.
#[derive(Debug, Clone, Serialize)]
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
