//! Entry point for the `rhizz-server` binary.

use std::path::PathBuf;
use std::process::ExitCode;

fn main() -> ExitCode {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .with_writer(std::io::stderr)
        .init();

    // Bind address, overridable so a build can be smoke-tested without
    // clashing with other servers.
    let addr = std::env::var("RHIZZ_ADDR").unwrap_or_else(|_| "127.0.0.1:3000".to_owned());
    // Where per-project VFS dumps live.
    let data_dir =
        PathBuf::from(std::env::var("RHIZZ_DATA_DIR").unwrap_or_else(|_| "rhizz-data".to_owned()));

    let runtime = match tokio::runtime::Runtime::new() {
        Ok(runtime) => runtime,
        Err(err) => {
            eprintln!("failed to start tokio runtime: {err}");
            return ExitCode::FAILURE;
        }
    };

    match runtime.block_on(rhizz_server::server::run(&addr, data_dir)) {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            tracing::error!(%err, "server exited with an error");
            ExitCode::FAILURE
        }
    }
}
