use std::process::ExitCode;

fn main() -> ExitCode {
    use clap::Parser as _;
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("warn")),
        )
        .with_writer(std::io::stderr)
        .init();
    let args = rhizz_cli::cli::Cli::parse();
    let code = rhizz_cli::cli::run(&args);
    // `run` returns i32 but process exit codes are u8; values above 255 are
    // truncated the same way the OS would truncate them.
    ExitCode::from(u8::try_from(code).unwrap_or(u8::MAX))
}
