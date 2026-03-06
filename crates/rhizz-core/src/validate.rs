//! Validation pass — warning pass over the resolved Model.

use crate::model::{ComponentParent, Diagnostic, Model};
use std::collections::{HashMap, HashSet};
use tracing::instrument;

/// Run the warning pass over a fully resolved [`Model`].
///
/// Returns a list of non-blocking [`Diagnostic`] values with codes W001–W007.
/// This function never emits E-codes; errors are produced by the resolution pass.
#[instrument(skip(model))]
pub fn validate(model: &Model) -> Vec<Diagnostic> {
    let mut warnings: Vec<Diagnostic> = Vec::new();

    // W001 — non-leaf component with no child components (decomposition pending)
    for comp in &model.components {
        if !comp.leaf && comp.children.is_empty() {
            warnings.push(Diagnostic::warning(
                "W001",
                format!(
                    "component '{}' is non-leaf but has no child components",
                    comp.label
                ),
            ));
        }
    }

    // W002 — non-leaf interface has no messages defined
    for iface in &model.interfaces {
        if !iface.leaf && iface.messages.is_empty() {
            warnings.push(Diagnostic::warning(
                "W002",
                format!(
                    "interface '{}' is non-leaf but has no messages",
                    iface.label
                ),
            ));
        }
    }

    // W003 — message has no fields defined
    for msg in &model.messages {
        if msg.fields.is_empty() {
            warnings.push(Diagnostic::warning(
                "W003",
                format!("message '{}' has no fields", msg.label),
            ));
        }
    }

    // W004 — component is not referenced by any interface (orphan)
    let mut referenced: HashSet<usize> = HashSet::new();
    for iface in &model.interfaces {
        referenced.insert(iface.from.0);
        referenced.insert(iface.to.0);
    }
    for (cid, comp) in model.components.iter().enumerate() {
        if !referenced.contains(&cid) {
            warnings.push(Diagnostic::warning(
                "W004",
                format!(
                    "component '{}' is not referenced by any interface",
                    comp.label
                ),
            ));
        }
    }

    // W005 — entity is missing a description
    for sys in &model.systems {
        if sys.description.is_empty() {
            warnings.push(Diagnostic::warning(
                "W005",
                format!("system '{}' is missing a description", sys.label),
            ));
        }
    }
    for comp in &model.components {
        if comp.description.is_empty() {
            warnings.push(Diagnostic::warning(
                "W005",
                format!("component '{}' is missing a description", comp.label),
            ));
        }
    }
    for iface in &model.interfaces {
        if iface.description.is_empty() {
            warnings.push(Diagnostic::warning(
                "W005",
                format!("interface '{}' is missing a description", iface.label),
            ));
        }
    }
    for msg in &model.messages {
        if msg.description.is_empty() {
            warnings.push(Diagnostic::warning(
                "W005",
                format!("message '{}' is missing a description", msg.label),
            ));
        }
    }

    // W006 — interface `from` and `to` point to the same component
    for iface in &model.interfaces {
        if iface.from == iface.to {
            warnings.push(Diagnostic::warning(
                "W006",
                format!(
                    "interface '{}' has 'from' and 'to' pointing to the same component",
                    iface.label
                ),
            ));
        }
    }

    // W007 — `level` value decreases relative to parent (likely a mistake)
    //
    // For components: compare against parent system/component level.
    for comp in &model.components {
        let parent_level = match comp.parent {
            ComponentParent::System(sid) => model.systems[sid.0].level,
            ComponentParent::Component(pid) => model.components[pid.0].level,
        };
        if comp.level < parent_level {
            warnings.push(Diagnostic::warning(
                "W007",
                format!(
                    "component '{}' has level {} which is less than parent level {}",
                    comp.label, comp.level, parent_level
                ),
            ));
        }
    }
    // For interfaces: determine parent scope level by scanning system/component
    // `interfaces` lists, then compare.
    let mut iface_parent_level: HashMap<usize, i32> = HashMap::new();
    for sys in &model.systems {
        for iid in &sys.interfaces {
            iface_parent_level.insert(iid.0, sys.level);
        }
    }
    for comp in &model.components {
        for iid in &comp.interfaces {
            iface_parent_level.insert(iid.0, comp.level);
        }
    }
    for (idx, iface) in model.interfaces.iter().enumerate() {
        if let Some(&parent_level) = iface_parent_level.get(&idx)
            && iface.level < parent_level
        {
            warnings.push(Diagnostic::warning(
                "W007",
                format!(
                    "interface '{}' has level {} which is less than parent level {}",
                    iface.label, iface.level, parent_level
                ),
            ));
        }
    }

    warnings
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parse::parse_dir;
    use crate::resolve::resolve;
    use std::path::PathBuf;

    fn example_dir(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../examples")
            .join(name)
    }

    fn warning_codes(warnings: &[Diagnostic]) -> Vec<&str> {
        warnings.iter().map(|d| d.code.as_str()).collect()
    }

    // ── drone ──────────────────────────────────────────────────────────────

    #[test]
    fn validate_drone_warnings() {
        let raw = parse_dir(&example_dir("drone")).expect("drone should parse");
        let (model, _) = resolve(raw).expect("drone should resolve without errors");
        let warnings = validate(&model);

        // No errors from resolution
        assert!(
            warnings.iter().all(|d| d.is_warning()),
            "expected only warnings, got: {:?}",
            warning_codes(&warnings)
        );

        // Expected: W001 for ground-station-pc (non-leaf, no children)
        assert!(
            warnings
                .iter()
                .any(|d| d.code == "W001" && d.message.contains("ground-station-pc")),
            "expected W001 for ground-station-pc, got: {:?}",
            warning_codes(&warnings)
        );

        // Expected: W005 for ground-station-pc (missing description)
        assert!(
            warnings
                .iter()
                .any(|d| d.code == "W005" && d.message.contains("ground-station-pc")),
            "expected W005 for ground-station-pc, got: {:?}",
            warning_codes(&warnings)
        );

        // No unexpected E-codes (resolve already guarantees this, but double-check)
        assert!(
            warnings.iter().all(|d| !d.is_error()),
            "unexpected error diagnostics in drone: {:?}",
            warning_codes(&warnings)
        );
    }

    // ── social-media ───────────────────────────────────────────────────────

    #[test]
    fn validate_social_media_warnings() {
        let raw = parse_dir(&example_dir("social-media")).expect("social-media should parse");
        let (model, _) = resolve(raw).expect("social-media should resolve without errors");
        let warnings = validate(&model);

        // No errors
        assert!(
            warnings.iter().all(|d| !d.is_error()),
            "unexpected errors in social-media: {:?}",
            warning_codes(&warnings)
        );

        // W001 — recommendation-engine: non-leaf, no children
        assert!(
            warnings
                .iter()
                .any(|d| d.code == "W001" && d.message.contains("recommendation-engine")),
            "expected W001 for recommendation-engine, got: {:?}",
            warning_codes(&warnings)
        );

        // W002 — push-notify: non-leaf, no messages
        assert!(
            warnings
                .iter()
                .any(|d| d.code == "W002" && d.message.contains("push-notify")),
            "expected W002 for push-notify, got: {:?}",
            warning_codes(&warnings)
        );

        // W004 — video-recorder: not referenced by any interface in mobile-app scope
        assert!(
            warnings
                .iter()
                .any(|d| d.code == "W004" && d.message.contains("video-recorder")),
            "expected W004 for video-recorder, got: {:?}",
            warning_codes(&warnings)
        );

        // W004 — video-service: not referenced by any interface in backend scope
        assert!(
            warnings
                .iter()
                .any(|d| d.code == "W004" && d.message.contains("video-service")),
            "expected W004 for video-service, got: {:?}",
            warning_codes(&warnings)
        );
    }

    // ── software-house ─────────────────────────────────────────────────────

    #[test]
    fn validate_software_house_warnings() {
        let raw = parse_dir(&example_dir("software-house")).expect("software-house should parse");
        let (model, _) = resolve(raw).expect("software-house should resolve without errors");
        let warnings = validate(&model);

        // No errors
        assert!(
            warnings.iter().all(|d| !d.is_error()),
            "unexpected errors in software-house: {:?}",
            warning_codes(&warnings)
        );

        // W001 — operations: non-leaf, no children
        assert!(
            warnings
                .iter()
                .any(|d| d.code == "W001" && d.message.contains("operations")),
            "expected W001 for operations, got: {:?}",
            warning_codes(&warnings)
        );

        // W004 — operations: not referenced by any interface
        assert!(
            warnings
                .iter()
                .any(|d| d.code == "W004" && d.message.contains("operations")),
            "expected W004 for operations, got: {:?}",
            warning_codes(&warnings)
        );

        // W005 — operations: missing description
        assert!(
            warnings
                .iter()
                .any(|d| d.code == "W005" && d.message.contains("operations")),
            "expected W005 for operations, got: {:?}",
            warning_codes(&warnings)
        );
    }

    // ── W003 ───────────────────────────────────────────────────────────────

    #[test]
    fn w003_message_no_fields() {
        let src = r#"
            system "s" {
              component "a" { leaf = true }
              component "b" { leaf = true }
              interface "i" {
                from = "a"
                to   = "b"
                leaf = false
                message "empty-msg" {
                  description = "a message with no fields"
                }
              }
            }
        "#;
        let raw = crate::parse::parse_file(src, std::path::Path::new("test.hcl")).unwrap();
        let (model, _) = resolve(raw).unwrap();
        let warnings = validate(&model);
        assert!(
            warnings
                .iter()
                .any(|d| d.code == "W003" && d.message.contains("empty-msg")),
            "expected W003 for empty-msg, got: {:?}",
            warning_codes(&warnings)
        );
    }

    // ── W006 ───────────────────────────────────────────────────────────────

    #[test]
    fn w006_from_equals_to() {
        let src = r#"
            system "s" {
              component "a" { leaf = true }
              interface "self-loop" {
                from = "a"
                to   = "a"
                leaf = true
              }
            }
        "#;
        let raw = crate::parse::parse_file(src, std::path::Path::new("test.hcl")).unwrap();
        let (model, _) = resolve(raw).unwrap();
        let warnings = validate(&model);
        assert!(
            warnings
                .iter()
                .any(|d| d.code == "W006" && d.message.contains("self-loop")),
            "expected W006 for self-loop, got: {:?}",
            warning_codes(&warnings)
        );
    }

    // ── W007 ───────────────────────────────────────────────────────────────

    #[test]
    fn w007_level_decreases() {
        let src = r#"
            system "s" {
              level = 5
              component "c" {
                level = 2
                leaf  = true
              }
            }
        "#;
        let raw = crate::parse::parse_file(src, std::path::Path::new("test.hcl")).unwrap();
        let (model, _) = resolve(raw).unwrap();
        let warnings = validate(&model);
        assert!(
            warnings
                .iter()
                .any(|d| d.code == "W007" && d.message.contains("c")),
            "expected W007 for component 'c', got: {:?}",
            warning_codes(&warnings)
        );
    }
}
