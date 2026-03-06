fn main() {
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
    std::process::exit(code);
}
