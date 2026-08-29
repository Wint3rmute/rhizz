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
        let path_str = path_str(&path)?;
        let _ = writeln!(
            out_code,
            "    #[doc = include_str!(r#\"{path_str}\"#)]\n    pub const {code}: Self = Self {{\n        code: \"{code}\",\n        level: {level},\n    }};"
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
