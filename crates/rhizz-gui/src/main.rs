//! `rhizz-gui` — desktop GUI frontend for the rhizz MBSE tool.
//!
//! Usage: `rhizz-gui <project-dir>`

use std::path::{Path, PathBuf};
use std::sync::mpsc;

use egui::Color32;
use layout::backends::svg::SVGWriter;
use layout::gv::{DotParser, GraphBuilder};
use notify::{RecursiveMode, Watcher as _};
use rhizz_core::{Diagnostic, Model, Source};
use tracing::{debug, error, info, warn};
use walkdir::WalkDir;

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
        .max_depth(1)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file() && e.path().extension().is_some_and(|x| x == "hcl"))
        .map(|e| e.path().to_path_buf())
        .collect();
    hcl_files.sort();

    if hcl_files.is_empty() {
        let d = Diagnostic::error("E000", format!("no .hcl files found in {}", dir.display()));
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
                let d = Diagnostic::error("E000", format!("cannot read {}: {e}", path.display()));
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

// ── Graph rendering ────────────────────────────────────────────────────────────

/// Render `view` in `model` to an egui `ColorImage` at the given pixel size.
///
/// Steps:
/// 1. Calls `rhizz_dot::render_view` to get the DOT string.
/// 2. Passes it to `layout-rs` SVG backend to get an SVG string.
/// 3. Rasterizes the SVG at the given pixel dimensions using `resvg`.
/// 4. Returns an `egui::ColorImage` (RGBA).
fn render_view_to_image(
    model: &Model,
    view: &rhizz_core::View,
    size: egui::Vec2,
) -> Result<egui::ColorImage, String> {
    let dot = rhizz_dot::render_view(model, view);

    let mut parser = DotParser::new(&dot);
    let tree = parser
        .process()
        .map_err(|e| format!("layout parse error: {e}"))?;
    let mut gb = GraphBuilder::new();
    gb.visit_graph(&tree);
    let mut vg = gb.get();

    let mut svg_backend = SVGWriter::new();
    vg.do_it(false, false, false, &mut svg_backend);
    let svg_str = svg_backend.finalize();

    let opt = resvg::usvg::Options::default();
    let rtree =
        resvg::usvg::Tree::from_str(&svg_str, &opt).map_err(|e| format!("SVG parse error: {e}"))?;

    let width = (size.x as u32).max(1);
    let height = (size.y as u32).max(1);
    let mut pixmap = resvg::tiny_skia::Pixmap::new(width, height)
        .ok_or_else(|| "failed to create pixmap".to_string())?;

    pixmap.fill(resvg::tiny_skia::Color::WHITE);

    let svg_size = rtree.size();
    let scale_x = width as f32 / svg_size.width();
    let scale_y = height as f32 / svg_size.height();
    let scale = scale_x.min(scale_y);
    let transform = resvg::tiny_skia::Transform::from_scale(scale, scale);
    resvg::render(&rtree, transform, &mut pixmap.as_mut());

    let pixels = pixmap.take_demultiplied();
    Ok(egui::ColorImage::from_rgba_unmultiplied(
        [width as usize, height as usize],
        &pixels,
    ))
}

/// Returns `true` if the connection with the given label is bidirectional
/// (i.e. both endpoint ports have `Peer` role).
#[cfg(test)]
fn is_bidirectional_connection(label: &str, model: &Model) -> bool {
    use rhizz_core::PortRole;
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

// ── App ───────────────────────────────────────────────────────────────────────

struct RhizzApp {
    path: PathBuf,
    model: Option<Model>,
    diagnostics: Vec<Diagnostic>,
    /// Index of the currently-selected view tab.
    selected_view: usize,
    /// Cached texture for each view (None = not yet rendered).
    /// The `egui::Vec2` is the panel size at which the texture was last rendered.
    view_textures: Vec<Option<(egui::TextureHandle, egui::Vec2)>>,
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
                        "W000",
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
                    "W000",
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
            view_textures: vec![None; view_count],
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
            let (model, diagnostics) = load_and_compile(&self.path);
            let view_count = model.as_ref().map_or(0, |m| m.views.len());
            self.model = model;
            self.diagnostics = diagnostics;
            self.view_textures = vec![None; view_count];
            self.selected_view = self.selected_view.min(view_count.saturating_sub(1));
            ctx.request_repaint();
        } else {
            ctx.request_repaint_after(std::time::Duration::from_secs(2));
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
                    let available_size = ui.available_size().max(egui::vec2(1.0, 1.0));

                    // Re-rasterize if panel size changed by more than 4 px on either axis.
                    let needs_render = match self.view_textures.get(idx).and_then(Option::as_ref) {
                        Some((_, stored)) => {
                            (stored.x - available_size.x).abs() > 4.0
                                || (stored.y - available_size.y).abs() > 4.0
                        }
                        None => true,
                    };

                    if needs_render {
                        // Borrow model immutably; result is owned so borrow ends before mutation.
                        let render_result = model
                            .views
                            .get(idx)
                            .map(|view| render_view_to_image(model, view, available_size));
                        match render_result {
                            Some(Ok(image)) => {
                                let handle = ctx.load_texture(
                                    format!("view_{idx}"),
                                    image,
                                    egui::TextureOptions::default(),
                                );
                                if let Some(slot) = self.view_textures.get_mut(idx) {
                                    *slot = Some((handle, available_size));
                                }
                                debug!("View {idx} rasterized at {available_size:?}");
                            }
                            Some(Err(ref e)) => {
                                warn!("render_view_to_image failed for view {idx}: {e}");
                            }
                            None => {}
                        }
                    }

                    egui::ScrollArea::both().show(ui, |ui| {
                        match self.view_textures.get(idx).and_then(Option::as_ref) {
                            Some((handle, _)) => {
                                ui.image(egui::load::SizedTexture::new(
                                    handle.id(),
                                    available_size,
                                ));
                            }
                            None => {
                                ui.label(egui::RichText::new("Rendering…").italics());
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
    use super::{is_bidirectional_connection, is_hcl_event, render_view_to_image};
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
            .max_depth(1)
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

    // ── Task 19: render_view_to_image tests ──────────────────────────────────

    #[test]
    fn drone_overview_renders_non_empty_image() {
        let model = load_example("drone");
        let view = model
            .views
            .iter()
            .find(|v| v.label == "drone-overview")
            .expect("drone-overview view");

        let img = render_view_to_image(&model, view, egui::vec2(800.0, 600.0))
            .expect("render_view_to_image should succeed for drone-overview");

        assert_eq!(
            img.size,
            [800, 600],
            "image dimensions match requested size"
        );
        assert!(!img.pixels.is_empty(), "image has pixels");
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
    fn all_example_views_render_without_error() {
        for example in ["drone", "social-media", "software-house"] {
            let model = load_example(example);
            for view in &model.views {
                render_view_to_image(&model, view, egui::vec2(800.0, 600.0)).unwrap_or_else(|e| {
                    panic!("render failed for {}/{}: {e}", example, view.label)
                });
            }
        }
    }
}
