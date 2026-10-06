use std::process::ExitCode;

fn main() -> ExitCode {
    use clap::Parser as _;
    let args = rhizz_cli::cli::Cli::parse();
    // `web` defaults to `info` (matching the old rhizz-server binary);
    // everything else defaults to `warn`.
    let default_level = if matches!(args.command, Some(rhizz_cli::cli::Command::Web { .. })) {
        "info"
    } else {
        "warn"
    };
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new(default_level)),
        )
        .with_writer(std::io::stderr)
        .init();
    let code = rhizz_cli::cli::run(&args);
    // `run` returns i32 but process exit codes are u8; values above 255 are
    // truncated the same way the OS would truncate them.
    ExitCode::from(u8::try_from(code).unwrap_or(u8::MAX))
}
