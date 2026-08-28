//! Command-line interface: argument parsing, pipeline orchestration, and output
//! formatting.

use std::io::{IsTerminal, Write as _};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, mpsc};
use std::time::{Duration, Instant};

use anyhow::Context as _;
use clap::{Parser, Subcommand};
use walkdir::WalkDir;

use rhizz_core::{Diagnostic, DiagnosticCode, Source};

// ── CLI argument types ───────────────────────────────────────────────────────

/// MBSE model checker and view generator.
#[derive(Parser, Debug)]
#[command(
    name = "rhizz",
    version,
    about = "MBSE model checker and view generator"
)]
pub struct Cli {
    /// Subcommand to run (defaults to `build`).
    #[command(subcommand)]
    pub command: Option<Command>,

    /// Path to project directory containing .hcl files (used when no subcommand given).
    #[arg(default_value = ".")]
    pub path: PathBuf,

    /// Output directory for generated .dot files.
    #[arg(short, long, default_value = "./out/", global = true)]
    pub output_dir: PathBuf,

    /// Treat warnings as errors.
    #[arg(long, global = true)]
    pub strict: bool,

    /// JSON output for CI/CD.
    #[arg(long, global = true)]
    pub json: bool,

    /// Only generate a specific view.
    #[arg(long, global = true)]
    pub view: Option<String>,

    /// Disable colored output.
    #[arg(long, global = true)]
    pub no_color: bool,
}

/// Available subcommands.
#[derive(Subcommand, Debug, Clone, PartialEq, Eq)]
pub enum Command {
    /// Parse all .hcl files, validate, print errors/warnings.
    Check {
        /// Path to project directory containing .hcl files.
        #[arg(default_value = ".")]
        path: PathBuf,
    },
    /// Run check, then print the completion report.
    Score {
        /// Path to project directory containing .hcl files.
        #[arg(default_value = ".")]
        path: PathBuf,
    },
    /// Run check, then generate .dot files for all (or selected) views.
    Views {
        /// Path to project directory containing .hcl files.
        #[arg(default_value = ".")]
        path: PathBuf,
    },
    /// Run check + score + views in sequence (default).
    Build {
        /// Path to project directory containing .hcl files.
        #[arg(default_value = ".")]
        path: PathBuf,
    },
    /// Run check + score + views, then watch for .hcl changes and re-run.
    Watch {
        /// Path to project directory containing .hcl files.
        #[arg(default_value = ".")]
        path: PathBuf,
    },
}

/// Effective command kind (without the path).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CommandKind {
    /// Parse all .hcl files, validate, print errors/warnings.
    Check,
    /// Run check, then print the completion report.
    Score,
    /// Run check, then generate .dot files for all (or selected) views.
    Views,
    /// Run check + score + views in sequence (default).
    Build,
    /// Watch for .hcl changes and re-run Build automatically.
    Watch,
}

impl Cli {
    /// Returns the effective command kind and the project path.
    const fn effective(&self) -> (CommandKind, &PathBuf) {
        match &self.command {
            Some(Command::Check { path }) => (CommandKind::Check, path),
            Some(Command::Score { path }) => (CommandKind::Score, path),
            Some(Command::Views { path }) => (CommandKind::Views, path),
            Some(Command::Build { path }) => (CommandKind::Build, path),
            Some(Command::Watch { path }) => (CommandKind::Watch, path),
            None => (CommandKind::Build, &self.path),
        }
    }
}

// ── I/O helpers ───────────────────────────────────────────────────────────────

/// Recursively walk `dir` and return a [`Source`] for every `.hcl` file found.
///
/// Files are sorted by path so that the compilation order is deterministic.
fn load_sources(dir: &Path) -> anyhow::Result<Vec<Source>> {
    let mut hcl_files: Vec<PathBuf> = WalkDir::new(dir)
        .into_iter()
        .filter_map(std::result::Result::ok)
        .filter(|e| e.file_type().is_file() && e.path().extension().is_some_and(|ext| ext == "hcl"))
        .map(|e| e.path().to_path_buf())
        .collect();
    hcl_files.sort();

    if hcl_files.is_empty() {
        anyhow::bail!("no .hcl files found in {}", dir.display());
    }

    let mut sources = Vec::new();
    for path in &hcl_files {
        let content = std::fs::read_to_string(path)
            .with_context(|| format!("cannot read {}", path.display()))?;
        sources.push(Source {
            filename: path.display().to_string(),
            content,
        });
    }
    Ok(sources)
}

// ── Color helper ─────────────────────────────────────────────────────────────

/// Returns `true` when ANSI colors should be used.
fn use_color(cli: &Cli) -> bool {
    if cli.no_color {
        return false;
    }
    if std::env::var_os("NO_COLOR").is_some() {
        return false;
    }
    std::io::stdout().is_terminal()
}

// ── Diagnostic formatting ────────────────────────────────────────────────────

/// Format a single [`Diagnostic`] as a human-readable line.
fn format_diagnostic(d: &Diagnostic, color: bool) -> String {
    let location = match (&d.file, d.line) {
        (Some(f), Some(l)) => format!("{}:{}", f.display(), l),
        (Some(f), None) => format!("{}", f.display()),
        _ => String::new(),
    };

    if !color {
        let icon = if d.is_error() { "✗" } else { "⚠" };
        return if location.is_empty() {
            format!("{} {}  {}", icon, d.code, d.message)
        } else {
            format!("{} {}  {}  {}", icon, d.code, location, d.message)
        };
    }

    // Colourise: red for errors, yellow for warnings.
    use owo_colors::OwoColorize;
    if d.is_error() {
        if location.is_empty() {
            format!("{} {}  {}", "✗".red(), d.code.red(), d.message)
        } else {
            format!(
                "{} {}  {}  {}",
                "✗".red(),
                d.code.red(),
                location,
                d.message
            )
        }
    } else if location.is_empty() {
        format!("{} {}  {}", "⚠".yellow(), d.code.yellow(), d.message)
    } else {
        format!(
            "{} {}  {}  {}",
            "⚠".yellow(),
            d.code.yellow(),
            location,
            d.message
        )
    }
}

/// Print the summary line, e.g. `1 error, 2 warnings — aborting (fix errors to continue)`.
fn format_summary(errors: usize, warnings: usize, has_errors: bool) -> String {
    let e_word = if errors == 1 { "error" } else { "errors" };
    let w_word = if warnings == 1 { "warning" } else { "warnings" };
    let base = format!("{errors} {e_word}, {warnings} {w_word}");
    if has_errors {
        format!("{base} — aborting (fix errors to continue)")
    } else {
        base
    }
}

// ── JSON output types ────────────────────────────────────────────────────────

/// JSON representation of a diagnostic.
#[derive(serde::Serialize)]
struct JsonDiagnostic {
    /// Diagnostic code.
    code: String,
    /// Source file path.
    file: String,
    /// Source line number.
    #[serde(skip_serializing_if = "Option::is_none")]
    line: Option<u32>,
    /// Human-readable message.
    message: String,
}

/// JSON representation of a category score.
#[derive(serde::Serialize)]
struct JsonCategoryScore {
    /// Number of complete entities.
    complete: usize,
    /// Total number of entities.
    total: usize,
}

/// JSON representation of the overall score.
#[derive(serde::Serialize)]
struct JsonOverallScore {
    /// Number of complete entities.
    complete: usize,
    /// Total number of entities.
    total: usize,
    /// Percentage complete (0.0 – 100.0).
    percent: f64,
}

/// JSON representation of the score report.
#[derive(serde::Serialize)]
struct JsonScore {
    /// Project/system name.
    system: String,
    /// Component scoring.
    components: JsonCategoryScore,
    /// Port scoring.
    ports: JsonCategoryScore,
    /// Connection scoring.
    connections: JsonCategoryScore,
    /// Message scoring.
    messages: JsonCategoryScore,
    /// Overall scoring.
    overall: JsonOverallScore,
}

/// JSON representation of a generated view.
#[derive(serde::Serialize)]
struct JsonView {
    /// View name.
    name: String,
    /// Output file path.
    file: String,
}

/// Top-level JSON output object.
#[derive(serde::Serialize)]
struct JsonOutput {
    /// Error diagnostics.
    errors: Vec<JsonDiagnostic>,
    /// Warning diagnostics.
    warnings: Vec<JsonDiagnostic>,
    /// Score report (present only if check passed).
    #[serde(skip_serializing_if = "Option::is_none")]
    score: Option<JsonScore>,
    /// Generated views (present only if views were generated).
    #[serde(skip_serializing_if = "Option::is_none")]
    views: Option<Vec<JsonView>>,
}

/// Convert a [`Diagnostic`] to its JSON representation.
fn to_json_diagnostic(d: &Diagnostic) -> JsonDiagnostic {
    JsonDiagnostic {
        code: d.code.to_string(),
        file: d
            .file
            .as_ref()
            .map(|f| f.display().to_string())
            .unwrap_or_default(),
        line: d.line,
        message: d.message.clone(),
    }
}

// ── Pipeline ─────────────────────────────────────────────────────────────────

/// Run the CLI pipeline and return the process exit code.
fn run_pipeline(cli: &Cli, cmd: CommandKind, path: &Path, color: bool) -> i32 {
    // ── Load sources ──────────────────────────────────────────────────────────
    let sources = match load_sources(path) {
        Ok(s) => s,
        Err(e) => {
            if cli.json {
                let out = JsonOutput {
                    errors: vec![JsonDiagnostic {
                        code: "E000".to_owned(),
                        file: String::new(),
                        line: None,
                        message: format!("{e:#}"),
                    }],
                    warnings: vec![],
                    score: None,
                    views: None,
                };
                println!(
                    "{}",
                    serde_json::to_string_pretty(&out).expect("JSON serialisation")
                );
            } else {
                let d = Diagnostic::error(DiagnosticCode::E000, format!("{e:#}"));
                eprintln!("{}", format_diagnostic(&d, color));
                eprintln!("{}", format_summary(1, 0, true));
            }
            return 1;
        }
    };

    // ── Compile (parse + resolve + validate) ──────────────────────────────────
    let result = rhizz_core::compile(&sources);
    let model = result.model;
    let diagnostics = result.diagnostics;

    let errors: Vec<&Diagnostic> = diagnostics.iter().filter(|d| d.is_error()).collect();
    let warnings: Vec<&Diagnostic> = diagnostics.iter().filter(|d| d.is_warning()).collect();
    let has_errors = !errors.is_empty();
    let has_warnings = !warnings.is_empty();

    // Under --strict, warnings count as errors for exit code purposes.
    let effective_failure = has_errors || (cli.strict && has_warnings);

    // ── Score (if check passed and command requires it) ────────────────────────
    let score_report = if !has_errors && matches!(cmd, CommandKind::Score | CommandKind::Build) {
        model.as_ref().map(rhizz_core::score)
    } else {
        None
    };

    // ── Output ────────────────────────────────────────────────────────────────
    if cli.json {
        let json_out = JsonOutput {
            errors: errors.iter().map(|d| to_json_diagnostic(d)).collect(),
            warnings: warnings.iter().map(|d| to_json_diagnostic(d)).collect(),
            score: score_report.as_ref().map(|r| JsonScore {
                system: r.project_name.clone(),
                components: JsonCategoryScore {
                    complete: r.components.complete,
                    total: r.components.total(),
                },
                ports: JsonCategoryScore {
                    complete: r.ports.complete,
                    total: r.ports.total(),
                },
                connections: JsonCategoryScore {
                    complete: r.connections.complete,
                    total: r.connections.total(),
                },
                messages: JsonCategoryScore {
                    complete: r.messages.complete,
                    total: r.messages.total(),
                },
                overall: JsonOverallScore {
                    complete: r.overall_complete(),
                    total: r.overall_total(),
                    // Round to one decimal place for clean JSON output.
                    percent: (r.overall_percentage() * 10.0).round() / 10.0,
                },
            }),
            views: None,
        };
        println!(
            "{}",
            serde_json::to_string_pretty(&json_out).expect("JSON serialisation")
        );
    } else {
        // Print diagnostics.
        for d in &diagnostics {
            eprintln!("{}", format_diagnostic(d, color));
        }

        // Summary line.
        if has_errors || has_warnings {
            eprintln!(
                "{}",
                format_summary(errors.len(), warnings.len(), has_errors)
            );
        }

        // Score report.
        if let Some(ref report) = score_report {
            println!("{report}");
        }
    }

    i32::from(effective_failure)
}

// ── Public entry point ────────────────────────────────────────────────────────

/// Dispatch to the appropriate pipeline based on the parsed CLI command.
#[must_use]
pub fn run(cli: &Cli) -> i32 {
    let color = use_color(cli);
    let (cmd, path) = cli.effective();

    if cmd == CommandKind::Watch {
        let running = Arc::new(AtomicBool::new(true));
        let r = running.clone();
        // Best-effort: a second call (e.g. in parallel tests) returns an error we can ignore.
        let _ = ctrlc::set_handler(move || r.store(false, Ordering::SeqCst));
        return run_watch(cli, path, color, running);
    }

    run_pipeline(cli, cmd, path, color)
}

// ── Watch ─────────────────────────────────────────────────────────────────────

/// Run the build pipeline once, then re-run it every time an `.hcl` file in
/// `path` is created, modified, or deleted.  Exits cleanly on Ctrl-C.
fn run_watch(cli: &Cli, path: &Path, color: bool, running: Arc<AtomicBool>) -> i32 {
    use notify::{RecursiveMode, Watcher};

    if color {
        use owo_colors::OwoColorize as _;
        eprintln!("Watching {} for changes…", path.display().cyan());
    } else {
        eprintln!("Watching {} for changes…", path.display());
    }

    // Initial build.
    run_pipeline(cli, CommandKind::Build, path, color);

    // Set up the file-system watcher.
    let (tx, rx) = mpsc::channel::<notify::Result<notify::Event>>();
    let mut watcher = match notify::recommended_watcher(tx) {
        Ok(w) => w,
        Err(e) => {
            eprintln!("Error: cannot create file watcher: {e}");
            return 1;
        }
    };
    if let Err(e) = watcher.watch(path, RecursiveMode::NonRecursive) {
        eprintln!("Error: cannot watch {}: {e}", path.display());
        return 1;
    }

    const DEBOUNCE: Duration = Duration::from_millis(200);
    const POLL: Duration = Duration::from_millis(100);

    while running.load(Ordering::SeqCst) {
        match rx.recv_timeout(POLL) {
            Ok(Ok(event)) if is_hcl_event(&event) => {
                // Consume any additional events that arrive within the debounce window
                // so a single logical save does not trigger multiple rebuilds.
                drain_debounce(&rx, DEBOUNCE);
                // Clear the terminal before each rebuild for a clean view.
                // Flush stdout immediately so the clear fires before any stderr
                // diagnostic output (stderr is unbuffered; stdout is not).
                print!("\x1B[2J\x1B[1;1H");
                let _ = std::io::stdout().flush();
                run_pipeline(cli, CommandKind::Build, path, color);
            }
            Ok(_) => {}
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }

    if color {
        use owo_colors::OwoColorize as _;
        eprintln!("{}", "Stopped watching.".dimmed());
    } else {
        eprintln!("Stopped watching.");
    }
    0
}

/// Return `true` if `event` is a create/modify/remove on an `.hcl` file.
fn is_hcl_event(event: &notify::Event) -> bool {
    use notify::EventKind::{Create, Modify, Remove};
    matches!(event.kind, Create(_) | Modify(_) | Remove(_))
        && event
            .paths
            .iter()
            .any(|p| p.extension().is_some_and(|ext| ext == "hcl"))
}

/// Drain the watch receiver for `window` to batch rapid successive events.
/// Returns the count of additional events consumed.
fn drain_debounce(rx: &mpsc::Receiver<notify::Result<notify::Event>>, window: Duration) -> usize {
    let deadline = Instant::now() + window;
    let mut count = 0;
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            break;
        }
        match rx.recv_timeout(remaining) {
            Ok(_) => count += 1,
            Err(_) => break,
        }
    }
    count
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use clap::Parser;
    use std::path::PathBuf;

    /// Helper: path to an example directory.
    fn example_dir(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../examples")
            .join(name)
    }

    /// Helper: build a [`Cli`] from a list of string arguments.
    fn parse_args(args: &[&str]) -> Cli {
        let mut full = vec!["rhizz"];
        full.extend_from_slice(args);
        Cli::parse_from(full)
    }

    // ── diagnostic formatting ─────────────────────────────────────────────

    #[test]
    fn format_error_no_color() {
        let d = Diagnostic::error(DiagnosticCode::E002, "test error message");
        let out = format_diagnostic(&d, false);
        assert!(out.contains("✗"));
        assert!(out.contains("E002"));
        assert!(out.contains("test error message"));
    }

    #[test]
    fn format_warning_no_color() {
        let d = Diagnostic::warning(DiagnosticCode::W001, "test warning");
        let out = format_diagnostic(&d, false);
        assert!(out.contains("⚠"));
        assert!(out.contains("W001"));
        assert!(out.contains("test warning"));
    }

    #[test]
    fn format_diagnostic_with_file_and_line() {
        let d = Diagnostic {
            code: DiagnosticCode::E002,
            file: Some(PathBuf::from("connections.hcl")),
            line: Some(14),
            message: "test message".to_owned(),
        };
        let out = format_diagnostic(&d, false);
        assert!(out.contains("connections.hcl:14"));
    }

    #[test]
    fn format_summary_with_errors() {
        let out = format_summary(1, 2, true);
        assert!(out.contains("1 error, 2 warnings"));
        assert!(out.contains("aborting"));
    }

    #[test]
    fn format_summary_no_errors() {
        let out = format_summary(0, 3, false);
        assert!(out.contains("0 errors, 3 warnings"));
        assert!(!out.contains("aborting"));
    }

    // ── CLI parsing ───────────────────────────────────────────────────────

    #[test]
    fn parse_default_command() {
        let cli = parse_args(&["examples/drone"]);
        assert!(cli.command.is_none());
        assert_eq!(cli.path, PathBuf::from("examples/drone"));
    }

    #[test]
    fn parse_build_subcommand() {
        let cli = parse_args(&["build", "examples/drone"]);
        assert!(
            matches!(cli.command, Some(Command::Build { .. })),
            "expected Build subcommand"
        );
    }

    #[test]
    fn parse_check_subcommand_with_strict() {
        let cli = parse_args(&["check", "examples/drone", "--strict"]);
        assert!(matches!(cli.command, Some(Command::Check { .. })));
        assert!(cli.strict);
    }

    #[test]
    fn parse_json_flag() {
        let cli = parse_args(&["--json", "examples/drone"]);
        assert!(cli.json);
    }

    // ── pipeline (unit-level) ─────────────────────────────────────────────

    #[test]
    fn run_build_drone_exit_0() {
        let out_dir = tempfile::tempdir().expect("tempdir");
        let cli = parse_args(&[
            "build",
            example_dir("drone").to_str().unwrap(),
            "--output-dir",
            out_dir.path().to_str().unwrap(),
            "--no-color",
        ]);
        let code = run(&cli);
        assert_eq!(code, 0, "drone build should exit 0");
    }

    #[test]
    fn run_build_social_media_exit_0() {
        let out_dir = tempfile::tempdir().expect("tempdir");
        let cli = parse_args(&[
            "build",
            example_dir("social-media").to_str().unwrap(),
            "--output-dir",
            out_dir.path().to_str().unwrap(),
            "--no-color",
        ]);
        let code = run(&cli);
        assert_eq!(code, 0, "social-media build should exit 0");
    }

    #[test]
    fn run_build_software_house_exit_0() {
        let out_dir = tempfile::tempdir().expect("tempdir");
        let cli = parse_args(&[
            "build",
            example_dir("software-house").to_str().unwrap(),
            "--output-dir",
            out_dir.path().to_str().unwrap(),
            "--no-color",
        ]);
        let code = run(&cli);
        assert_eq!(code, 0, "software-house build should exit 0");
    }

    #[test]
    fn run_check_drone_exit_0() {
        let cli = parse_args(&[
            "check",
            example_dir("drone").to_str().unwrap(),
            "--no-color",
        ]);
        let code = run(&cli);
        assert_eq!(code, 0, "drone check should exit 0 (warnings only)");
    }

    #[test]
    fn run_strict_drone_exit_1() {
        let cli = parse_args(&[
            "check",
            example_dir("drone").to_str().unwrap(),
            "--strict",
            "--no-color",
        ]);
        let code = run(&cli);
        assert_eq!(code, 1, "drone check --strict should exit 1 (has warnings)");
    }

    #[test]
    fn run_invalid_path_exit_1() {
        let cli = parse_args(&[
            "check",
            "/nonexistent/path/that/does/not/exist",
            "--no-color",
        ]);
        let code = run(&cli);
        assert_eq!(code, 1, "invalid path should exit 1");
    }

    // ── watch command ─────────────────────────────────────────────────────

    #[test]
    fn parse_watch_subcommand() {
        let cli = parse_args(&["watch", "examples/drone"]);
        assert!(
            matches!(cli.command, Some(Command::Watch { .. })),
            "expected Watch subcommand"
        );
    }

    #[test]
    fn debounce_drains_rapid_events() {
        use std::sync::mpsc;
        use std::time::Duration;

        let (tx, rx) = mpsc::channel::<notify::Result<notify::Event>>();

        // Pre-fill the channel with 5 events before the window starts.
        for _ in 0..5 {
            tx.send(Ok(notify::Event::new(notify::EventKind::Any)))
                .unwrap();
        }
        drop(tx); // close sender so recv_timeout returns Disconnected when empty

        let drained = drain_debounce(&rx, Duration::from_millis(50));
        assert_eq!(drained, 5, "all 5 rapid events should be consumed");
        assert!(
            rx.try_recv().is_err(),
            "channel should be empty after drain"
        );
    }

    #[test]
    fn debounce_does_not_block_past_window() {
        use std::sync::mpsc;
        use std::time::{Duration, Instant};

        // Empty channel — drain should return promptly after the window.
        let (_tx, rx) = mpsc::channel::<notify::Result<notify::Event>>();
        let start = Instant::now();
        let drained = drain_debounce(&rx, Duration::from_millis(50));
        let elapsed = start.elapsed();

        assert_eq!(drained, 0, "nothing to drain");
        // Should exit in roughly the window duration (allow generous slack).
        assert!(
            elapsed < Duration::from_millis(500),
            "drain took too long: {elapsed:?}"
        );
    }
}
