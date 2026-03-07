//! `rhizz-mermaid` — Mermaid flowchart rendering for rhizz models.
//!
//! The main entry point is [`render_view`], which converts a resolved
//! [`rhizz_core::View`] (with its filter predicates) into a Mermaid
//! `flowchart` string ready to be written to a `.mmd` file or passed to a
//! renderer.
//!
//! In addition, [`render_view_svg`] and (with the `png` feature)
//! [`render_view_png`] let callers obtain rendered image bytes directly via
//! [`mermaid_rs_renderer`].
//!
//! This crate has **no** I/O dependency in production code.

#![deny(clippy::all)]

use rhizz_core::{ComponentId, ComponentParent, ConnectionId, Model, PortRole, View, ViewFilter};
use std::collections::HashSet;
use std::fmt::Write as _;
use tracing::instrument;

// ── Public API ────────────────────────────────────────────────────────────────

/// Render a single [`View`] to a Mermaid flowchart string.
///
/// Applies the view's filter predicates (tag inclusion/exclusion, `max_level`,
/// component whitelist, `show_messages`) and emits a complete `flowchart`
/// block ready to be written to a `.mmd` file or passed to a renderer.
#[instrument(skip(model, view), fields(view = %view.label))]
pub fn render_view(model: &Model, view: &View) -> String {
    let system = &model.systems[view.system.0];
    let filter = &view.filter;

    // ── Pre-compute the visible component set ──────────────────────────────────
    //
    // Pass 1: components that directly satisfy all predicates.
    let mut visible: HashSet<ComponentId> = (0..model.components.len())
        .map(ComponentId)
        .filter(|&cid| is_component_visible(cid, model, filter))
        .collect();

    // Pass 2 (tag-filter views only): connections that match the tag filter
    // implicitly pull in their endpoints even if those components don't carry
    // the matching tag themselves.
    if !filter.include_tags.is_empty() {
        let all_conns = collect_all_connection_ids(system, model);
        for cid in all_conns {
            let conn = &model.connections[cid.0];
            if !conn.tags.iter().any(|t| filter.include_tags.contains(t)) {
                continue;
            }
            if filter.max_level.is_some_and(|max| conn.level > max) {
                continue;
            }
            for &comp_id in &[conn.from.component, conn.to.component] {
                if is_component_eligible_as_endpoint(comp_id, model, filter) {
                    visible.insert(comp_id);
                }
            }
        }
    }

    // ── Mermaid direction ──────────────────────────────────────────────────────
    // Map Graphviz rankdir to Mermaid flowchart direction.
    let direction = match view.output.rankdir.as_str() {
        "LR" => "LR",
        "RL" => "RL",
        "BT" => "BT",
        _ => "TD",
    };

    let mut buf = String::new();
    let _ = writeln!(buf, "flowchart {direction}");

    // ── Subgraph / node declarations ───────────────────────────────────────────
    for &cid in &system.components {
        if visible.contains(&cid) {
            render_component(cid, model, &visible, filter, 1, &mut buf);
        }
    }

    // ── Edges ──────────────────────────────────────────────────────────────────
    render_connections(&system.connections, model, &visible, filter, 1, &mut buf);

    buf
}

/// Render a single [`View`] to an SVG string via [`mermaid_rs_renderer`].
///
/// Applies the same filter logic as [`render_view`], generates Mermaid source,
/// and then renders it to SVG bytes using the default renderer options.
///
/// # Errors
///
/// Returns an error if the generated Mermaid source cannot be rendered.
#[instrument(skip(model, view), fields(view = %view.label))]
pub fn render_view_svg(model: &Model, view: &View) -> anyhow::Result<String> {
    let mmd = render_view(model, view);
    mermaid_rs_renderer::render(&mmd)
}

/// Render a single [`View`] to PNG bytes via [`mermaid_rs_renderer`].
///
/// Applies the same filter logic as [`render_view`], generates Mermaid source,
/// renders it to SVG, and then converts the SVG to PNG using `resvg`.
///
/// # Errors
///
/// Returns an error if the generated Mermaid source cannot be rendered or the
/// SVG cannot be converted to PNG.
#[cfg(feature = "png")]
#[instrument(skip(model, view), fields(view = %view.label))]
pub fn render_view_png(model: &Model, view: &View) -> anyhow::Result<Vec<u8>> {
    use mermaid_rs_renderer::RenderOptions;

    let mmd = render_view(model, view);
    // Use the classic Mermaid theme to avoid a font-family XML-escaping bug in
    // the modern theme (which places `"Segoe UI"` with literal double-quotes
    // into SVG attributes, making the SVG unparseable by usvg).
    let options = RenderOptions::mermaid_default();
    let svg = mermaid_rs_renderer::render_with_options(&mmd, options)?;

    // Rasterise the SVG to PNG bytes using resvg/usvg.
    // Load system fonts first so SVG text is rendered correctly.
    let mut opt = usvg::Options::default();
    opt.fontdb_mut().load_system_fonts();

    let tree = usvg::Tree::from_str(&svg, &opt)?;
    let size = tree.size().to_int_size();
    let mut pixmap = resvg::tiny_skia::Pixmap::new(size.width(), size.height())
        .ok_or_else(|| anyhow::anyhow!("failed to allocate pixmap for PNG rendering"))?;
    resvg::render(
        &tree,
        resvg::tiny_skia::Transform::default(),
        &mut pixmap.as_mut(),
    );
    pixmap.encode_png().map_err(|e| anyhow::anyhow!("{e}"))
}

// ── Visibility predicates ─────────────────────────────────────────────────────

fn is_component_visible(cid: ComponentId, model: &Model, filter: &ViewFilter) -> bool {
    let comp = &model.components[cid.0];
    if !filter.include_tags.is_empty() && !comp.tags.iter().any(|t| filter.include_tags.contains(t))
    {
        return false;
    }
    if comp.tags.iter().any(|t| filter.exclude_tags.contains(t)) {
        return false;
    }
    if filter.max_level.is_some_and(|max| comp.level > max) {
        return false;
    }
    if !filter.components.is_empty() && !is_in_whitelist(cid, model, &filter.components) {
        return false;
    }
    true
}

fn is_in_whitelist(cid: ComponentId, model: &Model, whitelist: &[String]) -> bool {
    let comp = &model.components[cid.0];
    if whitelist.contains(&comp.label) {
        return true;
    }
    match comp.parent {
        ComponentParent::System(_) => false,
        ComponentParent::Component(pid) => is_in_whitelist(pid, model, whitelist),
    }
}

fn is_component_eligible_as_endpoint(cid: ComponentId, model: &Model, filter: &ViewFilter) -> bool {
    let comp = &model.components[cid.0];
    if comp.tags.iter().any(|t| filter.exclude_tags.contains(t)) {
        return false;
    }
    if filter.max_level.is_some_and(|max| comp.level > max) {
        return false;
    }
    if !filter.components.is_empty() && !is_in_whitelist(cid, model, &filter.components) {
        return false;
    }
    true
}

fn collect_all_connection_ids(system: &rhizz_core::System, model: &Model) -> Vec<ConnectionId> {
    let mut result: Vec<ConnectionId> = Vec::new();
    result.extend_from_slice(&system.connections);
    for &cid in &system.components {
        collect_component_connection_ids(cid, model, &mut result);
    }
    result
}

fn collect_component_connection_ids(cid: ComponentId, model: &Model, out: &mut Vec<ConnectionId>) {
    let comp = &model.components[cid.0];
    out.extend_from_slice(&comp.connections);
    for &child in &comp.children {
        collect_component_connection_ids(child, model, out);
    }
}

fn has_visible_children(cid: ComponentId, model: &Model, visible: &HashSet<ComponentId>) -> bool {
    model.components[cid.0]
        .children
        .iter()
        .any(|c| visible.contains(c))
}

// ── Mermaid identifier helpers ────────────────────────────────────────────────

/// Safe Mermaid node identifier for a component (arena-index–based).
fn node_id(cid: ComponentId) -> String {
    format!("comp{}", cid.0)
}

/// Quote a label for Mermaid (wraps in double quotes, escapes internal quotes).
fn mmd_label(s: &str) -> String {
    format!("\"{}\"", s.replace('"', "&quot;"))
}

// ── Component rendering ───────────────────────────────────────────────────────

fn render_component(
    cid: ComponentId,
    model: &Model,
    visible: &HashSet<ComponentId>,
    filter: &ViewFilter,
    indent: usize,
    buf: &mut String,
) {
    let comp = &model.components[cid.0];
    let prefix = "    ".repeat(indent);
    let nid = node_id(cid);

    if has_visible_children(cid, model, visible) {
        // Render as a Mermaid subgraph.
        let _ = writeln!(
            buf,
            "{}subgraph {} [{}]",
            prefix,
            nid,
            mmd_label(&comp.label)
        );
        for &child in &comp.children {
            if visible.contains(&child) {
                render_component(child, model, visible, filter, indent + 1, buf);
            }
        }
        // Connections declared inside this component's scope.
        render_connections(&comp.connections, model, visible, filter, indent + 1, buf);
        let _ = writeln!(buf, "{}end", prefix);
    } else {
        // Render as a plain rectangular node.
        let _ = writeln!(buf, "{}{}[{}]", prefix, nid, mmd_label(&comp.label));
    }
}

// ── Connection rendering ──────────────────────────────────────────────────────

/// Append the label of every message carried by `port_id` to `label`.
fn append_port_messages(port_id: rhizz_core::PortId, model: &Model, label: &mut String) {
    for &mid in &model.ports[port_id.0].messages {
        label.push('\n');
        label.push_str(&model.messages[mid.0].label);
    }
}

fn render_connections(
    conn_ids: &[ConnectionId],
    model: &Model,
    visible: &HashSet<ComponentId>,
    filter: &ViewFilter,
    indent: usize,
    buf: &mut String,
) {
    for &cid in conn_ids {
        render_connection_edge(cid, model, visible, filter, indent, buf);
    }
}

fn render_connection_edge(
    conn_id: ConnectionId,
    model: &Model,
    visible: &HashSet<ComponentId>,
    filter: &ViewFilter,
    indent: usize,
    buf: &mut String,
) {
    let conn = &model.connections[conn_id.0];
    let from_cid = conn.from.component;
    let to_cid = conn.to.component;

    // Both endpoints must be visible.
    if !visible.contains(&from_cid) || !visible.contains(&to_cid) {
        return;
    }

    // Tag inclusion.
    if !filter.include_tags.is_empty() && !conn.tags.iter().any(|t| filter.include_tags.contains(t))
    {
        return;
    }
    // Tag exclusion.
    if conn.tags.iter().any(|t| filter.exclude_tags.contains(t)) {
        return;
    }
    // Level cap.
    if filter.max_level.is_some_and(|max| conn.level > max) {
        return;
    }

    // Build the edge label (connection name + optional port messages).
    let mut label = conn.label.clone();
    if filter.show_messages {
        if let Some(pid) = conn.from.port {
            append_port_messages(pid, model, &mut label);
        }
        if let Some(pid) = conn.to.port {
            append_port_messages(pid, model, &mut label);
        }
    }
    let edge_label = mmd_label(&label);

    let prefix = "    ".repeat(indent);

    // Determine arrow style and endpoint order from port roles.
    let from_role = conn.from.port.map(|pid| model.ports[pid.0].role);
    let to_role = conn.to.port.map(|pid| model.ports[pid.0].role);

    match (from_role, to_role) {
        (Some(PortRole::Provider), Some(PortRole::Consumer)) => {
            let _ = writeln!(
                buf,
                "{}{} -->|{}| {}",
                prefix,
                node_id(from_cid),
                edge_label,
                node_id(to_cid)
            );
        }
        (Some(PortRole::Consumer), Some(PortRole::Provider)) => {
            // Swap so the arrow always points from Provider to Consumer.
            let _ = writeln!(
                buf,
                "{}{} -->|{}| {}",
                prefix,
                node_id(to_cid),
                edge_label,
                node_id(from_cid)
            );
        }
        (Some(PortRole::Peer), Some(PortRole::Peer)) => {
            let _ = writeln!(
                buf,
                "{}{} <-->|{}| {}",
                prefix,
                node_id(from_cid),
                edge_label,
                node_id(to_cid)
            );
        }
        // Either side has no port (untyped), or roles are ambiguous
        // (Provider↔Provider, Consumer↔Consumer, Peer↔Provider, Peer↔Consumer, etc.)
        _ => {
            let _ = writeln!(
                buf,
                "{}{} -.->|{}| {}",
                prefix,
                node_id(from_cid),
                edge_label,
                node_id(to_cid)
            );
        }
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use rhizz_core::{Source, compile};
    use std::path::PathBuf;
    use walkdir::WalkDir;

    fn example_dir(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../examples")
            .join(name)
    }

    fn load(name: &str) -> Model {
        let dir = example_dir(name);
        let mut hcl_files: Vec<PathBuf> = WalkDir::new(&dir)
            .max_depth(1)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.file_type().is_file() && e.path().extension().is_some_and(|ext| ext == "hcl")
            })
            .map(|e| e.path().to_path_buf())
            .collect();
        hcl_files.sort();
        assert!(
            !hcl_files.is_empty(),
            "no .hcl files found in {}",
            dir.display()
        );

        let sources: Vec<Source> = hcl_files
            .iter()
            .map(|path| Source {
                filename: path.to_string_lossy().into_owned(),
                content: std::fs::read_to_string(path)
                    .unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display())),
            })
            .collect();

        let result = compile(&sources);
        assert!(
            result.diagnostics.iter().all(|d| !d.is_error()),
            "{name} compile errors: {:?}",
            result.diagnostics
        );
        result
            .model
            .unwrap_or_else(|| panic!("{name} model is None after compile"))
    }

    // ── drone ──────────────────────────────────────────────────────────────────

    #[test]
    fn drone_overview_contains_top_level_components() {
        let model = load("drone");
        let view = model
            .views
            .iter()
            .find(|v| v.label == "drone-overview")
            .expect("drone-overview view");
        let mmd = render_view(&model, view);

        assert!(
            mmd.contains("flight-controller"),
            "missing flight-controller"
        );
        assert!(mmd.contains("esc"), "missing esc");
        assert!(mmd.contains("gps"), "missing gps");
        assert!(mmd.contains("battery"), "missing battery");
        assert!(mmd.contains("radio-rx"), "missing radio-rx");
        assert!(mmd.contains("vtx"), "missing vtx");
        assert!(mmd.contains("camera"), "missing camera");

        // At max_level=1 the children of flight-controller are filtered out.
        assert!(
            !mmd.contains("\"mcu\""),
            "mcu should be hidden at max_level=1"
        );
        assert!(
            !mmd.contains("\"imu\""),
            "imu should be hidden at max_level=1"
        );
        assert!(
            !mmd.contains("\"barometer\""),
            "barometer should be hidden at max_level=1"
        );

        // System-scope interfaces should appear.
        assert!(mmd.contains("motor-control"), "missing motor-control edge");
        assert!(mmd.contains("gps-serial"), "missing gps-serial edge");
    }

    #[test]
    fn drone_overview_is_valid_flowchart() {
        let model = load("drone");
        let view = model
            .views
            .iter()
            .find(|v| v.label == "drone-overview")
            .expect("drone-overview view");
        let mmd = render_view(&model, view);

        assert!(mmd.starts_with("flowchart"), "should start with flowchart");
        assert!(mmd.contains("TD"), "should have TD direction");
        assert!(mmd.contains("-->"), "should have directed edges");
    }

    #[test]
    fn drone_fc_internals_shows_subgraph() {
        let model = load("drone");
        let view = model
            .views
            .iter()
            .find(|v| v.label == "fc-internals")
            .expect("fc-internals view");
        let mmd = render_view(&model, view);

        assert!(mmd.contains("subgraph"), "should have a subgraph");
        assert!(mmd.contains("flight-controller"), "subgraph label");

        assert!(mmd.contains("mcu"), "mcu should be visible");
        assert!(mmd.contains("imu"), "imu should be visible");
        assert!(mmd.contains("barometer"), "barometer should be visible");

        // Top-level siblings excluded by whitelist.
        assert!(
            !mmd.contains("\"esc\""),
            "esc should be hidden by whitelist"
        );
        assert!(
            !mmd.contains("\"gps\""),
            "gps should be hidden by whitelist"
        );

        assert!(mmd.contains("spi-imu"), "spi-imu edge missing");
        assert!(mmd.contains("i2c-baro"), "i2c-baro edge missing");
    }

    #[test]
    fn drone_power_paths_tag_filter() {
        let model = load("drone");
        let view = model
            .views
            .iter()
            .find(|v| v.label == "power-paths")
            .expect("power-paths view");
        let mmd = render_view(&model, view);

        assert!(mmd.contains("battery"), "battery should be visible");
        assert!(mmd.contains("esc"), "esc should be visible");
        assert!(mmd.contains("power-main"), "power-main edge missing");
        assert!(mmd.contains("LR"), "should have LR direction");

        assert!(!mmd.contains("\"gps\""), "gps should be hidden");
        assert!(!mmd.contains("\"camera\""), "camera should be hidden");
    }

    #[test]
    fn drone_ground_station_view() {
        let model = load("drone");
        let view = model
            .views
            .iter()
            .find(|v| v.label == "ground-station")
            .expect("ground-station view");
        let mmd = render_view(&model, view);

        assert!(mmd.contains("transmitter"), "transmitter missing");
        assert!(mmd.contains("goggles"), "goggles missing");
        assert!(
            mmd.contains("ground-station-pc"),
            "ground-station-pc missing"
        );
        assert!(mmd.contains("rf-control"), "rf-control edge missing");
        assert!(
            mmd.contains("video-downlink"),
            "video-downlink edge missing"
        );
    }

    // ── social-media ───────────────────────────────────────────────────────────

    #[test]
    fn social_media_full_platform_view() {
        let model = load("social-media");
        let view = model
            .views
            .iter()
            .find(|v| v.label == "full-platform")
            .expect("full-platform view");
        let mmd = render_view(&model, view);

        assert!(mmd.contains("mobile-app"), "mobile-app missing");
        assert!(mmd.contains("api-gateway"), "api-gateway missing");
        assert!(mmd.contains("backend"), "backend missing");
        assert!(mmd.contains("cdn"), "cdn missing");
        assert!(mmd.contains("client-api"), "client-api edge missing");
        assert!(mmd.contains("TD"), "should have TD direction");
    }

    #[test]
    fn social_media_backend_services_subgraph() {
        let model = load("social-media");
        let view = model
            .views
            .iter()
            .find(|v| v.label == "backend-services")
            .expect("backend-services view");
        let mmd = render_view(&model, view);

        assert!(mmd.contains("subgraph"), "should have subgraph for backend");
        assert!(mmd.contains("backend"), "backend label missing");
        assert!(mmd.contains("user-service"), "user-service missing");
        assert!(mmd.contains("feed-service"), "feed-service missing");
        assert!(mmd.contains("recommendation-engine"), "rec-engine missing");
        assert!(mmd.contains("rec-to-feed"), "rec-to-feed edge missing");
    }

    #[test]
    fn social_media_video_pipeline_tag_filter() {
        let model = load("social-media");
        let view = model
            .views
            .iter()
            .find(|v| v.label == "video-pipeline")
            .expect("video-pipeline view");
        let mmd = render_view(&model, view);

        assert!(mmd.contains("cdn"), "cdn (video-tagged) missing");
        assert!(mmd.contains("object-store"), "object-store missing");
        assert!(
            mmd.contains("backend-to-storage"),
            "backend-to-storage missing"
        );
        assert!(mmd.contains("cdn-origin"), "cdn-origin edge missing");
    }

    // ── software-house ─────────────────────────────────────────────────────────

    #[test]
    fn software_house_org_chart_view() {
        let model = load("software-house");
        let view = model
            .views
            .iter()
            .find(|v| v.label == "org-chart")
            .expect("org-chart view");
        let mmd = render_view(&model, view);

        assert!(mmd.contains("engineering"), "engineering missing");
        assert!(mmd.contains("product"), "product missing");
        assert!(mmd.contains("qa"), "qa missing");
        assert!(mmd.contains("sales"), "sales missing");
        assert!(mmd.contains("operations"), "operations missing");
        assert!(
            mmd.contains("sprint-planning"),
            "sprint-planning edge missing"
        );
        assert!(mmd.contains("bug-reports"), "bug-reports edge missing");
    }

    #[test]
    fn software_house_engineering_teams_subgraph() {
        let model = load("software-house");
        let view = model
            .views
            .iter()
            .find(|v| v.label == "engineering-teams")
            .expect("engineering-teams view");
        let mmd = render_view(&model, view);

        assert!(mmd.contains("subgraph"), "should have a subgraph");
        assert!(mmd.contains("engineering"), "engineering subgraph label");
        assert!(mmd.contains("frontend-team"), "frontend-team missing");
        assert!(mmd.contains("backend-team"), "backend-team missing");
        assert!(mmd.contains("platform-team"), "platform-team missing");
        assert!(mmd.contains("code-review"), "code-review edge missing");
    }

    #[test]
    fn software_house_processes_show_messages() {
        let model = load("software-house");
        let view = model
            .views
            .iter()
            .find(|v| v.label == "processes-only")
            .expect("processes-only view");
        let mmd = render_view(&model, view);

        assert!(
            mmd.contains("sprint-planning"),
            "sprint-planning edge missing"
        );
        assert!(mmd.contains("bug-reports"), "bug-reports edge missing");
        assert!(mmd.contains("release-sign-off"), "release-sign-off missing");

        assert!(
            mmd.contains("engineering"),
            "engineering (endpoint) missing"
        );
        assert!(mmd.contains("product"), "product (endpoint) missing");
        assert!(mmd.contains("qa"), "qa (endpoint) missing");

        // show_messages=true: message names should appear in edge labels.
        assert!(
            mmd.contains("sprint-backlog"),
            "sprint-backlog message missing"
        );
        assert!(mmd.contains("bug-ticket"), "bug-ticket message missing");
        assert!(
            mmd.contains("review-request"),
            "review-request message missing"
        );
    }

    // ── SVG rendering ──────────────────────────────────────────────────────────

    #[test]
    fn drone_overview_renders_to_svg() {
        let model = load("drone");
        let view = model
            .views
            .iter()
            .find(|v| v.label == "drone-overview")
            .expect("drone-overview view");
        let svg = render_view_svg(&model, view).expect("SVG rendering failed");
        assert!(svg.contains("<svg"), "SVG output should contain <svg tag");
        assert!(svg.contains("</svg>"), "SVG output should be closed");
    }

    // ── PNG rendering ──────────────────────────────────────────────────────────

    #[cfg(feature = "png")]
    #[test]
    fn drone_overview_renders_to_png() {
        let model = load("drone");
        let view = model
            .views
            .iter()
            .find(|v| v.label == "drone-overview")
            .expect("drone-overview view");
        let png = render_view_png(&model, view).expect("PNG rendering failed");
        // PNG magic bytes: \x89PNG\r\n\x1a\n
        assert!(
            png.starts_with(&[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
            "output should be a valid PNG"
        );
    }
}
