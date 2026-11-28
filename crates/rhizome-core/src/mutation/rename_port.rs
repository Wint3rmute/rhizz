//! `rename_port`: rename a port on a component definition and rewrite every
//! connection endpoint and view that names it, as one atomic op.
//!
//! Ports are declared on top-level definitions, so one rename reaches every
//! instance. Endpoints spell the same port differently from different scopes
//! (`inst/port`, `outer/inst/port`, `/sys/inst/port`, `./port`, ...), and two
//! definitions can declare ports with the same label. So the endpoints to
//! rewrite are found by resolving the model *before* the rename and keeping
//! those that land on the renamed `(definition, port)`, never by matching
//! text alone.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};

use super::{
    ApplyOutcome, LoggedAction, MutationError, PortJson, Scope, endpoint_port_target,
    find_definition, find_system, idle, scope_connections_mut, update_target,
};
use crate::model::{Component, ComponentKind, ComponentParent, Model};
use crate::parse::RawFile;
use crate::{parse_views, resolve, serialize_views};

/// A port label that changed on one placed component, keyed the way views
/// key nodes (`Model::component_keys`). Frontends use it to re-key the
/// per-view `port` blocks (outline side, shown flag) of that node.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PortRename {
    /// Component key of the placed instance (e.g. `"homelab/router"`).
    pub component: String,
    /// The port's label before the rename.
    pub from: String,
    /// The port's label after the rename.
    pub to: String,
}

/// Which end of a connection an endpoint is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum End {
    From,
    To,
}

/// Rename port `label` on the definition `component` names (a definition
/// label, or an instance path that redirects to its definition).
///
/// Unknown component or port, or an unchanged label, is an idle refusal. An
/// empty label, a label containing `/`, or one the definition already uses is
/// refused with an error.
pub(super) fn rename_port(
    raw: &mut RawFile,
    component: &str,
    label: &str,
    new_label: &str,
) -> Result<ApplyOutcome, MutationError> {
    if new_label.trim().is_empty() {
        return Err(MutationError::InvalidInput(
            "port name must not be empty".to_owned(),
        ));
    }
    if new_label.contains('/') {
        return Err(MutationError::InvalidInput(format!(
            "port name `{new_label}` must not contain `/`"
        )));
    }
    let Some((definition, _)) = update_target(raw, component) else {
        return Ok(idle());
    };
    let Some(index) = find_definition(raw, &definition) else {
        return Ok(idle());
    };
    let Some(body) = raw.components.get(index) else {
        return Ok(idle());
    };
    if label == new_label || !body.inner.ports.iter().any(|p| p.label == label) {
        return Ok(idle());
    }
    if body.inner.ports.iter().any(|p| p.label == new_label) {
        return Err(MutationError::InvalidInput(format!(
            "component `{definition}` already has a port named `{new_label}`"
        )));
    }

    let (model, _) = resolve::resolve(raw.clone()).map_err(|_| {
        MutationError::InvalidInput(format!(
            "cannot rename port `{label}` on component `{definition}` in an invalid model"
        ))
    })?;
    let endpoints = endpoints_on(&model, &definition, label);
    let port_renames = placed_instances(&model, &definition)
        .into_iter()
        .map(|key| PortRename {
            component: key,
            from: label.to_owned(),
            to: new_label.to_owned(),
        })
        .collect();

    if let Some(port) = raw
        .components
        .get_mut(index)
        .and_then(|body| body.inner.ports.iter_mut().find(|p| p.label == label))
    {
        new_label.clone_into(&mut port.label);
    }
    for (decl, connection, end) in endpoints {
        let Some(scope) = scope_of_decl(raw, &decl) else {
            continue;
        };
        let connections = scope_connections_mut(raw, scope)?;
        let Some(connection) = connections.iter_mut().find(|c| c.label == connection) else {
            continue;
        };
        let endpoint = match end {
            End::From => &mut connection.inner.from,
            End::To => &mut connection.inner.to,
        };
        if let Some(text) = endpoint.as_mut()
            && let Some(rewritten) = rewrite_port_segment(text, label, new_label)
        {
            *text = rewritten;
        }
    }

    Ok(ApplyOutcome {
        applied: true,
        path: None,
        actions: vec![LoggedAction::RenamePort {
            component: definition,
            label: label.to_owned(),
            new_label: new_label.to_owned(),
        }],
        port_renames,
        connection_renames: Vec::new(),
    })
}

/// Refuse a full-list `ports` replacement on `definition` that drops a port a
/// connection still ends on, naming the connection. Without this the resolver
/// refuses the same patch with a bare "component has no port" error that does
/// not say the fix (rename the port, or delete the connection first).
pub(super) fn refuse_dropping_connected_ports(
    raw: &RawFile,
    definition: &str,
    ports: &[PortJson],
) -> Result<(), MutationError> {
    let Some(body) = find_definition(raw, definition).and_then(|i| raw.components.get(i)) else {
        return Ok(());
    };
    let dropped: Vec<&str> = body
        .inner
        .ports
        .iter()
        .map(|p| p.label.as_str())
        .filter(|label| !ports.iter().any(|p| p.label == *label))
        .collect();
    if dropped.is_empty() {
        return Ok(());
    }
    // An invalid baseline is the resolver's to report.
    let Ok((model, _)) = resolve::resolve(raw.clone()) else {
        return Ok(());
    };
    for label in dropped {
        if let Some((_, connection, _)) = endpoints_on(&model, definition, label).into_iter().next()
        {
            return Err(MutationError::InvalidInput(format!(
                "cannot remove port `{label}` from component `{definition}`: connection `{connection}` still ends on it (rename the port instead, or delete the connection first)"
            )));
        }
    }
    Ok(())
}

/// Every connection end, as `(decl, connection label, end)`, that lands on
/// port `port` of `definition` (through any instance of it, or a `./port`
/// self endpoint inside it). Copies of one declaration collapse to one entry,
/// since they are one raw block.
fn endpoints_on(model: &Model, definition: &str, port: &str) -> BTreeSet<(String, String, End)> {
    let wanted = (definition.to_owned(), port.to_owned());
    let mut found = BTreeSet::new();
    for connection in &model.connections {
        for (end, endpoint) in [(End::From, &connection.from), (End::To, &connection.to)] {
            if endpoint_port_target(model, endpoint).is_some_and(|target| target == wanted) {
                found.insert((connection.decl.clone(), connection.label.clone(), end));
            }
        }
    }
    found
}

/// Component keys of every placed instance of `definition`.
fn placed_instances(model: &Model, definition: &str) -> Vec<String> {
    let keys = model.component_keys();
    model
        .components
        .iter()
        .zip(keys)
        .filter(|(component, _)| {
            component.kind == ComponentKind::Instance
                && component.source.as_deref() == Some(definition)
                && in_a_system(model, component)
        })
        .map(|(_, key)| key)
        .collect()
}

/// Whether `component` sits under a system. Instances inside a definition
/// body (not yet placed anywhere) have keys no view can name.
fn in_a_system(model: &Model, component: &Component) -> bool {
    let mut current = component;
    loop {
        match current.parent {
            Some(ComponentParent::System(_)) => return true,
            Some(ComponentParent::Component(parent)) => match model.component(parent) {
                Some(parent) => current = parent,
                None => return false,
            },
            None => return false,
        }
    }
}

/// The raw scope a resolved connection's `decl` (`"system:<label>"` or
/// `"component:<label>"`) was declared in.
fn scope_of_decl(raw: &RawFile, decl: &str) -> Option<Scope> {
    if let Some(label) = decl.strip_prefix("system:") {
        return find_system(raw, label).map(Scope::System);
    }
    let label = decl.strip_prefix("component:")?;
    find_definition(raw, label).map(Scope::Definition)
}

/// `endpoint` with its last segment (the port) replaced, when that segment is
/// `old`. Everything before it keeps its spelling.
fn rewrite_port_segment(endpoint: &str, old: &str, new: &str) -> Option<String> {
    let trimmed = endpoint.trim();
    let (head, port) = trimmed.rsplit_once('/')?;
    (port == old).then(|| format!("{head}/{new}"))
}

/// Re-key the `port` blocks of the nodes `renames` names in one view file.
///
/// Returns the rewritten canonical HCL, or `None` when nothing in the file
/// changed (so callers write nothing).
///
/// # Errors
///
/// Returns the parse error when `hcl` is not a valid views file.
pub fn rename_ports_in_views(hcl: &str, renames: &[PortRename]) -> anyhow::Result<Option<String>> {
    if renames.is_empty() {
        return Ok(None);
    }
    let mut views = parse_views(hcl)?;
    let mut changed = false;
    for view in &mut views {
        for node in &mut view.nodes {
            let key = node.component.trim_start_matches('/');
            for rename in renames.iter().filter(|r| r.component == key) {
                // A port block already under the new label would collide;
                // leave both alone rather than guess which one wins.
                if node.ports.iter().any(|p| p.port == rename.to) {
                    continue;
                }
                for port in node.ports.iter_mut().filter(|p| p.port == rename.from) {
                    rename.to.clone_into(&mut port.port);
                    changed = true;
                }
            }
        }
    }
    Ok(changed.then(|| serialize_views(&views)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diagnostics::DiagnosticCode;
    use crate::mutation::{ModelOp, MutationResult, mutate_to_hcl};
    use crate::{Diagnostic, compile};

    const HOMELAB: &str = r#"
component "router" {
  leaf = true

  port "link-thinkcentre" {
  }

  port "wifi" {
  }
}

component "thinkcentre" {
  leaf = true

  port "eth" {
    protocol = "data"
    role     = "peer"
  }
}

system "homelab" {
  instance "router" { source = "router" }

  instance "thinkcentre" { source = "thinkcentre" }

  connection "ethernet" {
    from = "/homelab/thinkcentre/eth"
    to   = "/homelab/router/link-thinkcentre"
  }
}
"#;

    const WEATHER: &str = include_str!("../../../../examples/weather-service/system.hcl");

    fn rename(content: &str, component: &str, label: &str, new_label: &str) -> MutationResult {
        try_rename(content, component, label, new_label).expect("rename must not be refused")
    }

    fn try_rename(
        content: &str,
        component: &str,
        label: &str,
        new_label: &str,
    ) -> Result<MutationResult, Vec<Diagnostic>> {
        let op: ModelOp = serde_json::from_value(serde_json::json!({
            "kind": "rename_port",
            "component": component,
            "label": label,
            "newLabel": new_label,
        }))
        .expect("op JSON must parse");
        mutate_to_hcl("system.hcl", content, &op)
    }

    fn applied_hcl(result: MutationResult) -> String {
        assert!(result.applied, "rename should apply");
        result.hcl.expect("applied ops carry HCL")
    }

    /// Error and warning codes a compile of `hcl` reports.
    fn diagnostic_codes(hcl: &str) -> Vec<DiagnosticCode> {
        let source = crate::Source {
            filename: "system.hcl".to_owned(),
            content: hcl.to_owned(),
        };
        let compiled = compile(&[source]);
        compiled.diagnostics.iter().map(|d| d.code).collect()
    }

    #[test]
    fn renames_a_connected_port_and_its_endpoint() {
        let hcl = applied_hcl(rename(HOMELAB, "router", "link-thinkcentre", "eth"));
        assert!(hcl.contains(r#"port "eth""#), "{hcl}");
        assert!(!hcl.contains("link-thinkcentre"), "{hcl}");
        assert!(hcl.contains(r#""/homelab/router/eth""#), "{hcl}");
        assert!(hcl.contains(r#""/homelab/thinkcentre/eth""#), "{hcl}");
    }

    #[test]
    fn rename_adds_no_diagnostics() {
        let before = diagnostic_codes(WEATHER);
        let hcl = applied_hcl(rename(WEATHER, "reverse-proxy", "http", "https"));
        assert_eq!(diagnostic_codes(&hcl), before);
    }

    #[test]
    fn instance_path_redirects_to_the_definition() {
        let result = rename(HOMELAB, "homelab/router", "link-thinkcentre", "eth");
        assert_eq!(
            result.actions,
            vec![LoggedAction::RenamePort {
                component: "router".to_owned(),
                label: "link-thinkcentre".to_owned(),
                new_label: "eth".to_owned(),
            }]
        );
        assert!(applied_hcl(result).contains(r#""/homelab/router/eth""#));
    }

    #[test]
    fn rewrites_delegation_and_parent_endpoints_but_not_a_same_named_port() {
        // `reverse-proxy/http` is wired by its own `./http` delegation and by
        // `proxy/http` inside `weather-service`. `listener` also has a port
        // `http`, reached as `listener/http`, which must stay.
        let hcl = applied_hcl(rename(WEATHER, "reverse-proxy", "http", "https"));
        assert!(hcl.contains(r#"from         = "./https""#), "{hcl}");
        assert!(hcl.contains(r#"to           = "proxy/https""#), "{hcl}");
        assert!(hcl.contains(r#"to           = "listener/http""#), "{hcl}");
    }

    #[test]
    fn renaming_the_inner_port_leaves_the_delegating_outer_alone() {
        let hcl = applied_hcl(rename(WEATHER, "listener", "http", "socket"));
        assert!(hcl.contains(r#"to           = "listener/socket""#), "{hcl}");
        assert!(hcl.contains(r#"from         = "./http""#), "{hcl}");
        assert!(hcl.contains(r#"to           = "proxy/http""#), "{hcl}");
    }

    #[test]
    fn rewrites_absolute_and_self_endpoints_of_a_system_child() {
        let hcl = applied_hcl(rename(WEATHER, "weather-service", "api", "rest"));
        assert!(hcl.contains(r#""/app/weather-service/rest""#), "{hcl}");
        assert!(hcl.contains(r#"from         = "./rest""#), "{hcl}");
        assert!(hcl.contains(r#""/app/user/out""#), "{hcl}");
    }

    #[test]
    fn rewrites_nested_paths_from_an_ancestor_system() {
        let content = r#"
component "leafy" {
  leaf = true

  port "p" {
    protocol = "data"
    role     = "peer"
  }
}

component "outer" {
  instance "inner" { source = "leafy" }
}

system "s" {
  instance "outer" { source = "outer" }

  instance "other" { source = "leafy" }

  connection "deep" {
    from = "outer/inner/p"
    to   = "other/p"
  }
}
"#;
        let result = rename(content, "leafy", "p", "q");
        let mut renamed: Vec<&str> = result
            .port_renames
            .iter()
            .map(|r| r.component.as_str())
            .collect();
        renamed.sort_unstable();
        assert_eq!(renamed, ["s/other", "s/outer/inner"]);
        let hcl = applied_hcl(result);
        assert!(hcl.contains(r#""/s/outer/inner/q""#), "{hcl}");
        assert!(hcl.contains(r#""/s/other/q""#), "{hcl}");
    }

    #[test]
    fn reports_every_placed_instance_for_view_rekeying() {
        let result = rename(HOMELAB, "router", "link-thinkcentre", "eth");
        assert_eq!(
            result.port_renames,
            vec![PortRename {
                component: "homelab/router".to_owned(),
                from: "link-thinkcentre".to_owned(),
                to: "eth".to_owned(),
            }]
        );
    }

    #[test]
    fn refuses_empty_slashed_and_taken_names() {
        for bad in ["", "  ", "a/b", "wifi"] {
            let refused = try_rename(HOMELAB, "router", "link-thinkcentre", bad)
                .expect_err("bad names are refused with a diagnostic");
            assert_eq!(
                refused.iter().map(|d| d.code).collect::<Vec<_>>(),
                [DiagnosticCode::E000],
                "{bad:?}"
            );
        }
    }

    #[test]
    fn unknown_targets_and_unchanged_names_are_idle() {
        for (component, label, new_label) in [
            ("nope", "wifi", "x"),
            ("router", "nope", "x"),
            ("router", "wifi", "wifi"),
            ("homelab/nope", "wifi", "x"),
        ] {
            let result =
                try_rename(HOMELAB, component, label, new_label).expect("idle, not an error");
            assert!(!result.applied, "{component} {label} {new_label}");
            assert!(result.hcl.is_none());
        }
    }

    #[test]
    fn logged_action_serializes_in_the_action_log_shape() {
        let action = LoggedAction::RenamePort {
            component: "router".to_owned(),
            label: "a".to_owned(),
            new_label: "b".to_owned(),
        };
        let json = serde_json::to_value(&action).expect("serialize");
        assert_eq!(
            json,
            serde_json::json!({"op": "rename_port", "component": "router", "label": "a", "newLabel": "b"})
        );
    }

    #[test]
    fn dropping_a_connected_port_from_the_list_names_the_connection() {
        let op: ModelOp = serde_json::from_value(serde_json::json!({
            "kind": "update_component",
            "path": "router",
            "patch": {"ports": [{"label": "wifi"}]},
        }))
        .expect("op JSON must parse");
        let refused = mutate_to_hcl("system.hcl", HOMELAB, &op).expect_err("refused");
        assert_eq!(refused.len(), 1);
        assert_eq!(refused[0].code, DiagnosticCode::E000);
        assert!(
            refused[0].message.contains("connection `ethernet`")
                && refused[0].message.contains("link-thinkcentre"),
            "{}",
            refused[0].message
        );

        // Dropping an unconnected port still applies.
        let op: ModelOp = serde_json::from_value(serde_json::json!({
            "kind": "update_component",
            "path": "router",
            "patch": {"ports": [{"label": "link-thinkcentre"}]},
        }))
        .expect("op JSON must parse");
        let result = mutate_to_hcl("system.hcl", HOMELAB, &op).expect("applies");
        assert!(result.applied);
    }

    const VIEW: &str = r#"
view "homelab" {
  system = "homelab"

  node "homelab/router" {
    x = 10
    y = 20

    port "link-thinkcentre" {
      side   = "left"
      offset = 0.25
    }

    port "wifi" {
      visible = true
    }
  }

  node "homelab/thinkcentre" {
    x = 100
    y = 20

    port "link-thinkcentre" {
      visible = true
    }
  }
}
"#;

    fn router_rename() -> Vec<PortRename> {
        vec![PortRename {
            component: "homelab/router".to_owned(),
            from: "link-thinkcentre".to_owned(),
            to: "eth".to_owned(),
        }]
    }

    #[test]
    fn views_rekey_only_the_renamed_nodes_ports() {
        let hcl = rename_ports_in_views(VIEW, &router_rename())
            .expect("valid view")
            .expect("the router node changed");
        let views = parse_views(&hcl).expect("rewritten view parses");
        let ports = |key: &str| -> Vec<(String, bool)> {
            views[0]
                .nodes
                .iter()
                .find(|n| n.component == key)
                .expect("node")
                .ports
                .iter()
                .map(|p| (p.port.clone(), p.side.is_some()))
                .collect()
        };
        assert_eq!(
            ports("homelab/router"),
            [("eth".to_owned(), true), ("wifi".to_owned(), false)]
        );
        // Another component's same-named port block is not this port.
        assert_eq!(
            ports("homelab/thinkcentre"),
            [("link-thinkcentre".to_owned(), false)]
        );
    }

    #[test]
    fn views_without_the_port_are_left_untouched() {
        let renames = vec![PortRename {
            component: "homelab/laptop".to_owned(),
            from: "wifi".to_owned(),
            to: "wlan".to_owned(),
        }];
        assert_eq!(rename_ports_in_views(VIEW, &renames).expect("valid"), None);
        assert_eq!(rename_ports_in_views(VIEW, &[]).expect("valid"), None);
    }

    #[test]
    fn views_rekeying_reports_invalid_hcl() {
        assert!(rename_ports_in_views("view {", &router_rename()).is_err());
    }
}
