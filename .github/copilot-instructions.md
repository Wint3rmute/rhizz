# Copilot Instructions for rhizz

## Project Overview

**rhizz** is a code-first Model-Based Systems Engineering (MBSE) tool written in
Rust. Systems are described in `.hcl` files (HCL syntax, same as Terraform) that
can be version-controlled, diffed, and reviewed without a GUI. See `SPEC.md` and
`SPEC/` for the full specification, and `examples/` for examples of systems
defined with `rhizz`.

## Repository Layout

```
crates/              – source, split into subcrates
examples/            – example systems
SPEC.md              – full specification (single file)
SPEC/                – specification split by topic (cli.md, models.md, …)
TASKS.md             – ordered implementation tasks
FINISHED_TASKS.md    – completed tasks (most recent first)
```

## Development Workflow

1. Read the next task from `TASKS.md`.
2. Get extra context from recently finished tasks (read the first 50 lines of
   `FINISHED_TASKS.md`).
3. Implement it using red/green TDD.
4. Run `just test`, `just lint`, and `just build` until everything passes.
5. Run `just format` to format the code.
6. Move the completed task to `FINISHED_TASKS.md` and report that you are
   finished.

## Build, Test & Lint Commands

```bash
just format   # format code (Rust + TypeScript/Svelte)
just lint     # lint workspace (Clippy + ESLint)
just test     # run all tests (Rust + Vitest)
just build    # build release binaries, WASM package, and web frontend
```

## Coding Conventions

- The crate has `#![deny(clippy::all)]`; all Clippy warnings must be fixed,
  never suppressed unless there is a strong reason.
- Use `anyhow::Result` for fallible functions that surface errors to the caller.
- Prefer `thiserror` for library-facing error types when type-safe matching is
  needed.
- Diagnostics use the `Diagnostic` type with fields `code`, `file`, `line`
  (optional), and `message`.
  - Error codes start with `E` (blocking), warning codes start with `W`
    (non-blocking).
- All identifier types (`ComponentId`, `InterfaceId`, …) are newtypes over a
  numeric arena index.
- Follow the existing module boundaries: parsing, resolution, validation,
  scoring, and rendering are separate modules.

## Testing Approach

- Unit tests live in `#[cfg(test)]` modules inside each source file.
- Integration tests exercise the three worked examples under `examples/` (drone,
  social-media, software-house).
- Use `just test` to run everything.
- Assert exact diagnostic codes (not just counts) for error/warning tests.
