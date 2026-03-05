fn main() {
    use clap::Parser as _;
    let args = rhizz_cli::cli::Cli::parse();
    let code = rhizz_cli::cli::run(&args);
    std::process::exit(code);
}
