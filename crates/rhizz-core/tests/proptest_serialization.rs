use std::fmt::Write as _;

use proptest::prelude::*;
use rhizz_core::{
    ConnectionLayout, ConnectionSide, NodeLayout, PortLayout, Source, ViewDefinition,
    ViewFilterDefinition, compile, parse_views, serialize_model, serialize_views,
};

#[derive(Debug)]
struct ComponentInput {
    suffix: String,
    full_name: String,
    tags: Vec<String>,
    external: bool,
    required: bool,
    border: Option<&'static str>,
}

#[derive(Debug)]
struct FieldInput {
    suffix: String,
    full_name: String,
    required: bool,
}

/// Input for the protocol / connection realization attributes.
#[derive(Debug)]
struct RealizationInput {
    /// Value of the main protocol's `leaf` attribute.
    leaf: bool,
    /// Suffix of the extra protocol the main protocol `encapsulates`.
    carried_suffix: String,
    /// Whether the extra protocol is emitted at all.
    encapsulate_carried: bool,
    /// For each generated connection, which later connections realize it.
    /// Only indexes greater than its own are used, so the graph stays acyclic.
    realized_by: Vec<Vec<bool>>,
}

#[derive(Debug)]
struct ModelInput {
    project_name: String,
    system_suffix: String,
    protocol_suffix: String,
    full_name: String,
    tags: Vec<String>,
    components: Vec<ComponentInput>,
    fields: Vec<FieldInput>,
    realization: RealizationInput,
}

fn identifier_suffix() -> impl Strategy<Value = String> {
    prop::collection::vec(proptest::char::range('a', 'z'), 1..8)
        .prop_map(|chars| chars.into_iter().collect())
}

fn text() -> impl Strategy<Value = String> {
    prop::collection::vec(
        prop_oneof![
            proptest::char::range('a', 'z'),
            proptest::char::range('A', 'Z'),
            proptest::char::range('0', '9'),
            Just(' '),
            Just('"'),
            Just('\\'),
            Just('\n'),
            Just('\t'),
        ],
        0..24,
    )
    .prop_map(|chars| chars.into_iter().collect())
}

fn tags() -> impl Strategy<Value = Vec<String>> {
    prop::collection::vec(identifier_suffix(), 0..4)
}

fn component_input() -> impl Strategy<Value = ComponentInput> {
    (
        identifier_suffix(),
        text(),
        tags(),
        any::<bool>(),
        any::<bool>(),
        prop::option::of(prop_oneof![Just("solid"), Just("dashed"), Just("dotted")]),
    )
        .prop_map(
            |(suffix, full_name, tags, external, required, border)| ComponentInput {
                suffix,
                full_name,
                tags,
                external,
                required,
                border,
            },
        )
}

fn field_input() -> impl Strategy<Value = FieldInput> {
    (identifier_suffix(), text(), any::<bool>()).prop_map(|(suffix, full_name, required)| {
        FieldInput {
            suffix,
            full_name,
            required,
        }
    })
}

fn realization_input() -> impl Strategy<Value = RealizationInput> {
    (
        any::<bool>(),
        identifier_suffix(),
        any::<bool>(),
        prop::collection::vec(prop::collection::vec(any::<bool>(), 0..6), 0..6),
    )
        .prop_map(|(leaf, carried_suffix, encapsulate_carried, realized_by)| {
            RealizationInput {
                leaf,
                carried_suffix,
                encapsulate_carried,
                realized_by,
            }
        })
}

fn model_input() -> impl Strategy<Value = ModelInput> {
    (
        text(),
        identifier_suffix(),
        identifier_suffix(),
        text(),
        tags(),
        prop::collection::vec(component_input(), 1..6),
        prop::collection::vec(field_input(), 0..5),
        realization_input(),
    )
        .prop_map(
            |(
                project_name,
                system_suffix,
                protocol_suffix,
                full_name,
                tags,
                components,
                fields,
                realization,
            )| ModelInput {
                project_name,
                system_suffix,
                protocol_suffix,
                full_name,
                tags,
                components,
                fields,
                realization,
            },
        )
}

fn quoted(value: &str) -> String {
    let mut result = String::with_capacity(value.len().saturating_add(2));
    result.push('"');
    for character in value.chars() {
        match character {
            '\\' => result.push_str("\\\\"),
            '"' => result.push_str("\\\""),
            '\n' => result.push_str("\\n"),
            '\r' => result.push_str("\\r"),
            '\t' => result.push_str("\\t"),
            _ => result.push(character),
        }
    }
    result.push('"');
    result
}

fn string_list(values: &[String]) -> String {
    let values = values.iter().map(|value| quoted(value)).collect::<Vec<_>>();
    format!("[{}]", values.join(", "))
}

/// Labels of the connections that `connection-{current_index}` is realized by.
///
/// Entries are listed in reverse so that canonical sorting is exercised. Only
/// later connections are referenced, which keeps the graph acyclic.
fn realized_by_targets(
    realization: &RealizationInput,
    previous_index: usize,
    current_index: usize,
    component_count: usize,
) -> Vec<String> {
    let flags = realization
        .realized_by
        .get(previous_index)
        .map(Vec::as_slice)
        .unwrap_or_default();
    flags
        .iter()
        .enumerate()
        .filter(|(_, enabled)| **enabled)
        .map(|(offset, _)| current_index.saturating_add(offset).saturating_add(1))
        .filter(|target| *target < component_count)
        .map(|target| format!("connection-{target}"))
        .rev()
        .collect()
}

fn render_valid_model(input: &ModelInput) -> String {
    let system_label = format!("system-{}", input.system_suffix);
    let protocol_label = format!("protocol-{}", input.protocol_suffix);
    let mut hcl = String::new();

    let _ = writeln!(hcl, "project {{");
    let _ = writeln!(hcl, "  name = {}", quoted(&input.project_name));
    let _ = writeln!(hcl, "  version = \"1.2.3\"");
    let _ = writeln!(hcl, "  authors = [\"property tester\"]");
    let _ = writeln!(hcl, "}}\n");

    let _ = writeln!(hcl, "protocol {} {{", quoted(&protocol_label));
    let _ = writeln!(hcl, "  full_name = {}", quoted(&input.full_name));
    let _ = writeln!(hcl, "  tags = {}", string_list(&input.tags));
    let _ = writeln!(hcl, "  roles = [\"provider\", \"consumer\"]");
    let realization = &input.realization;
    let carried_label = format!("protocol-carried-{}", realization.carried_suffix);
    // A leaf protocol must not be realized (reserved `E019`), so connections
    // only declare `realized_by` when the protocol is not a leaf.
    let _ = writeln!(hcl, "  leaf = {}", realization.leaf);
    if realization.encapsulate_carried {
        let _ = writeln!(hcl, "  encapsulates = [{}]", quoted(&carried_label));
    }
    let _ = writeln!(hcl, "  message \"message-generated\" {{");
    let _ = writeln!(hcl, "    full_name = {}", quoted(&input.full_name));
    for (index, field) in input.fields.iter().enumerate() {
        let _ = writeln!(
            hcl,
            "    field {} {{",
            quoted(&format!("field-{index}-{}", field.suffix))
        );
        let _ = writeln!(hcl, "      type = \"string\"");
        let _ = writeln!(hcl, "      full_name = {}", quoted(&field.full_name));
        let _ = writeln!(hcl, "      unit = \"unit\"");
        let _ = writeln!(hcl, "      required = {}", field.required);
        let _ = writeln!(hcl, "    }}");
    }
    let _ = writeln!(hcl, "  }}");
    let _ = writeln!(hcl, "}}\n");

    let _ = writeln!(hcl, "protocol {} {{}}\n", quoted(&carried_label));

    // Emit each component as a reusable top-level definition.
    for (index, component) in input.components.iter().enumerate() {
        let component_label = format!("component-{index}-{}", component.suffix);
        let _ = writeln!(hcl, "component {} {{", quoted(&component_label));
        let _ = writeln!(hcl, "  full_name = {}", quoted(&component.full_name));
        let _ = writeln!(hcl, "  tags = {}", string_list(&component.tags));
        if let Some(border) = component.border {
            let _ = writeln!(hcl, "  border = {}", quoted(border));
        }
        let _ = writeln!(hcl, "  leaf = true");
        let _ = writeln!(hcl, "  port \"port-generated\" {{");
        let _ = writeln!(hcl, "    protocol = {}", quoted(&protocol_label));
        let role = if index % 2 == 0 {
            "provider"
        } else {
            "consumer"
        };
        let _ = writeln!(hcl, "    role = {}", quoted(role));
        let _ = writeln!(hcl, "    external = {}", component.external);
        let _ = writeln!(hcl, "    required = {}", component.required);
        let _ = writeln!(hcl, "  }}");
        let _ = writeln!(hcl, "}}");
    }

    // The system references the definitions via `instance` blocks.
    let _ = writeln!(hcl, "system {} {{", quoted(&system_label));
    let _ = writeln!(hcl, "  full_name = {}", quoted(&input.full_name));
    let _ = writeln!(hcl, "  tags = {}", string_list(&input.tags));
    for (index, component) in input.components.iter().enumerate() {
        let component_label = format!("component-{index}-{}", component.suffix);
        let _ = writeln!(
            hcl,
            "  instance {} {{ source = {} }}",
            quoted(&component_label),
            quoted(&component_label)
        );
    }
    for (previous_index, pair) in input.components.windows(2).enumerate() {
        let [previous, current] = pair else {
            continue;
        };
        let current_index = previous_index.saturating_add(1);
        let from = format!(
            "component-{previous_index}-{}/port-generated",
            previous.suffix
        );
        let to = format!(
            "component-{current_index}-{}/port-generated",
            current.suffix
        );
        let _ = writeln!(hcl, "  connection \"connection-{current_index}\" {{");
        let _ = writeln!(hcl, "    from = {}", quoted(&from));
        let _ = writeln!(hcl, "    to = {}", quoted(&to));
        let targets = realized_by_targets(
            realization,
            previous_index,
            current_index,
            input.components.len(),
        );
        if !realization.leaf && !targets.is_empty() {
            let _ = writeln!(hcl, "    realized_by = {}", string_list(&targets));
        }
        let _ = writeln!(hcl, "  }}");
    }
    let _ = writeln!(hcl, "}}");

    hcl
}

fn side() -> impl Strategy<Value = ConnectionSide> {
    prop_oneof![
        Just(ConnectionSide::Top),
        Just(ConnectionSide::Bottom),
        Just(ConnectionSide::Left),
        Just(ConnectionSide::Right),
    ]
}

fn view_definition() -> impl Strategy<Value = ViewDefinition> {
    (
        identifier_suffix(),
        text(),
        tags(),
        identifier_suffix(),
        tags(),
        tags(),
        prop::option::of(-20_i32..20),
        tags(),
        prop::option::of(any::<bool>()),
        prop::collection::vec(
            (
                identifier_suffix(),
                -10_000.0_f64..10_000.0,
                -10_000.0_f64..10_000.0,
                prop::option::of(1.0_f64..1_000.0),
                prop::option::of(1.0_f64..1_000.0),
                prop::option::of(prop_oneof![
                    Just("center".to_owned()),
                    Just("top-left".to_owned())
                ]),
                prop::collection::vec((identifier_suffix(), side(), 0.0_f64..1.0), 0..3),
            ),
            0..5,
        ),
        prop::collection::vec(
            (
                identifier_suffix(),
                prop::option::of(side()),
                prop::option::of(side()),
                any::<bool>(),
            ),
            0..5,
        ),
    )
        .prop_map(
            |(
                label,
                full_name,
                tags,
                system,
                include_tags,
                exclude_tags,
                max_level,
                components,
                show_messages,
                nodes,
                connections,
            )| ViewDefinition {
                label: format!("view-{label}"),
                full_name,
                tags,
                system: format!("system-{system}"),
                filter: ViewFilterDefinition {
                    include_tags,
                    exclude_tags,
                    max_level,
                    components,
                    show_messages,
                },
                nodes: nodes
                    .into_iter()
                    .enumerate()
                    .map(
                        |(index, (component, x, y, width, height, text_align, ports))| NodeLayout {
                            component: format!("component-{index}-{component}"),
                            x,
                            y,
                            width,
                            height,
                            text_align,
                            ports: ports
                                .into_iter()
                                .enumerate()
                                .map(|(port_index, (port, side, offset))| PortLayout {
                                    port: format!("port-{port_index}-{port}"),
                                    side,
                                    offset,
                                })
                                .collect(),
                        },
                    )
                    .collect(),
                connections: connections
                    .into_iter()
                    .enumerate()
                    .map(
                        |(index, (connection, start_side, end_side, hidden))| ConnectionLayout {
                            connection: format!("connection-{index}-{connection}"),
                            start_side,
                            end_side,
                            hidden,
                        },
                    )
                    .collect(),
                annotations: vec![],
            },
        )
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(256))]

    #[test]
    fn generated_valid_models_are_canonical_after_roundtrip(input in model_input()) {
        let generated_hcl = render_valid_model(&input);
        let first = compile(&[Source {
            filename: "system.hcl".to_owned(),
            content: generated_hcl.clone(),
        }]);
        prop_assert!(
            first.diagnostics.iter().all(|diagnostic| !diagnostic.is_error()),
            "generated valid HCL failed to compile:\n{generated_hcl}\n{:?}",
            first.diagnostics
        );
        prop_assert!(first.model.is_some(), "valid generated HCL produced no model");
        let serialized_once = first.model.as_ref().map(serialize_model).unwrap_or_default();

        let second = compile(&[Source {
            filename: "system.hcl".to_owned(),
            content: serialized_once.clone(),
        }]);
        prop_assert!(
            second.diagnostics.iter().all(|diagnostic| !diagnostic.is_error()),
            "serialized model failed to recompile:\n{serialized_once}\n{:?}",
            second.diagnostics
        );
        prop_assert!(second.model.is_some(), "serialized model produced no model");
        let serialized_twice = second.model.as_ref().map(serialize_model).unwrap_or_default();

        prop_assert_eq!(serialized_once, serialized_twice);
    }

    #[test]
    fn generated_views_are_canonical_after_roundtrip(views in prop::collection::vec(view_definition(), 0..6)) {
        let serialized_once = serialize_views(&views);
        let parsed = parse_views(&serialized_once);
        prop_assert!(parsed.is_ok(), "serialized views failed to parse:\n{serialized_once}\n{parsed:?}");
        let serialized_twice = parsed.as_ref().map_or_else(|_| String::new(), |parsed| serialize_views(parsed));

        prop_assert_eq!(serialized_once, serialized_twice);
    }
}
