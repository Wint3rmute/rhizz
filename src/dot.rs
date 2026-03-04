//! Graphviz DOT generation.
//!
//! The public entry point is [`crate::dot::render_view`], which converts a resolved
//! [`crate::model::View`] (with its filter predicates) into a Graphviz DOT string ready to
//! be written to a `.dot` file.
// Public API consumed by downstream passes (Task 6).
#![allow(dead_code)]

use crate::model::{ComponentId, ComponentParent, Direction, InterfaceId, Model, View, ViewFilter};
use std::collections::HashSet;
use std::fmt::Write as _;

// ── Public API ────────────────────────────────────────────────────────────────

/// Render a single [`View`] to a Graphviz DOT string.
///
/// Applies the view's filter predicates (tag inclusion/exclusion, `max_level`,
/// component whitelist, `show_messages`) and emits a complete `digraph { … }`
/// block ready to be written to a `.dot` file.
pub fn render_view(model: &Model, view: &View) -> String {
    let system = &model.systems[view.system.0];
    let filter = &view.filter;

    // ── Pre-compute the visible component set ──────────────────────────────────
    //
    // Pass 1: components that directly satisfy all predicates (tag, level, whitelist).
    let mut visible: HashSet<ComponentId> = (0..model.components.len())
        .map(ComponentId)
        .filter(|&cid| is_component_visible(cid, model, filter))
        .collect();

    // Pass 2 (tag-filter views only): when `include_tags` is non-empty, interfaces
    // that match the tag filter implicitly pull in their endpoints even if those
    // components don't carry the matching tag themselves.  This makes filtered
    // views useful — e.g. a "process"-tagged view can show department components
    // that participate in process interfaces without requiring the departments to
    // be tagged "process".  Endpoints are still subject to level and whitelist
    // checks; only the tag-inclusion requirement is relaxed for them.
    if !filter.include_tags.is_empty() {
        let all_ifaces = collect_all_interface_ids(system, model);
        for iid in all_ifaces {
            let iface = &model.interfaces[iid.0];
            // Does this interface match the tag filter?
            if !iface.tags.iter().any(|t| filter.include_tags.contains(t)) {
                continue;
            }
            // Level cap for the interface itself.
            if filter.max_level.is_some_and(|max| iface.level > max) {
                continue;
            }
            // Add endpoints if they satisfy level and whitelist (but not the tag
            // filter — that is what we are relaxing here).
            for &cid in &[iface.from, iface.to] {
                if is_component_eligible_as_endpoint(cid, model, filter) {
                    visible.insert(cid);
                }
            }
        }
    }

    // compound=true is required when at least one component is rendered as a
    // cluster (to allow edges to reference the cluster boundary via lhead/ltail).
    let needs_compound = visible
        .iter()
        .any(|&cid| has_visible_children(cid, model, &visible));

    let mut buf = String::new();

    // ── Graph header ───────────────────────────────────────────────────────────
    let _ = writeln!(buf, "digraph {:?} {{", view.label);
    let _ = writeln!(buf, "    rankdir={};", view.output.rankdir);
    if needs_compound {
        let _ = writeln!(buf, "    compound=true;");
    }
    let _ = writeln!(
        buf,
        "    node [shape=box, style=filled, fillcolor=\"#e8f4f8\"];"
    );
    let _ = writeln!(buf);

    // ── Components ─────────────────────────────────────────────────────────────
    for &cid in &system.components {
        if visible.contains(&cid) {
            render_component(cid, model, &visible, filter, 1, &mut buf);
        }
    }

    // ── System-scope interfaces ────────────────────────────────────────────────
    render_interfaces(&system.interfaces, model, &visible, filter, 1, &mut buf);

    let _ = writeln!(buf, "}}");
    buf
}

// ── Visibility predicates ─────────────────────────────────────────────────────

/// Returns `true` if a component passes all view filter predicates.
fn is_component_visible(cid: ComponentId, model: &Model, filter: &ViewFilter) -> bool {
    let comp = &model.components[cid.0];

    // Tag inclusion: at least one matching tag required (empty list = all pass).
    if !filter.include_tags.is_empty() && !comp.tags.iter().any(|t| filter.include_tags.contains(t))
    {
        return false;
    }

    // Tag exclusion: any matching tag disqualifies.
    if comp.tags.iter().any(|t| filter.exclude_tags.contains(t)) {
        return false;
    }

    // Level cap.
    if filter.max_level.is_some_and(|max| comp.level > max) {
        return false;
    }

    // Component whitelist: include if the component or any component ancestor
    // appears in the whitelist (empty list = all pass).
    if !filter.components.is_empty() && !is_in_whitelist(cid, model, &filter.components) {
        return false;
    }

    true
}

/// Returns `true` if `cid` or any of its component ancestors is named in `whitelist`.
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

/// Returns `true` if a component satisfies level and whitelist predicates but
/// skips the tag-inclusion check.  Used for implicit endpoint inclusion in
/// tag-filtered views (see Pass 2 in [`render_view`]).
fn is_component_eligible_as_endpoint(cid: ComponentId, model: &Model, filter: &ViewFilter) -> bool {
    let comp = &model.components[cid.0];
    // Tag exclusion still applies.
    if comp.tags.iter().any(|t| filter.exclude_tags.contains(t)) {
        return false;
    }
    // Level cap.
    if filter.max_level.is_some_and(|max| comp.level > max) {
        return false;
    }
    // Whitelist.
    if !filter.components.is_empty() && !is_in_whitelist(cid, model, &filter.components) {
        return false;
    }
    true
}

/// Collect every [`InterfaceId`] that belongs to `system` or to any component
/// (recursively) inside it.  Used by the Pass-2 endpoint-inclusion logic.
fn collect_all_interface_ids(system: &crate::model::System, model: &Model) -> Vec<InterfaceId> {
    let mut result: Vec<InterfaceId> = Vec::new();
    result.extend_from_slice(&system.interfaces);
    for &cid in &system.components {
        collect_component_interface_ids(cid, model, &mut result);
    }
    result
}

/// Recursively append interface IDs owned by `cid` and all its descendants.
fn collect_component_interface_ids(cid: ComponentId, model: &Model, out: &mut Vec<InterfaceId>) {
    let comp = &model.components[cid.0];
    out.extend_from_slice(&comp.interfaces);
    for &child in &comp.children {
        collect_component_interface_ids(child, model, out);
    }
}

/// Returns `true` if `cid` has at least one visible child in `visible`.
fn has_visible_children(cid: ComponentId, model: &Model, visible: &HashSet<ComponentId>) -> bool {
    model.components[cid.0]
        .children
        .iter()
        .any(|c| visible.contains(c))
}

// ── DOT identifier helpers ────────────────────────────────────────────────────

/// Unique DOT node identifier for a component (arena-index–based for safety).
fn node_id(cid: ComponentId) -> String {
    format!("comp_{}", cid.0)
}

/// Unique DOT cluster identifier for a component rendered as a subgraph.
fn cluster_id(cid: ComponentId) -> String {
    format!("cluster_comp_{}", cid.0)
}

// ── Component rendering ───────────────────────────────────────────────────────

/// Render a component and its visible subtree.
///
/// * Components with at least one visible child → `subgraph cluster_*`
///   containing an invisible proxy node (edge anchor) plus all visible
///   children and their internal interfaces.
/// * All other components → plain `[shape=box]` node.
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
        // ── Cluster (non-leaf with ≥1 visible child) ──────────────────────────
        let _ = writeln!(buf, "{}subgraph {} {{", prefix, cluster_id(cid));
        let _ = writeln!(buf, "{}    label={:?};", prefix, comp.label);
        let _ = writeln!(buf, "{}    style=dashed;", prefix);
        // Invisible proxy node: gives edges a concrete anchor inside the cluster.
        let _ = writeln!(
            buf,
            "{}    {} [label=\"\", style=invis, width=0, height=0];",
            prefix, nid
        );

        for &child in &comp.children {
            if visible.contains(&child) {
                render_component(child, model, visible, filter, indent + 1, buf);
            }
        }

        // Interfaces declared inside this component's scope (between children).
        render_interfaces(&comp.interfaces, model, visible, filter, indent + 1, buf);

        let _ = writeln!(buf, "{}}}", prefix);
    } else {
        // ── Plain box node ─────────────────────────────────────────────────────
        let _ = writeln!(buf, "{}{} [label={:?}];", prefix, nid, comp.label);
    }
}

// ── Interface rendering ───────────────────────────────────────────────────────

/// Render all interfaces from `iface_ids` whose endpoints are both in `visible`
/// and that pass the filter predicates.
fn render_interfaces(
    iface_ids: &[InterfaceId],
    model: &Model,
    visible: &HashSet<ComponentId>,
    filter: &ViewFilter,
    indent: usize,
    buf: &mut String,
) {
    for &iid in iface_ids {
        render_interface_edge(iid, model, visible, filter, indent, buf);
    }
}

/// Render a single interface as a DOT edge, if it passes all predicates.
fn render_interface_edge(
    iid: InterfaceId,
    model: &Model,
    visible: &HashSet<ComponentId>,
    filter: &ViewFilter,
    indent: usize,
    buf: &mut String,
) {
    let iface = &model.interfaces[iid.0];

    // Both endpoints must be visible.
    if !visible.contains(&iface.from) || !visible.contains(&iface.to) {
        return;
    }

    // Tag inclusion.
    if !filter.include_tags.is_empty()
        && !iface.tags.iter().any(|t| filter.include_tags.contains(t))
    {
        return;
    }
    // Tag exclusion.
    if iface.tags.iter().any(|t| filter.exclude_tags.contains(t)) {
        return;
    }
    // Level cap.
    if filter.max_level.is_some_and(|max| iface.level > max) {
        return;
    }

    let from_cid = iface.from;
    let to_cid = iface.to;
    let from_is_cluster = has_visible_children(from_cid, model, visible);
    let to_is_cluster = has_visible_children(to_cid, model, visible);

    // Build the edge label.
    let mut label = iface.label.clone();
    if filter.show_messages && !iface.messages.is_empty() {
        for &mid in &iface.messages {
            label.push('\n');
            label.push_str(&model.messages[mid.0].label);
        }
    }

    // Collect edge attributes.
    let mut attrs: Vec<String> = vec![format!("label={:?}", label)];
    if iface.direction == Direction::Bidirectional {
        attrs.push("dir=both".to_owned());
    }
    if from_is_cluster {
        attrs.push(format!("ltail={}", cluster_id(from_cid)));
    }
    if to_is_cluster {
        attrs.push(format!("lhead={}", cluster_id(to_cid)));
    }

    let prefix = "    ".repeat(indent);
    let _ = writeln!(
        buf,
        "{}{} -> {} [{}];",
        prefix,
        node_id(from_cid),
        node_id(to_cid),
        attrs.join(", ")
    );
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
            .join("examples")
            .join(name)
    }

    fn load(name: &str) -> Model {
        let raw = parse_dir(&example_dir(name)).unwrap_or_else(|e| panic!("{name} parse: {e}"));
        let (model, _) = resolve(raw).unwrap_or_else(|diags| {
            let msgs: Vec<_> = diags.iter().map(|d| d.message.as_str()).collect();
            panic!("{name} resolve errors: {}", msgs.join("; "))
        });
        model
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
        let dot = render_view(&model, view);

        // All seven direct-child components of "quadcopter" should appear.
        assert!(
            dot.contains("flight-controller"),
            "missing flight-controller"
        );
        assert!(dot.contains("esc"), "missing esc");
        assert!(dot.contains("gps"), "missing gps");
        assert!(dot.contains("battery"), "missing battery");
        assert!(dot.contains("radio-rx"), "missing radio-rx");
        assert!(dot.contains("vtx"), "missing vtx");
        assert!(dot.contains("camera"), "missing camera");

        // At max_level=1 the children of flight-controller are filtered out.
        assert!(
            !dot.contains("\"mcu\""),
            "mcu should be hidden at max_level=1"
        );
        assert!(
            !dot.contains("\"imu\""),
            "imu should be hidden at max_level=1"
        );
        assert!(
            !dot.contains("\"barometer\""),
            "barometer hidden at max_level=1"
        );

        // System-scope interfaces should appear.
        assert!(dot.contains("motor-control"), "missing motor-control edge");
        assert!(dot.contains("gps-serial"), "missing gps-serial edge");
    }

    #[test]
    fn drone_overview_is_valid_digraph() {
        let model = load("drone");
        let view = model
            .views
            .iter()
            .find(|v| v.label == "drone-overview")
            .expect("drone-overview view");
        let dot = render_view(&model, view);

        assert!(dot.starts_with("digraph"), "should start with digraph");
        assert!(dot.contains("rankdir=TB"), "should have rankdir=TB");
        assert!(dot.contains("->"), "should have directed edges");
    }

    #[test]
    fn drone_fc_internals_shows_cluster() {
        let model = load("drone");
        let view = model
            .views
            .iter()
            .find(|v| v.label == "fc-internals")
            .expect("fc-internals view");
        let dot = render_view(&model, view);

        // flight-controller should render as a cluster.
        assert!(dot.contains("subgraph"), "should have a subgraph cluster");
        assert!(dot.contains("flight-controller"), "cluster label");

        // Its children should appear inside the cluster.
        assert!(dot.contains("mcu"), "mcu should be visible");
        assert!(dot.contains("imu"), "imu should be visible");
        assert!(dot.contains("barometer"), "barometer should be visible");

        // Top-level siblings excluded by whitelist.
        assert!(
            !dot.contains("\"esc\""),
            "esc should be hidden by whitelist"
        );
        assert!(
            !dot.contains("\"gps\""),
            "gps should be hidden by whitelist"
        );

        // Internal interfaces should appear.
        assert!(dot.contains("spi-imu"), "spi-imu edge missing");
        assert!(dot.contains("i2c-baro"), "i2c-baro edge missing");
    }

    #[test]
    fn drone_power_paths_tag_filter() {
        let model = load("drone");
        let view = model
            .views
            .iter()
            .find(|v| v.label == "power-paths")
            .expect("power-paths view");
        let dot = render_view(&model, view);

        // Components/interfaces with "power" tag should appear.
        assert!(dot.contains("battery"), "battery should be visible");
        assert!(dot.contains("esc"), "esc should be visible");
        assert!(dot.contains("power-main"), "power-main edge missing");
        assert!(dot.contains("rankdir=LR"), "should have rankdir=LR");

        // Non-power components should be absent.
        assert!(!dot.contains("\"gps\""), "gps should be hidden");
        assert!(!dot.contains("\"camera\""), "camera should be hidden");
    }

    #[test]
    fn drone_ground_station_view() {
        let model = load("drone");
        let view = model
            .views
            .iter()
            .find(|v| v.label == "ground-station")
            .expect("ground-station view");
        let dot = render_view(&model, view);

        assert!(dot.contains("transmitter"), "transmitter missing");
        assert!(dot.contains("goggles"), "goggles missing");
        assert!(
            dot.contains("ground-station-pc"),
            "ground-station-pc missing"
        );
        assert!(dot.contains("rf-control"), "rf-control edge missing");
        assert!(
            dot.contains("video-downlink"),
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
        let dot = render_view(&model, view);

        assert!(dot.contains("mobile-app"), "mobile-app missing");
        assert!(dot.contains("api-gateway"), "api-gateway missing");
        assert!(dot.contains("backend"), "backend missing");
        assert!(dot.contains("cdn"), "cdn missing");
        assert!(dot.contains("client-api"), "client-api edge missing");
        assert!(dot.contains("rankdir=TB"), "should have rankdir=TB");
    }

    #[test]
    fn social_media_backend_services_cluster() {
        let model = load("social-media");
        let view = model
            .views
            .iter()
            .find(|v| v.label == "backend-services")
            .expect("backend-services view");
        let dot = render_view(&model, view);

        // backend should render as a cluster.
        assert!(dot.contains("subgraph"), "should have cluster for backend");
        assert!(dot.contains("backend"), "backend label missing");
        // Internal components visible.
        assert!(dot.contains("user-service"), "user-service missing");
        assert!(dot.contains("feed-service"), "feed-service missing");
        assert!(dot.contains("recommendation-engine"), "rec-engine missing");
        // rec-to-feed internal interface.
        assert!(dot.contains("rec-to-feed"), "rec-to-feed edge missing");
    }

    #[test]
    fn social_media_video_pipeline_tag_filter() {
        let model = load("social-media");
        let view = model
            .views
            .iter()
            .find(|v| v.label == "video-pipeline")
            .expect("video-pipeline view");
        let dot = render_view(&model, view);

        // Video-tagged components should appear.
        assert!(dot.contains("cdn"), "cdn (video-tagged) missing");
        assert!(dot.contains("object-store"), "object-store missing");
        // backend-to-storage has "video" tag: backend is added as implicit endpoint.
        assert!(
            dot.contains("backend-to-storage"),
            "backend-to-storage missing"
        );
        assert!(dot.contains("cdn-origin"), "cdn-origin edge missing");
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
        let dot = render_view(&model, view);

        assert!(dot.contains("engineering"), "engineering missing");
        assert!(dot.contains("product"), "product missing");
        assert!(dot.contains("qa"), "qa missing");
        assert!(dot.contains("sales"), "sales missing");
        assert!(dot.contains("operations"), "operations missing");
        assert!(
            dot.contains("sprint-planning"),
            "sprint-planning edge missing"
        );
        assert!(dot.contains("bug-reports"), "bug-reports edge missing");
    }

    #[test]
    fn software_house_engineering_teams_cluster() {
        let model = load("software-house");
        let view = model
            .views
            .iter()
            .find(|v| v.label == "engineering-teams")
            .expect("engineering-teams view");
        let dot = render_view(&model, view);

        assert!(dot.contains("subgraph"), "should have a cluster");
        assert!(dot.contains("engineering"), "engineering cluster label");
        assert!(dot.contains("frontend-team"), "frontend-team missing");
        assert!(dot.contains("backend-team"), "backend-team missing");
        assert!(dot.contains("platform-team"), "platform-team missing");
        assert!(dot.contains("code-review"), "code-review edge missing");
    }

    #[test]
    fn software_house_processes_show_messages() {
        let model = load("software-house");
        let view = model
            .views
            .iter()
            .find(|v| v.label == "processes-only")
            .expect("processes-only view");
        let dot = render_view(&model, view);

        // "process"-tagged interfaces should appear.
        assert!(
            dot.contains("sprint-planning"),
            "sprint-planning edge missing"
        );
        assert!(dot.contains("bug-reports"), "bug-reports edge missing");
        assert!(dot.contains("release-sign-off"), "release-sign-off missing");

        // Endpoint components are implicitly included even without the "process" tag.
        assert!(
            dot.contains("engineering"),
            "engineering (endpoint) missing"
        );
        assert!(dot.contains("product"), "product (endpoint) missing");
        assert!(dot.contains("qa"), "qa (endpoint) missing");

        // show_messages=true: message names should appear in edge labels.
        assert!(
            dot.contains("sprint-backlog"),
            "sprint-backlog message missing"
        );
        assert!(dot.contains("bug-ticket"), "bug-ticket message missing");
        // "review-request" is a message inside the "code-review" interface.
        assert!(
            dot.contains("review-request"),
            "review-request message missing"
        );
    }
}
