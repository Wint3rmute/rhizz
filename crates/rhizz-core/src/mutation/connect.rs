//! The `connect_components` op: one gesture that creates a connection
//! together with the ports it ends on (and, optionally, a stub protocol).
//!
//! It exists so a frontend can offer "draw a line between two components" as a
//! single, atomic, undoable step. Composing the existing ops would leave the
//! model half-wired when the second one is refused, and would log three
//! actions for one gesture.
//!
//! Ports live on component *definitions*, so a port created for an instance
//! lands on the definition that instance was sourced from, and every instance
//! of that definition gets it.

use serde::{Deserialize, Serialize};

use super::{ApplyOutcome, LoggedAction, MutationError, ProtocolPatch, Scope};
use crate::parse::{Labeled, RawConnection, RawFile, RawPort};

/// A port to create, with the attributes the new `port` block starts with.
///
/// `None` leaves an attribute at its spec default (no protocol, no role,
/// `external = false`, `required = true`). An empty `protocol` or `role`
/// string also means "unset".
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct NewPort {
    /// Port label, unique within the owning component definition.
    pub label: String,
    /// Protocol label (or free-form protocol name).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub protocol: Option<String>,
    /// Role string; validated against the protocol's `roles` when it has any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    /// Whether the port is an external boundary interface.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub external: Option<bool>,
    /// Whether the port must be connected when its component is instantiated.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub required: Option<bool>,
}

/// The port one end of the connection lands on.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PortSpec {
    /// A port the component already has, by label.
    Existing(String),
    /// A port created together with the connection.
    New(NewPort),
}

/// One end of the connection.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ConnectEnd {
    /// Instance path relative to the connection's scope (`"mcu"`,
    /// `"fc/mcu"`). Empty addresses the scope's own component.
    pub component: String,
    /// The port on that component.
    pub port: PortSpec,
}

/// Apply `connect_components` to the raw tree.
///
/// # Errors
///
/// [`MutationError::InvalidInput`] for unusable input: a blank or taken
/// connection label, an unknown component, a missing or clashing port label,
/// or a protocol that cannot be created. Nothing is written in that case.
pub fn connect_components(
    raw: &mut RawFile,
    scope_path: &str,
    label: &str,
    from: &ConnectEnd,
    to: &ConnectEnd,
    create_protocol: Option<&str>,
) -> Result<ApplyOutcome, MutationError> {
    let Some(scope) = super::resolve_scope_or_idle(raw, scope_path) else {
        return Ok(super::idle());
    };
    check_connection_label(raw, scope, label)?;

    // Resolve both definitions before writing anything, so a bad endpoint is
    // reported as such rather than as a consequence of the first edit.
    let from_definition = end_definition(raw, scope, &from.component)?;
    let to_definition = end_definition(raw, scope, &to.component)?;

    if let Some(protocol) = create_protocol {
        super::add_protocol(raw, protocol, &ProtocolPatch::default())?;
    }
    attach_port(raw, from_definition, &from.port)?;
    attach_port(raw, to_definition, &to.port)?;

    super::scope_connections_mut(raw, scope)?.push(Labeled {
        label: label.to_owned(),
        inner: RawConnection {
            from: Some(endpoint(from)),
            to: Some(endpoint(to)),
            ..Default::default()
        },
    });

    Ok(ApplyOutcome {
        applied: true,
        path: None,
        actions: vec![LoggedAction::ConnectComponents {
            scope_path: scope_path.to_owned(),
            label: label.to_owned(),
            from: from.clone(),
            to: to.clone(),
            create_protocol: create_protocol.map(str::to_owned),
        }],
    })
}

const fn invalid(message: String) -> MutationError {
    MutationError::InvalidInput(message)
}

/// A connection label must be usable in paths and unique in its scope. Unlike
/// `add_connection`, which silently ignores a duplicate, a taken label is a
/// refusal here: the gesture would otherwise report success and change
/// nothing.
fn check_connection_label(
    raw: &mut RawFile,
    scope: Scope,
    label: &str,
) -> Result<(), MutationError> {
    check_label(label, "connection")?;
    if super::scope_connections_mut(raw, scope)?
        .iter()
        .any(|c| c.label == label)
    {
        return Err(invalid(format!("connection `{label}` already exists")));
    }
    Ok(())
}

/// A label that will be written into paths: non-empty and without `/`.
fn check_label(label: &str, what: &str) -> Result<(), MutationError> {
    if label.is_empty() {
        return Err(invalid(format!("{what} label must not be empty")));
    }
    if label.contains('/') {
        return Err(invalid(format!(
            "{what} label `{label}` must not contain `/`"
        )));
    }
    Ok(())
}

/// Index of the component definition that owns the ports of the component at
/// `component`, an instance path relative to `scope`. Walks through each
/// instance's `source`; an empty path is the scope's own definition.
fn end_definition(raw: &RawFile, scope: Scope, component: &str) -> Result<usize, MutationError> {
    let mut current = scope;
    for segment in component.split('/').filter(|s| !s.is_empty()) {
        let definition = super::scope_instances(raw, current)
            .iter()
            .find(|i| i.label == segment)
            .and_then(|i| i.inner.source.as_deref())
            .and_then(|source| super::find_definition(raw, source))
            .ok_or_else(|| invalid(format!("unknown component `{component}`")))?;
        current = Scope::Definition(definition);
    }
    match current {
        Scope::Definition(index) => Ok(index),
        Scope::System(_) => Err(invalid(
            "a system has no ports of its own; name a component".to_owned(),
        )),
    }
}

/// Make sure the port `spec` names exists on the definition, creating it for
/// [`PortSpec::New`].
fn attach_port(raw: &mut RawFile, definition: usize, spec: &PortSpec) -> Result<(), MutationError> {
    let Some(owner) = raw.components.get_mut(definition) else {
        return Err(invalid("stale definition scope".to_owned()));
    };
    let owner_label = owner.label.clone();
    let has_port = |label: &str, ports: &[Labeled<RawPort>]| ports.iter().any(|p| p.label == label);
    match spec {
        PortSpec::Existing(label) => {
            if has_port(label, &owner.inner.ports) {
                Ok(())
            } else {
                Err(invalid(format!(
                    "component `{owner_label}` has no port `{label}`"
                )))
            }
        }
        PortSpec::New(new) => {
            check_label(&new.label, "port")?;
            if has_port(&new.label, &owner.inner.ports) {
                return Err(invalid(format!(
                    "component `{owner_label}` already has a port `{}`",
                    new.label
                )));
            }
            owner.inner.ports.push(Labeled {
                label: new.label.clone(),
                inner: RawPort {
                    full_name: None,
                    protocol: new.protocol.as_deref().and_then(super::non_empty),
                    role: new.role.as_deref().and_then(super::non_empty),
                    external: new.external,
                    required: new.required,
                    tags: Vec::new(),
                },
            });
            Ok(())
        }
    }
}

/// The connection endpoint string for an end: `component/port`, or just the
/// port when the end is the scope's own component.
fn endpoint(end: &ConnectEnd) -> String {
    let port = match &end.port {
        PortSpec::Existing(label) => label,
        PortSpec::New(new) => &new.label,
    };
    let component = end.component.trim_matches('/');
    if component.is_empty() {
        port.clone()
    } else {
        format!("{component}/{port}")
    }
}

#[cfg(test)]
mod tests {
    use crate::diagnostics::{Diagnostic, DiagnosticCode};
    use crate::model::Model;
    use crate::mutation::{LoggedAction, ModelOp, MutationResult, mutate_to_hcl};
    use crate::{Source, compile};

    const BASELINE: &str = r#"
component "a" { leaf = true }
component "b" { leaf = true }
component "mcu" { leaf = true }
component "fc" {
  instance "mcu" { source = "mcu" }
}
system "demo" {
  instance "a"  { source = "a" }
  instance "b"  { source = "b" }
  instance "fc" { source = "fc" }
}
"#;

    fn connect(content: &str, json: &str) -> Result<MutationResult, Vec<Diagnostic>> {
        let op: ModelOp = serde_json::from_str(json).expect("op JSON must parse");
        mutate_to_hcl("system.hcl", content, &op)
    }

    fn compiled(hcl: &str) -> Model {
        let result = compile(&[Source {
            filename: "system.hcl".to_owned(),
            content: hcl.to_owned(),
        }]);
        assert!(
            !result.diagnostics.iter().any(Diagnostic::is_error),
            "result must compile: {:?}\n{hcl}",
            result.diagnostics
        );
        result.model.expect("model")
    }

    /// Codes of the blocking errors; refusals also carry the warnings the
    /// resolver produced on the way.
    fn codes(diagnostics: &[Diagnostic]) -> Vec<DiagnosticCode> {
        diagnostics
            .iter()
            .filter(|d| d.is_error())
            .map(|d| d.code)
            .collect()
    }

    /// Both ends create a port; default flags only.
    const A_TO_B: &str = r#"{"kind":"connect_components","scopePath":"demo","label":"a-to-b",
        "from":{"component":"a","port":{"new":{"label":"link-b"}}},
        "to":{"component":"b","port":{"new":{"label":"link-a"}}}}"#;

    /// The ports of connection `label`, as `(component, port)` label pairs.
    fn endpoint_ports(model: &Model, label: &str) -> [(String, String); 2] {
        let connection = model
            .connections
            .iter()
            .find(|c| c.label == label)
            .unwrap_or_else(|| panic!("connection `{label}` must exist"));
        [&connection.from, &connection.to].map(|end| {
            let component = model.component(end.component).expect("component");
            let port = end
                .port
                .and_then(|id| model.port(id))
                .expect("both ends must name a port");
            (component.label.clone(), port.label.clone())
        })
    }

    #[test]
    fn creates_both_ports_and_the_connection() {
        let result = connect(BASELINE, A_TO_B).expect("applies");
        assert!(result.applied);
        let model = compiled(&result.hcl.expect("hcl"));
        assert_eq!(
            endpoint_ports(&model, "a-to-b"),
            [
                ("a".to_owned(), "link-b".to_owned()),
                ("b".to_owned(), "link-a".to_owned())
            ]
        );
    }

    #[test]
    fn new_ports_start_untyped_with_spec_defaults() {
        let result = connect(BASELINE, A_TO_B).expect("applies");
        let hcl = result.hcl.expect("hcl");
        assert!(!hcl.contains("role"), "no role was chosen:\n{hcl}");
        assert!(!hcl.contains("protocol"), "no protocol was chosen:\n{hcl}");
        let model = compiled(&hcl);
        let port = model
            .ports
            .iter()
            .find(|p| p.label == "link-b")
            .expect("port");
        assert!(!port.external);
        assert!(port.required);
        assert_eq!(port.role, None);
        assert!(port.protocol.is_empty());
    }

    #[test]
    fn port_attributes_are_written() {
        let result = connect(
            BASELINE,
            r#"{"kind":"connect_components","scopePath":"demo","label":"a-to-b",
                "from":{"component":"a","port":{"new":{"label":"out","protocol":"free-form","role":"anything","external":true,"required":false}}},
                "to":{"component":"b","port":{"new":{"label":"in"}}}}"#,
        )
        .expect("applies");
        let model = compiled(&result.hcl.expect("hcl"));
        let port = model.ports.iter().find(|p| p.label == "out").expect("port");
        assert_eq!(port.protocol, "free-form");
        assert_eq!(port.role.as_deref(), Some("anything"));
        assert!(port.external);
        assert!(!port.required);
    }

    #[test]
    fn empty_protocol_and_role_strings_mean_unset() {
        let result = connect(
            BASELINE,
            r#"{"kind":"connect_components","scopePath":"demo","label":"a-to-b",
                "from":{"component":"a","port":{"new":{"label":"out","protocol":"","role":""}}},
                "to":{"component":"b","port":{"new":{"label":"in"}}}}"#,
        )
        .expect("applies");
        let hcl = result.hcl.expect("hcl");
        assert!(!hcl.contains("role"), "{hcl}");
        assert!(!hcl.contains("protocol"), "{hcl}");
    }

    #[test]
    fn create_protocol_adds_a_stub_the_ports_can_use() {
        let result = connect(
            BASELINE,
            r#"{"kind":"connect_components","scopePath":"demo","label":"a-to-b","createProtocol":"spi",
                "from":{"component":"a","port":{"new":{"label":"link-b","protocol":"spi"}}},
                "to":{"component":"b","port":{"new":{"label":"link-a","protocol":"spi"}}}}"#,
        )
        .expect("applies");
        let hcl = result.hcl.expect("hcl");
        assert!(hcl.contains(r#"protocol "spi""#), "{hcl}");
        let model = compiled(&hcl);
        let protocol = model
            .protocols
            .iter()
            .find(|p| p.label == "spi")
            .expect("protocol");
        assert!(!protocol.leaf, "a stub is not a leaf protocol");
        assert!(protocol.roles.is_empty());
        assert!(
            model
                .ports
                .iter()
                .filter(|p| p.label.starts_with("link-"))
                .all(|p| p.protocol_id.is_some()),
            "both ports resolve to the new protocol"
        );
    }

    #[test]
    fn creating_a_protocol_that_exists_is_refused() {
        let baseline = connect(BASELINE, r#"{"kind":"add_protocol","label":"spi"}"#)
            .expect("applies")
            .hcl
            .expect("hcl");
        let diagnostics = connect(
            &baseline,
            r#"{"kind":"connect_components","scopePath":"demo","label":"a-to-b","createProtocol":"spi",
                "from":{"component":"a","port":{"new":{"label":"x"}}},
                "to":{"component":"b","port":{"new":{"label":"y"}}}}"#,
        )
        .expect_err("refused");
        assert_eq!(codes(&diagnostics), [DiagnosticCode::E000]);
    }

    #[test]
    fn a_role_the_protocol_does_not_permit_refuses_the_whole_op() {
        let baseline = connect(
            BASELINE,
            r#"{"kind":"add_protocol","label":"spi","options":{"roles":["provider","consumer"]}}"#,
        )
        .expect("applies")
        .hcl
        .expect("hcl");
        let diagnostics = connect(
            &baseline,
            r#"{"kind":"connect_components","scopePath":"demo","label":"a-to-b",
                "from":{"component":"a","port":{"new":{"label":"x","protocol":"spi","role":"sideways"}}},
                "to":{"component":"b","port":{"new":{"label":"y","protocol":"spi","role":"consumer"}}}}"#,
        )
        .expect_err("refused");
        let errors = codes(&diagnostics);
        assert!(!errors.is_empty());
        assert!(
            errors.iter().all(|code| *code == DiagnosticCode::E009),
            "{errors:?}"
        );
    }

    #[test]
    fn permitted_roles_are_accepted() {
        let baseline = connect(
            BASELINE,
            r#"{"kind":"add_protocol","label":"spi","options":{"roles":["provider","consumer"]}}"#,
        )
        .expect("applies")
        .hcl
        .expect("hcl");
        let result = connect(
            &baseline,
            r#"{"kind":"connect_components","scopePath":"demo","label":"a-to-b",
                "from":{"component":"a","port":{"new":{"label":"x","protocol":"spi","role":"provider"}}},
                "to":{"component":"b","port":{"new":{"label":"y","protocol":"spi","role":"consumer"}}}}"#,
        )
        .expect("applies");
        let model = compiled(&result.hcl.expect("hcl"));
        // Each port exists on the definition and on its placed instance.
        let roles_of = |label: &str| -> Vec<Option<String>> {
            model
                .ports
                .iter()
                .filter(|p| p.label == label)
                .map(|p| p.role.clone())
                .collect()
        };
        assert_eq!(
            roles_of("x"),
            [Some("provider".to_owned()), Some("provider".to_owned())]
        );
        assert_eq!(
            roles_of("y"),
            [Some("consumer".to_owned()), Some("consumer".to_owned())]
        );
    }

    #[test]
    fn an_existing_port_is_reused_and_nothing_is_created_for_it() {
        let baseline = connect(BASELINE, A_TO_B)
            .expect("applies")
            .hcl
            .expect("hcl");
        let result = connect(
            &baseline,
            r#"{"kind":"connect_components","scopePath":"demo","label":"again",
                "from":{"component":"a","port":{"existing":"link-b"}},
                "to":{"component":"b","port":{"new":{"label":"second"}}}}"#,
        )
        .expect("applies");
        let model = compiled(&result.hcl.expect("hcl"));
        assert_eq!(
            endpoint_ports(&model, "again"),
            [
                ("a".to_owned(), "link-b".to_owned()),
                ("b".to_owned(), "second".to_owned())
            ]
        );
        assert_eq!(
            model.ports.iter().filter(|p| p.label == "link-b").count(),
            2,
            "one for the definition and one for its placed instance, not three"
        );
    }

    #[test]
    fn an_unknown_existing_port_is_refused() {
        let diagnostics = connect(
            BASELINE,
            r#"{"kind":"connect_components","scopePath":"demo","label":"a-to-b",
                "from":{"component":"a","port":{"existing":"nope"}},
                "to":{"component":"b","port":{"new":{"label":"y"}}}}"#,
        )
        .expect_err("refused");
        assert_eq!(codes(&diagnostics), [DiagnosticCode::E000]);
    }

    #[test]
    fn a_port_label_clash_is_refused() {
        let baseline = connect(BASELINE, A_TO_B)
            .expect("applies")
            .hcl
            .expect("hcl");
        let diagnostics = connect(
            &baseline,
            r#"{"kind":"connect_components","scopePath":"demo","label":"second",
                "from":{"component":"a","port":{"new":{"label":"link-b"}}},
                "to":{"component":"b","port":{"new":{"label":"other"}}}}"#,
        )
        .expect_err("refused");
        assert_eq!(codes(&diagnostics), [DiagnosticCode::E000]);
    }

    #[test]
    fn both_ends_on_one_definition_cannot_share_a_port_label() {
        let baseline = r#"
component "motor" { leaf = true }
system "demo" {
  instance "m1" { source = "motor" }
  instance "m2" { source = "motor" }
}
"#;
        let diagnostics = connect(
            baseline,
            r#"{"kind":"connect_components","scopePath":"demo","label":"m1-to-m2",
                "from":{"component":"m1","port":{"new":{"label":"link"}}},
                "to":{"component":"m2","port":{"new":{"label":"link"}}}}"#,
        )
        .expect_err("refused");
        assert_eq!(codes(&diagnostics), [DiagnosticCode::E000]);
    }

    #[test]
    fn a_blank_or_taken_connection_label_is_refused() {
        let blank = A_TO_B.replace(r#""label":"a-to-b""#, r#""label":"""#);
        let diagnostics = connect(BASELINE, &blank).expect_err("blank refused");
        assert_eq!(codes(&diagnostics), [DiagnosticCode::E000]);

        let baseline = connect(BASELINE, A_TO_B)
            .expect("applies")
            .hcl
            .expect("hcl");
        let taken = A_TO_B.replace("link-b", "x").replace("link-a", "y");
        let diagnostics = connect(&baseline, &taken).expect_err("taken refused");
        assert_eq!(codes(&diagnostics), [DiagnosticCode::E000]);
    }

    #[test]
    fn malformed_endpoints_are_refused() {
        for json in [
            A_TO_B.replace("link-b", "x/y"),
            A_TO_B.replace(r#""component":"a""#, r#""component":"ghost""#),
            A_TO_B.replace(r#""component":"a""#, r#""component":"""#),
        ] {
            let diagnostics = connect(BASELINE, &json).expect_err("refused");
            assert_eq!(codes(&diagnostics), [DiagnosticCode::E000]);
        }
    }

    #[test]
    fn an_unknown_scope_is_a_guard_refusal() {
        let result = connect(
            BASELINE,
            &A_TO_B.replace(r#""scopePath":"demo""#, r#""scopePath":"nowhere""#),
        )
        .expect("not an error");
        assert!(!result.applied);
        assert!(result.hcl.is_none());
    }

    #[test]
    fn nested_endpoints_put_the_port_on_the_nested_definition() {
        let result = connect(
            BASELINE,
            r#"{"kind":"connect_components","scopePath":"demo","label":"mcu-to-b",
                "from":{"component":"fc/mcu","port":{"new":{"label":"link-b","external":true}}},
                "to":{"component":"b","port":{"new":{"label":"link-mcu"}}}}"#,
        )
        .expect("applies");
        let hcl = result.hcl.expect("hcl");
        assert!(
            hcl.contains("fc/mcu/link-b"),
            "endpoint is scope-relative:\n{hcl}"
        );
        let model = compiled(&hcl);
        let ends = endpoint_ports(&model, "mcu-to-b");
        assert_eq!(
            ends,
            [
                ("mcu".to_owned(), "link-b".to_owned()),
                ("b".to_owned(), "link-mcu".to_owned())
            ]
        );
    }

    #[test]
    fn a_definition_scope_stores_the_connection_in_the_definition() {
        let baseline = r#"
component "x" { leaf = true }
component "y" { leaf = true }
component "pair" {
  instance "x" { source = "x" }
  instance "y" { source = "y" }
}
system "demo" {
  instance "pair" { source = "pair" }
}
"#;
        let result = connect(
            baseline,
            r#"{"kind":"connect_components","scopePath":"demo/pair","label":"x-to-y",
                "from":{"component":"x","port":{"new":{"label":"link-y"}}},
                "to":{"component":"y","port":{"new":{"label":"link-x"}}}}"#,
        )
        .expect("applies");
        let model = compiled(&result.hcl.expect("hcl"));
        assert_eq!(
            endpoint_ports(&model, "x-to-y"),
            [
                ("x".to_owned(), "link-y".to_owned()),
                ("y".to_owned(), "link-x".to_owned())
            ]
        );
    }

    #[test]
    fn an_empty_component_addresses_the_scopes_own_definition() {
        let baseline = r#"
component "child" { leaf = true }
component "parent" {
  instance "child" { source = "child" }
}
system "demo" {
  instance "parent" { source = "parent" }
}
"#;
        let result = connect(
            baseline,
            r#"{"kind":"connect_components","scopePath":"demo/parent","label":"expose",
                "from":{"component":"","port":{"new":{"label":"outer","external":true}}},
                "to":{"component":"child","port":{"new":{"label":"inner"}}}}"#,
        )
        .expect("applies");
        let hcl = result.hcl.expect("hcl");
        let model = compiled(&hcl);
        assert_eq!(
            endpoint_ports(&model, "expose"),
            [
                ("parent".to_owned(), "outer".to_owned()),
                ("child".to_owned(), "inner".to_owned())
            ]
        );
    }

    #[test]
    fn the_logged_action_replays_the_gesture_as_one_action() {
        let result = connect(
            BASELINE,
            r#"{"kind":"connect_components","scopePath":"demo","label":"a-to-b","createProtocol":"spi",
                "from":{"component":"a","port":{"new":{"label":"link-b","protocol":"spi","external":true}}},
                "to":{"component":"b","port":{"new":{"label":"link-a","protocol":"spi"}}}}"#,
        )
        .expect("applies");
        assert_eq!(result.actions.len(), 1, "one gesture, one action");
        let json = serde_json::to_value(&result.actions).expect("serializes");
        assert_eq!(
            json,
            serde_json::json!([{
                "op": "connect_components",
                "scopePath": "demo",
                "label": "a-to-b",
                "from": {"component": "a", "port": {"new": {"label": "link-b", "protocol": "spi", "external": true}}},
                "to": {"component": "b", "port": {"new": {"label": "link-a", "protocol": "spi"}}},
                "createProtocol": "spi"
            }])
        );
        assert!(matches!(
            result.actions.first(),
            Some(LoggedAction::ConnectComponents { .. })
        ));
    }
}
