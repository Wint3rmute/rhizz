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
use std::fs;
use std::path::{Path, PathBuf};

fn main() {
    let manifest_dir = env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR not set");
    let out_dir = env::var("OUT_DIR").expect("OUT_DIR not set");

    generate_diagnostic_codes(&manifest_dir, &out_dir);
    generate_example_projects(&manifest_dir, &out_dir);
}

/// Generates the `DiagnosticCode` implementation file from markdown documentation.
fn generate_diagnostic_codes(manifest_dir: &str, out_dir: &str) {
    let diagnostics_dir = Path::new(manifest_dir).join("../../SPEC/diagnostics");

    println!("cargo:rerun-if-changed={}", diagnostics_dir.display());

    let mut out_code = String::new();
    out_code.push_str("impl DiagnosticCode {\n");

    let mut entries = Vec::new();

    if let Ok(read_dir) = fs::read_dir(&diagnostics_dir) {
        for entry in read_dir.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            if let Some(ext) = path.extension() {
                if ext != "md" {
                    continue;
                }
            } else {
                continue;
            }

            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                let is_code = (stem.starts_with('E') || stem.starts_with('W'))
                    && stem.len() == 4
                    && stem[1..].chars().all(|c| c.is_ascii_digit());
                if is_code {
                    println!("cargo:rerun-if-changed={}", path.display());
                    entries.push((stem.to_string(), path.canonicalize().unwrap_or(path)));
                }
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
        let path_str = path.to_str().expect("valid UTF-8 path");
        out_code.push_str(&format!(
            "    #[doc = include_str!(r#\"{}\"#)]\n    pub const {}: Self = Self {{\n        code: \"{}\",\n        level: {},\n    }};\n",
            path_str, code, code, level
        ));
    }

    out_code.push_str("}\n");

    let dest_path = Path::new(out_dir).join("diagnostic_codes.rs");
    fs::write(dest_path, out_code).expect("failed to write generated diagnostic_codes.rs");
}

type ExampleFileList = Vec<(String, PathBuf)>;
type ExampleProjectMeta = (String, String, String, ExampleFileList);

fn collect_hcl_files(dir: &Path, base_dir: &Path, acc: &mut ExampleFileList) {
    if let Ok(read_dir) = fs::read_dir(dir) {
        for entry in read_dir.flatten() {
            let path = entry.path();
            if path.is_dir() {
                collect_hcl_files(&path, base_dir, acc);
            } else if path.is_file()
                && path.extension().is_some_and(|ext| ext == "hcl")
                && let Ok(rel_path) = path.strip_prefix(base_dir)
            {
                let rel_str = rel_path.to_string_lossy().replace('\\', "/");
                acc.push((rel_str, path.canonicalize().unwrap_or(path)));
            }
        }
    }
}

/// Generates static embedded representations of all projects in `examples/`.
fn generate_example_projects(manifest_dir: &str, out_dir: &str) {
    let examples_dir = Path::new(manifest_dir).join("../../examples");
    println!("cargo:rerun-if-changed={}", examples_dir.display());

    let mut out_code = String::new();
    let mut projects: Vec<ExampleProjectMeta> = Vec::new();

    if let Ok(read_dir) = fs::read_dir(&examples_dir) {
        for entry in read_dir.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }

            let id = entry.file_name().to_string_lossy().to_string();
            let mut files = Vec::new();
            collect_hcl_files(&path, &path, &mut files);
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
                    "Short-video platform backend services and event streaming pipelines"
                        .to_string(),
                ),
                "software-house" => (
                    "Software House".to_string(),
                    "Organizational model of software engineering departments and processes"
                        .to_string(),
                ),
                "web-app" => (
                    "Web Application".to_string(),
                    "Full-stack web application with frontend, backend API, and database"
                        .to_string(),
                ),
                _ => (id.clone(), "Example architecture project".to_string()),
            };

            projects.push((id, name, desc, files));
        }
    }

    projects.sort_by(|a, b| a.0.cmp(&b.0));

    // Generate static file arrays for each project
    for (i, (_id, _, _, files)) in projects.iter().enumerate() {
        let ident = format!("FILES_{}", i);
        out_code.push_str(&format!("const {}: &[ExampleFile] = &[\n", ident));
        for (rel_path, full_path) in files {
            out_code.push_str(&format!(
                "    ExampleFile {{\n        path: \"{}\",\n        content: include_str!(r#\"{}\"#),\n    }},\n",
                rel_path,
                full_path.to_str().expect("valid UTF-8 path")
            ));
        }
        out_code.push_str("];\n\n");
    }

    out_code.push_str("pub const EXAMPLE_PROJECTS: &[ExampleProject] = &[\n");
    for (i, (id, name, desc, _)) in projects.iter().enumerate() {
        let ident = format!("FILES_{}", i);
        out_code.push_str(&format!(
            "    ExampleProject {{\n        id: \"{}\",\n        name: \"{}\",\n        description: \"{}\",\n        files: {},\n    }},\n",
            id, name, desc, ident
        ));
    }
    out_code.push_str("];\n\n");

    out_code.push_str(
        "/// Returns all embedded example projects.\npub fn example_projects() -> &'static [ExampleProject] {\n    EXAMPLE_PROJECTS\n}\n",
    );

    let dest_path = Path::new(out_dir).join("example_projects.rs");
    fs::write(dest_path, out_code).expect("failed to write generated example_projects.rs");
}
