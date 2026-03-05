//! Integration tests that exercise the CLI pipeline end-to-end against the
//! worked examples shipped with the repository.

use clap::Parser as _;
use rhizz_cli::cli::{Cli, run};
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

#[test]
fn build_drone_exits_0_and_generates_dot() {
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
    assert!(
        out_dir.path().join("drone-overview.dot").exists(),
        "drone-overview.dot should be generated"
    );
}

#[test]
fn build_social_media_exits_0() {
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
fn build_software_house_exits_0() {
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
fn check_drone_exits_0() {
    let cli = parse_args(&[
        "check",
        example_dir("drone").to_str().unwrap(),
        "--no-color",
    ]);
    let code = run(&cli);
    assert_eq!(code, 0, "drone check should exit 0 (warnings only)");
}

#[test]
fn check_drone_strict_exits_1() {
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
fn check_invalid_path_exits_1() {
    let cli = parse_args(&[
        "check",
        "/nonexistent/path/that/does/not/exist",
        "--no-color",
    ]);
    let code = run(&cli);
    assert_eq!(code, 1, "invalid path should exit 1");
}
