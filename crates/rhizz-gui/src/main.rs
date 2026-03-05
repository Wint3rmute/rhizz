//! `rhizz-gui` — desktop GUI frontend for the rhizz MBSE tool.
//!
//! Usage: `rhizz-gui <project-dir>`

use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use egui::Color32;
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
        }
    }

    /// Apply a fresh `CompileOutput` from the watcher thread.
    fn apply(&mut self, output: CompileOutput) {
        self.diagnostics = output.diagnostics;
        self.no_hcl_files = output.no_hcl_files;
        if output.no_hcl_files {
            // All files removed — clear the model too.
            self.model = None;
        } else if let Some(m) = output.model {
            // Successful compile — update model.
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

        // ── Central panel: project info ───────────────────────────────────────
        egui::CentralPanel::default().show(ctx, |ui| {
            ui.heading("rhizz");
            ui.label(format!("Project: {}", self.path.display()));
            ui.separator();

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
            } else if let Some(ref model) = self.model {
                ui.label(format!(
                    "{} system(s), {} component(s), {} interface(s)",
                    model.systems.len(),
                    model.components.len(),
                    model.interfaces.len(),
                ));
            }
        });
    }
}
