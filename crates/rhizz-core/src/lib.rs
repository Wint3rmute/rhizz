//! `rhizz-core` — parsing, resolution, validation, and scoring.
//!
//! This crate has **no** I/O dependency in production code.  All file reading
//! happens outside (in the CLI) and is handed in via [`Source`] slices.

#![deny(clippy::all)]

use tracing::instrument;

pub mod diagnostics;
pub mod model;
pub mod parse;
pub mod resolve;
pub mod score;
pub mod serialize;
pub mod validate;

pub use diagnostics::{Diagnostic, DiagnosticCode, Level};
pub use model::{
    Component, ComponentId, ComponentParent, Connection, ConnectionEndpoint, ConnectionId, Field,
    FieldId, Message, MessageId, Model, NodeLayout, Port, PortId, PortRole, Project, Protocol,
    ProtocolId, System, SystemId, View, ViewDefinition, ViewFilter, ViewFilterDefinition,
};
pub use score::{CategoryScore, ScoreReport, score};
pub use serialize::{parse_views, serialize_model, serialize_resolved_views, serialize_views};

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

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
#[derive(Debug, Clone, Serialize)]
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
#[instrument(skip(sources), fields(source_count = sources.len()))]
pub fn compile(sources: &[Source]) -> CompileResult {
    let mut merged = parse::RawFile::default();
    let mut system_files = Vec::new();

    for source in sources {
        let path = Path::new(&source.filename);
        let file = match parse::parse_file(&source.content, path) {
            Ok(f) => f,
            Err(e) => {
                return CompileResult {
                    model: None,
                    diagnostics: vec![Diagnostic::error(DiagnosticCode::E000, e.to_string())],
                };
            }
        };
        if !file.systems.is_empty() {
            system_files.push(path.to_path_buf());
        }
        if let Err(e) = parse::merge_into(&mut merged, file, path) {
            return CompileResult {
                model: None,
                diagnostics: vec![Diagnostic::error(DiagnosticCode::E010, e.to_string())],
            };
        }
    }

    let mut pre_diagnostics = Vec::new();
    if validate_single_system_model(&system_files, &mut pre_diagnostics) {
        return CompileResult {
            model: None,
            diagnostics: pre_diagnostics,
        };
    }

    if let Some(project_name) = default_project_name(sources) {
        let project = merged
            .project
            .get_or_insert_with(parse::RawProject::default);
        if project.name.is_none() {
            project.name = Some(project_name);
        }
    }

    match resolve::resolve(merged) {
        Ok((model, mut diagnostics)) => {
            pre_diagnostics.append(&mut diagnostics);
            CompileResult {
                model: Some(model),
                diagnostics: pre_diagnostics,
            }
        }
        Err(mut diagnostics) => {
            pre_diagnostics.append(&mut diagnostics);
            CompileResult {
                model: None,
                diagnostics: pre_diagnostics,
            }
        }
    }
}

/// Thin validation layer checking project file structure conventions for MVP.
///
/// To be removed after MVP stage, once we're stable. Emits a blocking error if
/// multiple files define `system` blocks, requiring the single `system.hcl`
/// model file convention.
fn validate_single_system_model(
    system_files: &[PathBuf],
    diagnostics: &mut Vec<Diagnostic>,
) -> bool {
    if system_files.len() > 1 {
        let file_list = system_files
            .iter()
            .map(|p| p.display().to_string())
            .collect::<Vec<_>>()
            .join(", ");
        diagnostics.push(Diagnostic::error(
            DiagnosticCode::E000,
            format!(
                "multiple files define system blocks ({file_list}); system architecture models must be consolidated in a single system model file (e.g. system.hcl)"
            ),
        ));
        true
    } else {
        false
    }
}

fn default_project_name(sources: &[Source]) -> Option<String> {
    let paths: Vec<&Path> = sources
        .iter()
        .map(|source| Path::new(&source.filename))
        .collect();
    let (first, rest) = paths.split_first()?;

    let common = rest.iter().fold(PathBuf::from(first), |prefix, path| {
        shared_path_prefix(&prefix, path)
    });
    let project_dir = if rest.is_empty() || rest.iter().all(|path| *path == *first) {
        // A single source file gives a file path, so prefer its parent directory.
        // If the path has no parent (for example, a bare relative filename), fall
        // back to the path itself and let the basename helper decide what to use.
        common.parent().unwrap_or(common.as_path())
    } else {
        common.as_path()
    };

    // If the computed common directory has no basename (for example, the root
    // directory), fall back to the first source's parent directory or the first
    // path itself as a last resort.
    path_basename(project_dir).or_else(|| path_basename(first.parent().unwrap_or(first)))
}

fn shared_path_prefix(lhs: &Path, rhs: &Path) -> PathBuf {
    lhs.components()
        .zip(rhs.components())
        .take_while(|(left, right)| left == right)
        .fold(PathBuf::new(), |mut prefix, (component, _)| {
            prefix.push(component.as_os_str());
            prefix
        })
}

fn path_basename(path: &Path) -> Option<String> {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::Path;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};
    use walkdir::WalkDir;

    fn write_hcl(path: &Path, content: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("should create parent directories");
        }
        fs::write(path, content).expect("should write test HCL");
    }

    fn compile_dir(dir: &Path) -> CompileResult {
        let mut sources: Vec<Source> = WalkDir::new(dir)
            .into_iter()
            .filter_map(|entry| entry.ok())
            .filter(|entry| {
                entry.file_type().is_file()
                    && entry.path().extension().is_some_and(|ext| ext == "hcl")
            })
            .map(|entry| Source {
                filename: entry.path().to_string_lossy().into_owned(),
                content: fs::read_to_string(entry.path()).expect("should read test HCL"),
            })
            .collect();
        sources.sort_by(|left, right| left.filename.cmp(&right.filename));
        compile(&sources)
    }

    fn unique_temp_dir(test_name: &str) -> PathBuf {
        static COUNTER: AtomicU64 = AtomicU64::new(0);

        let unique = COUNTER.fetch_add(1, Ordering::Relaxed);
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after epoch")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("rhizz-core-{test_name}-{nanos}-{unique}"));
        fs::create_dir_all(&dir).expect("should create temp test directory");
        dir
    }

    struct TempProjectDir(PathBuf);

    impl TempProjectDir {
        fn new(test_name: &str) -> Self {
            Self(unique_temp_dir(test_name))
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempProjectDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn missing_project_name_defaults_to_directory_name() {
        let dir = TempProjectDir::new("missing-project-name");
        write_hcl(
            &dir.path().join("project.hcl"),
            r#"
project {
  version = "1.2.3"
}
"#,
        );
        write_hcl(
            &dir.path().join("systems.hcl"),
            r#"
system "demo" {}
"#,
        );

        let result = compile_dir(dir.path());
        let model = result.model.expect("compilation should succeed");
        assert!(
            result
                .diagnostics
                .iter()
                .all(|diagnostic| !diagnostic.is_error()),
            "unexpected errors: {:?}",
            result.diagnostics
        );
        assert_eq!(
            model.project.name,
            dir.path().file_name().unwrap().to_string_lossy()
        );
        assert_eq!(model.project.version, "1.2.3");
    }

    #[test]
    fn missing_project_block_defaults_to_common_source_directory_name() {
        let dir = TempProjectDir::new("missing-project-block");
        write_hcl(
            &dir.path().join("systems.hcl"),
            r#"
system "demo" {}
"#,
        );
        write_hcl(
            &dir.path().join("components").join("sensor.hcl"),
            r#"
component "sensor" {
  leaf = true
}
"#,
        );

        let result = compile_dir(dir.path());
        let model = result.model.expect("compilation should succeed");
        assert!(
            result
                .diagnostics
                .iter()
                .all(|diagnostic| !diagnostic.is_error()),
            "unexpected errors: {:?}",
            result.diagnostics
        );
        assert_eq!(
            model.project.name,
            dir.path().file_name().unwrap().to_string_lossy()
        );
        assert_eq!(model.project.version, "0.0.0");
    }

    #[test]
    fn explicit_project_name_overrides_directory_default() {
        let dir = TempProjectDir::new("explicit-project-name");
        write_hcl(
            &dir.path().join("project.hcl"),
            r#"
project {
  name = "explicit-name"
}
"#,
        );
        write_hcl(
            &dir.path().join("systems.hcl"),
            r#"
system "demo" {}
"#,
        );

        let result = compile_dir(dir.path());
        let model = result.model.expect("compilation should succeed");
        assert!(
            result
                .diagnostics
                .iter()
                .all(|diagnostic| !diagnostic.is_error()),
            "unexpected errors: {:?}",
            result.diagnostics
        );
        assert_eq!(model.project.name, "explicit-name");
    }

    #[test]
    fn single_system_model_file_emits_no_system_split_error() {
        let sources = vec![
            Source {
                filename: "system.hcl".to_string(),
                content: r#"
project { name = "single-sys" }
system "main" {
  description = "Main system"
  component "sensor" {
    description = "Sensor component"
    leaf = true
  }
}
"#
                .to_string(),
            },
            Source {
                filename: "views.hcl".to_string(),
                content: r#"
view "overview" {
  system = "main"
}
"#
                .to_string(),
            },
        ];

        let result = compile(&sources);
        assert!(result.model.is_some(), "model should compile successfully");
        assert!(
            !result
                .diagnostics
                .iter()
                .any(|d| d.code == DiagnosticCode::E000),
            "no E000 multi-system error should be emitted for single system file"
        );
    }

    #[test]
    fn multiple_system_files_emit_blocking_error() {
        let sources = vec![
            Source {
                filename: "system1.hcl".to_string(),
                content: r#"
system "sys1" {
  description = "System 1"
}
"#
                .to_string(),
            },
            Source {
                filename: "system2.hcl".to_string(),
                content: r#"
system "sys2" {
  description = "System 2"
}
"#
                .to_string(),
            },
        ];

        let result = compile(&sources);
        assert!(
            result.model.is_none(),
            "model should not be produced when blocking error occurs"
        );
        let split_error = result
            .diagnostics
            .iter()
            .find(|d| d.code == DiagnosticCode::E000 && d.is_error());
        assert!(
            split_error.is_some(),
            "E000 error should be emitted when multiple files define system blocks"
        );
        let msg = &split_error.unwrap().message;
        assert!(
            msg.contains("system1.hcl") && msg.contains("system2.hcl"),
            "error message should list the conflicting files: {msg}"
        );
    }
}
