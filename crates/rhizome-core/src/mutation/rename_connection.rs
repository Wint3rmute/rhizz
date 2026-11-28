//! `rename_connection`: rename a connection and rewrite every `realized_by`
//! entry and view that names it, as one atomic op.
//!
//! A connection declared in a definition is copied into every instance of
//! it, and `realized_by` entries spell one connection differently from
//! different scopes (`low`, `bank-x/low`, `/banking/bank-a/low`, ...). So the
//! entries to rewrite are found by resolving the model *before* the rename
//! and keeping those that land on a copy of the renamed declaration, never by
//! matching text alone.

use serde::{Deserialize, Serialize};

use super::{
    ApplyOutcome, LoggedAction, MutationError, Scope, find_definition, find_system, idle,
    resolve_scope_or_idle, scope_connections_mut,
};
use crate::parse::RawFile;
use crate::resolve::{self, RawOwner};
use crate::{parse_views, serialize_views};

/// A connection label that changed, with the systems holding a copy of it.
///
/// Views key their `connection` blocks by name within their system, so
/// frontends re-key the blocks of the views over those systems.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ConnectionRename {
    /// Labels of the systems a copy of the connection is placed in.
    pub systems: Vec<String>,
    /// The connection's label before the rename.
    pub from: String,
    /// The connection's label after the rename.
    pub to: String,
}

/// Rename the connection `label` declared in `scope_path` (a system, a
/// definition, or an instance path that redirects to its definition).
///
/// Unknown scope or connection, or an unchanged label, is an idle refusal. An
/// empty label, a label containing `/`, or a label any connection in the
/// model already uses is refused with an error.
pub(super) fn rename_connection(
    raw: &mut RawFile,
    scope_path: &str,
    label: &str,
    new_label: &str,
) -> Result<ApplyOutcome, MutationError> {
    if new_label.trim().is_empty() {
        return Err(MutationError::InvalidInput(
            "connection name must not be empty".to_owned(),
        ));
    }
    if new_label.contains('/') {
        return Err(MutationError::InvalidInput(format!(
            "connection name `{new_label}` must not contain `/`"
        )));
    }
    let Some(scope) = resolve_scope_or_idle(raw, scope_path) else {
        return Ok(idle());
    };
    let Some(decl) = decl_of(raw, scope) else {
        return Ok(idle());
    };
    if label == new_label
        || !scope_connections_mut(raw, scope)?
            .iter()
            .any(|c| c.label == label)
    {
        return Ok(idle());
    }
    // Views key connections by name, so a name is taken anywhere in the
    // model (the New-connection dialog applies the same rule).
    if all_connection_labels(raw).any(|taken| taken == new_label) {
        return Err(MutationError::InvalidInput(format!(
            "a connection named `{new_label}` already exists"
        )));
    }

    let refs = resolve::connection_references(raw.clone(), &decl, label);
    for reference in &refs.realized_by {
        let Some(owner) = owner_scope(raw, &reference.owner) else {
            continue;
        };
        let Some(connection) = scope_connections_mut(raw, owner)?
            .iter_mut()
            .find(|c| c.label == reference.label)
        else {
            continue;
        };
        for entry in &mut connection.inner.realized_by {
            if *entry == reference.entry {
                *entry = rewrite_last_segment(entry, new_label);
            }
        }
    }
    if let Some(connection) = scope_connections_mut(raw, scope)?
        .iter_mut()
        .find(|c| c.label == label)
    {
        new_label.clone_into(&mut connection.label);
    }

    let mut outcome = ApplyOutcome {
        applied: true,
        path: None,
        actions: vec![LoggedAction::RenameConnection {
            scope_path: scope_path.to_owned(),
            label: label.to_owned(),
            new_label: new_label.to_owned(),
        }],
        ..idle()
    };
    if !refs.systems.is_empty() {
        outcome.connection_renames.push(ConnectionRename {
            systems: refs.systems,
            from: label.to_owned(),
            to: new_label.to_owned(),
        });
    }
    Ok(outcome)
}

/// The resolved `decl` (`"system:<label>"` / `"component:<label>"`) of the
/// connections declared in `scope`.
fn decl_of(raw: &RawFile, scope: Scope) -> Option<String> {
    match scope {
        Scope::System(i) => raw.systems.get(i).map(|s| format!("system:{}", s.label)),
        Scope::Definition(i) => raw
            .components
            .get(i)
            .map(|c| format!("component:{}", c.label)),
    }
}

fn owner_scope(raw: &RawFile, owner: &RawOwner) -> Option<Scope> {
    match owner {
        RawOwner::System(label) => find_system(raw, label).map(Scope::System),
        RawOwner::Definition(label) => find_definition(raw, label).map(Scope::Definition),
    }
}

/// Every connection label declared anywhere in the raw tree.
fn all_connection_labels(raw: &RawFile) -> impl Iterator<Item = &str> {
    let in_systems = raw.systems.iter().flat_map(|s| &s.inner.connections);
    let in_definitions = raw.components.iter().flat_map(|c| &c.inner.connections);
    in_systems.chain(in_definitions).map(|c| c.label.as_str())
}

/// `entry` with its last segment (the connection label) replaced; the path
/// before it keeps its spelling.
fn rewrite_last_segment(entry: &str, new_label: &str) -> String {
    match entry.rsplit_once('/') {
        Some((head, _)) => format!("{head}/{new_label}"),
        None => new_label.to_owned(),
    }
}

/// Re-key the `connection` blocks `renames` names in one view file, in the
/// views over a system the renamed connection is placed in.
///
/// Returns the rewritten canonical HCL, or `None` when nothing in the file
/// changed (so callers write nothing).
///
/// # Errors
///
/// Returns the parse error when `hcl` is not a valid views file.
pub fn rename_connections_in_views(
    hcl: &str,
    renames: &[ConnectionRename],
) -> anyhow::Result<Option<String>> {
    if renames.is_empty() {
        return Ok(None);
    }
    let mut views = parse_views(hcl)?;
    let mut changed = false;
    for view in &mut views {
        for rename in renames.iter().filter(|r| r.systems.contains(&view.system)) {
            // A block already under the new name would collide; leave both
            // alone rather than guess which one wins.
            if view.connections.iter().any(|c| c.connection == rename.to) {
                continue;
            }
            for block in view
                .connections
                .iter_mut()
                .filter(|c| c.connection == rename.from)
            {
                rename.to.clone_into(&mut block.connection);
                changed = true;
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

    /// `bank` declares `low` and `mid` (realized by `low`). `region` holds a
    /// `bank` and realizes `trunk` by its `low`. System `banking` holds both
    /// and realizes `tls` by `bank-a`'s `low`. System `other` has its own,
    /// unrelated `low` that `spare` realizes.
    const BANKS: &str = r#"
component "stack" {
  leaf = true

  port "p" {}
}

component "bank" {
  port "p" {}

  instance "stack" { source = "stack" }

  connection "low" {
    from = "stack/p"
    to   = "stack/p"
  }

  connection "mid" {
    from        = "stack/p"
    to          = "stack/p"
    realized_by = ["low"]
  }
}

component "region" {
  instance "bank-x" { source = "bank" }

  connection "trunk" {
    from        = "bank-x/p"
    to          = "bank-x/p"
    realized_by = ["bank-x/low"]
  }
}

system "banking" {
  instance "bank-a" { source = "bank" }

  instance "north" { source = "region" }

  instance "ext" { source = "stack" }

  connection "tls" {
    from        = "bank-a/p"
    to          = "ext/p"
    realized_by = ["/banking/bank-a/low"]
  }
}

system "other" {
  instance "ext" { source = "stack" }

  connection "wire" {
    from = "ext/p"
    to   = "ext/p"
  }

  connection "spare" {
    from        = "ext/p"
    to          = "ext/p"
    realized_by = ["wire"]
  }
}
"#;

    fn try_rename(
        content: &str,
        scope_path: &str,
        label: &str,
        new_label: &str,
    ) -> Result<MutationResult, Vec<Diagnostic>> {
        let op: ModelOp = serde_json::from_value(serde_json::json!({
            "kind": "rename_connection",
            "scopePath": scope_path,
            "label": label,
            "newLabel": new_label,
        }))
        .expect("op JSON must parse");
        mutate_to_hcl("system.hcl", content, &op)
    }

    fn rename(content: &str, scope_path: &str, label: &str, new_label: &str) -> MutationResult {
        try_rename(content, scope_path, label, new_label).expect("rename must not be refused")
    }

    fn applied_hcl(result: MutationResult) -> String {
        assert!(result.applied, "rename should apply");
        result.hcl.expect("applied ops carry HCL")
    }

    fn diagnostic_codes(hcl: &str) -> Vec<DiagnosticCode> {
        let source = crate::Source {
            filename: "system.hcl".to_owned(),
            content: hcl.to_owned(),
        };
        compile(&[source])
            .diagnostics
            .iter()
            .map(|d| d.code)
            .collect()
    }

    #[test]
    fn renames_a_connection_in_a_system() {
        let hcl = applied_hcl(rename(BANKS, "other", "wire", "cable"));
        assert!(hcl.contains(r#"connection "cable""#), "{hcl}");
        assert!(!hcl.contains(r#"connection "wire""#), "{hcl}");
        // Same-scope reference follows.
        assert!(hcl.contains(r#"realized_by  = ["cable"]"#), "{hcl}");
    }

    #[test]
    fn instance_path_renames_the_definition_and_every_reference() {
        let result = rename(BANKS, "banking/bank-a", "low", "base");
        assert_eq!(
            result.actions,
            vec![LoggedAction::RenameConnection {
                scope_path: "banking/bank-a".to_owned(),
                label: "low".to_owned(),
                new_label: "base".to_owned(),
            }]
        );
        let hcl = applied_hcl(result);
        assert!(hcl.contains(r#"connection "base""#), "{hcl}");
        assert!(!hcl.contains(r#"connection "low""#), "{hcl}");
        // Same scope, an instance one level down, and an absolute path from
        // the system.
        assert!(hcl.contains(r#"realized_by  = ["base"]"#), "{hcl}");
        assert!(hcl.contains(r#"realized_by  = ["bank-x/base"]"#), "{hcl}");
        assert!(
            hcl.contains(r#"realized_by  = ["/banking/bank-a/base"]"#),
            "{hcl}"
        );
    }

    #[test]
    fn leaves_references_to_another_connection_alone() {
        let hcl = applied_hcl(rename(BANKS, "bank", "low", "base"));
        assert!(hcl.contains(r#"realized_by  = ["wire"]"#), "{hcl}");
    }

    #[test]
    fn rename_adds_no_diagnostics() {
        let before = diagnostic_codes(BANKS);
        for (scope, label) in [("bank", "low"), ("other", "wire"), ("banking", "tls")] {
            let hcl = applied_hcl(rename(BANKS, scope, label, "renamed"));
            assert_eq!(diagnostic_codes(&hcl), before, "{scope}/{label}");
        }
    }

    #[test]
    fn reports_the_systems_holding_a_copy_for_view_rekeying() {
        let result = rename(BANKS, "bank", "low", "base");
        assert_eq!(
            result.connection_renames,
            vec![ConnectionRename {
                systems: vec!["banking".to_owned()],
                from: "low".to_owned(),
                to: "base".to_owned(),
            }]
        );
        let result = rename(BANKS, "other", "wire", "cable");
        assert_eq!(result.connection_renames[0].systems, ["other"]);
    }

    #[test]
    fn renames_a_delegation_edge() {
        const WEATHER: &str = include_str!("../../../../examples/weather-service/system.hcl");
        let before = diagnostic_codes(WEATHER);
        let hcl = applied_hcl(rename(WEATHER, "reverse-proxy", "http-delegation", "front"));
        assert!(hcl.contains(r#"connection "front""#), "{hcl}");
        assert_eq!(diagnostic_codes(&hcl), before);
    }

    #[test]
    fn refuses_empty_slashed_and_taken_names() {
        // `spare` lives in another system: names are unique model-wide.
        for bad in ["", "  ", "a/b", "mid", "spare"] {
            let refused = try_rename(BANKS, "bank", "low", bad)
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
        for (scope, label, new_label) in [
            ("nope", "low", "x"),
            ("bank", "nope", "x"),
            ("bank", "low", "low"),
            ("banking/nope", "low", "x"),
        ] {
            let result = try_rename(BANKS, scope, label, new_label).expect("idle, not an error");
            assert!(!result.applied, "{scope} {label} {new_label}");
            assert!(result.hcl.is_none());
        }
    }

    #[test]
    fn op_and_logged_action_use_the_action_log_shape() {
        let action = LoggedAction::RenameConnection {
            scope_path: "bank".to_owned(),
            label: "a".to_owned(),
            new_label: "b".to_owned(),
        };
        let json = serde_json::to_value(&action).expect("serialize");
        let expected = serde_json::json!({
            "op": "rename_connection", "scopePath": "bank", "label": "a", "newLabel": "b"
        });
        assert_eq!(json, expected);
        let op: ModelOp = serde_json::from_value(serde_json::json!({
            "kind": "rename_connection", "scopePath": "bank", "label": "a", "newLabel": "b"
        }))
        .expect("op parses");
        assert!(matches!(op, ModelOp::RenameConnection { .. }));
    }

    const VIEWS: &str = r#"
view "banking" {
  system = "banking"

  connection "low" {
    hidden = true
  }

  connection "tls" {
    hidden = true
  }
}

view "other" {
  system = "other"

  connection "low" {
    hidden = true
  }
}
"#;

    fn low_rename() -> Vec<ConnectionRename> {
        vec![ConnectionRename {
            systems: vec!["banking".to_owned()],
            from: "low".to_owned(),
            to: "base".to_owned(),
        }]
    }

    #[test]
    fn views_rekey_only_views_over_a_system_holding_a_copy() {
        let hcl = rename_connections_in_views(VIEWS, &low_rename())
            .expect("valid views")
            .expect("the banking view changed");
        let views = parse_views(&hcl).expect("rewritten views parse");
        let keys = |label: &str| -> Vec<(String, bool)> {
            views
                .iter()
                .find(|v| v.label == label)
                .expect("view")
                .connections
                .iter()
                .map(|c| (c.connection.clone(), c.hidden))
                .collect()
        };
        assert_eq!(
            keys("banking"),
            [("base".to_owned(), true), ("tls".to_owned(), true)]
        );
        assert_eq!(keys("other"), [("low".to_owned(), true)]);
    }

    #[test]
    fn views_without_the_connection_are_left_untouched() {
        let renames = vec![ConnectionRename {
            systems: vec!["banking".to_owned()],
            from: "nope".to_owned(),
            to: "x".to_owned(),
        }];
        assert_eq!(
            rename_connections_in_views(VIEWS, &renames).expect("valid"),
            None
        );
        assert_eq!(
            rename_connections_in_views(VIEWS, &[]).expect("valid"),
            None
        );
    }

    #[test]
    fn views_rekeying_reports_invalid_hcl() {
        assert!(rename_connections_in_views("view {", &low_rename()).is_err());
    }
}
