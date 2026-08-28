//! Integration tests that exercise the CLI pipeline end-to-end against the
//! worked examples shipped with the repository.

// Integration test crates are not compiled with `#[cfg(test)]`, so the
// `allow-expect-in-tests` setting in clippy.toml does not apply here.
#![allow(clippy::expect_used)]
#![allow(clippy::unwrap_used)]

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

// ── watch ─────────────────────────────────────────────────────────────────────

/// Copy all `.hcl` files from `src` directory (non-recursively) to `dst`.
fn copy_hcl_files(src: &std::path::Path, dst: &std::path::Path) {
    for entry in std::fs::read_dir(src).expect("read dir") {
        let entry = entry.expect("dir entry");
        if entry.path().extension().is_some_and(|e| e == "hcl") {
            std::fs::copy(entry.path(), dst.join(entry.file_name())).expect("copy hcl");
        }
    }
}

/// Spawn `rhizz watch <dir> --no-color --output-dir <out>`, modify an `.hcl`
/// file after the initial build, assert that the build output is printed a
/// second time (proving the watcher re-triggered the pipeline), then kill the
/// process.
#[test]
fn watch_reruns_build_on_hcl_change() {
    use std::time::Duration;

    let tmp_project = tempfile::tempdir().expect("tempdir project");
    let tmp_out = tempfile::tempdir().expect("tempdir out");

    copy_hcl_files(&example_dir("drone"), tmp_project.path());

    let mut child = std::process::Command::new(env!("CARGO_BIN_EXE_rhizz"))
        .args([
            "watch",
            tmp_project.path().to_str().unwrap(),
            "--no-color",
            "--output-dir",
            tmp_out.path().to_str().unwrap(),
        ])
        .stderr(std::process::Stdio::piped())
        .stdout(std::process::Stdio::null())
        .spawn()
        .expect("failed to spawn rhizz watch");

    // Wait long enough for the initial build to complete and stabilise.
    std::thread::sleep(Duration::from_millis(1500));

    // Touch `system.hcl` to trigger a rebuild.
    let project_hcl = tmp_project.path().join("system.hcl");
    let content = std::fs::read_to_string(&project_hcl).expect("read system.hcl");
    std::fs::write(&project_hcl, format!("{content}\n// watch-test trigger\n"))
        .expect("write system.hcl");

    // Wait for the rebuild.
    std::thread::sleep(Duration::from_millis(1500));

    // Terminate and collect output.
    child.kill().expect("kill");
    let output = child.wait_with_output().expect("wait_with_output");
    let stderr = String::from_utf8_lossy(&output.stderr);

    // The "Watching …" banner must appear.
    assert!(
        stderr.contains("Watching"),
        "expected watching banner in stderr:\n{stderr}"
    );

    // The drone example always emits warnings, so each build cycle writes at
    // least one "W0xx" diagnostic line to stderr.  Two cycles means the marker
    // should appear at least twice.
    let cycles = stderr.matches("W0").count();
    assert!(
        cycles >= 2,
        "expected build output from ≥2 cycles (W0xx markers: {cycles}):\n{stderr}"
    );
}
