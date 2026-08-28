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
    #[must_use]
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

include!(concat!(env!("OUT_DIR"), "/diagnostic_codes.rs"));

impl DiagnosticCode {
    /// Returns `true` if this code is error-level.
    #[must_use]
    pub fn is_error(self) -> bool {
        self.level == Level::Error
    }

    /// Returns `true` if this code is warning-level.
    #[must_use]
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
        Self {
            code,
            file: None,
            line: None,
            message: message.into(),
        }
    }

    /// Create a warning-level diagnostic.
    pub fn warning(code: DiagnosticCode, message: impl Into<String>) -> Self {
        Self {
            code,
            file: None,
            line: None,
            message: message.into(),
        }
    }

    /// Returns `true` if this is an error diagnostic.
    #[must_use]
    pub fn is_error(&self) -> bool {
        self.code.is_error()
    }

    /// Returns `true` if this is a warning diagnostic.
    #[must_use]
    pub fn is_warning(&self) -> bool {
        self.code.is_warning()
    }
}
