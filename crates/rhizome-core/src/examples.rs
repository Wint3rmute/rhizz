//! Embedded example projects.
//!
//! Exposes all example systems defined under `examples/` as static, compiled-in
//! data structures so that tools (CLI, WASM workbench, tests) have a single
//! source of truth.

/// A single source file in an embedded example project.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ExampleFile {
    /// Relative path within the project (e.g. `"system.hcl"` or `"views.hcl"`).
    pub path: &'static str,
    /// UTF-8 HCL content.
    pub content: &'static str,
}

/// An embedded example project available for scaffolding or exploring.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ExampleProject {
    /// Identifier / directory name (e.g. `"apollo-11"`, `"drone"`).
    pub id: &'static str,
    /// Human-readable title (e.g. `"Apollo 11 Mission Stack"`).
    pub name: &'static str,
    /// Brief description of what this example demonstrates.
    pub description: &'static str,
    /// List of source files comprising the project.
    pub files: &'static [ExampleFile],
}

include!(concat!(env!("OUT_DIR"), "/example_projects.rs"));

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Source, compile};
    use std::fmt::Write as _;
    use std::path::Path;

    /// Set to `1` to rewrite `examples/README.md` instead of failing on drift
    /// (`just examples-readme`).
    const UPDATE_README_ENV: &str = "RHIZOME_UPDATE_EXAMPLES_README";
    const README_BEGIN: &str = "<!-- BEGIN GENERATED: examples table — edit each example's `project` block, then run `just examples-readme` -->";
    const README_END: &str = "<!-- END GENERATED -->";

    /// Renders the README table from the embedded examples' metadata.
    fn readme_table() -> String {
        let rows: Vec<[String; 3]> = example_projects()
            .iter()
            .map(|p| {
                [
                    format!("[{id}/]({id}/)", id = p.id),
                    p.name.to_owned(),
                    p.description.to_owned(),
                ]
            })
            .collect();
        let header = ["Example", "Name", "Description"].map(str::to_owned);
        let widths: Vec<usize> = (0..3)
            .map(|c| {
                std::iter::once(&header)
                    .chain(&rows)
                    .map(|r| r[c].chars().count())
                    .max()
                    .unwrap_or(0)
            })
            .collect();
        let line = |cells: &[String; 3]| {
            let mut out = String::from("|");
            for (cell, width) in cells.iter().zip(&widths) {
                let _ = write!(out, " {cell:<width$} |");
            }
            out
        };
        let rule: [String; 3] = std::array::from_fn(|c| "-".repeat(widths[c]));
        let mut table = vec![line(&header), line(&rule)];
        table.extend(rows.iter().map(line));
        table.join("\n")
    }

    #[test]
    fn example_metadata_comes_from_its_project_block() {
        for p in example_projects() {
            let sources: Vec<Source> = p
                .files
                .iter()
                .filter(|f| Path::new(f.path).extension().is_some_and(|e| e == "hcl"))
                .map(|f| Source {
                    filename: f.path.to_owned(),
                    content: f.content.to_owned(),
                })
                .collect();
            let model = compile(&sources)
                .model
                .unwrap_or_else(|| panic!("{} should compile", p.id));
            assert_eq!(model.project.full_name.as_deref(), Some(p.name), "{}", p.id);
            assert_eq!(
                model.project.description.as_deref(),
                Some(p.description),
                "{}",
                p.id
            );
        }
    }

    #[test]
    fn readme_table_matches_examples() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples/README.md");
        let readme = std::fs::read_to_string(&path).expect("examples/README.md");
        let (before, rest) = readme
            .split_once(README_BEGIN)
            .expect("README is missing the BEGIN GENERATED marker");
        let (current, after) = rest
            .split_once(README_END)
            .expect("README is missing the END GENERATED marker");
        let expected = format!("\n\n{}\n\n", readme_table());
        if current == expected {
            return;
        }
        if std::env::var(UPDATE_README_ENV).as_deref() == Ok("1") {
            let updated = format!("{before}{README_BEGIN}{expected}{README_END}{after}");
            std::fs::write(&path, updated).expect("write examples/README.md");
            return;
        }
        panic!(
            "examples/README.md is out of date with the examples' `project` blocks; \
             run `just examples-readme`"
        );
    }

    #[test]
    fn test_embedded_examples_present_and_valid() {
        let projects = example_projects();
        assert!(
            projects.len() >= 6,
            "expected at least 6 embedded examples, got {}",
            projects.len()
        );

        let apollo = projects
            .iter()
            .find(|p| p.id == "apollo-11")
            .expect("apollo-11 missing");
        assert_eq!(apollo.name, "Apollo 11 Mission Stack");
        assert!(!apollo.files.is_empty(), "{:?}", apollo.files);
        assert!(apollo.files.iter().any(|f| f.path == "system.hcl"));

        for p in projects {
            assert!(!p.id.is_empty(), "{:?}", p.id);
            assert!(!p.name.is_empty(), "{:?}", p.name);
            assert!(!p.description.is_empty(), "{:?}", p.description);
            assert!(!p.files.is_empty(), "{:?}", p.files);
            for f in p.files {
                assert!(!f.path.is_empty(), "{:?}", f.path);
                assert!(!f.content.is_empty(), "{:?}", f.content);
            }
        }
    }
}
