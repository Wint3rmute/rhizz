# Copilot Instructions for rhizz

## Project Overview

**rhizz** is a code-first Model-Based Systems Engineering (MBSE) tool written in Rust.
Systems are described in `.hcl` files (HCL syntax, same as Terraform) that can be
version-controlled, diffed, and reviewed without a GUI. See `SPEC.md` and `SPEC/` for
the full specification, and `examples/` for examples of systems defined with `rhizz`.

## Repository Layout

```
src/ .          – source code
examples/       – example systems
SPEC.md         – full specification (single file)
SPEC/           – specification split by topic (cli.md, models.md, …)
TASKS.md        – ordered implementation tasks
```

## Development Workflow

1. Read the next task from the `# TODO` section of `TASKS.md` (first level-2 header).
2. Get extra context from recently finished tasks in the `# FINISHED` section of `TASKS.md`.
3. Implement it using red/green TDD.
4. Run `cargo test`, `cargo clippy`, `cargo doc` and `cargo build` until everything passes.
5. Run `cargo fmt` to format the code.
6. Move the completed task to the top of the `# FINISHED` section in `TASKS.md` and report that you are finished.

## Build, Test & Lint Commands

```bash
cargo build                       # debug build
cargo test --all                  # run all tests
cargo clippy --all-targets --all-features -- -D warnings   # lint (warnings are errors)
cargo fmt --all -- --check        # check formatting
cargo fmt                         # auto-format
```

## Coding Conventions

- The crate has `#![deny(clippy::all)]`; all Clippy warnings must be fixed, never suppressed unless there is a strong reason.
- Use `anyhow::Result` for fallible functions that surface errors to the caller.
- Prefer `thiserror` for library-facing error types when type-safe matching is needed.
- Diagnostics use the `Diagnostic` type with fields `code`, `file`, `line` (optional), and `message`.
  - Error codes start with `E` (blocking), warning codes start with `W` (non-blocking).
- All identifier types (`ComponentId`, `InterfaceId`, …) are newtypes over a numeric arena index.
- Follow the existing module boundaries: parsing, resolution, validation, scoring, and rendering are separate modules.

## Testing Approach

- Unit tests live in `#[cfg(test)]` modules inside each source file.
- Integration tests exercise the three worked examples under `examples/` (drone, social-media, software-house).
- Use `cargo test --all` to run everything.
- Assert exact diagnostic codes (not just counts) for error/warning tests.
