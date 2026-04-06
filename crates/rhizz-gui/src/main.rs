//! `rhizz-gui` — desktop GUI frontend for the rhizz MBSE tool.
//!
//! Usage: `rhizz-gui <project-dir>`

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc;

use egui::Color32;
use notify::{RecursiveMode, Watcher as _};
use rhizz_core::{ComponentId, Diagnostic, DiagnosticCode, Model, PortRole, Source};
use tracing::{debug, error, info, warn};
use walkdir::WalkDir;

use layout::core::format::{ClipHandle, RenderBackend};
use layout::core::geometry::Point as LP;
use layout::core::style::StyleAttr;
use layout::gv::{DotParser, GraphBuilder};

fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("warn")),
        )
        .with_writer(std::io::stderr)
        .init();

    let path = std::env::args()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));

    let title = format!("rhizz — {}", path.display());

    let app = RhizzApp::new(path);
    let options = eframe::NativeOptions::default();
    eframe::run_native(&title, options, Box::new(|_cc| Ok(Box::new(app))))
        .map_err(|e| anyhow::anyhow!("eframe error: {e}"))
}

// ── compile helper ────────────────────────────────────────────────────────────

fn load_and_compile(dir: &Path) -> (Option<Model>, Vec<Diagnostic>) {
    let mut hcl_files: Vec<PathBuf> = WalkDir::new(dir)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file() && e.path().extension().is_some_and(|x| x == "hcl"))
        .map(|e| e.path().to_path_buf())
        .collect();
    hcl_files.sort();

    if hcl_files.is_empty() {
        let d = Diagnostic::error(
            DiagnosticCode::E000,
            format!("no .hcl files found in {}", dir.display()),
        );
        return (None, vec![d]);
    }

    let mut sources = Vec::new();
    for path in &hcl_files {
        match std::fs::read_to_string(path) {
            Ok(content) => sources.push(Source {
                filename: path.display().to_string(),
                content,
            }),
            Err(e) => {
                let d = Diagnostic::error(
                    DiagnosticCode::E000,
                    format!("cannot read {}: {e}", path.display()),
                );
                return (None, vec![d]);
            }
        }
    }

    let result = rhizz_core::compile(&sources);
    (result.model, result.diagnostics)
}

// ── File-watch helpers ────────────────────────────────────────────────────────

/// Return `true` if `event` is a create/modify/remove on an `.hcl` file.
fn is_hcl_event(event: &notify::Event) -> bool {
    use notify::EventKind::{Create, Modify, Remove};
    matches!(event.kind, Create(_) | Modify(_) | Remove(_))
        && event
            .paths
            .iter()
            .any(|p| p.extension().is_some_and(|ext| ext == "hcl"))
}

// ── Graph layout types ────────────────────────────────────────────────────────

/// A single drawable command collected from the layout engine.
#[derive(Clone)]
enum DrawCmd {
    /// A leaf component node (solid border box).
    Node {
        rect: egui::Rect,
        fill: Color32,
        stroke: egui::Stroke,
        label: String,
    },
    /// A non-leaf component cluster (dashed border rectangle).
    Cluster { rect: egui::Rect, label: String },
    /// A connection edge (arrow or plain line).
    Edge {
        path: Vec<egui::Pos2>,
        /// (start_arrowhead, end_arrowhead)
        head: (bool, bool),
        dashed: bool,
        stroke: egui::Stroke,
        label: String,
    },
}

/// Computed layout for a single view, ready to be drawn by egui::Painter.
#[derive(Clone)]
struct GraphLayout {
    cmds: Vec<DrawCmd>,
    canvas: egui::Vec2,
}

/// A collecting render backend that converts layout-rs draw calls into
/// egui-compatible draw commands.
struct EguiBackend {
    cmds: Vec<DrawCmd>,
    /// Pending rect waiting for its label text (draw_rect → draw_text pair).
    pending: Option<(egui::Rect, egui::Stroke, Color32)>,
    canvas: egui::Vec2,
    /// Map from component label → rect, used for cluster bounding boxes.
    label_to_rect: HashMap<String, egui::Rect>,
}

impl EguiBackend {
    fn new() -> Self {
        Self {
            cmds: Vec::new(),
            pending: None,
            canvas: egui::Vec2::ZERO,
            label_to_rect: HashMap::new(),
        }
    }

    fn lp_to_pos(p: LP) -> egui::Pos2 {
        egui::pos2(p.x as f32, p.y as f32)
    }

    /// Convert a layout-rs color to egui Color32.
    fn layout_color(c: &layout::core::color::Color) -> Color32 {
        let hex = c.to_web_color();
        let h = hex.trim_start_matches('#');
        if h.len() == 8 {
            let r = u8::from_str_radix(&h[0..2], 16).unwrap_or(0);
            let g = u8::from_str_radix(&h[2..4], 16).unwrap_or(0);
            let b = u8::from_str_radix(&h[4..6], 16).unwrap_or(0);
            let a = u8::from_str_radix(&h[6..8], 16).unwrap_or(255);
            Color32::from_rgba_unmultiplied(r, g, b, a)
        } else {
            Color32::BLACK
        }
    }

    /// Expand the canvas to include the rectangle defined by (xy, size).
    fn update_canvas(&mut self, xy: LP, size: LP) {
        let max_x = (xy.x + size.x + 20.0) as f32;
        let max_y = (xy.y + size.y + 20.0) as f32;
        self.canvas.x = self.canvas.x.max(max_x);
        self.canvas.y = self.canvas.y.max(max_y);
    }

    /// Consume the backend and return the collected draw commands, canvas size,
    /// and label→rect map.
    fn finish(self) -> (Vec<DrawCmd>, egui::Vec2, HashMap<String, egui::Rect>) {
        (self.cmds, self.canvas, self.label_to_rect)
    }
}

impl RenderBackend for EguiBackend {
    fn draw_rect(
        &mut self,
        xy: LP,
        size: LP,
        look: &StyleAttr,
        _properties: Option<String>,
        _clip: Option<ClipHandle>,
    ) {
        self.update_canvas(xy, size);
        let rect = egui::Rect::from_min_size(
            Self::lp_to_pos(xy),
            egui::vec2(size.x as f32, size.y as f32),
        );
        let fill = look
            .fill_color
            .as_ref()
            .map(Self::layout_color)
            .unwrap_or(Color32::TRANSPARENT);
        let stroke = egui::Stroke::new(
            (look.line_width as f32).max(1.0),
            Self::layout_color(&look.line_color),
        );
        self.pending = Some((rect, stroke, fill));
    }

    fn draw_line(&mut self, start: LP, stop: LP, look: &StyleAttr, _properties: Option<String>) {
        let stroke = egui::Stroke::new(
            (look.line_width as f32).max(1.0),
            Self::layout_color(&look.line_color),
        );
        self.cmds.push(DrawCmd::Edge {
            path: vec![Self::lp_to_pos(start), Self::lp_to_pos(stop)],
            head: (false, false),
            dashed: false,
            stroke,
            label: String::new(),
        });
    }

    fn draw_circle(&mut self, xy: LP, size: LP, look: &StyleAttr, _properties: Option<String>) {
        // xy is the center for circles; convert to top-left for Rect.
        let tl = LP::new(xy.x - size.x / 2.0, xy.y - size.y / 2.0);
        self.update_canvas(tl, size);
        let rect = egui::Rect::from_center_size(
            Self::lp_to_pos(xy),
            egui::vec2(size.x as f32, size.y as f32),
        );
        let fill = look
            .fill_color
            .as_ref()
            .map(Self::layout_color)
            .unwrap_or(Color32::TRANSPARENT);
        let stroke = egui::Stroke::new(
            (look.line_width as f32).max(1.0),
            Self::layout_color(&look.line_color),
        );
        self.pending = Some((rect, stroke, fill));
    }

    fn draw_text(&mut self, _xy: LP, text: &str, _look: &StyleAttr) {
        if let Some((rect, stroke, fill)) = self.pending.take()
            && !text.is_empty()
        {
            self.label_to_rect.insert(text.to_owned(), rect);
            self.cmds.push(DrawCmd::Node {
                rect,
                fill,
                stroke,
                label: text.to_owned(),
            });
        }
        // Empty text → invisible proxy node → discard.
        // No pending rect → standalone connector label → ignore.
    }

    fn draw_arrow(
        &mut self,
        path: &[(LP, LP)],
        dashed: bool,
        head: (bool, bool),
        look: &StyleAttr,
        _properties: Option<String>,
        text: &str,
    ) {
        if path.len() < 2 {
            return;
        }
        let stroke = egui::Stroke::new(
            (look.line_width as f32).max(1.0),
            Self::layout_color(&look.line_color),
        );
        // Build a polyline from the bezier anchor points: path[0].0 is the
        // start; each subsequent path[n].1 is the next anchor.
        let mut pts = vec![Self::lp_to_pos(path[0].0)];
        for seg in path.iter().skip(1) {
            let p = Self::lp_to_pos(seg.1);
            self.canvas.x = self.canvas.x.max(p.x + 10.0);
            self.canvas.y = self.canvas.y.max(p.y + 10.0);
            pts.push(p);
        }
        self.canvas.x = self.canvas.x.max(pts[0].x + 10.0);
        self.canvas.y = self.canvas.y.max(pts[0].y + 10.0);
        self.cmds.push(DrawCmd::Edge {
            path: pts,
            head,
            dashed,
            stroke,
            label: text.to_owned(),
        });
    }

    fn create_clip(&mut self, _xy: LP, _size: LP, _rounded_px: usize) -> ClipHandle {
        // This renderer does not use clip regions; return the zero handle.
        0
    }
}

// ── Graph layout computation ──────────────────────────────────────────────────

/// Compute and return the egui draw list for `view` in `model`.
///
/// Calls `rhizz_dot::render_view` to obtain the DOT representation, passes it
/// to the `layout` crate for node placement, then post-processes the result
/// to add cluster bounding boxes and fix bidirectional edge directions.
fn compute_graph_layout(model: &Model, view: &rhizz_core::View) -> Result<GraphLayout, String> {
    let dot = rhizz_dot::render_view(model, view);

    let mut parser = DotParser::new(&dot);
    let tree = parser
        .process()
        .map_err(|e| format!("layout parse error: {e}"))?;

    let mut gb = GraphBuilder::new();
    gb.visit_graph(&tree);
    let mut vg = gb.get();

    let mut backend = EguiBackend::new();
    vg.do_it(false, false, false, &mut backend);

    let (mut cmds, canvas, label_to_rect) = backend.finish();

    // Fix bidirectional edges: the layout crate treats all directed edges as
    // unidirectional (end arrow only).  Replace head with (false, false) for
    // bidirectional connections so they render as plain lines.
    for cmd in &mut cmds {
        if let DrawCmd::Edge { label, head, .. } = cmd {
            let iface_label = label.lines().next().unwrap_or(label.as_str());
            if is_bidirectional_connection(iface_label, model) {
                *head = (false, false);
            }
        }
    }

    // Compute cluster bounding boxes (inserted before nodes so they render as
    // background rectangles).
    let mut cluster_cmds = Vec::new();
    let system = &model.systems[view.system.0];
    for &cid in &system.components {
        collect_cluster_cmds(cid, model, &label_to_rect, &mut cluster_cmds);
    }

    let mut all_cmds = cluster_cmds;
    all_cmds.extend(cmds);

    Ok(GraphLayout {
        cmds: all_cmds,
        canvas,
    })
}

/// Returns `true` if the connection with the given label is bidirectional
/// (i.e. both endpoint ports have `Peer` role).
fn is_bidirectional_connection(label: &str, model: &Model) -> bool {
    model.connections.iter().any(|c| {
        c.label == label && {
            let from_role = c.from.port.map(|pid| model.ports[pid.0].role);
            let to_role = c.to.port.map(|pid| model.ports[pid.0].role);
            matches!(
                (from_role, to_role),
                (Some(PortRole::Peer), Some(PortRole::Peer))
            )
        }
    })
}

/// Recursively compute dashed cluster boxes for non-leaf components.
/// Inner clusters are inserted first so they are drawn on top of outer ones.
fn collect_cluster_cmds(
    cid: ComponentId,
    model: &Model,
    label_to_rect: &HashMap<String, egui::Rect>,
    out: &mut Vec<DrawCmd>,
) {
    let comp = &model.components[cid.0];
    if comp.children.is_empty() {
        return;
    }

    // Process children recursively first (inner clusters drawn on top).
    for &child in &comp.children {
        collect_cluster_cmds(child, model, label_to_rect, out);
    }

    // Compute bounding box from all children that have a known position.
    let padding = 15.0_f32;
    let child_rects: Vec<egui::Rect> = comp
        .children
        .iter()
        .filter_map(|&c| label_to_rect.get(&model.components[c.0].label).copied())
        .collect();

    if child_rects.is_empty() {
        return;
    }

    let min_x = child_rects.iter().map(|r| r.min.x).fold(f32::MAX, f32::min) - padding;
    let min_y = child_rects.iter().map(|r| r.min.y).fold(f32::MAX, f32::min) - padding;
    let max_x = child_rects.iter().map(|r| r.max.x).fold(f32::MIN, f32::max) + padding;
    let max_y = child_rects.iter().map(|r| r.max.y).fold(f32::MIN, f32::max) + padding;

    out.push(DrawCmd::Cluster {
        rect: egui::Rect::from_min_max(egui::pos2(min_x, min_y), egui::pos2(max_x, max_y)),
        label: comp.label.clone(),
    });
}

// ── Graph rendering helpers ───────────────────────────────────────────────────

/// Draw the full graph layout via `painter`.  All coordinates are offset by
/// `origin` (the top-left of the allocated canvas rect inside the ScrollArea)
/// and scaled uniformly by `scale`.
fn draw_graph_layout(
    painter: &egui::Painter,
    origin: egui::Pos2,
    layout: &GraphLayout,
    scale: f32,
) {
    for cmd in &layout.cmds {
        match cmd {
            DrawCmd::Cluster { rect, label } => {
                let r = scale_and_offset_rect(*rect, origin, scale);
                draw_dashed_rect(painter, r, Color32::from_rgb(80, 100, 200), scale);
                painter.text(
                    r.min + egui::vec2(6.0, 3.0) * scale,
                    egui::Align2::LEFT_TOP,
                    label,
                    egui::FontId::proportional(12.0 * scale),
                    Color32::from_rgb(80, 100, 200),
                );
            }
            DrawCmd::Node {
                rect,
                fill,
                stroke,
                label,
            } => {
                let r = scale_and_offset_rect(*rect, origin, scale);
                let scaled_stroke = egui::Stroke::new(stroke.width * scale, stroke.color);
                painter.rect_filled(r, 2.0 * scale, *fill);
                painter.rect_stroke(r, 2.0 * scale, scaled_stroke, egui::StrokeKind::Middle);
                painter.text(
                    r.center(),
                    egui::Align2::CENTER_CENTER,
                    label,
                    egui::FontId::proportional(12.0 * scale),
                    Color32::BLACK,
                );
            }
            DrawCmd::Edge {
                path,
                head,
                dashed,
                stroke,
                label,
            } => {
                let pts: Vec<egui::Pos2> = path
                    .iter()
                    .map(|p| origin + egui::vec2(p.x * scale, p.y * scale))
                    .collect();
                let scaled_stroke = egui::Stroke::new(stroke.width * scale, stroke.color);
                draw_edge(painter, &pts, *head, *dashed, scaled_stroke, label, scale);
            }
        }
    }
}

fn scale_and_offset_rect(rect: egui::Rect, origin: egui::Pos2, scale: f32) -> egui::Rect {
    let min = origin + egui::vec2(rect.min.x * scale, rect.min.y * scale);
    let max = origin + egui::vec2(rect.max.x * scale, rect.max.y * scale);
    egui::Rect::from_min_max(min, max)
}

fn draw_edge(
    painter: &egui::Painter,
    pts: &[egui::Pos2],
    head: (bool, bool),
    dashed: bool,
    stroke: egui::Stroke,
    label: &str,
    scale: f32,
) {
    if pts.len() < 2 {
        return;
    }

    // Draw line segments.
    for i in 0..pts.len().saturating_sub(1) {
        if dashed {
            draw_dashed_line(painter, pts[i], pts[i + 1], stroke, scale);
        } else {
            painter.line_segment([pts[i], pts[i + 1]], stroke);
        }
    }

    // End arrowhead.
    if head.1 {
        let tip = pts[pts.len() - 1];
        let prev = pts[pts.len() - 2];
        draw_arrowhead(painter, prev, tip, stroke.color, scale);
    }
    // Start arrowhead.
    if head.0 {
        let tip = pts[0];
        let next = pts[1];
        draw_arrowhead(painter, next, tip, stroke.color, scale);
    }

    // Edge label (first line only, drawn near the midpoint).
    let first_line = label.lines().next().unwrap_or_default();
    if !first_line.is_empty() {
        let mid = pts[pts.len() / 2];
        painter.text(
            mid + egui::vec2(4.0, -8.0) * scale,
            egui::Align2::LEFT_BOTTOM,
            first_line,
            egui::FontId::proportional(11.0 * scale),
            Color32::DARK_GRAY,
        );
    }
}

fn draw_arrowhead(
    painter: &egui::Painter,
    from: egui::Pos2,
    tip: egui::Pos2,
    color: Color32,
    scale: f32,
) {
    let delta = tip - from;
    if delta.length() < 0.01 {
        return;
    }
    let dir = delta.normalized();
    let perp = egui::vec2(-dir.y, dir.x);
    let size = 8.0_f32 * scale;
    let half_w = 4.5_f32 * scale;
    let base = tip - dir * size;
    painter.add(egui::Shape::convex_polygon(
        vec![tip, base + perp * half_w, base - perp * half_w],
        color,
        egui::Stroke::NONE,
    ));
}

fn draw_dashed_line(
    painter: &egui::Painter,
    a: egui::Pos2,
    b: egui::Pos2,
    stroke: egui::Stroke,
    scale: f32,
) {
    let total = (b - a).length();
    if total < 0.01 {
        return;
    }
    let dir = (b - a) / total;
    let dash = 6.0_f32 * scale;
    let gap = 4.0_f32 * scale;
    let mut pos = 0.0_f32;
    while pos < total {
        let start = a + dir * pos;
        let end = a + dir * (pos + dash).min(total);
        painter.line_segment([start, end], stroke);
        pos += dash + gap;
    }
}

fn draw_dashed_rect(painter: &egui::Painter, rect: egui::Rect, color: Color32, scale: f32) {
    let s = egui::Stroke::new(1.5 * scale, color);
    let tl = rect.min;
    let tr = egui::pos2(rect.max.x, rect.min.y);
    let bl = egui::pos2(rect.min.x, rect.max.y);
    let br = rect.max;
    draw_dashed_line(painter, tl, tr, s, scale);
    draw_dashed_line(painter, tr, br, s, scale);
    draw_dashed_line(painter, br, bl, s, scale);
    draw_dashed_line(painter, bl, tl, s, scale);
}

// ── App ───────────────────────────────────────────────────────────────────────

struct RhizzApp {
    path: PathBuf,
    model: Option<Model>,
    diagnostics: Vec<Diagnostic>,
    /// Index of the currently-selected view tab.
    selected_view: usize,
    /// Cached layout for each view (None = not yet computed).
    view_layouts: Vec<Option<Result<GraphLayout, String>>>,
    /// Whether the score dashboard panel is open.
    score_panel_open: bool,
    /// File-system watcher (kept alive so it is not dropped).
    _watcher: Option<notify::RecommendedWatcher>,
    /// Receiver for file-system watcher events.
    watch_rx: mpsc::Receiver<notify::Result<notify::Event>>,
}

impl RhizzApp {
    fn new(path: PathBuf) -> Self {
        let (model, mut diagnostics) = load_and_compile(&path);
        let view_count = model.as_ref().map_or(0, |m| m.views.len());

        let (tx, watch_rx) = mpsc::channel::<notify::Result<notify::Event>>();
        let mut watch_diagnostics: Vec<Diagnostic> = Vec::new();
        let watcher = match notify::recommended_watcher(tx) {
            Ok(mut w) => {
                if let Err(e) = w.watch(&path, RecursiveMode::NonRecursive) {
                    error!("Warning: cannot watch {}: {e}", path.display());
                    watch_diagnostics.push(Diagnostic::warning(
                        DiagnosticCode::W000,
                        format!(
                            "live reload unavailable: cannot watch {}: {e}",
                            path.display()
                        ),
                    ));
                } else {
                    info!("fs watcher for {} created successfully", path.display());
                }
                Some(w)
            }
            Err(e) => {
                error!("Warning: cannot create file watcher: {e}");
                watch_diagnostics.push(Diagnostic::warning(
                    DiagnosticCode::W000,
                    format!("live reload unavailable: cannot create file watcher: {e}"),
                ));
                None
            }
        };

        diagnostics.extend(watch_diagnostics);

        Self {
            path,
            model,
            diagnostics,
            selected_view: 0,
            view_layouts: vec![None; view_count],
            score_panel_open: false,
            _watcher: watcher,
            watch_rx,
        }
    }
}

impl eframe::App for RhizzApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        // ── Poll the file-watcher channel ─────────────────────────────────────
        let mut changed = false;
        loop {
            match self.watch_rx.try_recv() {
                Ok(Ok(ref event)) if is_hcl_event(event) => {
                    debug!("Filesystem event received, HCL file changed.");
                    changed = true;
                }
                Ok(event) => {
                    debug!("Filesystem event received: {event:?}");
                }
                Err(mpsc::TryRecvError::Empty) => break,
                Err(mpsc::TryRecvError::Disconnected) => {
                    error!("Filesystem watcher disconnected, this should never happen!");
                }
            }
        }
        if changed {
            info!("Source files changed, rebuilding the model...");
            let (new_model, diagnostics) = load_and_compile(&self.path);
            self.diagnostics = diagnostics;
            if let Some(model) = new_model {
                let view_count = model.views.len();
                self.model = Some(model);
                self.view_layouts = vec![None; view_count];
                self.selected_view = self.selected_view.min(view_count.saturating_sub(1));
            }
            // When recompile produces no model (hard errors), keep the previous
            // valid model so the graph view stays visible while the user fixes
            // the errors (spec: SPEC/gui.md § File Watching and Live Recompile).
            ctx.request_repaint();
        } else {
            ctx.request_repaint_after(std::time::Duration::from_secs(2));
        }

        // ── Lazy-compute layout for the selected view ─────────────────────────
        let view_count = self.model.as_ref().map_or(0, |m| m.views.len());
        if view_count > 0 {
            let idx = self.selected_view.min(view_count - 1);
            if let Some(model) = &self.model
                && let Some(slot) = self.view_layouts.get_mut(idx)
                && slot.is_none()
            {
                let result = compute_graph_layout(model, &model.views[idx]);
                if let Err(ref e) = result {
                    warn!("Failed to compute layout for view {idx}: {e}");
                } else {
                    debug!("View {idx} layout computed successfully");
                }
                *slot = Some(result);
            }
        }

        // ── Left sidebar: systems / components / connections ───────────────────
        egui::SidePanel::left("sidebar").show(ctx, |ui| {
            ui.heading("Model");
            ui.separator();
            egui::ScrollArea::vertical().show(ui, |ui| {
                if let Some(ref model) = self.model {
                    for system in &model.systems {
                        ui.label(egui::RichText::new(format!("⬡ {}", system.label)).strong());
                        for &cid in &system.components {
                            let c = &model.components[cid.0];
                            ui.label(format!("  ▸ {}", c.label));
                        }
                        for &conn_id in &system.connections {
                            let conn = &model.connections[conn_id.0];
                            ui.label(
                                egui::RichText::new(format!("  ⇄ {}", conn.label))
                                    .color(Color32::from_rgb(100, 150, 220)),
                            );
                        }
                    }
                } else {
                    ui.label(egui::RichText::new("(no model)").italics());
                }
            });
        });

        // ── Bottom panel: diagnostics ─────────────────────────────────────────
        egui::TopBottomPanel::bottom("diagnostics")
            .resizable(true)
            .min_height(80.0)
            .show(ctx, |ui| {
                ui.heading("Diagnostics");
                ui.separator();
                egui::ScrollArea::vertical().show(ui, |ui| {
                    if self.diagnostics.is_empty() {
                        ui.label(egui::RichText::new("✓ No issues").color(Color32::GREEN));
                    } else {
                        for d in &self.diagnostics {
                            let location = match (&d.file, d.line) {
                                (Some(f), Some(l)) => format!("{}:{}", f.display(), l),
                                (Some(f), None) => f.display().to_string(),
                                _ => String::new(),
                            };
                            let text = if location.is_empty() {
                                format!("{} — {}", d.code, d.message)
                            } else {
                                format!("{} {} — {}", d.code, location, d.message)
                            };
                            let color = if d.is_error() {
                                Color32::from_rgb(220, 80, 80)
                            } else {
                                Color32::from_rgb(220, 180, 60)
                            };
                            ui.label(egui::RichText::new(text).color(color));
                        }
                    }
                });
            });

        // ── Score dashboard panel (Task 16) ───────────────────────────────────
        // Must be added before the central panel.
        egui::SidePanel::right("score_panel")
            .resizable(true)
            .default_width(230.0)
            .show_animated(ctx, self.score_panel_open, |ui| {
                ui.heading("Score");
                ui.separator();
                if let Some(ref model) = self.model {
                    let report = rhizz_core::score(model);
                    egui::Grid::new("score_grid")
                        .num_columns(4)
                        .striped(true)
                        .show(ui, |ui| {
                            ui.label(egui::RichText::new("Category").strong());
                            ui.label(egui::RichText::new("✓").strong());
                            ui.label(egui::RichText::new("Total").strong());
                            ui.label(egui::RichText::new("%").strong());
                            ui.end_row();

                            score_row(ui, "Components", &report.components);
                            score_row(ui, "Ports", &report.ports);
                            score_row(ui, "Connections", &report.connections);
                            score_row(ui, "Messages", &report.messages);
                        });

                    ui.separator();
                    let pct = (report.overall_percentage() as f32) / 100.0;
                    ui.label(format!("Overall: {:.1}%", report.overall_percentage()));
                    ui.add(egui::ProgressBar::new(pct).desired_width(ui.available_width()));
                } else {
                    ui.label(egui::RichText::new("(no model loaded)").italics());
                }
            });

        // ── Central panel: view tabs + graph rendering ────────────────────────
        egui::CentralPanel::default().show(ctx, |ui| {
            ui.horizontal(|ui| {
                ui.heading("rhizz");
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    let btn = if self.score_panel_open {
                        "Score ◀"
                    } else {
                        "Score ▶"
                    };
                    if ui.button(btn).clicked() {
                        self.score_panel_open = !self.score_panel_open;
                    }
                });
            });
            ui.label(format!("Project: {}", self.path.display()));

            if let Some(ref model) = self.model {
                ui.label(format!(
                    "{} system(s), {} component(s), {} connection(s)",
                    model.systems.len(),
                    model.components.len(),
                    model.connections.len(),
                ));

                if model.views.is_empty() {
                    ui.separator();
                    ui.label(egui::RichText::new("(no views defined)").italics());
                } else {
                    ui.separator();

                    // ── View tabs ─────────────────────────────────────────────
                    ui.horizontal(|ui| {
                        for (i, view) in model.views.iter().enumerate() {
                            let selected = self.selected_view == i;
                            if ui.selectable_label(selected, &view.label).clicked() {
                                self.selected_view = i;
                            }
                        }
                    });

                    ui.separator();

                    let idx = self.selected_view.min(model.views.len() - 1);

                    egui::ScrollArea::both().show(ui, |ui| {
                        match self.view_layouts.get(idx).and_then(Option::as_ref) {
                            Some(Ok(layout)) => {
                                // Compute uniform scale to fit the canvas into the
                                // available space, never exceeding 1:1.
                                let avail = ui.available_size().max(egui::vec2(1.0, 1.0));
                                let canvas = layout.canvas.max(egui::vec2(1.0, 1.0));
                                let scale = (avail.x / canvas.x).min(avail.y / canvas.y).min(1.0);
                                let canvas_size = canvas * scale;
                                let (rect, _) =
                                    ui.allocate_exact_size(canvas_size, egui::Sense::hover());
                                if ui.is_rect_visible(rect) {
                                    draw_graph_layout(ui.painter(), rect.min, layout, scale);
                                }
                            }
                            Some(Err(e)) => {
                                ui.colored_label(
                                    Color32::from_rgb(220, 80, 80),
                                    format!("Layout error: {e}"),
                                );
                            }
                            None => {
                                ui.label(egui::RichText::new("Computing layout…").italics());
                            }
                        }
                    });
                }
            } else {
                ui.separator();
                ui.label(egui::RichText::new("(no model loaded)").italics());
            }
        });
    }
}

/// Render one row of the score table.
fn score_row(ui: &mut egui::Ui, label: &str, cat: &rhizz_core::CategoryScore) {
    ui.label(label);
    ui.label(cat.complete.to_string());
    ui.label(cat.total().to_string());
    ui.label(format!("{:.0}%", cat.percentage()));
    ui.end_row();
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::{DrawCmd, compute_graph_layout, is_bidirectional_connection, is_hcl_event};
    use notify::{Event, EventKind};
    use std::path::PathBuf;
    use walkdir::WalkDir;

    fn make_event(kind: EventKind, paths: Vec<PathBuf>) -> Event {
        Event {
            kind,
            paths,
            attrs: Default::default(),
        }
    }

    /// Load and compile an example project by name.
    fn load_example(name: &str) -> rhizz_core::Model {
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../examples")
            .join(name);
        let mut hcl_files: Vec<PathBuf> = WalkDir::new(&dir)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.file_type().is_file() && e.path().extension().is_some_and(|ext| ext == "hcl")
            })
            .map(|e| e.path().to_path_buf())
            .collect();
        hcl_files.sort();
        let sources: Vec<rhizz_core::Source> = hcl_files
            .iter()
            .map(|p| rhizz_core::Source {
                filename: p.to_string_lossy().into_owned(),
                content: std::fs::read_to_string(p).expect("read hcl"),
            })
            .collect();
        let result = rhizz_core::compile(&sources);
        assert!(
            result.diagnostics.iter().all(|d| !d.is_error()),
            "{name} compile errors"
        );
        result.model.expect("model")
    }

    #[test]
    fn hcl_modify_is_detected() {
        let ev = make_event(
            EventKind::Modify(notify::event::ModifyKind::Any),
            vec![PathBuf::from("/project/system.hcl")],
        );
        assert!(is_hcl_event(&ev));
    }

    #[test]
    fn hcl_create_is_detected() {
        let ev = make_event(
            EventKind::Create(notify::event::CreateKind::Any),
            vec![PathBuf::from("/project/new.hcl")],
        );
        assert!(is_hcl_event(&ev));
    }

    #[test]
    fn hcl_remove_is_detected() {
        let ev = make_event(
            EventKind::Remove(notify::event::RemoveKind::Any),
            vec![PathBuf::from("/project/old.hcl")],
        );
        assert!(is_hcl_event(&ev));
    }

    #[test]
    fn non_hcl_modify_is_ignored() {
        let ev = make_event(
            EventKind::Modify(notify::event::ModifyKind::Any),
            vec![PathBuf::from("/project/README.md")],
        );
        assert!(!is_hcl_event(&ev));
    }

    #[test]
    fn access_event_is_ignored() {
        let ev = make_event(
            EventKind::Access(notify::event::AccessKind::Any),
            vec![PathBuf::from("/project/system.hcl")],
        );
        assert!(!is_hcl_event(&ev));
    }

    // ── Task 15: graph layout tests ───────────────────────────────────────────

    #[test]
    fn drone_overview_layout_produces_nodes_and_edges() {
        let model = load_example("drone");
        let view = model
            .views
            .iter()
            .find(|v| v.label == "drone-overview")
            .expect("drone-overview view");

        let layout =
            compute_graph_layout(&model, view).expect("layout should succeed for drone-overview");

        // Canvas must have non-zero area.
        assert!(layout.canvas.x > 0.0, "canvas width > 0");
        assert!(layout.canvas.y > 0.0, "canvas height > 0");

        // Must have at least one node and one edge in the draw list.
        let node_count = layout
            .cmds
            .iter()
            .filter(|c| matches!(c, DrawCmd::Node { .. }))
            .count();
        let edge_count = layout
            .cmds
            .iter()
            .filter(|c| matches!(c, DrawCmd::Edge { .. }))
            .count();
        assert!(node_count > 0, "at least one node drawn");
        assert!(edge_count > 0, "at least one edge drawn");
    }

    #[test]
    fn bidirectional_connection_detection() {
        let model = load_example("drone");
        // drone has at least one bidirectional connection (both ports are Peer).
        let bidir_conn = model
            .connections
            .iter()
            .find(|c| {
                let from_role = c.from.port.map(|pid| model.ports[pid.0].role);
                let to_role = c.to.port.map(|pid| model.ports[pid.0].role);
                matches!(
                    (from_role, to_role),
                    (
                        Some(rhizz_core::PortRole::Peer),
                        Some(rhizz_core::PortRole::Peer)
                    )
                )
            })
            .expect("drone should have at least one bidirectional connection");
        assert!(
            is_bidirectional_connection(&bidir_conn.label, &model),
            "bidirectional connection recognised"
        );
        // Non-bidirectional connections must NOT be flagged as bidirectional.
        if let Some(unidir) = model.connections.iter().find(|c| {
            let from_role = c.from.port.map(|pid| model.ports[pid.0].role);
            let to_role = c.to.port.map(|pid| model.ports[pid.0].role);
            !matches!(
                (from_role, to_role),
                (
                    Some(rhizz_core::PortRole::Peer),
                    Some(rhizz_core::PortRole::Peer)
                )
            )
        }) {
            assert!(
                !is_bidirectional_connection(&unidir.label, &model),
                "non-bidirectional connection should not be flagged as bidirectional"
            );
        }
    }

    #[test]
    fn all_example_views_layout_without_error() {
        for example in ["drone", "social-media", "software-house"] {
            let model = load_example(example);
            for view in &model.views {
                compute_graph_layout(&model, view).unwrap_or_else(|e| {
                    panic!("layout failed for {}/{}: {e}", example, view.label)
                });
            }
        }
    }
}
