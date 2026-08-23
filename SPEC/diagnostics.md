# Diagnostics Architecture

## Overview

Diagnostic codes in rhizz follow a simplified version of the approach used by
the Rust compiler (`rustc_error_codes`). Each code has a single source of truth
in a dedicated Markdown file, eliminating duplication across the spec, doc
comments, and error messages.

## File layout

```
SPEC/diagnostics/
├── README.md          # index and conventions
├── E000.md            # one file per error code
├── E001.md
├── ...
├── W000.md            # one file per warning code
├── W001.md
└── ...
```

Error codes (`Exxx`) halt compilation. Warning codes (`Wxxx`) are non-blocking.

## Markdown file format

Every diagnostic file follows this structure:

````markdown
# E001 — Short title

Prose description of the condition.

## Example (error)

\```hcl // HCL snippet that triggers the diagnostic \```

## Fix

\```hcl // Corrected HCL snippet \```
````

## How the files are used

### 1. Automatic Code & Doc Generation (`build.rs`)

Each `DiagnosticCode` const is generated at build time by `crates/rhizz-core/build.rs`, which scans `SPEC/diagnostics/` and produces the corresponding `pub const` definitions with embedded Markdown doc comments:

```rust
#[doc = include_str!(r#"/path/to/SPEC/diagnostics/E001.md"#)]
pub const E001: Self = Self {
    code: "E001",
    level: Level::Error,
};
```

This means `cargo doc` renders the full description, HCL examples, and fix guidance for every code with zero hand-written `const` boilerplate or manual `include_str!` mappings to maintain.

### 2. Spec reference

SPEC.md §4 points to the `SPEC/diagnostics/` directory rather than maintaining
inline tables. The Markdown files _are_ the spec for each code.

### 3. Future: `rhizz explain E001`

A CLI subcommand can surface the same `include_str!` content at runtime, giving
users offline access to the full explanation and example — identical to
`rustc --explain E0001`.

## What stays at the call site

The **short, contextual message** passed to `Diagnostic::error()` or
`Diagnostic::warning()` remains at each emission site because it interpolates
runtime values (labels, file paths, etc.):

```rust
Diagnostic::error(
    DiagnosticCode::E001,
    format!("duplicate system label '{label}'"),
)
```

This is not duplication — the Markdown file explains the _class_ of error, while
the call-site message describes the _specific instance_.

## Adding a new diagnostic code

1. Create `SPEC/diagnostics/Xxxx.md` following the format above (`Exxx.md` for errors, `Wxxx.md` for warnings).
2. Cargo's `build.rs` automatically picks up the new file, generates `DiagnosticCode::Xxxx`, and embeds its documentation.
3. Emit it via `Diagnostic::error(DiagnosticCode::Xxxx, ...)` or `Diagnostic::warning(DiagnosticCode::Xxxx, ...)` at the appropriate point in parsing, resolution, or validation.
