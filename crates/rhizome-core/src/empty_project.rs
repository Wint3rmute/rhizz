//! The seed layout of a brand-new empty project.
//!
//! Single source of truth shared by every surface that creates a project from
//! scratch: the web editor (through the WASM bindings) and the MCP
//! `create_project` tool. Keeping it here means a project made by an AI
//! client is indistinguishable from one made in the UI.

/// Label of the system every empty project starts with, so the auto-seeded
/// `views/main.hcl` view and the component-creation flow always have a system
/// to link to instead of an empty file.
pub const MAIN_SYSTEM_LABEL: &str = "main";

/// Full name of the seeded [`MAIN_SYSTEM_LABEL`] system.
pub const MAIN_SYSTEM_FULL_NAME: &str = "Main system";

/// Project-relative path of the seeded model file.
pub const EMPTY_PROJECT_MAIN_FILE: &str = "main.hcl";

/// Content of the seeded model file: a single `main` system.
pub const EMPTY_PROJECT_HCL: &str = "system \"main\" {\n  full_name = \"Main system\"\n}\n";

/// Project-relative directories seeded alongside the model file. They are
/// empty: a directory entry persists on its own, so no placeholder file is
/// needed.
pub const EMPTY_PROJECT_DIRS: &[&str] = &["docs"];

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Source, compile};

    #[test]
    fn seed_declares_the_main_system_with_its_full_name() {
        assert_eq!(
            EMPTY_PROJECT_HCL,
            format!(
                "system \"{MAIN_SYSTEM_LABEL}\" {{\n  full_name = \"{MAIN_SYSTEM_FULL_NAME}\"\n}}\n"
            )
        );
    }

    #[test]
    fn seed_compiles_without_errors() {
        let result = compile(&[Source {
            filename: EMPTY_PROJECT_MAIN_FILE.to_owned(),
            content: EMPTY_PROJECT_HCL.to_owned(),
        }]);
        assert!(
            result.model.is_some(),
            "seed must resolve: {:?}",
            result.diagnostics
        );
    }

    #[test]
    fn seed_layout_is_a_root_model_file_plus_docs_dir() {
        assert_eq!(EMPTY_PROJECT_MAIN_FILE, "main.hcl");
        assert_eq!(EMPTY_PROJECT_DIRS, ["docs"]);
    }
}
