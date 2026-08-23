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

use crate::model::{
    Component, Connection, Field, Message, Model, NodeLayout, Port, PortRole, Project, Protocol,
    System, View, ViewDefinition, ViewFilterDefinition,
};
use anyhow::Context;
use serde::Deserialize;

// ── Model Serialization ───────────────────────────────────────────────────────

/// Serializes a resolved [`Model`] into a canonical, formatted HCL string.
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

    // 3. System blocks (sorted by label for determinism)
    let mut systems: Vec<&System> = model.systems.iter().collect();
    systems.sort_by(|a, b| a.label.cmp(&b.label));

    for (i, sys) in systems.iter().enumerate() {
        if !out.is_empty() {
            out.push('\n');
        }
        serialize_system(&mut out, sys, model);
        if i + 1 < systems.len() {
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
        out.push_str(&format!("  name    = {}\n", escape_string(&project.name)));
    }
    if !project.version.is_empty() && project.version != "0.0.0" {
        out.push_str(&format!(
            "  version = {}\n",
            escape_string(&project.version)
        ));
    }
    if !project.authors.is_empty() {
        out.push_str(&format!(
            "  authors = {}\n",
            format_string_list(&project.authors)
        ));
    }
    out.push_str("}\n");
}

fn serialize_system(out: &mut String, sys: &System, model: &Model) {
    out.push_str(&format!("system {} {{\n", escape_string(&sys.label)));

    let indent = "  ";

    if !sys.description.is_empty() {
        out.push_str(&format!(
            "{indent}description = {}\n",
            escape_string(&sys.description)
        ));
    }
    if !sys.tags.is_empty() {
        out.push_str(&format!(
            "{indent}tags        = {}\n",
            format_string_list(&sys.tags)
        ));
    }
    if sys.level != 0 {
        out.push_str(&format!("{indent}level       = {}\n", sys.level));
    }

    // Child components (sorted by label)
    let mut child_comps: Vec<&Component> = sys
        .components
        .iter()
        .map(|id| &model.components[id.0])
        .collect();
    child_comps.sort_by(|a, b| a.label.cmp(&b.label));

    for comp in child_comps {
        out.push('\n');
        serialize_component(out, comp, model, 1, sys.level);
    }

    // System-level connections (sorted by label)
    let mut child_conns: Vec<&Connection> = sys
        .connections
        .iter()
        .map(|id| &model.connections[id.0])
        .collect();
    child_conns.sort_by(|a, b| a.label.cmp(&b.label));

    for conn in child_conns {
        out.push('\n');
        serialize_connection(out, conn, model, 1, sys.level);
    }

    out.push_str("}\n");
}

fn serialize_component(
    out: &mut String,
    comp: &Component,
    model: &Model,
    depth: usize,
    parent_level: i32,
) {
    let indent = "  ".repeat(depth);
    out.push_str(&format!(
        "{indent}component {} {{\n",
        escape_string(&comp.label)
    ));

    let inner_indent = "  ".repeat(depth + 1);

    if !comp.description.is_empty() {
        out.push_str(&format!(
            "{inner_indent}description = {}\n",
            escape_string(&comp.description)
        ));
    }
    if !comp.tags.is_empty() {
        out.push_str(&format!(
            "{inner_indent}tags        = {}\n",
            format_string_list(&comp.tags)
        ));
    }
    if comp.level != parent_level + 1 {
        out.push_str(&format!("{inner_indent}level       = {}\n", comp.level));
    }
    if comp.leaf {
        out.push_str(&format!("{inner_indent}leaf        = true\n"));
    }

    // Ports (sorted by label)
    let mut ports: Vec<&Port> = comp.ports.iter().map(|id| &model.ports[id.0]).collect();
    ports.sort_by(|a, b| a.label.cmp(&b.label));

    for port in ports {
        out.push('\n');
        serialize_port(out, port, depth + 1);
    }

    // Child components (sorted by label)
    let mut child_comps: Vec<&Component> = comp
        .children
        .iter()
        .map(|id| &model.components[id.0])
        .collect();
    child_comps.sort_by(|a, b| a.label.cmp(&b.label));

    for child in child_comps {
        out.push('\n');
        serialize_component(out, child, model, depth + 1, comp.level);
    }

    // Internal connections (sorted by label)
    let mut child_conns: Vec<&Connection> = comp
        .connections
        .iter()
        .map(|id| &model.connections[id.0])
        .collect();
    child_conns.sort_by(|a, b| a.label.cmp(&b.label));

    for conn in child_conns {
        out.push('\n');
        serialize_connection(out, conn, model, depth + 1, comp.level);
    }

    out.push_str(&format!("{indent}}}\n"));
}

fn serialize_port(out: &mut String, port: &Port, depth: usize) {
    let indent = "  ".repeat(depth);
    out.push_str(&format!("{indent}port {} {{\n", escape_string(&port.label)));

    let inner_indent = "  ".repeat(depth + 1);

    if !port.description.is_empty() {
        out.push_str(&format!(
            "{inner_indent}description = {}\n",
            escape_string(&port.description)
        ));
    }
    if !port.protocol.is_empty() {
        out.push_str(&format!(
            "{inner_indent}protocol    = {}\n",
            escape_string(&port.protocol)
        ));
    }
    let role_str = match port.role {
        PortRole::Provider => "provider",
        PortRole::Consumer => "consumer",
        PortRole::Peer => "peer",
    };
    out.push_str(&format!(
        "{inner_indent}role        = {}\n",
        escape_string(role_str)
    ));

    if !port.tags.is_empty() {
        out.push_str(&format!(
            "{inner_indent}tags        = {}\n",
            format_string_list(&port.tags)
        ));
    }
    if port.external {
        out.push_str(&format!("{inner_indent}external    = true\n"));
    }
    if !port.required {
        out.push_str(&format!("{inner_indent}required    = false\n"));
    }

    out.push_str(&format!("{indent}}}\n"));
}

fn serialize_protocol(out: &mut String, proto: &Protocol, model: &Model) {
    out.push_str(&format!("protocol {} {{\n", escape_string(&proto.label)));

    if !proto.description.is_empty() {
        out.push_str(&format!(
            "  description = {}\n",
            escape_string(&proto.description)
        ));
    }
    if !proto.tags.is_empty() {
        out.push_str(&format!("  tags        = {}\n", format_string_list(&proto.tags)));
    }
    if !proto.roles.is_empty() {
        let role_strs: Vec<String> = proto
            .roles
            .iter()
            .map(|r| match r {
                PortRole::Provider => "provider".to_string(),
                PortRole::Consumer => "consumer".to_string(),
                PortRole::Peer => "peer".to_string(),
            })
            .collect();
        out.push_str(&format!("  roles       = {}\n", format_string_list(&role_strs)));
    }

    let mut messages: Vec<&Message> = proto
        .messages
        .iter()
        .map(|id| &model.messages[id.0])
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
    out.push_str(&format!(
        "{indent}message {} {{\n",
        escape_string(&msg.label)
    ));

    let inner_indent = "  ".repeat(depth + 1);

    if !msg.description.is_empty() {
        out.push_str(&format!(
            "{inner_indent}description = {}\n",
            escape_string(&msg.description)
        ));
    }
    if !msg.tags.is_empty() {
        out.push_str(&format!(
            "{inner_indent}tags        = {}\n",
            format_string_list(&msg.tags)
        ));
    }
    if msg.level != parent_level {
        out.push_str(&format!("{inner_indent}level       = {}\n", msg.level));
    }

    // Fields (sorted by label)
    let mut fields: Vec<&Field> = msg.fields.iter().map(|id| &model.fields[id.0]).collect();
    fields.sort_by(|a, b| a.label.cmp(&b.label));

    for field in fields {
        out.push('\n');
        serialize_field(out, field, depth + 1);
    }

    out.push_str(&format!("{indent}}}\n"));
}

fn serialize_field(out: &mut String, field: &Field, depth: usize) {
    let indent = "  ".repeat(depth);
    out.push_str(&format!(
        "{indent}field {} {{\n",
        escape_string(&field.label)
    ));

    let inner_indent = "  ".repeat(depth + 1);

    out.push_str(&format!(
        "{inner_indent}type        = {}\n",
        escape_string(&field.field_type)
    ));
    if !field.description.is_empty() {
        out.push_str(&format!(
            "{inner_indent}description = {}\n",
            escape_string(&field.description)
        ));
    }
    if !field.unit.is_empty() {
        out.push_str(&format!(
            "{inner_indent}unit        = {}\n",
            escape_string(&field.unit)
        ));
    }
    if field.required {
        out.push_str(&format!("{inner_indent}required    = true\n"));
    }

    out.push_str(&format!("{indent}}}\n"));
}

fn serialize_connection(
    out: &mut String,
    conn: &Connection,
    model: &Model,
    depth: usize,
    parent_level: i32,
) {
    let indent = "  ".repeat(depth);
    out.push_str(&format!(
        "{indent}connection {} {{\n",
        escape_string(&conn.label)
    ));

    let inner_indent = "  ".repeat(depth + 1);

    if !conn.description.is_empty() {
        out.push_str(&format!(
            "{inner_indent}description  = {}\n",
            escape_string(&conn.description)
        ));
    }
    if !conn.tags.is_empty() {
        out.push_str(&format!(
            "{inner_indent}tags         = {}\n",
            format_string_list(&conn.tags)
        ));
    }
    if conn.level != parent_level + 1 {
        out.push_str(&format!("{inner_indent}level        = {}\n", conn.level));
    }

    let from_comp = &model.components[conn.from.component.0].label;
    let from_str = match conn.from.port {
        Some(pid) => format!("{from_comp}/{}", model.ports[pid.0].label),
        None => from_comp.clone(),
    };
    out.push_str(&format!(
        "{inner_indent}from         = {}\n",
        escape_string(&from_str)
    ));

    let to_comp = &model.components[conn.to.component.0].label;
    let to_str = match conn.to.port {
        Some(pid) => format!("{to_comp}/{}", model.ports[pid.0].label),
        None => to_comp.clone(),
    };
    out.push_str(&format!(
        "{inner_indent}to           = {}\n",
        escape_string(&to_str)
    ));

    if !conn.encapsulates.is_empty() {
        let mut enc_labels: Vec<String> = conn
            .encapsulates
            .iter()
            .map(|id| model.connections[id.0].label.clone())
            .collect();
        enc_labels.sort();
        out.push_str(&format!(
            "{inner_indent}encapsulates = {}\n",
            format_string_list(&enc_labels)
        ));
    }

    out.push_str(&format!("{indent}}}\n"));
}

// ── Views and Layout Serialization ────────────────────────────────────────────

/// Serializes a slice of [`ViewDefinition`]s into canonical HCL formatted for `views.hcl`.
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
pub fn serialize_resolved_views(views: &[View], model: &Model) -> String {
    let view_defs: Vec<ViewDefinition> = views
        .iter()
        .map(|v| ViewDefinition::from_resolved(v, model))
        .collect();
    serialize_views(&view_defs)
}

fn serialize_single_view(out: &mut String, view: &ViewDefinition) {
    out.push_str(&format!("view {} {{\n", escape_string(&view.label)));

    if !view.description.is_empty() {
        out.push_str(&format!(
            "  description = {}\n",
            escape_string(&view.description)
        ));
    }
    if !view.tags.is_empty() {
        out.push_str(&format!(
            "  tags        = {}\n",
            format_string_list(&view.tags)
        ));
    }
    if !view.system.is_empty() {
        out.push_str(&format!(
            "  system      = {}\n",
            escape_string(&view.system)
        ));
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

    out.push_str("}\n");
}

fn should_serialize_filter(filter: &ViewFilterDefinition) -> bool {
    !filter.include_tags.is_empty()
        || !filter.exclude_tags.is_empty()
        || filter.max_level.is_some()
        || !filter.components.is_empty()
        || filter.show_messages.is_some()
}

fn serialize_view_filter(out: &mut String, filter: &ViewFilterDefinition) {
    out.push_str("  filter {\n");
    if !filter.include_tags.is_empty() {
        out.push_str(&format!(
            "    include_tags  = {}\n",
            format_string_list(&filter.include_tags)
        ));
    }
    if !filter.exclude_tags.is_empty() {
        out.push_str(&format!(
            "    exclude_tags  = {}\n",
            format_string_list(&filter.exclude_tags)
        ));
    }
    if let Some(max_level) = filter.max_level {
        out.push_str(&format!("    max_level     = {max_level}\n"));
    }
    if !filter.components.is_empty() {
        out.push_str(&format!(
            "    components    = {}\n",
            format_string_list(&filter.components)
        ));
    }
    if let Some(show_messages) = filter.show_messages {
        out.push_str(&format!("    show_messages = {show_messages}\n"));
    }
    out.push_str("  }\n");
}

fn serialize_node_layout(out: &mut String, node: &NodeLayout) {
    out.push_str(&format!("  node {} {{\n", escape_string(&node.component)));
    out.push_str(&format!("    x          = {}\n", format_number(node.x)));
    out.push_str(&format!("    y          = {}\n", format_number(node.y)));
    if let Some(w) = node.width {
        out.push_str(&format!("    width      = {}\n", format_number(w)));
    }
    if let Some(h) = node.height {
        out.push_str(&format!("    height     = {}\n", format_number(h)));
    }
    if let Some(ref align) = node.text_align {
        out.push_str(&format!("    text_align = {}\n", escape_string(align)));
    }
    out.push_str("  }\n");
}

fn format_number(n: f64) -> String {
    if n.fract() == 0.0 && n.is_finite() {
        format!("{}", n as i64)
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

/// Parses an HCL string representing `views.hcl` into a vector of [`ViewDefinition`]s.
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
            });
        }
    }

    Ok(views)
}

// ── Shared formatting helpers ─────────────────────────────────────────────────

fn escape_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
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
            .filter_map(|entry| entry.ok())
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

system "demo" {
  description = "A demo system"
  tags        = ["demo"]

  component "comp-a" {
    description = "Component A"
    leaf        = true

    port "p1" {
      description = "Port 1"
      protocol    = "proto"
      role        = "provider"

      message "m1" {
        description = "Message 1"

        field "f1" {
          type        = "uint32"
          description = "Field 1"
        }
      }
    }
  }

  component "comp-b" {
    leaf        = true

    port "p2" {
      protocol    = "proto"
      role        = "consumer"
    }
  }

  connection "c1" {
    description  = "Link"
    from         = "comp-a/p1"
    to           = "comp-b/p2"
  }
}
"#;

        let res1 = compile(&[Source {
            filename: "system.hcl".to_string(),
            content: hcl.to_string(),
        }]);
        assert!(res1.diagnostics.iter().all(|d| !d.is_error()));
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
        ] {
            let example_path = examples_dir.join(example_name);
            if !example_path.exists() {
                continue;
            }

            let initial_result = compile_dir(&example_path);
            let model0 = initial_result
                .model
                .unwrap_or_else(|| panic!("failed to compile example {}", example_name));

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
                "idempotency failed for example {}",
                example_name
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
}
