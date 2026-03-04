//! `rhizz-core` — parsing, resolution, validation, and scoring.
//!
//! This crate has **no** I/O dependency in production code.  All file reading
//! happens outside (in the CLI) and is handed in via [`Source`] slices.

#![deny(clippy::all)]

pub mod model;
pub mod parse;
pub mod resolve;
pub mod score;
pub mod validate;

pub use model::{
    Component, ComponentId, ComponentParent, Diagnostic, Direction, Field, FieldId, Interface,
    InterfaceId, Message, MessageId, Model, Project, System, SystemId, View, ViewFilter,
    ViewOutput,
};
pub use score::{CategoryScore, ScoreReport, score};

use serde::{Deserialize, Serialize};

// ── Public types ──────────────────────────────────────────────────────────────

/// A single named source file to compile.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Source {
    /// The filename (used in diagnostics).
    pub filename: String,
    /// The raw HCL content.
    pub content: String,
}

/// The result of compiling one or more [`Source`] files.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompileResult {
    /// The fully-resolved model, if no hard errors were encountered.
    pub model: Option<Model>,
    /// All diagnostics (errors and warnings) produced during compilation.
    pub diagnostics: Vec<Diagnostic>,
}

// ── compile ───────────────────────────────────────────────────────────────────

/// Parse, merge, resolve, and validate all `sources`.
///
/// Returns a [`CompileResult`] with the optional model and all diagnostics.
/// If any parse errors occur, `model` is `None` and `diagnostics` contains
/// the error.  If resolution produces hard errors, `model` is also `None`.
pub fn compile(sources: &[Source]) -> CompileResult {
    use std::path::Path;

    let mut merged = parse::RawFile::default();

    for source in sources {
        let path = Path::new(&source.filename);
        let file = match parse::parse_file(&source.content, path) {
            Ok(f) => f,
            Err(e) => {
                return CompileResult {
                    model: None,
                    diagnostics: vec![Diagnostic::error("E000", e.to_string())],
                };
            }
        };
        if let Err(e) = parse::merge_into(&mut merged, file, path) {
            return CompileResult {
                model: None,
                diagnostics: vec![Diagnostic::error("E010", e.to_string())],
            };
        }
    }

    match resolve::resolve(merged) {
        Ok((model, warnings)) => CompileResult {
            model: Some(model),
            diagnostics: warnings,
        },
        Err(diagnostics) => CompileResult {
            model: None,
            diagnostics,
        },
    }
}
