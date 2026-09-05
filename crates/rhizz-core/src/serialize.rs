//! Canonical, deterministic HCL serialization and parsing for system models and views.
//!
//! Converts a resolved [`Model`] or [`ViewDefinition`] list into clean, human-readable HCL strings.
//!
//! # Guarantees
//!
//! 1. **Determinism**: Sibling entities (systems, components, ports, connections,
//!    messages, fields, views, nodes) are serialized in sorted order by label,
//!    ensuring identical output across runs.
//! 2. **Round-trip stability (Idempotency)**:
//!    - `serialize_model(compile(serialize_model(model))) == serialize_model(model)`
//!    - `serialize_views(parse_views(serialize_views(views))) == serialize_views(views)`
//! 3. **Pure model & view separation**: Architectural entities are serialized into
//!    system model files, while visual layout coordinates and views are serialized into
//!    separate `views.hcl` files.

use std::collections::HashSet;
use std::fmt::Write as _;

use crate::model::{
    Annotation, BorderStyle, Component, ComponentKind, ComponentParent, Connection,
    ConnectionEndpoint, ConnectionLayout, ConnectionSide, Field, Message, Model, NodeLayout, Port,
    Project, Protocol, System, View, ViewDefinition, ViewFilterDefinition,
};
use anyhow::Context;
use serde::Deserialize;

// ── Model Serialization ───────────────────────────────────────────────────────

/// Serializes a resolved [`Model`] into a canonical, formatted HCL string.
///
/// Components are emitted as standalone top-level definitions, never inlined
/// under a parent:
///
/// - A component instantiated via `source = "<label>"` is emitted once as
///   `component "<label>"` (its definition label, not its instance path).
/// - An inline component (no `source`) is emitted under its qualified path.
///
/// Systems and parent components reference their children via
/// `source = "<label-or-path>"`. This keeps the model flat and stable across
/// multi-system reuse instead of inlining clones or renaming definitions to
/// their instantiation paths.
#[must_use]
pub fn serialize_model(model: &Model) -> String {
    let mut out = String::new();

    // 1. Project block (if any non-default field is present)
    if should_serialize_project(&model.project) {
        serialize_project(&mut out, &model.project);
    }

    // 2. Protocol blocks (sorted by label for determinism)
    let mut protocols: Vec<&Protocol> = model.protocols.iter().collect();
    protocols.sort_by(|a, b| a.label.cmp(&b.label));

    for proto in &protocols {
        if !out.is_empty() {
            out.push('\n');
        }
        serialize_protocol(&mut out, proto, model);
    }

    // 3. Component definitions. Each reusable top-level definition
    // (`model.definitions`, kind: Definition) is emitted once as a standalone
    // `component` block keyed by its own label. Instances never get their own
    // definition block — they reference a definition via `source` inside a
    // system/component below.
    let mut definitions: Vec<&Component> = model
        .definitions
        .iter()
        .filter_map(|id| model.component(*id))
        .collect();
    definitions.sort_by(|a, b| a.label.cmp(&b.label));

    for comp in &definitions {
        if !out.is_empty() {
            out.push('\n');
        }
        serialize_component_def(&mut out, comp, model);
    }

    // 4. System blocks (sorted by label for determinism).
    let mut systems: Vec<&System> = model.systems.iter().collect();
    systems.sort_by(|a, b| a.label.cmp(&b.label));

    for (i, sys) in systems.iter().enumerate() {
        if !out.is_empty() {
            out.push('\n');
        }
        serialize_system(&mut out, sys, model);
        if i.saturating_add(1) < systems.len() {
            out.push('\n');
        }
    }

    out
}

fn should_serialize_project(project: &Project) -> bool {
    !project.name.is_empty()
        || (!project.version.is_empty() && project.version != "0.0.0")
        || !project.authors.is_empty()
}

fn serialize_project(out: &mut String, project: &Project) {
    out.push_str("project {\n");
    if !project.name.is_empty() {
        let _ = writeln!(out, "  name    = {}", escape_string(&project.name));
    }
    if !project.version.is_empty() && project.version != "0.0.0" {
        let _ = writeln!(out, "  version = {}", escape_string(&project.version));
    }
    if !project.authors.is_empty() {
        let _ = writeln!(out, "  authors = {}", format_string_list(&project.authors));
    }
    out.push_str("}\n");
}

fn serialize_system(out: &mut String, sys: &System, model: &Model) {
    let _ = writeln!(out, "system {} {{", escape_string(&sys.label));

    let indent = "  ";

    if !sys.description.is_empty() {
        let _ = writeln!(
            out,
            "{indent}description = {}",
            escape_string(&sys.description)
        );
    }
    if !sys.tags.is_empty() {
        let _ = writeln!(
            out,
            "{indent}tags        = {}",
            format_string_list(&sys.tags)
        );
    }
    if sys.level != 0 {
        let _ = writeln!(out, "{indent}level       = {}", sys.level);
    }

    // Direct child components: instances are emitted as `instance` blocks using
    // their `source` reference; inline components (rare) as `component` blocks.
    let mut child_comps: Vec<&Component> = sys
        .components
        .iter()
        .filter_map(|id| model.component(*id))
        .collect();
    child_comps.sort_by(|a, b| a.label.cmp(&b.label));

    for comp in child_comps {
        out.push('\n');
        if comp.kind == ComponentKind::Instance {
            let src = comp.source.clone().unwrap_or_default();
            let _ = writeln!(
                out,
                "{indent}instance {} {{ source = {} }}",
                escape_string(&comp.label),
                escape_string(&src)
            );
        } else {
            let _ = writeln!(
                out,
                "{indent}component {} {{ source = {} }}",
                escape_string(&comp.label),
                escape_string(&component_ref(comp, model))
            );
        }
    }

    // System-level connections (sorted by label)
    let mut child_conns: Vec<&Connection> = sys
        .connections
        .iter()
        .filter_map(|id| model.connection(*id))
        .collect();
    child_conns.sort_by(|a, b| a.label.cmp(&b.label));

    for conn in child_conns {
        out.push('\n');
        serialize_connection(out, conn, model, 1, sys.level);
    }

    out.push_str("}\n");
}

/// Serializes a single component as a standalone top-level definition. The
/// definition is keyed by its `source` label when the component is an instance
/// of a shared definition, otherwise by its qualified path. Children are
/// referenced via `source` pointing at their own standalone definitions rather
/// than inlined.
fn serialize_component_def(out: &mut String, comp: &Component, model: &Model) {
    // A definition is keyed by its own label (it has no source).
    let label = comp.label.clone();
    let _ = writeln!(out, "component {} {{", escape_string(&label));

    let indent = "  ";

    if !comp.description.is_empty() {
        let _ = writeln!(
            out,
            "{indent}description = {}",
            escape_string(&comp.description)
        );
    }
    if let Some(icon) = comp.icon.as_deref().filter(|s| !s.is_empty()) {
        let _ = writeln!(out, "{indent}icon        = {}", escape_string(icon));
    }
    if let Some(color) = comp.color.as_deref().filter(|s| !s.is_empty()) {
        let _ = writeln!(out, "{indent}color       = {}", escape_string(color));
    }
    if let Some(border) = comp.border
        && border != BorderStyle::Solid
    {
        let _ = writeln!(
            out,
            "{indent}border      = {}",
            escape_string(border.as_str())
        );
    }
    if let Some(font) = comp.font.as_deref().filter(|s| !s.is_empty()) {
        let _ = writeln!(out, "{indent}font        = {}", escape_string(font));
    }
    if !comp.tags.is_empty() {
        let _ = writeln!(
            out,
            "{indent}tags        = {}",
            format_string_list(&comp.tags)
        );
    }
    if comp.level != 1 {
        let _ = writeln!(out, "{indent}level       = {}", comp.level);
    }
    if comp.leaf {
        let _ = writeln!(out, "{indent}leaf        = true");
    }

    // Ports (sorted by label)
    let mut ports: Vec<&Port> = comp.ports.iter().filter_map(|id| model.port(*id)).collect();
    ports.sort_by(|a, b| a.label.cmp(&b.label));

    for port in ports {
        out.push('\n');
        serialize_port(out, port, 1);
    }

    // Child components: instances as `instance` blocks (via their `source`),
    // inline components as `component` blocks.
    let mut child_comps: Vec<&Component> = comp
        .children
        .iter()
        .filter_map(|id| model.component(*id))
        .collect();
    child_comps.sort_by(|a, b| a.label.cmp(&b.label));

    for child in child_comps {
        out.push('\n');
        if child.kind == ComponentKind::Instance {
            let src = child.source.clone().unwrap_or_default();
            let _ = writeln!(
                out,
                "{indent}instance {} {{ source = {} }}",
                escape_string(&child.label),
                escape_string(&src)
            );
        } else {
            let _ = writeln!(
                out,
                "{indent}component {} {{ source = {} }}",
                escape_string(&child.label),
                escape_string(&component_ref(child, model))
            );
        }
    }

    // Internal connections (sorted by label)
    let mut child_conns: Vec<&Connection> = comp
        .connections
        .iter()
        .filter_map(|id| model.connection(*id))
        .collect();
    child_conns.sort_by(|a, b| a.label.cmp(&b.label));

    for conn in child_conns {
        out.push('\n');
        serialize_connection(out, conn, model, 1, comp.level);
    }

    out.push_str("}\n");
}

/// Builds the qualified path of a component from its root system, e.g.
/// `airborne/plane/engine` (no leading slash). The root system label is
/// included so the path is globally unique across systems — this is the
/// component's identity used as its top-level definition label.
fn component_path(comp: &Component, model: &Model) -> String {
    let mut segments: Vec<String> = Vec::new();
    let mut current = comp;
    loop {
        segments.push(current.label.clone());
        match current.parent {
            Some(ComponentParent::Component(parent)) => {
                let Some(parent_comp) = model.component(parent) else {
                    break;
                };
                current = parent_comp;
            }
            Some(ComponentParent::System(sid)) => {
                if let Some(system) = model.system(sid) {
                    segments.push(system.label.clone());
                }
                break;
            }
            // A top-level reusable definition (or an internal component of one)
            // has no placement path — its path is just its own label chain.
            None => break,
        }
    }
    segments.reverse();
    segments.join("/")
}

/// Returns the reference used to point at a component from a parent or system:
/// its `source` definition label when it is an instance of a shared definition,
/// otherwise its qualified path.
fn component_ref(comp: &Component, model: &Model) -> String {
    comp.source
        .clone()
        .unwrap_or_else(|| component_path(comp, model))
}

fn serialize_port(out: &mut String, port: &Port, depth: usize) {
    let indent = "  ".repeat(depth);
    let _ = writeln!(out, "{indent}port {} {{", escape_string(&port.label));

    let inner_indent = "  ".repeat(depth.saturating_add(1));

    if !port.description.is_empty() {
        let _ = writeln!(
            out,
            "{inner_indent}description = {}",
            escape_string(&port.description)
        );
    }
    if !port.protocol.is_empty() {
        let _ = writeln!(
            out,
            "{inner_indent}protocol    = {}",
            escape_string(&port.protocol)
        );
    }
    if let Some(role_str) = &port.role {
        let _ = writeln!(
            out,
            "{inner_indent}role        = {}",
            escape_string(role_str)
        );
    }

    if !port.tags.is_empty() {
        let _ = writeln!(
            out,
            "{inner_indent}tags        = {}",
            format_string_list(&port.tags)
        );
    }
    if port.external {
        let _ = writeln!(out, "{inner_indent}external    = true");
    }
    if !port.required {
        let _ = writeln!(out, "{inner_indent}required    = false");
    }

    let _ = writeln!(out, "{indent}}}");
}

fn serialize_protocol(out: &mut String, proto: &Protocol, model: &Model) {
    let _ = writeln!(out, "protocol {} {{", escape_string(&proto.label));

    if !proto.description.is_empty() {
        let _ = writeln!(out, "  description = {}", escape_string(&proto.description));
    }
    if !proto.tags.is_empty() {
        let _ = writeln!(out, "  tags        = {}", format_string_list(&proto.tags));
    }
    if !proto.roles.is_empty() {
        let _ = writeln!(out, "  roles       = {}", format_string_list(&proto.roles));
    }

    let mut messages: Vec<&Message> = proto
        .messages
        .iter()
        .filter_map(|id| model.message(*id))
        .collect();
    messages.sort_by(|a, b| a.label.cmp(&b.label));

    for msg in messages {
        out.push('\n');
        serialize_message(out, msg, model, 1, 0);
    }

    out.push_str("}\n");
}

fn serialize_message(
    out: &mut String,
    msg: &Message,
    model: &Model,
    depth: usize,
    parent_level: i32,
) {
    let indent = "  ".repeat(depth);
    let _ = writeln!(out, "{indent}message {} {{", escape_string(&msg.label));

    let inner_indent = "  ".repeat(depth.saturating_add(1));

    if !msg.description.is_empty() {
        let _ = writeln!(
            out,
            "{inner_indent}description = {}",
            escape_string(&msg.description)
        );
    }
    if !msg.tags.is_empty() {
        let _ = writeln!(
            out,
            "{inner_indent}tags        = {}",
            format_string_list(&msg.tags)
        );
    }
    if msg.level != parent_level {
        let _ = writeln!(out, "{inner_indent}level       = {}", msg.level);
    }

    // Fields (sorted by label)
    let mut fields: Vec<&Field> = msg
        .fields
        .iter()
        .filter_map(|id| model.field(*id))
        .collect();
    fields.sort_by(|a, b| a.label.cmp(&b.label));

    for field in fields {
        out.push('\n');
        serialize_field(out, field, depth.saturating_add(1));
    }

    let _ = writeln!(out, "{indent}}}");
}

fn serialize_field(out: &mut String, field: &Field, depth: usize) {
    let indent = "  ".repeat(depth);
    let _ = writeln!(out, "{indent}field {} {{", escape_string(&field.label));

    let inner_indent = "  ".repeat(depth.saturating_add(1));

    let _ = writeln!(
        out,
        "{inner_indent}type        = {}",
        escape_string(&field.field_type)
    );
    if !field.description.is_empty() {
        let _ = writeln!(
            out,
            "{inner_indent}description = {}",
            escape_string(&field.description)
        );
    }
    if !field.unit.is_empty() {
        let _ = writeln!(
            out,
            "{inner_indent}unit        = {}",
            escape_string(&field.unit)
        );
    }
    if field.required {
        let _ = writeln!(out, "{inner_indent}required    = true");
    }

    let _ = writeln!(out, "{indent}}}");
}

fn serialize_connection(
    out: &mut String,
    conn: &Connection,
    model: &Model,
    depth: usize,
    parent_level: i32,
) {
    let indent = "  ".repeat(depth);
    let _ = writeln!(out, "{indent}connection {} {{", escape_string(&conn.label));

    let inner_indent = "  ".repeat(depth.saturating_add(1));

    if !conn.description.is_empty() {
        let _ = writeln!(
            out,
            "{inner_indent}description  = {}",
            escape_string(&conn.description)
        );
    }
    if !conn.tags.is_empty() {
        let _ = writeln!(
            out,
            "{inner_indent}tags         = {}",
            format_string_list(&conn.tags)
        );
    }
    if conn.level != parent_level.saturating_add(1) {
        let _ = writeln!(out, "{inner_indent}level        = {}", conn.level);
    }

    let from_str = endpoint_path(&conn.from, model);
    let _ = writeln!(
        out,
        "{inner_indent}from         = {}",
        escape_string(&from_str)
    );

    let to_str = endpoint_path(&conn.to, model);
    let _ = writeln!(
        out,
        "{inner_indent}to           = {}",
        escape_string(&to_str)
    );

    if !conn.encapsulates.is_empty() {
        let mut enc_labels: Vec<String> = conn
            .encapsulates
            .iter()
            .filter_map(|id| model.connection(*id))
            .map(|c| c.label.clone())
            .collect();
        enc_labels.sort();
        let _ = writeln!(
            out,
            "{inner_indent}encapsulates = {}",
            format_string_list(&enc_labels)
        );
    }

    let _ = writeln!(out, "{indent}}}");
}

/// Builds an absolute, scope-independent path to a connection endpoint, e.g.
/// `/system/comp/child/port`. Walking up the parent chain from the endpoint
/// component to its root system guarantees the path resolves identically on
/// re-parse regardless of the connection's own scope (a relative label like
/// `agc/port` would break for deeply-nested endpoints — see the nested
/// connection roundtrip regression test).
///
/// Endpoints rooted in a reusable definition (top-level `component`, no
/// placement parent) have no system in their chain; these are emitted as a
/// relative path (no leading slash) so they re-parse as definition-local
/// references rather than being mistaken for a `/system/...` absolute path.
fn endpoint_path(endpoint: &ConnectionEndpoint, model: &Model) -> String {
    let mut segments: Vec<String> = Vec::new();
    let mut definition_rooted = false;

    if let Some(pid) = endpoint.port
        && let Some(port) = model.port(pid)
    {
        segments.push(port.label.clone());
    }

    let mut current = endpoint.component;
    while let Some(comp) = model.component(current) {
        let label = comp.label.clone();
        let parent = comp.parent;
        segments.push(label);
        match parent {
            Some(ComponentParent::Component(parent)) => current = parent,
            Some(ComponentParent::System(sid)) => {
                let system_label = model
                    .system(sid)
                    .map(|s| s.label.clone())
                    .unwrap_or_default();
                segments.push(system_label);
                break;
            }
            // A top-level reusable definition (or an internal component of one)
            // has no placement path — its path is just its own label chain, and
            // stays relative.
            None => {
                definition_rooted = true;
                break;
            }
        }
    }

    segments.reverse();
    if definition_rooted {
        // The endpoint lives inside a reusable definition's scope. Its path
        // must be relative to that definition (drop the definition's own label,
        // which is the scope root and is not a child of itself), so the
        // reference resolves within the definition body.
        if segments.len() > 1 {
            segments.remove(0);
        }
        segments.join("/")
    } else {
        format!("/{}", segments.join("/"))
    }
}

// ── Views and Layout Serialization ────────────────────────────────────────────

/// Serializes a slice of [`ViewDefinition`]s into canonical HCL formatted for `views.hcl`.
#[must_use]
pub fn serialize_views(views: &[ViewDefinition]) -> String {
    let mut out = String::new();
    let mut sorted_views: Vec<&ViewDefinition> = views.iter().collect();
    sorted_views.sort_by(|a, b| a.label.cmp(&b.label));

    for (i, view) in sorted_views.iter().enumerate() {
        if i > 0 {
            out.push('\n');
        }
        serialize_single_view(&mut out, view);
    }

    out
}

/// Helper to serialize resolved [`View`] models from a [`Model`] into HCL.
#[must_use]
pub fn serialize_resolved_views(views: &[View], model: &Model) -> String {
    // Deduplicate by label: parse merges every `.hcl` in the project (including
    // `diagrams/*.hcl`), so the same view may appear both in `views.hcl` and a
    // diagram file. Emit each view exactly once to keep the output idempotent.
    let mut seen: HashSet<&str> = HashSet::new();
    let mut view_defs: Vec<ViewDefinition> = Vec::new();
    for v in views {
        if seen.insert(v.label.as_str()) {
            view_defs.push(ViewDefinition::from_resolved(v, model));
        }
    }
    serialize_views(&view_defs)
}

fn serialize_single_view(out: &mut String, view: &ViewDefinition) {
    let _ = writeln!(out, "view {} {{", escape_string(&view.label));

    if !view.description.is_empty() {
        let _ = writeln!(out, "  description = {}", escape_string(&view.description));
    }
    if !view.tags.is_empty() {
        let _ = writeln!(out, "  tags        = {}", format_string_list(&view.tags));
    }
    if !view.system.is_empty() {
        let _ = writeln!(out, "  system      = {}", escape_string(&view.system));
    }

    if should_serialize_filter(&view.filter) {
        out.push('\n');
        serialize_view_filter(out, &view.filter);
    }

    let mut sorted_nodes: Vec<&NodeLayout> = view.nodes.iter().collect();
    sorted_nodes.sort_by(|a, b| a.component.cmp(&b.component));

    for node in sorted_nodes {
        out.push('\n');
        serialize_node_layout(out, node);
    }

    let mut sorted_conns: Vec<&ConnectionLayout> = view.connections.iter().collect();
    sorted_conns.sort_by(|a, b| a.connection.cmp(&b.connection));

    for conn in sorted_conns {
        out.push('\n');
        serialize_connection_layout(out, conn);
    }

    let mut sorted_anns: Vec<&Annotation> = view.annotations.iter().collect();
    sorted_anns.sort_by(|a, b| a.text.cmp(&b.text));

    for ann in sorted_anns {
        out.push('\n');
        serialize_annotation(out, ann);
    }

    out.push_str("}\n");
}

const fn should_serialize_filter(filter: &ViewFilterDefinition) -> bool {
    !filter.include_tags.is_empty()
        || !filter.exclude_tags.is_empty()
        || filter.max_level.is_some()
        || !filter.components.is_empty()
        || filter.show_messages.is_some()
}

fn serialize_view_filter(out: &mut String, filter: &ViewFilterDefinition) {
    out.push_str("  filter {\n");
    if !filter.include_tags.is_empty() {
        let _ = writeln!(
            out,
            "    include_tags  = {}",
            format_string_list(&filter.include_tags)
        );
    }
    if !filter.exclude_tags.is_empty() {
        let _ = writeln!(
            out,
            "    exclude_tags  = {}",
            format_string_list(&filter.exclude_tags)
        );
    }
    if let Some(max_level) = filter.max_level {
        let _ = writeln!(out, "    max_level     = {max_level}");
    }
    if !filter.components.is_empty() {
        let _ = writeln!(
            out,
            "    components    = {}",
            format_string_list(&filter.components)
        );
    }
    if let Some(show_messages) = filter.show_messages {
        let _ = writeln!(out, "    show_messages = {show_messages}");
    }
    out.push_str("  }\n");
}

fn serialize_node_layout(out: &mut String, node: &NodeLayout) {
    let _ = writeln!(out, "  node {} {{", escape_string(&node.component));
    let _ = writeln!(out, "    x          = {}", format_number(node.x));
    let _ = writeln!(out, "    y          = {}", format_number(node.y));
    if let Some(w) = node.width {
        let _ = writeln!(out, "    width      = {}", format_number(w));
    }
    if let Some(h) = node.height {
        let _ = writeln!(out, "    height     = {}", format_number(h));
    }
    if let Some(ref align) = node.text_align {
        let _ = writeln!(out, "    text_align = {}", escape_string(align));
    }
    out.push_str("  }\n");
}

fn serialize_connection_layout(out: &mut String, conn: &ConnectionLayout) {
    let _ = writeln!(out, "  connection {} {{", escape_string(&conn.connection));
    if let Some(side) = conn.start_side {
        let _ = writeln!(out, "    start_side = {}", escape_string(side.as_str()));
    }
    if let Some(side) = conn.end_side {
        let _ = writeln!(out, "    end_side   = {}", escape_string(side.as_str()));
    }
    out.push_str("  }\n");
}

/// Serialize one annotation block: `annotation { x y text }`.
fn serialize_annotation(out: &mut String, ann: &Annotation) {
    let _ = writeln!(out, "  annotation {{");
    let _ = writeln!(out, "    x    = {}", format_number(ann.x));
    let _ = writeln!(out, "    y    = {}", format_number(ann.y));
    let _ = writeln!(out, "    text = {}", escape_string(&ann.text));
    out.push_str("  }\n");
}

fn format_number(n: f64) -> String {
    if n.fract() == 0.0 && n.is_finite() {
        // The value is a finite whole number. Clamp to the i64 range so the
        // float-to-int cast cannot overflow. std provides no TryFrom<f64> for
        // i64, so an `as` cast is the only available conversion here; the
        // clamp above makes it safe.
        #[allow(clippy::as_conversions, clippy::cast_possible_truncation)]
        let as_int = n.clamp(-9.223_372_036_854_776E18, 9.223_372_036_854_776E18) as i64;
        format!("{as_int}")
    } else {
        format!("{n}")
    }
}

// ── Views Parsing ─────────────────────────────────────────────────────────────

#[derive(Deserialize, Default)]
struct RawViewAttrs {
    description: Option<String>,
    tags: Option<Vec<String>>,
    system: Option<String>,
}

#[derive(Deserialize, Default)]
struct RawFilterAttrs {
    include_tags: Option<Vec<String>>,
    exclude_tags: Option<Vec<String>>,
    max_level: Option<i32>,
    components: Option<Vec<String>>,
    show_messages: Option<bool>,
}

#[derive(Deserialize, Default)]
struct RawNodeAttrs {
    x: Option<f64>,
    y: Option<f64>,
    width: Option<f64>,
    height: Option<f64>,
    text_align: Option<String>,
}

#[derive(Deserialize, Default)]
struct RawConnectionLayoutAttrs {
    start_side: Option<String>,
    end_side: Option<String>,
}

#[derive(Deserialize, Default)]
struct RawAnnotationAttrs {
    x: Option<f64>,
    y: Option<f64>,
    text: Option<String>,
}

fn parse_connection_side(s: Option<&str>) -> Option<ConnectionSide> {
    match s {
        Some("top") => Some(ConnectionSide::Top),
        Some("bottom") => Some(ConnectionSide::Bottom),
        Some("left") => Some(ConnectionSide::Left),
        Some("right") => Some(ConnectionSide::Right),
        _ => None,
    }
}

/// Parses an HCL string representing `views.hcl` into a vector of [`ViewDefinition`]s.
///
/// # Errors
///
/// Returns an error if the HCL cannot be parsed or a `view` block is missing
/// its label.
pub fn parse_views(hcl_str: &str) -> anyhow::Result<Vec<ViewDefinition>> {
    let body: hcl::Body = hcl::from_str(hcl_str).context("failed to parse HCL for views")?;
    let mut views = Vec::new();

    for block in body.blocks() {
        if block.identifier() == "view" {
            let label = block
                .labels()
                .first()
                .map(|l| l.as_str().to_owned())
                .ok_or_else(|| anyhow::anyhow!("view block is missing a label"))?;

            let attrs: RawViewAttrs = hcl::from_body(block.body().clone())
                .context("failed to deserialize view attributes")?;

            let mut filter = ViewFilterDefinition::default();
            let mut nodes = Vec::new();
            let mut connections = Vec::new();
            let mut annotations = Vec::new();

            for child in block.body().blocks() {
                match child.identifier() {
                    "filter" => {
                        let fa: RawFilterAttrs = hcl::from_body(child.body().clone())
                            .context("failed to deserialize filter attributes")?;
                        filter = ViewFilterDefinition {
                            include_tags: fa.include_tags.unwrap_or_default(),
                            exclude_tags: fa.exclude_tags.unwrap_or_default(),
                            max_level: fa.max_level,
                            components: fa.components.unwrap_or_default(),
                            show_messages: fa.show_messages,
                        };
                    }
                    "node" => {
                        let node_label = child
                            .labels()
                            .first()
                            .map(|l| l.as_str().to_owned())
                            .ok_or_else(|| anyhow::anyhow!("node block is missing a label"))?;
                        let na: RawNodeAttrs = hcl::from_body(child.body().clone())
                            .context("failed to deserialize node attributes")?;
                        nodes.push(NodeLayout {
                            component: node_label,
                            x: na.x.unwrap_or(0.0),
                            y: na.y.unwrap_or(0.0),
                            width: na.width,
                            height: na.height,
                            text_align: na.text_align,
                        });
                    }
                    "connection" => {
                        let conn_label = child
                            .labels()
                            .first()
                            .map(|l| l.as_str().to_owned())
                            .ok_or_else(|| {
                                anyhow::anyhow!("connection layout block is missing a label")
                            })?;
                        let ca: RawConnectionLayoutAttrs = hcl::from_body(child.body().clone())
                            .context("failed to deserialize connection layout attributes")?;
                        connections.push(ConnectionLayout {
                            connection: conn_label,
                            start_side: parse_connection_side(ca.start_side.as_deref()),
                            end_side: parse_connection_side(ca.end_side.as_deref()),
                        });
                    }
                    "annotation" => {
                        let aa: RawAnnotationAttrs = hcl::from_body(child.body().clone())
                            .context("failed to deserialize annotation attributes")?;
                        annotations.push(Annotation {
                            text: aa.text.unwrap_or_default(),
                            x: aa.x.unwrap_or(0.0),
                            y: aa.y.unwrap_or(0.0),
                        });
                    }
                    _ => {}
                }
            }

            views.push(ViewDefinition {
                label,
                description: attrs.description.unwrap_or_default(),
                tags: attrs.tags.unwrap_or_default(),
                system: attrs.system.unwrap_or_default(),
                filter,
                nodes,
                connections,
                annotations,
            });
        }
    }

    Ok(views)
}

// ── Shared formatting helpers ─────────────────────────────────────────────────

fn escape_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len().saturating_add(2));
    out.push('"');
    for c in s.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            _ => out.push(c),
        }
    }
    out.push('"');
    out
}

fn format_string_list(items: &[String]) -> String {
    let escaped: Vec<String> = items.iter().map(|s| escape_string(s)).collect();
    format!("[{}]", escaped.join(", "))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{CompileResult, Source, compile};
    use std::fs;
    use std::path::Path;
    use walkdir::WalkDir;

    fn compile_dir(dir: &Path) -> CompileResult {
        let mut sources: Vec<Source> = WalkDir::new(dir)
            .into_iter()
            .filter_map(std::result::Result::ok)
            .filter(|entry| {
                entry.file_type().is_file()
                    && entry.path().extension().is_some_and(|ext| ext == "hcl")
            })
            .map(|entry| Source {
                filename: entry.path().to_string_lossy().into_owned(),
                content: fs::read_to_string(entry.path()).expect("should read test HCL"),
            })
            .collect();
        sources.sort_by(|left, right| left.filename.cmp(&right.filename));
        compile(&sources)
    }

    #[test]
    fn test_minimal_system_roundtrip() {
        let hcl = r#"project {
  name    = "mini"
  version = "1.0.0"
}

protocol "proto" {
  description = "A protocol"

  message "m1" {
    description = "Message 1"

    field "f1" {
      type        = "uint32"
      description = "Field 1"
    }
  }
}

component "comp-a" {
  leaf = true

  port "p1" {
    description = "Port 1"
    protocol    = "proto"
    role        = "provider"
  }
}

component "comp-b" {
  leaf = true

  port "p2" {
    protocol    = "proto"
    role        = "consumer"
  }
}

system "demo" {
  description = "A demo system"
  tags        = ["demo"]

  instance "comp-a" {
    source = "comp-a"
  }

  instance "comp-b" {
    source = "comp-b"
  }

  connection "c1" {
    description = "Link"
    from        = "comp-a/p1"
    to          = "comp-b/p2"
  }
}
"#;

        let res1 = compile(&[Source {
            filename: "system.hcl".to_string(),
            content: hcl.to_string(),
        }]);
        assert!(
            res1.diagnostics.iter().all(|d| !d.is_error()),
            "errors in res1: {:?}",
            res1.diagnostics
        );
        let model1 = res1.model.expect("model should resolve");

        let serialized1 = serialize_model(&model1);

        let res2 = compile(&[Source {
            filename: "system.hcl".to_string(),
            content: serialized1.clone(),
        }]);
        assert!(res2.diagnostics.iter().all(|d| !d.is_error()));
        let model2 = res2.model.expect("model should resolve second time");

        let serialized2 = serialize_model(&model2);

        assert_eq!(serialized1, serialized2, "serialization must be idempotent");
    }

    #[test]
    fn test_deep_hierarchy_and_escaping_roundtrip() {
        let hcl = r#"project {
  name    = "deep-system \"quotes\" and \\ slashes"
  version = "2.1.0"
  authors = ["Alice \"The Architect\"", "Bob"]
}

protocol "pcie" {
  description = "PCIe protocol"

  message "telemetry" {
    description = "Diagnostics & status"
    level       = 3

    field "err_count" {
      type        = "uint32"
      description = "Error count"
      required    = true
    }

    field "temperature" {
      type        = "float32"
      description = "Die temperature"
      unit        = "degC"
    }
  }
}

system "root-sys" {
  description = "A \"complex\" system with\nmultiple lines"
  tags        = ["tag-a", "tag-b"]
  level       = 1

  component "sub-system" {
    description = "Intermediate subsystem"
    level       = 2

    component "leaf-node" {
      description = "Deep leaf"
      tags        = ["hw"]
      leaf        = true

      port "data-port" {
        description = "High-speed serial"
        protocol    = "pcie"
        role        = "peer"
        tags        = ["bus"]
      }
    }

    component "peer-node" {
      leaf        = true

      port "data-port" {
        protocol    = "pcie"
        role        = "peer"
      }
    }

    connection "pcie-link" {
      description  = "Internal PCIe bus"
      from         = "leaf-node/data-port"
      to           = "peer-node/data-port"
    }
  }
}
"#;

        let res1 = compile(&[Source {
            filename: "system.hcl".to_string(),
            content: hcl.to_string(),
        }]);
        assert!(
            res1.diagnostics.iter().all(|d| !d.is_error()),
            "errors in res1: {:?}",
            res1.diagnostics
        );
        let model1 = res1.model.expect("model1 should resolve");

        let serialized1 = serialize_model(&model1);

        let res2 = compile(&[Source {
            filename: "system.hcl".to_string(),
            content: serialized1.clone(),
        }]);
        assert!(
            res2.diagnostics.iter().all(|d| !d.is_error()),
            "errors in res2: {:?}",
            res2.diagnostics
        );
        let model2 = res2.model.expect("model2 should resolve");

        let serialized2 = serialize_model(&model2);
        assert_eq!(
            serialized1, serialized2,
            "deep hierarchy must be idempotent"
        );
    }

    #[test]
    fn test_protocol_and_port_attributes_roundtrip() {
        let hcl = r#"protocol "telemetry" {
  description = "Telemetry streaming protocol"
  tags        = ["data", "telemetry"]
  roles       = ["provider", "consumer"]

  message "status" {
    description = "System status packet"

    field "battery_mv" {
      type        = "uint32"
      description = "Battery millivolts"
      unit        = "mV"
    }

    field "uptime_sec" {
      type        = "uint64"
      description = "Uptime in seconds"
      unit        = "s"
      required    = true
    }
  }
}

system "monitored-device" {
  component "hub" {
    leaf        = true

    port "telem-in" {
      description = "Telemetry input"
      protocol    = "telemetry"
      role        = "consumer"
      external    = true
    }

    port "debug-port" {
      role        = "peer"
      external    = true
      required    = false
    }
  }
}
"#;

        let res1 = compile(&[Source {
            filename: "system.hcl".to_string(),
            content: hcl.to_string(),
        }]);
        assert!(
            res1.diagnostics.iter().all(|d| !d.is_error()),
            "errors in res1: {:?}",
            res1.diagnostics
        );
        let model1 = res1.model.expect("model1 should resolve");

        let serialized1 = serialize_model(&model1);

        let res2 = compile(&[Source {
            filename: "system.hcl".to_string(),
            content: serialized1.clone(),
        }]);
        assert!(
            res2.diagnostics.iter().all(|d| !d.is_error()),
            "errors in res2: {:?}",
            res2.diagnostics
        );
        let model2 = res2.model.expect("model2 should resolve");

        let serialized2 = serialize_model(&model2);
        assert_eq!(
            serialized1, serialized2,
            "protocol and port attributes serialization must be idempotent"
        );
    }

    #[test]
    fn test_component_visual_attributes_roundtrip() {
        let src = r##"component "danger" {
    color  = "#ff0000"
    border = "dashed"
    font   = "bold"
}
system "style-demo" {
  instance "danger" {
    source = "danger"
  }
}
"##;

        let res1 = compile(&[Source {
            filename: "system.hcl".to_string(),
            content: src.to_string(),
        }]);
        assert!(
            res1.diagnostics.iter().all(|d| !d.is_error()),
            "errors in res1: {:?}",
            res1.diagnostics
        );
        let model1 = res1.model.expect("model1 should resolve");
        let serialized1 = serialize_model(&model1);

        // The visual attributes survive serialization.
        assert!(serialized1.contains("color       = \"#ff0000\""));
        assert!(serialized1.contains("border      = \"dashed\""));
        assert!(serialized1.contains("font        = \"bold\""));

        // The plain component omits them entirely (defaults).
        let res2 = compile(&[Source {
            filename: "system.hcl".to_string(),
            content: serialized1.clone(),
        }]);
        assert!(
            res2.diagnostics.iter().all(|d| !d.is_error()),
            "errors in res2: {:?}",
            res2.diagnostics
        );
        let model2 = res2.model.expect("model2 should resolve");
        let serialized2 = serialize_model(&model2);
        assert_eq!(
            serialized1, serialized2,
            "visual attribute serialization must be idempotent"
        );
    }

    #[test]
    fn test_nested_connection_roundtrip() {
        // A connection at the system level referencing a deeply-nested
        // component (cm/agc/rcs-commands) must round-trip. Regression test for
        // the serializer emitting endpoint labels without their full scope
        // path, which broke resolution on re-parse (E011).
        let hcl = r#"component "agc" {
  port "rcs-commands" {
    role = "provider"
  }
}
component "rcs-quads" {
  port "driver-signals" {
    role = "consumer"
  }
}
component "cm" {
  instance "agc" {
    source = "agc"
  }
}
component "sm" {
  instance "rcs-quads" {
    source = "rcs-quads"
  }
}
system "apollo" {
  instance "cm" {
    source = "cm"
  }
  instance "sm" {
    source = "sm"
  }

  connection "cm-agc-to-sm-rcs" {
    from = "cm/agc/rcs-commands"
    to   = "sm/rcs-quads/driver-signals"
  }
}
"#;

        let res1 = compile(&[Source {
            filename: "system.hcl".to_string(),
            content: hcl.to_string(),
        }]);
        assert!(
            res1.diagnostics.iter().all(|d| !d.is_error()),
            "errors in res1: {:?}",
            res1.diagnostics
        );
        let model1 = res1.model.expect("model1 should resolve");
        let serialized1 = serialize_model(&model1);

        let res2 = compile(&[Source {
            filename: "system.hcl".to_string(),
            content: serialized1.clone(),
        }]);
        assert!(
            res2.diagnostics.iter().all(|d| !d.is_error()),
            "errors recompiling serialized nested-connection model: {:?}",
            res2.diagnostics
        );
        let model2 = res2.model.expect("model2 should resolve");
        let serialized2 = serialize_model(&model2);
        assert_eq!(
            serialized1, serialized2,
            "nested-connection serialization must be idempotent"
        );
    }

    #[test]
    fn test_examples_idempotent_roundtrip() {
        let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
        let workspace_dir = manifest_dir
            .parent()
            .and_then(|p| p.parent())
            .expect("should find workspace root");
        let examples_dir = workspace_dir.join("examples");

        for example_name in [
            "drone",
            "social-media",
            "software-house",
            "single-file",
            "web-app",
            "apollo-11",
        ] {
            let example_path = examples_dir.join(example_name);
            if !example_path.exists() {
                continue;
            }

            let initial_result = compile_dir(&example_path);
            let model0 = initial_result
                .model
                .unwrap_or_else(|| panic!("failed to compile example {example_name}"));

            let serialized1 = serialize_model(&model0);

            let result1 = compile(&[Source {
                filename: "system.hcl".to_string(),
                content: serialized1.clone(),
            }]);
            assert!(
                result1.diagnostics.iter().all(|d| !d.is_error()),
                "errors compiling serialized {} model: {:?}",
                example_name,
                result1.diagnostics
            );
            let model1 = result1.model.expect("recompiled model should be available");

            let serialized2 = serialize_model(&model1);

            assert_eq!(
                serialized1, serialized2,
                "idempotency failed for example {example_name}"
            );
        }
    }

    #[test]
    fn test_views_roundtrip_with_nodes() {
        let hcl = r#"view "overview" {
  description = "Full overview"
  tags        = ["arch", "top"]
  system      = "quadcopter"

  filter {
    include_tags  = ["core"]
    exclude_tags  = ["debug"]
    max_level     = 2
    components    = ["fc", "esc"]
    show_messages = true
  }

  node "battery" {
    x          = 100
    y          = 250
    width      = 140
    height     = 90
    text_align = "center"
  }

  node "fc/mcu" {
    x          = 320.5
    y          = 150
    width      = 160
    height     = 100
    text_align = "top-left"
  }
}
"#;

        let parsed1 = parse_views(hcl).expect("should parse views HCL");
        assert_eq!(parsed1.len(), 1);
        let serialized1 = serialize_views(&parsed1);
        assert_eq!(serialized1, hcl);

        let parsed2 = parse_views(&serialized1).expect("should parse serialized views");
        assert_eq!(parsed1, parsed2);
    }

    #[test]
    fn test_example_views_roundtrip() {
        let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
        let workspace_dir = manifest_dir
            .parent()
            .and_then(|p| p.parent())
            .expect("should find workspace root");
        let examples_dir = workspace_dir.join("examples");

        for example_name in ["drone", "social-media", "software-house", "web-app"] {
            let views_path = examples_dir.join(example_name).join("views.hcl");
            if !views_path.exists() {
                continue;
            }

            let content = fs::read_to_string(&views_path).expect("should read views.hcl");
            let mut parsed1 = parse_views(&content)
                .unwrap_or_else(|e| panic!("failed parsing {example_name}: {e}"));
            parsed1.sort_by(|a, b| a.label.cmp(&b.label));

            let serialized1 = serialize_views(&parsed1);
            let mut parsed2 = parse_views(&serialized1)
                .unwrap_or_else(|e| panic!("failed parsing re-serialized {example_name}: {e}"));
            parsed2.sort_by(|a, b| a.label.cmp(&b.label));

            assert_eq!(parsed1, parsed2, "views mismatch for {example_name}");

            let serialized2 = serialize_views(&parsed2);
            assert_eq!(
                serialized1, serialized2,
                "views serialization idempotency failed for {example_name}"
            );
        }
    }

    #[test]
    fn test_flat_serialization_multi_system_reuse() {
        // A component reused across two systems must serialize as standalone
        // top-level definitions with `source` references, never inlined.
        let hcl = r#"
component "engine" {
    description = "shared engine"
    leaf = true
}
system "airborne" {
    instance "plane" {
        source = "engine"
    }
}
system "hangar" {
    instance "plane" {
        source = "engine"
    }
}
"#;
        let res1 = compile(&[Source {
            filename: "system.hcl".to_string(),
            content: hcl.to_string(),
        }]);
        assert!(
            res1.diagnostics.iter().all(|d| !d.is_error()),
            "errors: {:?}",
            res1.diagnostics
        );
        let model1 = res1.model.expect("should resolve");
        let serialized = serialize_model(&model1);

        // The shared definition is emitted once under its own label, not the
        // instance paths.
        assert!(
            serialized.contains("component \"engine\" {"),
            "{serialized}"
        );
        assert!(
            !serialized.contains("component \"airborne/plane\" {"),
            "definition wrongly keyed by instance path:\n{serialized}"
        );
        // Systems reference their children via instance blocks pointing at the
        // shared definition.
        assert!(
            serialized.contains("instance \"plane\" { source = \"engine\" }"),
            "{serialized}"
        );

        // Round-trip: recompiling the flat output yields the same systems.
        let res2 = compile(&[Source {
            filename: "system.hcl".to_string(),
            content: serialized,
        }]);
        assert!(
            res2.diagnostics.iter().all(|d| !d.is_error()),
            "recompile errors: {:?}",
            res2.diagnostics
        );
        // No orphan top-level components: every emitted definition is
        // referenced by a source somewhere.
        assert!(
            res2.diagnostics.iter().all(|d| d.code.code != "W012"),
            "unexpected W012: {:?}",
            res2.diagnostics
        );
        let model2 = res2.model.expect("should re-resolve");
        assert_eq!(model2.systems.len(), 2);
        assert_eq!(model2.systems[0].components.len(), 1);
        assert_eq!(model2.systems[1].components.len(), 1);
    }

    #[test]
    fn test_definition_label_preserved_across_instantiation() {
        // A component defined once and instantiated under a system must keep
        // its *definition* label (`satellite`), not be renamed to the instance
        // path (`main/satellite`).
        let hcl = r#"
component "satellite" {
    description = "a satellite"
    leaf = true
}
system "main" {
    instance "satellite" {
        source = "satellite"
    }
}
"#;
        let res1 = compile(&[Source {
            filename: "system.hcl".to_string(),
            content: hcl.to_string(),
        }]);
        assert!(
            res1.diagnostics.iter().all(|d| !d.is_error()),
            "errors: {:?}",
            res1.diagnostics
        );
        let serialized = serialize_model(&res1.model.expect("should resolve"));

        // The definition must be emitted under its own label, not the instance
        // path. The instance under `main` must reference it via source.
        assert!(
            serialized.contains("component \"satellite\" {"),
            "definition renamed to instance path:\n{serialized}"
        );
        assert!(
            serialized.contains("instance \"satellite\" { source = \"satellite\" }"),
            "instance should source the definition:\n{serialized}"
        );
        // The definition must not be keyed by the instantiation path.
        assert!(
            !serialized.contains("component \"main/satellite\" {"),
            "definition wrongly keyed by instance path:\n{serialized}"
        );

        // Round-trip must be stable: idempotent serialization keeps the
        // definition label.
        let res2 = compile(&[Source {
            filename: "system.hcl".to_string(),
            content: serialized.clone(),
        }]);
        assert!(
            res2.diagnostics.iter().all(|d| !d.is_error()),
            "recompile errors: {:?}",
            res2.diagnostics
        );
        let serialized2 = serialize_model(&res2.model.expect("should re-resolve"));
        assert_eq!(serialized, serialized2, "serialization must be idempotent");
    }

    #[test]
    fn test_flat_serialization_redundant_siblings() {
        // Redundant avionics: two instances of the same definition under one
        // parent must each serialize as their own standalone definition keyed
        // by path, and round-trip without inlining.
        let hcl = r#"
component "avionics" {
    description = "shared avionics"
    leaf = true
}
system "plane" {
    instance "left-avionics" {
        source = "avionics"
    }
    instance "right-avionics" {
        source = "avionics"
    }
}
"#;
        let res1 = compile(&[Source {
            filename: "system.hcl".to_string(),
            content: hcl.to_string(),
        }]);
        assert!(
            res1.diagnostics.iter().all(|d| !d.is_error()),
            "errors: {:?}",
            res1.diagnostics
        );
        let model1 = res1.model.expect("should resolve");
        let serialized = serialize_model(&model1);

        // The shared definition is emitted once under its own label, and both
        // instances reference it via source.
        assert!(
            serialized.contains("component \"avionics\" {"),
            "{serialized}"
        );
        assert!(
            !serialized.contains("component \"plane/left-avionics\" {"),
            "definition wrongly keyed by instance path:\n{serialized}"
        );
        assert!(
            serialized.contains("instance \"left-avionics\" { source = \"avionics\" }"),
            "left instance should source the shared definition:\n{serialized}"
        );
        assert!(
            serialized.contains("instance \"right-avionics\" { source = \"avionics\" }"),
            "right instance should source the shared definition:\n{serialized}"
        );

        let res2 = compile(&[Source {
            filename: "system.hcl".to_string(),
            content: serialized,
        }]);
        assert!(
            res2.diagnostics.iter().all(|d| !d.is_error()),
            "recompile errors: {:?}",
            res2.diagnostics
        );
        let model2 = res2.model.expect("should re-resolve");
        assert_eq!(model2.systems[0].components.len(), 2);
    }

    #[test]
    fn test_connection_from_child_to_sibling_and_sibling_child() {
        // Regression: a connection from a child component (radio inside
        // satellite) to a sibling top-level component (ground-station), plus a
        // connection from radio to obc (both children of satellite), must
        // round-trip without E002 (undefined component).
        let hcl = r#"
component "radio" {
    leaf = true
}
component "obc" {
    leaf = true
}
component "ground-station" {
    leaf = true
}
component "satellite" {
    instance "radio" { source = "radio" }
    instance "obc" { source = "obc" }
}
system "main" {
    instance "satellite" { source = "satellite" }
    instance "ground-station" { source = "ground-station" }

    connection "radio-ground-station" {
        from = "satellite/radio"
        to   = "ground-station"
    }
    connection "radio-obc" {
        from = "satellite/radio"
        to   = "satellite/obc"
    }
}
"#;
        let res1 = compile(&[Source {
            filename: "system.hcl".to_string(),
            content: hcl.to_string(),
        }]);
        assert!(
            res1.diagnostics.iter().all(|d| !d.is_error()),
            "initial errors: {:?}",
            res1.diagnostics
        );
        let serialized = serialize_model(&res1.model.expect("should resolve"));

        let res2 = compile(&[Source {
            filename: "system.hcl".to_string(),
            content: serialized.clone(),
        }]);
        assert!(
            res2.diagnostics.iter().all(|d| !d.is_error()),
            "recompile errors: {:?}\nserialized:\n{serialized}",
            res2.diagnostics
        );
    }

    #[test]
    fn serialize_resolved_views_dedups_duplicate_labels() {
        // A project may define the same view in views.hcl and in a
        // diagrams/*.hcl file; parsing merges both, so the resolved view list
        // contains duplicates. The serializer must emit each view once.
        let hcl = r#"project {
  name = "dup"
}
system "s" {
  description = "d"
}
view "main" {
  system = "s"
}
"#;
        let res = crate::compile(&[Source {
            filename: "system.hcl".to_string(),
            content: hcl.to_string(),
        }]);
        let model = res.model.expect("should resolve");
        // Simulate the duplicate: a second view with the same label.
        let mut views = model.views.clone();
        let dup = views[0].clone();
        views.push(dup);
        let out = serialize_resolved_views(&views, &model);
        assert_eq!(
            out.matches("view \"main\"").count(),
            1,
            "duplicate view must be emitted once: {out}"
        );
    }

    #[test]
    fn annotations_round_trip_through_views_hcl() {
        let hcl = r#"view "overview" {
  system = "s"
  annotation {
    x    = 12.5
    y    = -3
    text = "First line\nSecond line"
  }
  annotation {
    x    = 0
    y    = 100
    text = "Standalone note"
  }
}
"#;
        let views = parse_views(hcl).expect("parse annotations");
        assert_eq!(views.len(), 1);
        let view = &views[0];
        assert_eq!(view.annotations.len(), 2, "two annotations expected");
        assert!(
            (view.annotations[0].x - 12.5).abs() < 1e-9,
            "x={}",
            view.annotations[0].x
        );
        assert!(
            (view.annotations[0].y + 3.0).abs() < 1e-9,
            "y={}",
            view.annotations[0].y
        );
        assert_eq!(view.annotations[0].text, "First line\nSecond line");
        assert_eq!(view.annotations[1].text, "Standalone note");

        // Serialize back and re-parse: idempotent round trip, sorted by text.
        let serialized = serialize_views(&views);
        let reparsed = parse_views(&serialized).expect("reparse");
        assert_eq!(reparsed, views, "annotation round trip must be stable");
        assert!(serialized.contains("annotation {"));
        assert!(serialized.contains("text = \"First line\\nSecond line\""));
    }
}
