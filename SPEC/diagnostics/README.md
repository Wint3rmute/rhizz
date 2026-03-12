# Diagnostic Codes

Each file in this directory documents a single diagnostic code emitted by
`rhizz-core` during parsing, resolution, or validation.

- **Error codes** (`EXXX`) halt compilation.
- **Warning codes** (`WXXX`) are non-blocking.

Every file contains a description, an HCL example that triggers the diagnostic,
and a suggested fix. These files are the single source of truth — they are
embedded into Rust doc comments via `include_str!` in `diagnostics.rs`.
