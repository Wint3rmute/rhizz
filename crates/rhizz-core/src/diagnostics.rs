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
    #[doc = include_str!("../../../SPEC/diagnostics/E000.md")]
    pub const E000: Self = Self {
        code: "E000",
        level: Level::Error,
    };
    #[doc = include_str!("../../../SPEC/diagnostics/E001.md")]
    pub const E001: Self = Self {
        code: "E001",
        level: Level::Error,
    };
    #[doc = include_str!("../../../SPEC/diagnostics/E002.md")]
    pub const E002: Self = Self {
        code: "E002",
        level: Level::Error,
    };
    #[doc = include_str!("../../../SPEC/diagnostics/E003.md")]
    pub const E003: Self = Self {
        code: "E003",
        level: Level::Error,
    };
    #[doc = include_str!("../../../SPEC/diagnostics/E004.md")]
    pub const E004: Self = Self {
        code: "E004",
        level: Level::Error,
    };
    #[doc = include_str!("../../../SPEC/diagnostics/E005.md")]
    pub const E005: Self = Self {
        code: "E005",
        level: Level::Error,
    };
    #[doc = include_str!("../../../SPEC/diagnostics/E006.md")]
    pub const E006: Self = Self {
        code: "E006",
        level: Level::Error,
    };
    #[doc = include_str!("../../../SPEC/diagnostics/E007.md")]
    pub const E007: Self = Self {
        code: "E007",
        level: Level::Error,
    };
    #[doc = include_str!("../../../SPEC/diagnostics/E008.md")]
    pub const E008: Self = Self {
        code: "E008",
        level: Level::Error,
    };
    #[doc = include_str!("../../../SPEC/diagnostics/E009.md")]
    pub const E009: Self = Self {
        code: "E009",
        level: Level::Error,
    };
    #[doc = include_str!("../../../SPEC/diagnostics/E010.md")]
    pub const E010: Self = Self {
        code: "E010",
        level: Level::Error,
    };
    #[doc = include_str!("../../../SPEC/diagnostics/E011.md")]
    pub const E011: Self = Self {
        code: "E011",
        level: Level::Error,
    };
    #[doc = include_str!("../../../SPEC/diagnostics/E012.md")]
    pub const E012: Self = Self {
        code: "E012",
        level: Level::Error,
    };
    #[doc = include_str!("../../../SPEC/diagnostics/E013.md")]
    pub const E013: Self = Self {
        code: "E013",
        level: Level::Error,
    };
    #[doc = include_str!("../../../SPEC/diagnostics/E014.md")]
    pub const E014: Self = Self {
        code: "E014",
        level: Level::Error,
    };
    #[doc = include_str!("../../../SPEC/diagnostics/E015.md")]
    pub const E015: Self = Self {
        code: "E015",
        level: Level::Error,
    };

    // ── Warnings ──────────────────────────────────────────────────────────────
    #[doc = include_str!("../../../SPEC/diagnostics/W000.md")]
    pub const W000: Self = Self {
        code: "W000",
        level: Level::Warning,
    };
    #[doc = include_str!("../../../SPEC/diagnostics/W001.md")]
    pub const W001: Self = Self {
        code: "W001",
        level: Level::Warning,
    };
    #[doc = include_str!("../../../SPEC/diagnostics/W002.md")]
    pub const W002: Self = Self {
        code: "W002",
        level: Level::Warning,
    };
    #[doc = include_str!("../../../SPEC/diagnostics/W003.md")]
    pub const W003: Self = Self {
        code: "W003",
        level: Level::Warning,
    };
    #[doc = include_str!("../../../SPEC/diagnostics/W004.md")]
    pub const W004: Self = Self {
        code: "W004",
        level: Level::Warning,
    };
    #[doc = include_str!("../../../SPEC/diagnostics/W005.md")]
    pub const W005: Self = Self {
        code: "W005",
        level: Level::Warning,
    };
    #[doc = include_str!("../../../SPEC/diagnostics/W006.md")]
    pub const W006: Self = Self {
        code: "W006",
        level: Level::Warning,
    };
    #[doc = include_str!("../../../SPEC/diagnostics/W007.md")]
    pub const W007: Self = Self {
        code: "W007",
        level: Level::Warning,
    };
    #[doc = include_str!("../../../SPEC/diagnostics/W008.md")]
    pub const W008: Self = Self {
        code: "W008",
        level: Level::Warning,
    };
    #[doc = include_str!("../../../SPEC/diagnostics/W009.md")]
    pub const W009: Self = Self {
        code: "W009",
        level: Level::Warning,
    };
    #[doc = include_str!("../../../SPEC/diagnostics/W010.md")]
    pub const W010: Self = Self {
        code: "W010",
        level: Level::Warning,
    };
    #[doc = include_str!("../../../SPEC/diagnostics/W011.md")]
    pub const W011: Self = Self {
        code: "W011",
        level: Level::Warning,
    };
    #[doc = include_str!("../../../SPEC/diagnostics/W012.md")]
    pub const W012: Self = Self {
        code: "W012",
        level: Level::Warning,
    };
    #[doc = include_str!("../../../SPEC/diagnostics/W013.md")]
    pub const W013: Self = Self {
        code: "W013",
        level: Level::Warning,
    };
    #[doc = include_str!("../../../SPEC/diagnostics/W014.md")]
    pub const W014: Self = Self {
        code: "W014",
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
