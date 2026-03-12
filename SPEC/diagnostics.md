# Diagnostics Architecture

## Overview

Diagnostic codes in rhizz follow a simplified version of the approach used by
the Rust compiler (`rustc_error_codes`). Each code has a single source of truth
in a dedicated Markdown file, eliminating duplication across the spec,
doc comments, and error messages.

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

```markdown
# E001 — Short title

Prose description of the condition.

## Example (error)

\```hcl
// HCL snippet that triggers the diagnostic
\```

## Fix

\```hcl
// Corrected HCL snippet
\```
```

## How the files are used

### 1. Rust doc comments (`include_str!`)

Each `DiagnosticCode` const in `diagnostics.rs` pulls its documentation from
the corresponding Markdown file at compile time:

```rust
#[doc = include_str!("../../../../SPEC/diagnostics/E001.md")]
pub const E001: Self = Self { code: "E001", level: Level::Error };
```

This means `cargo doc` renders the full description, HCL examples, and fix
guidance for every code — with zero hand-written doc comments to keep in sync.

### 2. Spec reference

SPEC.md §4 points to the `SPEC/diagnostics/` directory rather than maintaining
inline tables. The Markdown files *are* the spec for each code.

### 3. Future: `rhizz explain E001`

A CLI subcommand can surface the same `include_str!` content at runtime,
giving users offline access to the full explanation and example — identical to
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

This is not duplication — the Markdown file explains the *class* of error,
while the call-site message describes the *specific instance*.

## Adding a new diagnostic code

1. Create `SPEC/diagnostics/Xxxx.md` following the format above.
2. Add a `pub const` to `DiagnosticCode` in `diagnostics.rs` with
   `#[doc = include_str!(...)]`.
3. Emit it via `Diagnostic::error()` or `Diagnostic::warning()` at the
   appropriate point in parsing, resolution, or validation.
4. Update the code range in `SPEC/architecture.md` if the new code extends
   the current range.
