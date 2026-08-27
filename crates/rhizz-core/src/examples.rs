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
        assert!(!apollo.files.is_empty());
        assert!(apollo.files.iter().any(|f| f.path == "system.hcl"));

        for p in projects {
            assert!(!p.id.is_empty());
            assert!(!p.name.is_empty());
            assert!(!p.description.is_empty());
            assert!(!p.files.is_empty());
            for f in p.files {
                assert!(!f.path.is_empty());
                assert!(!f.content.is_empty());
            }
        }
    }
}
