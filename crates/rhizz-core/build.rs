//! Build script for `rhizz-core`.
//!
//! Automatically generates diagnostic code constants and doc comments on `DiagnosticCode`
//! by scanning Markdown specification files in `SPEC/diagnostics/`.
//!
//! # Code Generation Pipeline
//!
//! 1. Scans `SPEC/diagnostics/` for files matching `Exxx.md` (error codes) and `Wxxx.md` (warning codes).
//! 2. Emits Cargo `rerun-if-changed` instructions for each diagnostic markdown file and directory.
//! 3. Generates `pub const Exxx` / `pub const Wxxx` definitions inside an `impl DiagnosticCode` block.
//! 4. Embeds the full Markdown content as Rust doc comments via `#[doc = include_str!(...)]`.
//! 5. Writes the generated code to `$OUT_DIR/diagnostic_codes.rs`, which is included in `src/diagnostics.rs`.

use std::env;
use std::error::Error;
use std::fmt::Write as _;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

type Result<T> = std::result::Result<T, Box<dyn Error>>;

fn main() -> Result<()> {
    let manifest_dir = env::var("CARGO_MANIFEST_DIR")?;
    let out_dir = env::var("OUT_DIR")?;

    generate_diagnostic_codes(&manifest_dir, &out_dir)?;
    generate_example_projects(&manifest_dir, &out_dir)?;
    Ok(())
}

/// Converts a filesystem path into its UTF-8 string form, erroring on
/// non-UTF-8 paths instead of panicking.
fn path_str(path: &Path) -> Result<&str> {
    path.to_str().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            format!("path is not valid UTF-8: {}", path.display()),
        )
        .into()
    })
}

/// Marker that introduces the machine-readable warning-level declaration every
/// warning document carries directly below its title.
const WARNING_LEVEL_PREFIX: &str = "warning level:";

/// Accepted warning-level names, paired with the constant `build.rs` emits for
/// them. Ordered from least to most detailed.
const WARNING_LEVELS: [(&str, &str); 3] = [
    ("business", "WarningLevel::Business"),
    ("architectural", "WarningLevel::Architectural"),
    ("component", "WarningLevel::Component"),
];

/// Warning level assigned to error codes. Errors are reported at every level
/// (see `WarningLevel::reports`), so the value is never consulted for them —
/// `E*.md` files are forbidden from declaring their own.
const ERROR_WARNING_LEVEL: &str = "WarningLevel::Business";

/// Builds a build-script error attributed to a diagnostic document.
fn doc_error(path: &Path, message: &str) -> Box<dyn Error> {
    io::Error::new(
        io::ErrorKind::InvalidData,
        format!("{}: {message}", path.display()),
    )
    .into()
}

/// Returns the code named by a document's H1, e.g. `Some("W010")` for
/// `# W010 — Unused port`.
fn title_code(markdown: &str) -> Option<&str> {
    markdown
        .lines()
        .map(str::trim_start)
        .find_map(|line| line.strip_prefix("# "))
        .and_then(|title| title.split_whitespace().next())
}

/// Extracts the warning level declared on the first non-blank line after the
/// H1, e.g. `**Warning level:** Component.` -> `Some("component")`.
///
/// Markdown emphasis and a trailing period are both optional, so
/// `Warning level: component` parses identically.
fn warning_level_declaration(markdown: &str) -> Option<String> {
    let mut lines = markdown.lines();
    lines.find(|line| line.trim_start().starts_with("# "))?;

    lines
        .map(str::trim)
        .find(|trimmed| !trimmed.is_empty())
        .map(|trimmed| trimmed.replace('*', "").to_ascii_lowercase())
        .and_then(|normalized| {
            normalized
                .strip_prefix(WARNING_LEVEL_PREFIX)
                .map(|value| value.trim().trim_end_matches('.').to_owned())
        })
}

/// Resolves the `WarningLevel` constant a diagnostic document declares.
///
/// Warnings must declare one; errors must not, and always report everywhere.
fn resolve_warning_level(code: &str, path: &Path, markdown: &str) -> Result<&'static str> {
    let declared = warning_level_declaration(markdown);

    if code.starts_with('E') {
        if declared.is_some() {
            return Err(doc_error(
                path,
                &format!(
                    "{code}: error codes must not declare a warning level — they are reported at \
                     every level; delete the '**Warning level:**' line"
                ),
            ));
        }
        return Ok(ERROR_WARNING_LEVEL);
    }

    let Some(declared) = declared else {
        return Err(doc_error(
            path,
            &format!(
                "{code}: missing warning level — add '**Warning level:** \
                 <business|architectural|component>.' as the first line after the title"
            ),
        ));
    };

    WARNING_LEVELS
        .iter()
        .find_map(|(name, constant)| (*name == declared).then_some(*constant))
        .ok_or_else(|| {
            let allowed = WARNING_LEVELS
                .iter()
                .map(|(name, _)| *name)
                .collect::<Vec<_>>()
                .join(", ");
            doc_error(
                path,
                &format!("{code}: unknown warning level '{declared}' — expected one of: {allowed}"),
            )
        })
}

/// Generates the `DiagnosticCode` implementation file from markdown documentation.
fn generate_diagnostic_codes(manifest_dir: &str, out_dir: &str) -> Result<()> {
    let diagnostics_dir = Path::new(manifest_dir).join("../../SPEC/diagnostics");

    println!("cargo:rerun-if-changed={}", diagnostics_dir.display());

    let mut out_code = String::new();
    out_code.push_str("impl DiagnosticCode {\n");

    let mut entries = Vec::new();

    let read_dir = fs::read_dir(&diagnostics_dir)?;
    for entry in read_dir.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }

        if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
            let is_code = stem.len() == 4
                && matches!(stem.chars().next(), Some('E' | 'W'))
                && stem.chars().skip(1).all(|c| c.is_ascii_digit());
            if is_code {
                println!("cargo:rerun-if-changed={}", path.display());
                entries.push((stem.to_string(), path.canonicalize().unwrap_or(path)));
            }
        }
    }

    entries.sort_by(|a, b| a.0.cmp(&b.0));

    for (code, path) in entries {
        let level = if code.starts_with('E') {
            "Level::Error"
        } else {
            "Level::Warning"
        };
        let markdown = fs::read_to_string(&path)?;

        // The H1 names the code, so a document duplicated to a new filename
        // cannot silently keep the old title.
        if title_code(&markdown) != Some(code.as_str()) {
            return Err(doc_error(
                &path,
                &format!(
                    "title must read '# {code} — ...' to match the filename (found: {})",
                    title_code(&markdown).unwrap_or("<no '# ' title line>")
                ),
            ));
        }

        let min_warning_level = resolve_warning_level(&code, &path, &markdown)?;
        let path_str = path_str(&path)?;
        let _ = writeln!(
            out_code,
            "    #[doc = include_str!(r#\"{path_str}\"#)]\n    pub const {code}: Self = Self {{\n        code: \"{code}\",\n        level: {level},\n        min_warning_level: {min_warning_level},\n    }};"
        );
    }

    out_code.push_str("}\n");

    let dest_path = Path::new(out_dir).join("diagnostic_codes.rs");
    fs::write(dest_path, out_code)?;
    Ok(())
}

type ExampleFileList = Vec<(String, PathBuf)>;
type ExampleProjectMeta = (String, String, String, ExampleFileList);

fn collect_example_files(dir: &Path, base_dir: &Path, acc: &mut ExampleFileList) {
    println!("cargo:rerun-if-changed={}", dir.display());
    if let Ok(read_dir) = fs::read_dir(dir) {
        for entry in read_dir.flatten() {
            let path = entry.path();
            if path.is_dir() {
                collect_example_files(&path, base_dir, acc);
            } else if path.is_file()
                && path
                    .extension()
                    .and_then(|e| e.to_str())
                    .is_some_and(|ext| ext == "hcl" || ext == "md")
                && let Ok(rel_path) = path.strip_prefix(base_dir)
            {
                let rel_str = rel_path.to_string_lossy().replace('\\', "/");
                println!("cargo:rerun-if-changed={}", path.display());
                acc.push((rel_str, path.canonicalize().unwrap_or(path)));
            }
        }
    }
}

/// Generates static embedded representations of all projects in `examples/`.
fn generate_example_projects(manifest_dir: &str, out_dir: &str) -> Result<()> {
    let examples_dir = Path::new(manifest_dir).join("../../examples");
    println!("cargo:rerun-if-changed={}", examples_dir.display());

    let mut out_code = String::new();
    let mut projects: Vec<ExampleProjectMeta> = Vec::new();

    let read_dir = fs::read_dir(&examples_dir)?;
    for entry in read_dir.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let id = entry.file_name().to_string_lossy().to_string();
        let mut files = Vec::new();
        collect_example_files(&path, &path, &mut files);
        if files.is_empty() {
            continue;
        }
        files.sort_by(|a, b| a.0.cmp(&b.0));

        for (_, file_path) in &files {
            println!("cargo:rerun-if-changed={}", file_path.display());
        }

        let (name, desc) = match id.as_str() {
            "apollo-11" => (
                "Apollo 11 Mission Stack".to_string(),
                "Trans-lunar, lunar landing, and Deep Space Network architecture".to_string(),
            ),
            "drone" => (
                "Quadcopter Drone".to_string(),
                "Quadcopter drone with ground station and flight controller decomposition"
                    .to_string(),
            ),
            "single-file" => (
                "Home Monitor (Single File)".to_string(),
                "Smart home environmental monitoring node in a single HCL file".to_string(),
            ),
            "social-media" => (
                "Social Media Platform".to_string(),
                "Short-video platform backend services and event streaming pipelines".to_string(),
            ),
            "software-house" => (
                "Software House".to_string(),
                "Organizational model of software engineering departments and processes"
                    .to_string(),
            ),
            "web-app" => (
                "Web Application".to_string(),
                "Full-stack web application with frontend, backend API, and database".to_string(),
            ),
            _ => (id.clone(), "Example architecture project".to_string()),
        };

        projects.push((id, name, desc, files));
    }

    projects.sort_by(|a, b| a.0.cmp(&b.0));

    // Generate static file arrays for each project
    for (i, (_id, _, _, files)) in projects.iter().enumerate() {
        let ident = format!("FILES_{i}");
        let _ = writeln!(out_code, "const {ident}: &[ExampleFile] = &[\n");
        for (rel_path, full_path) in files {
            let full_path_str = path_str(full_path)?;
            let _ = writeln!(
                out_code,
                "    ExampleFile {{\n        path: \"{rel_path}\",\n        content: include_str!(r#\"{full_path_str}\"#),\n    }},"
            );
        }
        out_code.push_str("];\n\n");
    }

    out_code.push_str("pub const EXAMPLE_PROJECTS: &[ExampleProject] = &[\n");
    for (i, (id, name, desc, _)) in projects.iter().enumerate() {
        let ident = format!("FILES_{i}");
        let _ = writeln!(
            out_code,
            "    ExampleProject {{\n        id: \"{id}\",\n        name: \"{name}\",\n        description: \"{desc}\",\n        files: {ident},\n    }},"
        );
    }
    out_code.push_str("];\n\n");

    out_code.push_str(
        "/// Returns all embedded example projects.\n#[must_use]\npub const fn example_projects() -> &'static [ExampleProject] {\n    EXAMPLE_PROJECTS\n}\n",
    );

    let dest_path = Path::new(out_dir).join("example_projects.rs");
    fs::write(dest_path, out_code)?;
    Ok(())
}
