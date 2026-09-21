//! `rhizz-core` — parsing, resolution, validation, and scoring.
//!
//! This crate has **no** I/O dependency in production code.  All file reading
//! happens outside (in the CLI) and is handed in via [`Source`] slices.

#![deny(clippy::all)]

use tracing::instrument;

pub mod diagnostics;
pub mod examples;
pub mod model;
pub mod mutation;
pub mod parse;
pub mod resolve;
pub mod score;
pub mod serialize;
pub mod validate;

pub use diagnostics::{Diagnostic, DiagnosticCode, Level, ParseWarningLevelError, WarningLevel};
pub use examples::{ExampleFile, ExampleProject, example_projects};
pub use model::{
    Annotation, Component, ComponentId, ComponentKind, ComponentParent, Connection,
    ConnectionEndpoint, ConnectionId, ConnectionLayout, ConnectionSide, Field, FieldId, Message,
    MessageId, Model, NodeLayout, Port, PortId, Project, Protocol, ProtocolId, System, SystemId,
    ViewDefinition, ViewFilterDefinition,
};
pub use mutation::{LoggedAction, ModelOp, MutationResult, mutate_to_hcl};
pub use score::{CategoryScore, ScoreReport, score};
pub use serialize::{parse_views, serialize_model, serialize_views};

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

/// Returns `true` when `filename` names a view/diagram source file.
///
/// View files live under a `diagrams/` directory or are a legacy root-level
/// `views.hcl`. They are validated one-file-at-a-time in phase 2 rather than
/// being merged into the system model.
#[must_use]
pub fn is_view_source(filename: &str) -> bool {
    let path = Path::new(filename);
    let under_diagrams = path
        .components()
        .any(|component| component.as_os_str() == "diagrams");
    let named_views = path.file_name().is_some_and(|name| name == "views.hcl");
    under_diagrams || named_views
}

/// Returns `true` when `filename` names a component documentation file.
///
/// Doc files live under a `docs/` directory and end in `.md` (e.g.
/// `docs/motor.md`). They are never parsed as HCL: [`compile`] extracts
/// their label keys and checks them against component definitions (W018).
#[must_use]
pub fn is_docs_source(filename: &str) -> bool {
    let path = Path::new(filename);
    if path.extension().and_then(|ext| ext.to_str()) != Some("md") {
        return false;
    }
    path.components()
        .any(|component| component.as_os_str() == "docs")
}

/// Extract the doc key for a docs source file: its path relative to `docs/`
/// minus the `.md` suffix (e.g. `docs/motor.md` -> `motor`,
/// `proj/docs/sub/bar.md` -> `sub/bar`). Returns `None` when the filename
/// is not a docs source.
#[must_use]
pub fn doc_key_for(filename: &str) -> Option<String> {
    if !is_docs_source(filename) {
        return None;
    }
    let path = Path::new(filename);
    let components: Vec<String> = path
        .components()
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect();
    let docs_pos = components.iter().rposition(|c| c == "docs")?;
    let mut relative = components[docs_pos + 1..].join("/");
    if let Some(stripped) = relative.strip_suffix(".md") {
        relative = stripped.to_owned();
    }
    if relative.is_empty() { None } else { Some(relative) }
}

/// Parse, merge, resolve, and validate all `sources`.
///
/// Compilation happens in two phases:
/// 1. The system model sources (`system.hcl`/`main.hcl`, i.e. anything that is
///    not a view file) are parsed, merged, resolved and validated exactly as
///    before. When this phase produces hard errors, phase 2 is skipped.
/// 2. Each view file (`diagrams/*.hcl` or a root-level `views.hcl`) is parsed
///    and validated independently against the resolved model. View errors are
///    appended to the result but never clear the model, so one bad view file
///    cannot hide the others or the model itself.
///
/// Returns a [`CompileResult`] with the optional model and all diagnostics.
///
/// Doc files (`docs/*.md`) are never parsed: their label keys are extracted
/// and checked against component definitions (W018) once the model resolves.
#[instrument(skip(sources), fields(source_count = sources.len()))]
pub fn compile(sources: &[Source]) -> CompileResult {
    let (docs_sources, rest): (Vec<&Source>, Vec<&Source>) = sources
        .iter()
        .partition(|source| is_docs_source(&source.filename));
    let doc_keys: std::collections::HashSet<String> = docs_sources
        .iter()
        .filter_map(|source| doc_key_for(&source.filename))
        .collect();
    let (view_sources, model_sources): (Vec<&Source>, Vec<&Source>) = rest
        .into_iter()
        .partition(|source| is_view_source(&source.filename));

    let mut result = compile_model_sources(&model_sources, &doc_keys);

    let phase_one_ok =
        result.model.is_some() && !result.diagnostics.iter().any(Diagnostic::is_error);
    if !phase_one_ok {
        return result;
    }

    let Some(model) = result.model.as_ref() else {
        return result;
    };

    for source in view_sources {
        match serialize::parse_views(&source.content) {
            Ok(views) => {
                result
                    .diagnostics
                    .extend(validate::validate_view(model, &views, &source.filename));
            }
            Err(e) => result.diagnostics.push(Diagnostic {
                code: DiagnosticCode::E000,
                file: Some(PathBuf::from(&source.filename)),
                line: None,
                message: format!("{}: {e}", source.filename),
            }),
        }
    }

    result
}

/// Compile `sources` while reporting warnings down to `warning_level`.
///
/// Errors are always reported, so a business-level spec produces exactly the
/// same [`Model`] as a component-level one — it only sees less feedback. See
/// [`WarningLevel`] for the cumulative semantics.
#[instrument(skip(sources), fields(source_count = sources.len(), %warning_level))]
pub fn compile_with_warning_level(
    sources: &[Source],
    warning_level: WarningLevel,
) -> CompileResult {
    let mut result = compile(sources);
    result
        .diagnostics
        .retain(|diagnostic| warning_level.reports(diagnostic.code));
    result
}

/// Phase 1 of [`compile`]: parse, merge, resolve and validate only the system
/// model sources. View blocks no longer take part in the merge. `doc_keys`
/// carries the `docs/` listing so the missing-documentation check (W018)
/// fires on the resolved model.
fn compile_model_sources(
    sources: &[&Source],
    doc_keys: &std::collections::HashSet<String>,
) -> CompileResult {
    let mut merged = parse::RawFile::default();
    let mut system_files = Vec::new();
    let mut pre_diagnostics = Vec::new();

    for source in sources {
        let path = Path::new(&source.filename);
        let mut file = match parse::parse_file(&source.content, path) {
            Ok(f) => f,
            Err(e) => {
                return CompileResult {
                    model: None,
                    diagnostics: vec![Diagnostic::error(e.code, e.message)],
                };
            }
        };
        // Non-fatal parse warnings (e.g. W015 unexpected block type) surface
        // alongside the resolution/validation diagnostics below. Draining
        // keeps `file` intact for `merge_into`.
        pre_diagnostics.extend(std::mem::take(&mut file.diagnostics));
        if !file.systems.is_empty() {
            system_files.push(path.to_path_buf());
        }
        if let Err(e) = parse::merge_into(&mut merged, file, path) {
            return CompileResult {
                model: None,
                diagnostics: vec![Diagnostic::error(e.code, e.message)],
            };
        }
    }

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
            pre_diagnostics.extend(validate::validate_docs(&model, doc_keys));
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

pub(crate) fn default_project_name(sources: &[&Source]) -> Option<String> {
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
            .filter_map(std::result::Result::ok)
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
                filename: "diagrams/overview.hcl".to_string(),
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
        assert!(
            !result
                .diagnostics
                .iter()
                .any(|d| d.code == DiagnosticCode::E016),
            "the diagram file is valid, so no E016 should be emitted"
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
        let msg = &split_error
            .expect("E000 error should be emitted when multiple files define system blocks")
            .message;
        assert!(
            msg.contains("system1.hcl") && msg.contains("system2.hcl"),
            "error message should list the conflicting files: {msg}"
        );
    }

    // ── source classification ────────────────────────────────────────────

    #[test]
    fn is_view_source_classifies_diagrams_and_legacy_views() {
        assert!(is_view_source("diagrams/overview.hcl"));
        assert!(is_view_source("examples/drone/diagrams/main.hcl"));
        assert!(is_view_source("views.hcl"));
        assert!(is_view_source("examples/drone/views.hcl"));
        assert!(is_view_source("diagrams/views.hcl"));
        assert!(!is_view_source("system.hcl"));
        assert!(!is_view_source("examples/drone/system.hcl"));
        assert!(!is_view_source("diagrams.hcl"));
    }

    // ── docs sources (W018) ────────────────────────────────────────────

    fn docs_source(filename: &str) -> Source {
        Source {
            filename: filename.to_string(),
            content: "# doc\n".to_string(),
        }
    }

    #[test]
    fn is_docs_source_classifies_docs_markdown_only() {
        assert!(is_docs_source("docs/motor.md"));
        assert!(is_docs_source("examples/software-house/docs/product.md"));
        assert!(is_docs_source("/abs/proj/docs/sub/motor.md"));
        assert!(!is_docs_source("docs/motor.hcl"));
        assert!(!is_docs_source("system.hcl"));
        assert!(!is_docs_source("docs.hcl"));
        assert!(!is_docs_source("diagrams/overview.hcl"));
    }

    #[test]
    fn doc_key_for_strips_docs_prefix_and_suffix() {
        assert_eq!(doc_key_for("docs/motor.md").as_deref(), Some("motor"));
        assert_eq!(
            doc_key_for("examples/software-house/docs/product.md").as_deref(),
            Some("product")
        );
        assert_eq!(
            doc_key_for("proj/docs/sub/motor.md").as_deref(),
            Some("sub/motor")
        );
        assert_eq!(doc_key_for("system.hcl"), None);
        assert_eq!(doc_key_for("docs/motor.hcl"), None);
    }

    const DOC_MODEL: &str = "component \"motor\" {\n  description = \"d\"\n  leaf = true\n}";

    #[test]
    fn missing_doc_emits_w018() {
        let result = compile(&[model_source(DOC_MODEL)]);
        assert!(result.model.is_some());
        let w018: Vec<_> = result
            .diagnostics
            .iter()
            .filter(|d| d.code == DiagnosticCode::W018)
            .collect();
        assert_eq!(w018.len(), 1, "expected one W018, got {:?}", codes(&result));
        assert!(w018[0].message.contains("motor"));
        assert!(w018[0].message.contains("docs/motor.md"));
    }

    #[test]
    fn present_doc_suppresses_w018() {
        let result = compile(&[model_source(DOC_MODEL), docs_source("docs/motor.md")]);
        assert!(result.model.is_some());
        assert!(
            result
                .diagnostics
                .iter()
                .all(|d| d.code != DiagnosticCode::W018),
            "doc present, expected no W018, got {:?}",
            codes(&result)
        );
    }

    #[test]
    fn docs_sources_are_never_parsed_as_hcl() {
        // Markdown content must not break compilation: docs files only
        // contribute their filename, never their body.
        let result = compile(&[
            model_source(DOC_MODEL),
            Source {
                filename: "docs/motor.md".to_string(),
                content: "# Motor\n\ncomponent \"broken \" {{{".to_string(),
            },
        ]);
        assert!(result.model.is_some());
        assert!(
            result.diagnostics.iter().all(|d| !d.is_error()),
            "docs content must never error, got {:?}",
            codes(&result)
        );
    }

    #[test]
    fn w018_is_gated_at_component_level() {
        let sources = vec![model_source(DOC_MODEL)];
        for level in [WarningLevel::Business, WarningLevel::Architectural] {
            let result = compile_with_warning_level(&sources, level);
            assert!(
                result
                    .diagnostics
                    .iter()
                    .all(|d| d.code != DiagnosticCode::W018),
                "W018 must be hidden at {level}, got {:?}",
                codes(&result)
            );
        }
        let result = compile_with_warning_level(&sources, WarningLevel::Component);
        assert!(
            result
                .diagnostics
                .iter()
                .any(|d| d.code == DiagnosticCode::W018),
            "W018 must show at component level, got {:?}",
            codes(&result)
        );
    }

    // ── phase 2: per-file view validation ────────────────────────────────

    fn model_source(content: &str) -> Source {
        Source {
            filename: "system.hcl".to_string(),
            content: content.to_string(),
        }
    }

    fn view_source(filename: &str, content: &str) -> Source {
        Source {
            filename: filename.to_string(),
            content: content.to_string(),
        }
    }

    fn codes(result: &CompileResult) -> Vec<&'static str> {
        result.diagnostics.iter().map(|d| d.code.code).collect()
    }

    const SINGLE_SYSTEM: &str = "system \"s\" { description = \"d\" }";

    #[test]
    fn diagram_file_with_zero_views_emits_e016() {
        let sources = vec![
            model_source(SINGLE_SYSTEM),
            view_source("diagrams/overview.hcl", "project { name = \"x\" }"),
        ];
        let result = compile(&sources);
        assert!(result.model.is_some(), "model must survive view errors");
        let e016: Vec<_> = result
            .diagnostics
            .iter()
            .filter(|d| d.code == DiagnosticCode::E016)
            .collect();
        assert_eq!(e016.len(), 1, "expected one E016, got {:?}", codes(&result));
        assert!(
            e016[0].message.contains("diagrams/overview.hcl"),
            "E016 must name the file: {}",
            e016[0].message
        );
    }

    #[test]
    fn diagram_file_with_two_views_emits_e016() {
        let content = "view \"a\" { system = \"s\" }\nview \"b\" { system = \"s\" }";
        let sources = vec![
            model_source(SINGLE_SYSTEM),
            view_source("diagrams/combined.hcl", content),
        ];
        let result = compile(&sources);
        assert_eq!(
            result
                .diagnostics
                .iter()
                .filter(|d| d.code == DiagnosticCode::E016)
                .count(),
            1,
            "expected one E016, got {:?}",
            codes(&result)
        );
    }

    #[test]
    fn diagram_file_label_mismatch_emits_e016() {
        let sources = vec![
            model_source(SINGLE_SYSTEM),
            view_source("diagrams/overview.hcl", "view \"other\" { system = \"s\" }"),
        ];
        let result = compile(&sources);
        let e016: Vec<_> = result
            .diagnostics
            .iter()
            .filter(|d| d.code == DiagnosticCode::E016)
            .collect();
        assert_eq!(e016.len(), 1, "expected one E016, got {:?}", codes(&result));
        assert!(e016[0].message.contains("overview"));
    }

    #[test]
    fn legacy_root_views_hcl_emits_e016() {
        let content = "view \"a\" { system = \"s\" }\nview \"b\" { system = \"s\" }";
        let sources = vec![
            model_source(SINGLE_SYSTEM),
            view_source("views.hcl", content),
        ];
        let result = compile(&sources);
        let e016: Vec<_> = result
            .diagnostics
            .iter()
            .filter(|d| d.code == DiagnosticCode::E016)
            .collect();
        assert_eq!(e016.len(), 1, "expected one E016, got {:?}", codes(&result));
        assert!(e016[0].message.contains("views.hcl"));
    }

    #[test]
    fn per_file_isolation_keeps_valid_and_invalid_diagrams_independent() {
        let sources = vec![
            model_source(SINGLE_SYSTEM),
            view_source(
                "diagrams/overview.hcl",
                "view \"overview\" { system = \"s\" }",
            ),
            view_source(
                "diagrams/broken.hcl",
                "view \"broken\" { system = \"nope\" }",
            ),
        ];
        let result = compile(&sources);
        assert!(result.model.is_some(), "model must survive view errors");
        let e006: Vec<_> = result
            .diagnostics
            .iter()
            .filter(|d| d.code == DiagnosticCode::E006)
            .collect();
        assert_eq!(e006.len(), 1, "expected one E006, got {:?}", codes(&result));
        assert!(e006[0].message.contains("diagrams/broken.hcl"));
    }

    #[test]
    fn valid_diagram_file_emits_no_view_diagnostics() {
        let sources = vec![
            model_source(SINGLE_SYSTEM),
            view_source(
                "diagrams/overview.hcl",
                "view \"overview\" { system = \"s\" }",
            ),
        ];
        let result = compile(&sources);
        assert!(
            result.diagnostics.iter().all(|d| !d.is_error()),
            "unexpected errors: {:?}",
            codes(&result)
        );
    }

    #[test]
    fn diagram_file_with_unknown_node_emits_w016() {
        let model = "component \"cpu\" { leaf = true }\n\
component \"computer\" {\n  instance \"cpu\" { source = \"cpu\" }\n}\n\
system \"computer-setup\" {\n  instance \"computer\" { source = \"computer\" }\n}";
        let diagram = "view \"overview\" {\n  system = \"computer-setup\"\n\n  node \"computer-setup/ghost\" {\n    x = 1\n    y = 2\n  }\n}";
        let sources = vec![
            model_source(model),
            view_source("diagrams/overview.hcl", diagram),
        ];
        let result = compile(&sources);
        assert!(
            result.model.is_some(),
            "model must survive view warnings: {:?}",
            codes(&result)
        );
        let w016: Vec<_> = result
            .diagnostics
            .iter()
            .filter(|d| d.code == DiagnosticCode::W016)
            .collect();
        assert_eq!(w016.len(), 1, "expected one W016, got {:?}", codes(&result));
        assert!(
            w016[0].message.contains("computer-setup/ghost"),
            "W016 must name the bad path: {}",
            w016[0].message
        );
    }

    #[test]
    fn phase_two_is_skipped_when_phase_one_has_errors() {
        let sources = vec![
            model_source("project { name = \"a\" }"),
            Source {
                filename: "other.hcl".to_string(),
                content: "project { name = \"b\" }".to_string(),
            },
            view_source("diagrams/overview.hcl", "view \"other\" { system = \"s\" }"),
        ];
        let result = compile(&sources);
        assert!(result.model.is_none());
        assert!(
            result
                .diagnostics
                .iter()
                .any(|d| d.code == DiagnosticCode::E010),
            "expected E010, got {:?}",
            codes(&result)
        );
        assert!(
            !result
                .diagnostics
                .iter()
                .any(|d| d.code == DiagnosticCode::E016),
            "phase 2 must be skipped when phase 1 fails: {:?}",
            codes(&result)
        );
    }

    #[test]
    fn unknown_model_attr_surfaces_as_e000() {
        let sources = vec![model_source(r#"system "s" { descripton = "typo" }"#)];
        let result = compile(&sources);
        assert!(result.model.is_none(), "model must not survive E000");
        assert!(
            result
                .diagnostics
                .iter()
                .any(|d| d.code == DiagnosticCode::E000),
            "expected E000, got {:?}",
            codes(&result)
        );
    }

    #[test]
    fn instance_extra_attr_surfaces_as_e012() {
        let src = "component \"c\" { leaf = true }\nsystem \"s\" {\n  instance \"i\" {\n    source = \"c\"\n    description = \"extra\"\n  }\n}";
        let result = compile(&[model_source(src)]);
        assert!(result.model.is_none(), "model must not survive E012");
        assert!(
            result
                .diagnostics
                .iter()
                .any(|d| d.code == DiagnosticCode::E012),
            "expected E012, got {:?}",
            codes(&result)
        );
    }

    // ── warning levels ───────────────────────────────────────────────────

    /// Raises one warning per level: W005 (business, self-connection), W001
    /// (architectural, non-leaf definition without children) and W004
    /// (component, missing description).
    const MIXED_WARNINGS: &str = "component \"non-leaf\" {}\n\
system \"s\" {\n\
  instance \"a\" { source = \"non-leaf\" }\n\
  connection \"self\" {\n\
    from = \"a\"\n\
    to   = \"a\"\n\
  }\n\
}";

    fn mixed_warnings_at(level: WarningLevel) -> Vec<&'static str> {
        codes(&compile_with_warning_level(
            &[model_source(MIXED_WARNINGS)],
            level,
        ))
    }

    #[test]
    fn business_level_reports_only_business_warnings() {
        let raised = mixed_warnings_at(WarningLevel::Business);
        assert!(raised.contains(&"W005"), "expected W005, got {raised:?}");
        assert!(!raised.contains(&"W001"), "unexpected W001 in {raised:?}");
        assert!(!raised.contains(&"W004"), "unexpected W004 in {raised:?}");
    }

    #[test]
    fn architectural_level_adds_architectural_warnings() {
        let raised = mixed_warnings_at(WarningLevel::Architectural);
        assert!(raised.contains(&"W005"), "expected W005, got {raised:?}");
        assert!(raised.contains(&"W001"), "expected W001, got {raised:?}");
        assert!(!raised.contains(&"W004"), "unexpected W004 in {raised:?}");
    }

    #[test]
    fn component_level_reports_every_warning() {
        let raised = mixed_warnings_at(WarningLevel::Component);
        for expected in ["W001", "W004", "W005"] {
            assert!(
                raised.contains(&expected),
                "expected {expected}, got {raised:?}"
            );
        }
    }

    #[test]
    fn default_compile_reports_every_warning() {
        let sources = [model_source(MIXED_WARNINGS)];
        assert_eq!(
            codes(&compile(&sources)),
            codes(&compile_with_warning_level(
                &sources,
                WarningLevel::Component
            ))
        );
    }

    #[test]
    fn errors_are_reported_at_every_warning_level() {
        let sources = [model_source(
            "system \"s\" {\n    instance \"a\" {\n        source = \"missing\"\n    }\n}\n",
        )];
        for level in WarningLevel::ALL {
            let result = compile_with_warning_level(&sources, level);
            assert!(
                result.model.is_none(),
                "model must not survive E014 at {level}"
            );
            let raised = codes(&result);
            assert!(
                raised.contains(&"E014"),
                "expected E014 at {level}, got {raised:?}"
            );
        }
    }
}
