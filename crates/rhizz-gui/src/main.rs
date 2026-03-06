//! `rhizz-gui` — desktop GUI frontend for the rhizz MBSE tool.
//!
//! Usage: `rhizz-gui <project-dir>`

use std::path::{Path, PathBuf};
use std::sync::mpsc;

use egui::Color32;
use notify::{RecursiveMode, Watcher as _};
use rhizz_core::{Diagnostic, Model, Source};
use tracing::{debug, error, info, warn};
use walkdir::WalkDir;

// Mermaid view renderer (replaces the former rhizz-dot / graphviz path).
use rhizz_mermaid::render_view_png;

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

// ── App ───────────────────────────────────────────────────────────────────────

struct RhizzApp {
    path: PathBuf,
    model: Option<Model>,
    diagnostics: Vec<Diagnostic>,
    /// Index of the currently-selected view tab.
    selected_view: usize,
    /// Cached PNG textures for each view (index matches model.views).
    /// `None` = not yet rendered; `Err(msg)` = render failed.
    view_textures: Vec<Option<Result<egui::TextureHandle, String>>>,
    /// File-system watcher. Kept alive here so it isn't dropped.
    _watcher: Option<notify::RecommendedWatcher>,
    /// Receiver end of the channel the watcher sends events to.
    watch_rx: mpsc::Receiver<notify::Result<notify::Event>>,
}

impl RhizzApp {
    fn new(path: PathBuf) -> Self {
        let (model, mut diagnostics) = load_and_compile(&path);
        let view_count = model.as_ref().map_or(0, |m| m.views.len());

        // Set up a file-system watcher for the project directory.
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
            _watcher: watcher,
            watch_rx,
        }
    }
}

impl eframe::App for RhizzApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        // ── Poll the file-watcher channel and reload on .hcl changes ─────────
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
            // Reset texture cache so views are re-rendered with the new model.
            self.view_textures = vec![None; view_count];
            self.selected_view = self.selected_view.min(view_count.saturating_sub(1));
            ctx.request_repaint();
        } else {
            ctx.request_repaint_after(std::time::Duration::from_secs(2));
        }

        // ── Lazy-render PNG texture for the selected view ─────────────────────
        let view_count = self.model.as_ref().map_or(0, |m| m.views.len());
        if view_count > 0 {
            let idx = self.selected_view.min(view_count - 1);
            if let Some(model) = &self.model
                && let Some(slot) = self.view_textures.get_mut(idx)
                && slot.is_none()
            {
                let result = render_view_png(model, &model.views[idx])
                    .and_then(|png| {
                        let img = image::load_from_memory(&png)
                            .map_err(|e| anyhow::anyhow!("PNG decode: {e}"))?;
                        let rgba = img.into_rgba8();
                        let size = [rgba.width() as usize, rgba.height() as usize];
                        // PNG stores straight (unassociated) alpha per the PNG spec,
                        // so `from_rgba_unmultiplied` is the correct conversion here.
                        let ci = egui::ColorImage::from_rgba_unmultiplied(size, rgba.as_raw());
                        Ok(ctx.load_texture(
                            format!("view_{idx}"),
                            ci,
                            egui::TextureOptions::default(),
                        ))
                    })
                    .map_err(|e| e.to_string());
                if let Err(ref e) = result {
                    warn!("Failed to render view {idx}: {e}");
                } else {
                    debug!("View {idx} texture rendered successfully");
                }
                *slot = Some(result);
            }
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

        // ── Central panel: view tabs + mermaid source ─────────────────────────
        egui::CentralPanel::default().show(ctx, |ui| {
            ui.heading("rhizz");
            ui.label(format!("Project: {}", self.path.display()));

            if let Some(ref model) = self.model {
                ui.label(format!(
                    "{} system(s), {} component(s), {} interface(s)",
                    model.systems.len(),
                    model.components.len(),
                    model.interfaces.len(),
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

                    // ── Rasterized PNG for the selected view ──────────────────
                    // Clamp the index in case the model changed (e.g. after a
                    // future live-reload). model.views is non-empty here (guarded
                    // above by the `model.views.is_empty()` check).
                    let idx = self.selected_view.min(model.views.len() - 1);

                    egui::ScrollArea::both().show(ui, |ui| {
                        match self.view_textures.get(idx).and_then(Option::as_ref) {
                            Some(Ok(texture)) => {
                                ui.image(texture);
                            }
                            Some(Err(e)) => {
                                ui.colored_label(
                                    Color32::from_rgb(220, 80, 80),
                                    format!("Render error: {e}"),
                                );
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

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::is_hcl_event;
    use notify::{Event, EventKind};
    use std::path::PathBuf;

    fn make_event(kind: EventKind, paths: Vec<PathBuf>) -> Event {
        Event {
            kind,
            paths,
            attrs: Default::default(),
        }
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
}
