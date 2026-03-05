//! `rhizz-gui` — desktop GUI frontend for the rhizz MBSE tool.
//!
//! Usage: `rhizz-gui <project-dir>`

use std::path::PathBuf;

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
        Box::new(|_cc| Ok(Box::new(RhizzApp { _path: path }))),
    )
    .map_err(|e| anyhow::anyhow!("eframe error: {e}"))
}

struct RhizzApp {
    _path: PathBuf,
}

impl eframe::App for RhizzApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        egui::CentralPanel::default().show(ctx, |ui| {
            ui.heading("rhizz");
            ui.label(format!("Project: {}", self._path.display()));
        });
    }
}
