//! `rhizz-gui` — desktop GUI frontend for the rhizz MBSE tool.
//!
//! Usage: `rhizz-gui <project-dir>`

use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use egui::Color32;
use layout::core::color::Color as LayoutColor;
use layout::core::format::{ClipHandle, RenderBackend};
use layout::core::geometry::Point;
use layout::core::style::StyleAttr;
use notify::{RecursiveMode, Watcher};
use rhizz_core::{Diagnostic, Model, Source};
use walkdir::WalkDir;

fn main() -> anyhow::Result<()> {
    let path = std::env::args()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));

    let title = format!("rhizz — {}", path.display());

    let options = eframe::NativeOptions::default();
    eframe::run_native(
        &title,
        options,
        Box::new(|cc| Ok(Box::new(RhizzApp::new(path, cc)))),
    )
    .map_err(|e| anyhow::anyhow!("eframe error: {e}"))
}

// ── Compile output ────────────────────────────────────────────────────────────

struct CompileOutput {
    model: Option<Model>,
    diagnostics: Vec<Diagnostic>,
    no_hcl_files: bool,
}

fn load_and_compile(dir: &Path) -> CompileOutput {
    let mut hcl_files: Vec<PathBuf> = WalkDir::new(dir)
        .max_depth(1)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file() && e.path().extension().is_some_and(|x| x == "hcl"))
        .map(|e| e.path().to_path_buf())
        .collect();
    hcl_files.sort();

    if hcl_files.is_empty() {
        return CompileOutput {
            model: None,
            diagnostics: vec![],
            no_hcl_files: true,
        };
    }

    let mut sources = Vec::new();
    for path in &hcl_files {
        match std::fs::read_to_string(path) {
            Ok(content) => sources.push(Source {
                filename: path.display().to_string(),
                content,
            }),
            Err(e) => {
                return CompileOutput {
                    model: None,
                    diagnostics: vec![Diagnostic::error(
                        "E000",
                        format!("cannot read {}: {e}", path.display()),
                    )],
                    no_hcl_files: false,
                };
            }
        }
    }

    let result = rhizz_core::compile(&sources);
    CompileOutput {
        model: result.model,
        diagnostics: result.diagnostics,
        no_hcl_files: false,
    }
}

// ── Notify helper ─────────────────────────────────────────────────────────────

fn is_hcl_event(event: &notify::Event) -> bool {
    use notify::EventKind::{Create, Modify, Remove};
    matches!(event.kind, Create(_) | Modify(_) | Remove(_))
        && event
            .paths
            .iter()
            .any(|p| p.extension().is_some_and(|ext| ext == "hcl"))
}

// ── App ───────────────────────────────────────────────────────────────────────

struct RhizzApp {
    path: PathBuf,
    /// Last valid model — kept alive when a recompile produces hard errors.
    model: Option<Model>,
    diagnostics: Vec<Diagnostic>,
    no_hcl_files: bool,
    rx: mpsc::Receiver<CompileOutput>,
    /// Index of the currently selected view tab.
    selected_view: usize,
}

impl RhizzApp {
    fn new(path: PathBuf, cc: &eframe::CreationContext) -> Self {
        // Initial compile on the main thread.
        let initial = load_and_compile(&path);
        let model = initial.model;
        let diagnostics = initial.diagnostics;
        let no_hcl_files = initial.no_hcl_files;

        // Spawn background watcher thread that recompiles on .hcl changes.
        let (tx, rx) = mpsc::channel::<CompileOutput>();
        let watch_path = path.clone();
        let egui_ctx = cc.egui_ctx.clone();

        std::thread::spawn(move || {
            let (notify_tx, notify_rx) = mpsc::channel::<notify::Result<notify::Event>>();
            let mut watcher = match notify::recommended_watcher(notify_tx) {
                Ok(w) => w,
                Err(_) => return,
            };
            if watcher
                .watch(&watch_path, RecursiveMode::NonRecursive)
                .is_err()
            {
                return;
            }

            const DEBOUNCE: Duration = Duration::from_millis(200);
            const POLL: Duration = Duration::from_millis(100);

            loop {
                match notify_rx.recv_timeout(POLL) {
                    Ok(Ok(event)) if is_hcl_event(&event) => {
                        // Drain events within the debounce window.
                        let deadline = Instant::now() + DEBOUNCE;
                        loop {
                            let remaining = deadline.saturating_duration_since(Instant::now());
                            if remaining.is_zero() {
                                break;
                            }
                            match notify_rx.recv_timeout(remaining) {
                                Ok(_) => {}
                                Err(_) => break,
                            }
                        }
                        let output = load_and_compile(&watch_path);
                        if tx.send(output).is_err() {
                            break;
                        }
                        egui_ctx.request_repaint();
                    }
                    Ok(_) => {}
                    Err(mpsc::RecvTimeoutError::Timeout) => {}
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                }
            }
        });

        Self {
            path,
            model,
            diagnostics,
            no_hcl_files,
            rx,
            selected_view: 0,
        }
    }

    /// Apply a fresh `CompileOutput` from the watcher thread.
    fn apply(&mut self, output: CompileOutput) {
        self.diagnostics = output.diagnostics;
        self.no_hcl_files = output.no_hcl_files;
        if output.no_hcl_files {
            // All files removed — clear the model too.
            self.model = None;
            self.selected_view = 0;
        } else if let Some(m) = output.model {
            // Successful compile — update model and reset tab selection.
            self.selected_view = 0;
            self.model = Some(m);
        }
        // If model is None but no_hcl_files is false, hard errors occurred;
        // keep self.model as the last valid fallback.
    }
}

impl eframe::App for RhizzApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        // Drain all pending compile results from the background thread.
        while let Ok(output) = self.rx.try_recv() {
            self.apply(output);
        }

        // ── Left sidebar: systems / components / interfaces ───────────────────
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
                        for &iid in &system.interfaces {
                            let iface = &model.interfaces[iid.0];
                            ui.label(
                                egui::RichText::new(format!("  ⇄ {}", iface.label))
                                    .color(Color32::from_rgb(100, 150, 220)),
                            );
                        }
                    }
                } else {
                    ui.label(egui::RichText::new("(no model)").italics());
                }
            });
        });

        // ── Bottom panel: status bar + diagnostics ────────────────────────────
        egui::TopBottomPanel::bottom("diagnostics")
            .resizable(true)
            .min_height(80.0)
            .show(ctx, |ui| {
                // Status bar row.
                ui.horizontal(|ui| {
                    ui.heading("Diagnostics");
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        let errors = self.diagnostics.iter().filter(|d| d.is_error()).count();
                        let warnings = self.diagnostics.iter().filter(|d| d.is_warning()).count();
                        if self.no_hcl_files {
                            ui.label(
                                egui::RichText::new("⚠ no .hcl files")
                                    .color(Color32::from_rgb(220, 180, 60)),
                            );
                        } else if errors > 0 {
                            ui.label(
                                egui::RichText::new(format!(
                                    "✗ {errors} error(s), {warnings} warning(s)"
                                ))
                                .color(Color32::from_rgb(220, 80, 80)),
                            );
                        } else if warnings > 0 {
                            ui.label(
                                egui::RichText::new(format!("⚠ {warnings} warning(s)"))
                                    .color(Color32::from_rgb(220, 180, 60)),
                            );
                        } else {
                            ui.label(egui::RichText::new("✓ OK").color(Color32::GREEN));
                        }
                    });
                });
                ui.separator();
                egui::ScrollArea::vertical().show(ui, |ui| {
                    if self.diagnostics.is_empty() && !self.no_hcl_files {
                        ui.label(egui::RichText::new("No issues.").color(Color32::GREEN));
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

        // ── Central panel: view tabs + graph rendering ────────────────────────
        egui::CentralPanel::default().show(ctx, |ui| {
            if self.no_hcl_files {
                ui.add_space(20.0);
                ui.label(
                    egui::RichText::new(format!(
                        "No .hcl files found in {}.\nDid you select the right directory?",
                        self.path.display()
                    ))
                    .color(Color32::from_rgb(220, 180, 60))
                    .size(16.0),
                );
                return;
            }

            let Some(ref model) = self.model else {
                ui.heading("rhizz");
                ui.label(format!("Project: {}", self.path.display()));
                return;
            };

            if model.views.is_empty() {
                ui.heading("rhizz");
                ui.label(format!("Project: {}", self.path.display()));
                ui.separator();
                ui.label(format!(
                    "{} system(s), {} component(s), {} interface(s)",
                    model.systems.len(),
                    model.components.len(),
                    model.interfaces.len(),
                ));
                return;
            }

            // Clamp selected_view in case a recompile produced fewer views.
            if self.selected_view >= model.views.len() {
                self.selected_view = 0;
            }

            // ── Tab bar ───────────────────────────────────────────────────────
            ui.horizontal(|ui| {
                for (i, view) in model.views.iter().enumerate() {
                    let label = egui::RichText::new(&view.label);
                    let label = if i == self.selected_view {
                        label.strong()
                    } else {
                        label
                    };
                    if ui
                        .selectable_label(i == self.selected_view, label)
                        .clicked()
                    {
                        self.selected_view = i;
                    }
                }
            });
            ui.separator();

            // ── Graph canvas ──────────────────────────────────────────────────
            let view = &model.views[self.selected_view];
            draw_view(ui, model, view);
        });
    }
}

// ── EguiBackend ───────────────────────────────────────────────────────────────

fn layout_color_to_egui(c: &LayoutColor) -> Color32 {
    // to_web_color() returns "#rrggbbaa"
    let web = c.to_web_color();
    let hex = u32::from_str_radix(web.trim_start_matches('#'), 16).unwrap_or(0x000000ff);
    let r = ((hex >> 24) & 0xff) as u8;
    let g = ((hex >> 16) & 0xff) as u8;
    let b = ((hex >> 8) & 0xff) as u8;
    let a = (hex & 0xff) as u8;
    Color32::from_rgba_unmultiplied(r, g, b, a)
}

struct EguiBackend<'p> {
    painter: &'p egui::Painter,
    offset: egui::Vec2,
    clip_counter: usize,
}

impl<'p> EguiBackend<'p> {
    fn new(painter: &'p egui::Painter, offset: egui::Vec2) -> Self {
        Self {
            painter,
            offset,
            clip_counter: 0,
        }
    }

    fn pt(&self, p: Point) -> egui::Pos2 {
        egui::pos2(p.x as f32 + self.offset.x, p.y as f32 + self.offset.y)
    }
}

impl RenderBackend for EguiBackend<'_> {
    fn draw_rect(
        &mut self,
        xy: Point,
        size: Point,
        look: &StyleAttr,
        _properties: Option<String>,
        _clip: Option<ClipHandle>,
    ) {
        let min = self.pt(xy);
        let max = self.pt(Point::new(xy.x + size.x, xy.y + size.y));
        let rect = egui::Rect::from_min_max(min, max);
        let corner_radius = egui::CornerRadius::same(look.rounded as u8);
        let fill = look
            .fill_color
            .map(|c| layout_color_to_egui(&c))
            .unwrap_or(Color32::TRANSPARENT);
        let stroke_color = layout_color_to_egui(&look.line_color);
        let stroke_width = look.line_width as f32;
        self.painter.rect_filled(rect, corner_radius, fill);
        self.painter.rect_stroke(
            rect,
            corner_radius,
            egui::Stroke::new(stroke_width, stroke_color),
            egui::StrokeKind::Outside,
        );
    }

    fn draw_line(
        &mut self,
        start: Point,
        stop: Point,
        look: &StyleAttr,
        _properties: Option<String>,
    ) {
        let stroke = egui::Stroke::new(
            look.line_width as f32,
            layout_color_to_egui(&look.line_color),
        );
        self.painter
            .line_segment([self.pt(start), self.pt(stop)], stroke);
    }

    fn draw_circle(
        &mut self,
        xy: Point,
        size: Point,
        look: &StyleAttr,
        _properties: Option<String>,
    ) {
        let center = self.pt(xy);
        let radius = (size.x.min(size.y) / 2.0) as f32;
        let fill = look
            .fill_color
            .map(|c| layout_color_to_egui(&c))
            .unwrap_or(Color32::TRANSPARENT);
        let stroke = egui::Stroke::new(
            look.line_width as f32,
            layout_color_to_egui(&look.line_color),
        );
        self.painter.circle(center, radius, fill, stroke);
    }

    fn draw_text(&mut self, xy: Point, text: &str, look: &StyleAttr) {
        let pos = self.pt(xy);
        let font_size = look.font_size as f32;
        self.painter.text(
            pos,
            egui::Align2::CENTER_CENTER,
            text,
            egui::FontId::proportional(font_size),
            Color32::BLACK,
        );
    }

    fn draw_arrow(
        &mut self,
        path: &[(Point, Point)],
        _dashed: bool,
        head: (bool, bool),
        look: &StyleAttr,
        _properties: Option<String>,
        text: &str,
    ) {
        if path.is_empty() {
            return;
        }
        let stroke = egui::Stroke::new(
            look.line_width as f32,
            layout_color_to_egui(&look.line_color),
        );

        // Draw the path as connected line segments.
        let points: Vec<egui::Pos2> = path.iter().map(|(p, _)| self.pt(*p)).collect();
        for i in 0..points.len().saturating_sub(1) {
            self.painter
                .line_segment([points[i], points[i + 1]], stroke);
        }

        // Arrowhead at the end.
        if head.1 && points.len() >= 2 {
            let tip = points[points.len() - 1];
            let prev = points[points.len() - 2];
            let dir = (tip - prev).normalized();
            let perp = egui::vec2(-dir.y, dir.x);
            let arrow_len = 10.0_f32;
            let half_w = 4.0_f32;
            let a = tip - dir * arrow_len + perp * half_w;
            let b = tip - dir * arrow_len - perp * half_w;
            self.painter.add(egui::Shape::convex_polygon(
                vec![tip, a, b],
                stroke.color,
                stroke,
            ));
        }

        // Arrowhead at the start.
        if head.0 && points.len() >= 2 {
            let tip = points[0];
            let next = points[1];
            let dir = (tip - next).normalized();
            let perp = egui::vec2(-dir.y, dir.x);
            let arrow_len = 10.0_f32;
            let half_w = 4.0_f32;
            let a = tip - dir * arrow_len + perp * half_w;
            let b = tip - dir * arrow_len - perp * half_w;
            self.painter.add(egui::Shape::convex_polygon(
                vec![tip, a, b],
                stroke.color,
                stroke,
            ));
        }

        // Edge label (if any).
        if !text.is_empty() && points.len() >= 2 {
            let mid = points[points.len() / 2];
            self.painter.text(
                mid,
                egui::Align2::CENTER_CENTER,
                text,
                egui::FontId::proportional(look.font_size as f32),
                Color32::BLACK,
            );
        }
    }

    fn create_clip(&mut self, _xy: Point, _size: Point, _rounded_px: usize) -> ClipHandle {
        let handle = self.clip_counter;
        self.clip_counter += 1;
        handle
    }
}

// ── Graph rendering ───────────────────────────────────────────────────────────

fn draw_view(ui: &mut egui::Ui, model: &Model, view: &rhizz_core::View) {
    use layout::gv;

    let dot = rhizz_dot::render_view(model, view);
    let mut parser = gv::DotParser::new(&dot);

    match parser.process() {
        Ok(graph) => {
            let mut builder = gv::GraphBuilder::new();
            builder.visit_graph(&graph);
            let mut vg = builder.get();

            let available = ui.available_size();
            egui::ScrollArea::both().show(ui, |ui| {
                // Reserve a drawing area at least as large as the viewport.
                let (resp, painter) = ui.allocate_painter(
                    available.max(egui::vec2(800.0, 600.0)),
                    egui::Sense::hover(),
                );
                let offset = resp.rect.min.to_vec2();
                let mut backend = EguiBackend::new(&painter, offset);
                vg.do_it(false, false, false, &mut backend);
            });
        }
        Err(e) => {
            ui.label(
                egui::RichText::new(format!("DOT parse error: {e}"))
                    .color(Color32::from_rgb(220, 80, 80)),
            );
        }
    }
}
