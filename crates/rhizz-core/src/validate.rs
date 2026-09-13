//! Validation pass -- warning pass over the resolved Model.

use crate::model::{
    ComponentKind, ComponentParent, Diagnostic, DiagnosticCode, Model, ViewDefinition,
};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use tracing::instrument;

/// Run the warning pass over a fully resolved [`Model`].
///
/// Returns a list of non-blocking [`Diagnostic`] values with codes W001-W011.
/// This function never emits E-codes; errors are produced by the resolution pass.
// Long but linear: one loop per warning rule (W001-W011), each independent.
#[allow(clippy::too_many_lines)]
#[instrument(skip(model))]
pub fn validate(model: &Model) -> Vec<Diagnostic> {
    let mut warnings: Vec<Diagnostic> = Vec::new();

    // W001 -- non-leaf component with no child components (decomposition
    // pending). Only definitions are checked: an instance clones the
    // definition's body, so a structural defect would be reported on the
    // definition itself and must not be duplicated per instance.
    for comp in &model.components {
        if comp.kind == ComponentKind::Instance {
            continue;
        }
        if !comp.leaf && comp.children.is_empty() {
            warnings.push(Diagnostic::warning(
                DiagnosticCode::W001,
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
                DiagnosticCode::W002,
                format!("message '{}' has no fields", msg.label),
            ));
        }
    }

    // W003 -- placed instance is not referenced by any connection (orphan).
    // Reusable definitions are abstractions that cannot be connected, so only
    // instances are checked; the source definition is appended for context.
    let mut referenced: HashSet<usize> = HashSet::new();
    for conn in &model.connections {
        referenced.insert(conn.from.component.0);
        referenced.insert(conn.to.component.0);
    }
    for (cid, comp) in model.components.iter().enumerate() {
        if comp.kind == ComponentKind::Definition {
            continue;
        }
        if !referenced.contains(&cid) {
            let source_suffix = comp
                .source
                .as_deref()
                .map_or_else(String::new, |source| format!(" (source '{source}')"));
            warnings.push(Diagnostic::warning(
                DiagnosticCode::W003,
                format!(
                    "component '{}'{} is not referenced by any connection",
                    comp.label, source_suffix
                ),
            ));
        }
    }

    // W004 -- entity is missing a description
    for sys in &model.systems {
        if sys.description.is_empty() {
            warnings.push(Diagnostic::warning(
                DiagnosticCode::W004,
                format!("system '{}' is missing a description", sys.label),
            ));
        }
    }
    for comp in &model.components {
        if comp.kind == ComponentKind::Instance {
            continue;
        }
        if comp.description.is_empty() {
            warnings.push(Diagnostic::warning(
                DiagnosticCode::W004,
                format!("component '{}' is missing a description", comp.label),
            ));
        }
    }
    for conn in &model.connections {
        if conn.description.is_empty() {
            warnings.push(Diagnostic::warning(
                DiagnosticCode::W004,
                format!("connection '{}' is missing a description", conn.label),
            ));
        }
    }
    for msg in &model.messages {
        if msg.description.is_empty() {
            warnings.push(Diagnostic::warning(
                DiagnosticCode::W004,
                format!("message '{}' is missing a description", msg.label),
            ));
        }
    }

    // W005 -- connection `from` and `to` point to the same component
    for conn in &model.connections {
        if conn.from.component == conn.to.component {
            warnings.push(Diagnostic::warning(
                DiagnosticCode::W005,
                format!(
                    "connection '{}' has 'from' and 'to' pointing to the same component",
                    conn.label
                ),
            ));
        }
    }

    // W006 -- `level` value decreases relative to parent (likely a mistake).
    // Systems are implicitly level 0 (SPEC.md §2.2).
    for comp in &model.components {
        let parent_level = match comp.parent {
            Some(ComponentParent::System(_)) => 0,
            Some(ComponentParent::Component(pid)) => model.component(pid).map_or(0, |c| c.level),
            // A top-level definition has no placement parent; nothing to compare.
            None => continue,
        };
        if comp.level < parent_level {
            warnings.push(Diagnostic::warning(
                DiagnosticCode::W006,
                format!(
                    "component '{}' has level {} which is less than parent level {}",
                    comp.label, comp.level, parent_level
                ),
            ));
        }
    }
    // For connections: determine parent scope level by scanning system/component
    // `connections` lists, then compare. Systems are implicitly level 0.
    let mut conn_parent_level: HashMap<usize, i32> = HashMap::new();
    for sys in &model.systems {
        for cid in &sys.connections {
            conn_parent_level.insert(cid.0, 0);
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
                DiagnosticCode::W006,
                format!(
                    "connection '{}' has level {} which is less than parent level {}",
                    conn.label, conn.level, parent_level
                ),
            ));
        }
    }

    // W007 -- one side of a connection is typed (comp/port), the other is not
    for conn in &model.connections {
        let from_typed = conn.from.port.is_some();
        let to_typed = conn.to.port.is_some();
        if from_typed != to_typed {
            warnings.push(Diagnostic::warning(
                DiagnosticCode::W007,
                format!(
                    "connection '{}': one side is typed (comp/port) but the other is bare",
                    conn.label
                ),
            ));
        }
    }

    // W008 -- both sides typed but protocol values differ
    for conn in &model.connections {
        if let (Some(from_pid), Some(to_pid)) = (conn.from.port, conn.to.port) {
            let from_proto = model
                .port(from_pid)
                .map(|p| p.protocol.as_str())
                .unwrap_or_default();
            let to_proto = model
                .port(to_pid)
                .map(|p| p.protocol.as_str())
                .unwrap_or_default();
            if !from_proto.is_empty() && !to_proto.is_empty() && from_proto != to_proto {
                warnings.push(Diagnostic::warning(
                    DiagnosticCode::W008,
                    format!(
                        "connection '{}': protocol mismatch ('{}' vs '{}')",
                        conn.label, from_proto, to_proto
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
        // Connectivity warnings apply to placed instances only; a definition's
        // port is part of an abstraction's contract and cannot be connected.
        let owner = model
            .components
            .get(port.owner.0)
            .map_or(ComponentKind::Definition, |comp| comp.kind);
        if owner != ComponentKind::Instance {
            continue;
        }
        if !used_ports.contains(&idx) {
            // Unconnected ports emit W010 unless marked as an optional external port (external = true, required = false)
            if !port.external || port.required {
                warnings.push(Diagnostic::warning(
                    DiagnosticCode::W010,
                    format!("port '{}' is not referenced by any connection", port.label),
                ));
            }
        }
    }

    // W011 -- protocol has no messages defined
    for proto in &model.protocols {
        if proto.messages.is_empty() {
            warnings.push(Diagnostic::warning(
                DiagnosticCode::W011,
                format!("protocol '{}' has no messages defined", proto.label),
            ));
        }
    }

    warnings
}

// ── View validation ───────────────────────────────────────────────────────────

/// Validate one view/diagram file against the resolved [`Model`].
///
/// `filename` is the file the views were parsed from (e.g.
/// `diagrams/overview.hcl`). It is used both as the diagnostic's structured
/// `file` and embedded in the message, because downstream consumers (the
/// book/lock) drop the `file` field.
///
/// Checks:
/// - **E016** — the file must contain exactly one `view` block.
/// - **E016** — the view label must match the filename stem
///   (`diagrams/overview.hcl` -> `view "overview"`).
/// - **E006** — the view's `system` must name a defined system.
/// - **W016** — every `node` path must resolve to a known component (the
///   structurally-stable keys the diagram editor persists).
#[must_use]
pub fn validate_view(model: &Model, views: &[ViewDefinition], filename: &str) -> Vec<Diagnostic> {
    let mut diagnostics = Vec::new();
    let file = PathBuf::from(filename);

    if views.len() != 1 {
        diagnostics.push(view_diagnostic(
            DiagnosticCode::E016,
            &file,
            format!(
                "{filename}: must contain exactly one `view` block, found {}",
                views.len()
            ),
        ));
        return diagnostics;
    }

    let Some(view) = views.first() else {
        return diagnostics;
    };

    let stem = Path::new(filename)
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_default();
    if view.label != stem {
        diagnostics.push(view_diagnostic(
            DiagnosticCode::E016,
            &file,
            format!(
                "{filename}: view label '{}' does not match filename stem '{stem}'",
                view.label
            ),
        ));
    }

    let system_known = if view.system.is_empty() {
        diagnostics.push(view_diagnostic(
            DiagnosticCode::E006,
            &file,
            format!(
                "{filename}: view '{}' does not specify a system",
                view.label
            ),
        ));
        false
    } else if !model
        .systems
        .iter()
        .any(|system| system.label == view.system)
    {
        diagnostics.push(view_diagnostic(
            DiagnosticCode::E006,
            &file,
            format!(
                "{filename}: view '{}' references undefined system '{}'",
                view.label, view.system
            ),
        ));
        false
    } else {
        true
    };

    if system_known {
        validate_view_nodes(model, view, &file, filename, &mut diagnostics);
    }

    diagnostics
}

/// Emit **W016** for `node` blocks whose component path does not resolve to a
/// real component.
fn validate_view_nodes(
    model: &Model,
    view: &ViewDefinition,
    file: &Path,
    filename: &str,
    diagnostics: &mut Vec<Diagnostic>,
) {
    let keys = model.component_keys();
    let mut reported: HashSet<&str> = HashSet::new();
    for node in &view.nodes {
        if keys.contains(&node.component) {
            continue;
        }
        if !reported.insert(node.component.as_str()) {
            continue;
        }
        diagnostics.push(view_diagnostic(
            DiagnosticCode::W016,
            file,
            format!(
                "{filename}: view '{}' node '{}' does not reference a known component",
                view.label, node.component
            ),
        ));
    }
}

/// Build a view validation diagnostic carrying the offending `file`.
fn view_diagnostic(code: DiagnosticCode, file: &Path, message: String) -> Diagnostic {
    Diagnostic {
        code,
        file: Some(file.to_path_buf()),
        line: None,
        message,
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::DiagnosticCode;
    use crate::parse::parse_dir;
    use crate::resolve::resolve;
    use std::path::PathBuf;

    fn example_dir(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../examples")
            .join(name)
    }

    fn warning_codes(warnings: &[Diagnostic]) -> Vec<String> {
        warnings.iter().map(|d| d.code.to_string()).collect()
    }

    // ── drone ──────────────────────────────────────────────────────────────

    #[test]
    fn validate_drone_warnings() {
        let raw = parse_dir(&example_dir("drone")).expect("drone should parse");
        let (model, _) = resolve(raw).expect("drone should resolve without errors");
        let warnings = validate(&model);

        // No errors from resolution
        assert!(
            warnings
                .iter()
                .all(super::super::diagnostics::Diagnostic::is_warning),
            "expected only warnings, got: {:?}",
            warning_codes(&warnings)
        );

        // Expected: W001 for ground-station-pc (non-leaf, no children)
        assert!(
            warnings
                .iter()
                .any(|d| d.code == DiagnosticCode::W001 && d.message.contains("ground-station-pc")),
            "expected W001 for ground-station-pc, got: {:?}",
            warning_codes(&warnings)
        );

        // Expected: W004 for ground-station-pc (missing description)
        assert!(
            warnings
                .iter()
                .any(|d| d.code == DiagnosticCode::W004 && d.message.contains("ground-station-pc")),
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
                .any(|d| d.code == DiagnosticCode::W001
                    && d.message.contains("recommendation-engine")),
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
                .any(|d| d.code == DiagnosticCode::W001 && d.message.contains("operations")),
            "expected W001 for operations, got: {:?}",
            warning_codes(&warnings)
        );

        // W003 -- operations: not referenced by any connection
        assert!(
            warnings
                .iter()
                .any(|d| d.code == DiagnosticCode::W003 && d.message.contains("operations")),
            "expected W003 for operations, got: {:?}",
            warning_codes(&warnings)
        );

        // W004 -- operations: missing description
        assert!(
            warnings
                .iter()
                .any(|d| d.code == DiagnosticCode::W004 && d.message.contains("operations")),
            "expected W004 for operations, got: {:?}",
            warning_codes(&warnings)
        );
    }

    // ── W002 ───────────────────────────────────────────────────────────────

    #[test]
    fn w002_message_no_fields() {
        let src = r#"
            protocol "proto" {
              message "empty-msg" {
                description = "a message with no fields"
              }
            }

            component "a" {
              leaf = true
              port "p" {
                protocol = "proto"
                role     = "provider"
              }
            }
            component "b" { leaf = true }
            system "s" {
              instance "a" { source = "a" }
              instance "b" { source = "b" }
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
                .any(|d| d.code == DiagnosticCode::W002 && d.message.contains("empty-msg")),
            "expected W002 for empty-msg, got: {:?}",
            warning_codes(&warnings)
        );
    }

    // ── W005 ───────────────────────────────────────────────────────────────

    #[test]
    fn w005_from_equals_to() {
        let src = r#"
            component "a" { leaf = true }
            system "s" {
              instance "a" { source = "a" }
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
                .any(|d| d.code == DiagnosticCode::W005 && d.message.contains("self-loop")),
            "expected W005 for self-loop, got: {:?}",
            warning_codes(&warnings)
        );
    }

    // ── W006 ───────────────────────────────────────────────────────────────

    #[test]
    fn w006_level_decreases() {
        // Systems are implicitly level 0; exercise the decrease through a
        // component parent instead (child level 1 < parent level 2).
        let src = r#"
            component "child" {
              level = 1
              leaf  = true
            }
            component "parent" {
              level = 2
              instance "c" { source = "child" }
            }
            system "s" {
              instance "p" { source = "parent" }
            }
        "#;
        let raw = crate::parse::parse_file(src, std::path::Path::new("test.hcl")).unwrap();
        let (model, _) = resolve(raw).unwrap();
        let warnings = validate(&model);
        assert!(
            warnings
                .iter()
                .any(|d| d.code == DiagnosticCode::W006 && d.message.contains('c')),
            "expected W006 for component 'c', got: {:?}",
            warning_codes(&warnings)
        );
    }

    // ── W007 ───────────────────────────────────────────────────────────────

    #[test]
    fn w007_mixed_typed_untyped() {
        let src = r#"
            component "a" {
              leaf = true
              port "p" { role = "provider" }
            }
            component "b" { leaf = true }
            system "s" {
              instance "a" { source = "a" }
              instance "b" { source = "b" }
              connection "mixed" {
                from = "a/p"
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
                .any(|d| d.code == DiagnosticCode::W007 && d.message.contains("mixed")),
            "expected W007 for mixed, got: {:?}",
            warning_codes(&warnings)
        );
    }

    // ── W008 ───────────────────────────────────────────────────────────────

    #[test]
    fn w008_protocol_mismatch() {
        let src = r#"
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
            system "s" {
              instance "a" { source = "a" }
              instance "b" { source = "b" }
              connection "mismatch" {
                from = "a/p1"
                to   = "b/p2"
              }
            }
        "#;
        let raw = crate::parse::parse_file(src, std::path::Path::new("test.hcl")).unwrap();
        let (model, _) = resolve(raw).unwrap();
        let warnings = validate(&model);
        assert!(
            warnings
                .iter()
                .any(|d| d.code == DiagnosticCode::W008 && d.message.contains("mismatch")),
            "expected W008 for mismatch, got: {:?}",
            warning_codes(&warnings)
        );
    }

    // ── W010: Port locality & required external ports ─────────────────────────

    #[test]
    fn w010_optional_external_port_no_warning() {
        let src = r#"
            component "sensor" {
              leaf = true
              port "debug-uart" {
                external = true
                required = false
              }
            }
            system "s" {
              instance "sensor" { source = "sensor" }
            }
        "#;
        let raw = crate::parse::parse_file(src, std::path::Path::new("test.hcl")).unwrap();
        let (model, _) = resolve(raw).unwrap();
        let warnings = validate(&model);
        assert!(
            !warnings.iter().any(|d| d.code == DiagnosticCode::W010),
            "optional external port should not emit W010, got: {:?}",
            warning_codes(&warnings)
        );
    }

    #[test]
    fn w010_required_external_port_emits_warning() {
        let src = r#"
            component "sensor" {
              leaf = true
              port "data-out" {
                external = true
                required = true
              }
            }
            system "s" {
              instance "sensor" { source = "sensor" }
            }
        "#;
        let raw = crate::parse::parse_file(src, std::path::Path::new("test.hcl")).unwrap();
        let (model, _) = resolve(raw).unwrap();
        let warnings = validate(&model);
        assert!(
            warnings.iter().any(|d| d.code == DiagnosticCode::W010),
            "unconnected required external port must emit W010, got: {:?}",
            warning_codes(&warnings)
        );
    }

    #[test]
    fn w010_internal_port_unconnected_emits_warning() {
        let src = r#"
            component "sensor" {
              leaf = true
              port "internal-bus" {
                external = false
              }
            }
            system "s" {
              instance "sensor" { source = "sensor" }
            }
        "#;
        let raw = crate::parse::parse_file(src, std::path::Path::new("test.hcl")).unwrap();
        let (model, _) = resolve(raw).unwrap();
        let warnings = validate(&model);
        assert!(
            warnings.iter().any(|d| d.code == DiagnosticCode::W010),
            "unconnected internal port must emit W010, got: {:?}",
            warning_codes(&warnings)
        );
    }

    // ── Definition vs instance scoping of W001/W003/W004/W010 ─────────────

    #[test]
    fn w003_not_emitted_for_definitions() {
        let src = r#"
            component "sensor" {
              description = "Reusable definition"
              leaf = true
              port "data" { protocol = "sig" }
            }
        "#;
        let raw = crate::parse::parse_file(src, std::path::Path::new("test.hcl")).unwrap();
        let (model, _) = resolve(raw).unwrap();
        let warnings = validate(&model);
        assert!(
            !warnings.iter().any(|d| d.code == DiagnosticCode::W003),
            "a definition must never emit W003, got: {:?}",
            warning_codes(&warnings)
        );
        assert_eq!(model.components.len(), 1);
        assert_eq!(
            model.components[0].kind,
            crate::model::ComponentKind::Definition
        );
    }

    #[test]
    fn w003_emitted_for_unconnected_instance_with_source_suffix() {
        let src = r#"
            component "sensor" {
              description = "Reusable definition"
              leaf = true
            }
            system "s" {
              instance "sensor" { source = "sensor" }
            }
        "#;
        let raw = crate::parse::parse_file(src, std::path::Path::new("test.hcl")).unwrap();
        let (model, _) = resolve(raw).unwrap();
        let warnings = validate(&model);
        let w003: Vec<&Diagnostic> = warnings
            .iter()
            .filter(|d| d.code == DiagnosticCode::W003)
            .collect();
        assert_eq!(
            w003.len(),
            1,
            "expected one W003, got: {:?}",
            warning_codes(&warnings)
        );
        assert!(
            w003[0]
                .message
                .contains("component 'sensor' (source 'sensor') is not referenced"),
            "W003 should name the local label with source context: {}",
            w003[0].message
        );
    }

    #[test]
    fn w010_not_emitted_for_definition_ports() {
        let src = r#"
            component "sensor" {
              description = "Reusable definition"
              leaf = true
              port "data" { protocol = "sig" }
            }
        "#;
        let raw = crate::parse::parse_file(src, std::path::Path::new("test.hcl")).unwrap();
        let (model, _) = resolve(raw).unwrap();
        let warnings = validate(&model);
        assert!(
            !warnings.iter().any(|d| d.code == DiagnosticCode::W010),
            "a definition port must never emit W010, got: {:?}",
            warning_codes(&warnings)
        );
    }

    #[test]
    fn w001_and_w004_emitted_once_for_definition_not_per_instance() {
        let src = r#"
            component "motor" {
              description = ""
              leaf = false
            }
            system "s" {
              instance "m1" { source = "motor" }
              instance "m2" { source = "motor" }
            }
        "#;
        let raw = crate::parse::parse_file(src, std::path::Path::new("test.hcl")).unwrap();
        let (model, _) = resolve(raw).unwrap();
        let warnings = validate(&model);
        // Structural and description warnings come from the definition only,
        // once each, even though two instances clone the (empty) body.
        let w001: Vec<&Diagnostic> = warnings
            .iter()
            .filter(|d| d.code == DiagnosticCode::W001)
            .collect();
        let w004: Vec<&Diagnostic> = warnings
            .iter()
            .filter(|d| d.code == DiagnosticCode::W004 && d.message.contains("component"))
            .collect();
        assert_eq!(
            w001.len(),
            1,
            "expected exactly one W001, got: {:?}",
            warning_codes(&warnings)
        );
        assert_eq!(
            w004.len(),
            1,
            "expected exactly one component-W004, got: {:?}",
            warning_codes(&warnings)
        );
        assert!(w001[0].message.contains("motor"));
        assert!(w004[0].message.contains("motor"));
        // The two unconnected instances still each emit W003.
        let w003_count = warnings
            .iter()
            .filter(|d| d.code == DiagnosticCode::W003)
            .count();
        assert_eq!(
            w003_count,
            2,
            "expected two W003, got: {:?}",
            warning_codes(&warnings)
        );
    }

    // ── validate_view ────────────────────────────────────────────────────

    fn model_with_system(label: &str) -> Model {
        let src = format!(r#"system "{label}" {{ description = "d" }}"#);
        let raw = crate::parse::parse_file(&src, Path::new("system.hcl")).expect("parse");
        resolve(raw).expect("resolve").0
    }

    fn view(label: &str, system: &str) -> ViewDefinition {
        ViewDefinition {
            label: label.to_owned(),
            system: system.to_owned(),
            ..ViewDefinition::default()
        }
    }

    #[test]
    fn validate_view_zero_views_emits_e016() {
        let model = model_with_system("s");
        let diags = validate_view(&model, &[], "diagrams/overview.hcl");
        assert_eq!(diags.len(), 1, "expected one diagnostic, got {diags:?}");
        assert_eq!(diags[0].code, DiagnosticCode::E016);
        assert!(
            diags[0].message.contains("diagrams/overview.hcl"),
            "message must name the file: {}",
            diags[0].message
        );
    }

    #[test]
    fn validate_view_multiple_views_emits_e016() {
        let model = model_with_system("s");
        let views = vec![view("a", "s"), view("b", "s")];
        let diags = validate_view(&model, &views, "diagrams/combined.hcl");
        assert_eq!(diags.len(), 1, "expected one diagnostic, got {diags:?}");
        assert_eq!(diags[0].code, DiagnosticCode::E016);
        assert!(diags[0].message.contains("diagrams/combined.hcl"));
    }

    #[test]
    fn validate_view_label_mismatch_emits_e016() {
        let model = model_with_system("s");
        let views = vec![view("other", "s")];
        let diags = validate_view(&model, &views, "diagrams/overview.hcl");
        assert_eq!(diags.len(), 1, "expected one diagnostic, got {diags:?}");
        assert_eq!(diags[0].code, DiagnosticCode::E016);
        assert!(diags[0].message.contains("overview"));
    }

    #[test]
    fn validate_view_unknown_system_emits_e006() {
        let model = model_with_system("s");
        let views = vec![view("overview", "nope")];
        let diags = validate_view(&model, &views, "diagrams/overview.hcl");
        assert_eq!(diags.len(), 1, "expected one diagnostic, got {diags:?}");
        assert_eq!(diags[0].code, DiagnosticCode::E006);
        assert!(diags[0].message.contains("nope"));
    }

    #[test]
    fn validate_view_missing_system_emits_e006() {
        let model = model_with_system("s");
        let views = vec![view("overview", "")];
        let diags = validate_view(&model, &views, "diagrams/overview.hcl");
        assert_eq!(diags.len(), 1, "expected one diagnostic, got {diags:?}");
        assert_eq!(diags[0].code, DiagnosticCode::E006);
    }

    #[test]
    fn validate_view_valid_file_emits_nothing() {
        let model = model_with_system("s");
        let views = vec![view("overview", "s")];
        let diags = validate_view(&model, &views, "diagrams/overview.hcl");
        assert!(diags.is_empty(), "expected no diagnostics, got {diags:?}");
    }

    #[test]
    fn validate_view_diagnostic_carries_file() {
        let model = model_with_system("s");
        let diags = validate_view(&model, &[], "diagrams/overview.hcl");
        assert_eq!(
            diags[0].file.as_deref(),
            Some(Path::new("diagrams/overview.hcl"))
        );
    }

    // ── validate_view: node paths (W016) ─────────────────────────────────

    fn model_with_components() -> Model {
        let src = r#"
component "cpu" { leaf = true }
component "computer" {
  instance "cpu" { source = "cpu" }
}
system "computer-setup" {
  instance "computer" { source = "computer" }
}
system "other" {
  instance "monitor" { source = "cpu" }
}
"#;
        let raw = crate::parse::parse_file(src, Path::new("system.hcl")).expect("parse");
        resolve(raw).expect("resolve").0
    }

    #[test]
    fn model_component_keys_match_diagram_paths() {
        let model = model_with_components();
        let mut keys = model.component_keys();
        keys.sort();
        assert_eq!(
            keys,
            vec![
                "computer",
                "computer-setup/computer",
                "computer-setup/computer/cpu",
                "computer/cpu",
                "cpu",
                "other/monitor",
            ]
        );
    }

    fn view_with_nodes(label: &str, system: &str, nodes: &[&str]) -> ViewDefinition {
        ViewDefinition {
            label: label.to_owned(),
            system: system.to_owned(),
            nodes: nodes
                .iter()
                .map(|component| crate::model::NodeLayout {
                    component: (*component).to_owned(),
                    x: 0.0,
                    y: 0.0,
                    width: None,
                    height: None,
                    text_align: None,
                })
                .collect(),
            ..ViewDefinition::default()
        }
    }

    fn w016_paths(diagnostics: &[Diagnostic]) -> Vec<&str> {
        diagnostics
            .iter()
            .filter(|d| d.code == DiagnosticCode::W016)
            .map(|d| d.message.as_str())
            .collect()
    }

    #[test]
    fn validate_view_known_node_emits_nothing() {
        let model = model_with_components();
        let view = view_with_nodes(
            "overview",
            "computer-setup",
            &[
                "computer-setup/computer",
                "computer-setup/computer/cpu",
                "computer/cpu",
                "cpu",
            ],
        );
        let diags = validate_view(&model, &[view], "diagrams/overview.hcl");
        assert!(diags.is_empty(), "expected no diagnostics, got {diags:?}");
    }

    #[test]
    fn validate_view_unknown_node_emits_w016() {
        let model = model_with_components();
        let view = view_with_nodes(
            "overview",
            "computer-setup",
            &["computer-setup/not-a-computer"],
        );
        let diags = validate_view(&model, &[view], "diagrams/overview.hcl");
        assert_eq!(diags.len(), 1, "expected one diagnostic, got {diags:?}");
        assert_eq!(diags[0].code, DiagnosticCode::W016);
        assert!(
            diags[0].message.contains("computer-setup/not-a-computer"),
            "message must name the bad path: {}",
            diags[0].message
        );
    }

    #[test]
    fn validate_view_node_in_other_system_resolves() {
        // Live example: drone's `main` view targets `ground-control` but also
        // places nodes from `quadcopter`. A node is valid if it names any real
        // component key, not only one inside the view's own system.
        let model = model_with_components();
        let view = view_with_nodes("overview", "computer-setup", &["other/monitor"]);
        let diags = validate_view(&model, &[view], "diagrams/overview.hcl");
        assert!(diags.is_empty(), "expected no diagnostics, got {diags:?}");
    }

    #[test]
    fn validate_view_repeated_unknown_node_emits_one_w016() {
        let model = model_with_components();
        let view = view_with_nodes(
            "overview",
            "computer-setup",
            &["computer-setup/ghost", "computer-setup/ghost"],
        );
        let diags = validate_view(&model, &[view], "diagrams/overview.hcl");
        assert_eq!(
            w016_paths(&diags).len(),
            1,
            "expected one W016, got {diags:?}"
        );
    }

    #[test]
    fn validate_view_nodes_skipped_when_system_unknown() {
        let model = model_with_components();
        let view = view_with_nodes("overview", "nope", &["computer-setup/ghost"]);
        let diags = validate_view(&model, &[view], "diagrams/overview.hcl");
        assert!(
            diags.iter().any(|d| d.code == DiagnosticCode::E006),
            "expected E006, got {diags:?}"
        );
        assert!(
            w016_paths(&diags).is_empty(),
            "node checks must be skipped when the system is unknown, got {diags:?}"
        );
    }
}
