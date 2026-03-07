//! Validation pass -- warning pass over the resolved Model.

use crate::model::{ComponentParent, Diagnostic, Model, PortRole};
use std::collections::{HashMap, HashSet};
use tracing::instrument;

/// Run the warning pass over a fully resolved [`Model`].
///
/// Returns a list of non-blocking [`Diagnostic`] values with codes W001-W011.
/// This function never emits E-codes; errors are produced by the resolution pass.
#[instrument(skip(model))]
pub fn validate(model: &Model) -> Vec<Diagnostic> {
    let mut warnings: Vec<Diagnostic> = Vec::new();

    // W001 -- non-leaf component with no child components (decomposition pending)
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

    // W002 -- message has no fields defined
    for msg in &model.messages {
        if msg.fields.is_empty() {
            warnings.push(Diagnostic::warning(
                "W002",
                format!("message '{}' has no fields", msg.label),
            ));
        }
    }

    // W003 -- component is not referenced by any connection (orphan)
    let mut referenced: HashSet<usize> = HashSet::new();
    for conn in &model.connections {
        referenced.insert(conn.from.component.0);
        referenced.insert(conn.to.component.0);
    }
    for (cid, comp) in model.components.iter().enumerate() {
        if !referenced.contains(&cid) {
            warnings.push(Diagnostic::warning(
                "W003",
                format!(
                    "component '{}' is not referenced by any connection",
                    comp.label
                ),
            ));
        }
    }

    // W004 -- entity is missing a description
    for sys in &model.systems {
        if sys.description.is_empty() {
            warnings.push(Diagnostic::warning(
                "W004",
                format!("system '{}' is missing a description", sys.label),
            ));
        }
    }
    for comp in &model.components {
        if comp.description.is_empty() {
            warnings.push(Diagnostic::warning(
                "W004",
                format!("component '{}' is missing a description", comp.label),
            ));
        }
    }
    for conn in &model.connections {
        if conn.description.is_empty() {
            warnings.push(Diagnostic::warning(
                "W004",
                format!("connection '{}' is missing a description", conn.label),
            ));
        }
    }
    for msg in &model.messages {
        if msg.description.is_empty() {
            warnings.push(Diagnostic::warning(
                "W004",
                format!("message '{}' is missing a description", msg.label),
            ));
        }
    }

    // W005 -- connection `from` and `to` point to the same component
    for conn in &model.connections {
        if conn.from.component == conn.to.component {
            warnings.push(Diagnostic::warning(
                "W005",
                format!(
                    "connection '{}' has 'from' and 'to' pointing to the same component",
                    conn.label
                ),
            ));
        }
    }

    // W006 -- `level` value decreases relative to parent (likely a mistake)
    for comp in &model.components {
        let parent_level = match comp.parent {
            ComponentParent::System(sid) => model.systems[sid.0].level,
            ComponentParent::Component(pid) => model.components[pid.0].level,
        };
        if comp.level < parent_level {
            warnings.push(Diagnostic::warning(
                "W006",
                format!(
                    "component '{}' has level {} which is less than parent level {}",
                    comp.label, comp.level, parent_level
                ),
            ));
        }
    }
    // For connections: determine parent scope level by scanning system/component
    // `connections` lists, then compare.
    let mut conn_parent_level: HashMap<usize, i32> = HashMap::new();
    for sys in &model.systems {
        for cid in &sys.connections {
            conn_parent_level.insert(cid.0, sys.level);
        }
    }
    for comp in &model.components {
        for cid in &comp.connections {
            conn_parent_level.insert(cid.0, comp.level);
        }
    }
    for (idx, conn) in model.connections.iter().enumerate() {
        if let Some(&parent_level) = conn_parent_level.get(&idx)
            && conn.level < parent_level
        {
            warnings.push(Diagnostic::warning(
                "W006",
                format!(
                    "connection '{}' has level {} which is less than parent level {}",
                    conn.label, conn.level, parent_level
                ),
            ));
        }
    }

    // W007 -- one side of a connection is typed (comp:port), the other is not
    for conn in &model.connections {
        let from_typed = conn.from.port.is_some();
        let to_typed = conn.to.port.is_some();
        if from_typed != to_typed {
            warnings.push(Diagnostic::warning(
                "W007",
                format!(
                    "connection '{}': one side is typed (comp:port) but the other is bare",
                    conn.label
                ),
            ));
        }
    }

    // W008 -- both sides typed but protocol values differ
    for conn in &model.connections {
        if let (Some(from_pid), Some(to_pid)) = (conn.from.port, conn.to.port) {
            let from_proto = &model.ports[from_pid.0].protocol;
            let to_proto = &model.ports[to_pid.0].protocol;
            if !from_proto.is_empty() && !to_proto.is_empty() && from_proto != to_proto {
                warnings.push(Diagnostic::warning(
                    "W008",
                    format!(
                        "connection '{}': protocol mismatch ('{}' vs '{}')",
                        conn.label, from_proto, to_proto
                    ),
                ));
            }
        }
    }

    // W009 -- port roles are incompatible or ambiguous
    // Compatible pairs: provider<->consumer, peer<->peer
    // Incompatible: provider<->provider, consumer<->consumer, provider<->peer, consumer<->peer
    for conn in &model.connections {
        if let (Some(from_pid), Some(to_pid)) = (conn.from.port, conn.to.port) {
            let from_role = model.ports[from_pid.0].role;
            let to_role = model.ports[to_pid.0].role;
            let compatible = matches!(
                (from_role, to_role),
                (PortRole::Provider, PortRole::Consumer)
                    | (PortRole::Consumer, PortRole::Provider)
                    | (PortRole::Peer, PortRole::Peer)
            );
            if !compatible {
                warnings.push(Diagnostic::warning(
                    "W009",
                    format!(
                        "connection '{}': port roles are incompatible ({:?} <-> {:?})",
                        conn.label, from_role, to_role
                    ),
                ));
            }
        }
    }

    // W010 -- port is defined but not referenced by any connection endpoint
    let mut used_ports: HashSet<usize> = HashSet::new();
    for conn in &model.connections {
        if let Some(pid) = conn.from.port {
            used_ports.insert(pid.0);
        }
        if let Some(pid) = conn.to.port {
            used_ports.insert(pid.0);
        }
    }
    for (idx, port) in model.ports.iter().enumerate() {
        if !used_ports.contains(&idx) {
            warnings.push(Diagnostic::warning(
                "W010",
                format!("port '{}' is not referenced by any connection", port.label),
            ));
        }
    }

    // W011 -- port has no messages defined
    for port in &model.ports {
        if port.messages.is_empty() {
            warnings.push(Diagnostic::warning(
                "W011",
                format!("port '{}' has no messages defined", port.label),
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

        // Expected: W004 for ground-station-pc (missing description)
        assert!(
            warnings
                .iter()
                .any(|d| d.code == "W004" && d.message.contains("ground-station-pc")),
            "expected W004 for ground-station-pc, got: {:?}",
            warning_codes(&warnings)
        );

        // No unexpected E-codes
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

        // W001 -- recommendation-engine: non-leaf, no children
        assert!(
            warnings
                .iter()
                .any(|d| d.code == "W001" && d.message.contains("recommendation-engine")),
            "expected W001 for recommendation-engine, got: {:?}",
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

        // W001 -- operations: non-leaf, no children
        assert!(
            warnings
                .iter()
                .any(|d| d.code == "W001" && d.message.contains("operations")),
            "expected W001 for operations, got: {:?}",
            warning_codes(&warnings)
        );

        // W003 -- operations: not referenced by any connection
        assert!(
            warnings
                .iter()
                .any(|d| d.code == "W003" && d.message.contains("operations")),
            "expected W003 for operations, got: {:?}",
            warning_codes(&warnings)
        );

        // W004 -- operations: missing description
        assert!(
            warnings
                .iter()
                .any(|d| d.code == "W004" && d.message.contains("operations")),
            "expected W004 for operations, got: {:?}",
            warning_codes(&warnings)
        );
    }

    // ── W002 ───────────────────────────────────────────────────────────────

    #[test]
    fn w002_message_no_fields() {
        let src = r#"
            system "s" {
              component "a" {
                leaf = true
                port "p" {
                  role = "provider"
                  message "empty-msg" {
                    description = "a message with no fields"
                  }
                }
              }
              component "b" { leaf = true }
              connection "c" {
                from = "a"
                to   = "b"
              }
            }
        "#;
        let raw = crate::parse::parse_file(src, std::path::Path::new("test.hcl")).unwrap();
        let (model, _) = resolve(raw).unwrap();
        let warnings = validate(&model);
        assert!(
            warnings
                .iter()
                .any(|d| d.code == "W002" && d.message.contains("empty-msg")),
            "expected W002 for empty-msg, got: {:?}",
            warning_codes(&warnings)
        );
    }

    // ── W005 ───────────────────────────────────────────────────────────────

    #[test]
    fn w005_from_equals_to() {
        let src = r#"
            system "s" {
              component "a" { leaf = true }
              connection "self-loop" {
                from = "a"
                to   = "a"
              }
            }
        "#;
        let raw = crate::parse::parse_file(src, std::path::Path::new("test.hcl")).unwrap();
        let (model, _) = resolve(raw).unwrap();
        let warnings = validate(&model);
        assert!(
            warnings
                .iter()
                .any(|d| d.code == "W005" && d.message.contains("self-loop")),
            "expected W005 for self-loop, got: {:?}",
            warning_codes(&warnings)
        );
    }

    // ── W006 ───────────────────────────────────────────────────────────────

    #[test]
    fn w006_level_decreases() {
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
                .any(|d| d.code == "W006" && d.message.contains("c")),
            "expected W006 for component 'c', got: {:?}",
            warning_codes(&warnings)
        );
    }

    // ── W007 ───────────────────────────────────────────────────────────────

    #[test]
    fn w007_mixed_typed_untyped() {
        let src = r#"
            system "s" {
              component "a" {
                leaf = true
                port "p" { role = "provider" }
              }
              component "b" { leaf = true }
              connection "mixed" {
                from = "a:p"
                to   = "b"
              }
            }
        "#;
        let raw = crate::parse::parse_file(src, std::path::Path::new("test.hcl")).unwrap();
        let (model, _) = resolve(raw).unwrap();
        let warnings = validate(&model);
        assert!(
            warnings
                .iter()
                .any(|d| d.code == "W007" && d.message.contains("mixed")),
            "expected W007 for mixed, got: {:?}",
            warning_codes(&warnings)
        );
    }

    // ── W008 ───────────────────────────────────────────────────────────────

    #[test]
    fn w008_protocol_mismatch() {
        let src = r#"
            system "s" {
              component "a" {
                leaf = true
                port "p1" {
                  protocol = "spi"
                  role = "provider"
                }
              }
              component "b" {
                leaf = true
                port "p2" {
                  protocol = "i2c"
                  role = "consumer"
                }
              }
              connection "mismatch" {
                from = "a:p1"
                to   = "b:p2"
              }
            }
        "#;
        let raw = crate::parse::parse_file(src, std::path::Path::new("test.hcl")).unwrap();
        let (model, _) = resolve(raw).unwrap();
        let warnings = validate(&model);
        assert!(
            warnings
                .iter()
                .any(|d| d.code == "W008" && d.message.contains("mismatch")),
            "expected W008 for mismatch, got: {:?}",
            warning_codes(&warnings)
        );
    }

    // ── W009 ───────────────────────────────────────────────────────────────

    #[test]
    fn w009_incompatible_roles() {
        let src = r#"
            system "s" {
              component "a" {
                leaf = true
                port "p1" {
                  protocol = "spi"
                  role = "provider"
                }
              }
              component "b" {
                leaf = true
                port "p2" {
                  protocol = "spi"
                  role = "provider"
                }
              }
              connection "clash" {
                from = "a:p1"
                to   = "b:p2"
              }
            }
        "#;
        let raw = crate::parse::parse_file(src, std::path::Path::new("test.hcl")).unwrap();
        let (model, _) = resolve(raw).unwrap();
        let warnings = validate(&model);
        assert!(
            warnings
                .iter()
                .any(|d| d.code == "W009" && d.message.contains("clash")),
            "expected W009 for clash, got: {:?}",
            warning_codes(&warnings)
        );
    }
}
