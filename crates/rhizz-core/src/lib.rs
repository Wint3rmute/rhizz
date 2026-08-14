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
    FieldId, Message, MessageId, Model, Port, PortId, PortRole, Project, System, SystemId, View,
    ViewFilter, ViewOutput,
};
pub use score::{CategoryScore, ScoreReport, score};
pub use serialize::serialize_model;

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
        if let Err(e) = parse::merge_into(&mut merged, file, path) {
            return CompileResult {
                model: None,
                diagnostics: vec![Diagnostic::error(DiagnosticCode::E010, e.to_string())],
            };
        }
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
        Ok((model, diagnostics)) => CompileResult {
            model: Some(model),
            diagnostics,
        },
        Err(diagnostics) => CompileResult {
            model: None,
            diagnostics,
        },
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
}
