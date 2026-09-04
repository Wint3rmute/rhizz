//! Binary entry point for the `` ```rhizz `` mdBook preprocessor.
//!
//! Implements the mdbook 0.5.x protocol:
//! * `rhizz-book supports <renderer>` — exit 0 when the renderer is supported.
//! * otherwise reads a `[context, book]` JSON document from stdin, runs the
//!   pipeline, and writes the transformed book JSON to stdout.

#![deny(clippy::all)]
#![deny(missing_docs)]
#![deny(warnings)]

use rhizz_book::lock::{accept_changes_enabled, lock_path};
use rhizz_book::protocol::{
    is_supports_probe, parse_input, probe_renderer, process_book, read_stdin, version_string,
};
use serde_json::Value;
use std::env;
use std::io::{self, IsTerminal};
use std::path::Path;
use std::process::ExitCode;

fn main() -> ExitCode {
    match run() {
        Ok(code) => code,
        Err(error) => {
            eprintln!("rhizz-book: {error:#}");
            ExitCode::FAILURE
        }
    }
}

/// Dispatch a probe or a full build; never panics, always exits cleanly.
fn run() -> anyhow::Result<ExitCode> {
    let args: Vec<String> = env::args().collect();

    if is_supports_probe(&args) {
        let renderer = probe_renderer(&args).unwrap_or_default();
        return Ok(if renderer == "html" {
            ExitCode::SUCCESS
        } else {
            ExitCode::FAILURE
        });
    }

    init_tracing();

    let raw = read_stdin(&mut io::stdin())?;
    if raw.trim().is_empty() {
        println!("{{\"items\": []}}");
        return Ok(ExitCode::SUCCESS);
    }

    let (context, mut book) = parse_input(&raw)?;
    let root = context
        .get("root")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let lock_path = lock_path(Path::new(root));

    let json = process_book(
        &mut book,
        &lock_path,
        &version_string(),
        accept_changes_enabled(),
        color_enabled(),
        &mut io::stderr(),
    )?;
    print!("{json}");

    Ok(ExitCode::SUCCESS)
}

/// Whether diagnostics may be ANSI-colored: only when stderr is a terminal
/// and `NO_COLOR` is not set (git's own convention).
fn color_enabled() -> bool {
    let interactive = std::io::stderr().is_terminal();
    let no_color = std::env::var_os("NO_COLOR").is_some();
    interactive && !no_color
}

/// Install a `tracing` subscriber for info-level processing logs, written to
/// stderr (never stdout, which carries the mdbook protocol payload).
///
/// `RUST_LOG` overrides the default `info` filter; colors follow the same
/// TTY + `NO_COLOR` policy as the lock diff.
fn init_tracing() {
    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"));
    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_writer(io::stderr)
        .with_ansi(color_enabled())
        .with_target(false)
        .init();
}
