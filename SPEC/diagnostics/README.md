# Diagnostic Codes

Each file in this directory documents a single diagnostic code emitted by
`rhizz-core` during parsing, resolution, or validation.

- **Error codes** (`EXXX`) halt compilation.
- **Warning codes** (`WXXX`) are non-blocking, and declare the least-detailed
  [warning level](warning-levels.md) at which they are reported.

Every file contains a description, an HCL example that triggers the diagnostic,
and a suggested fix. These files are the single source of truth — they are
embedded into Rust doc comments via `include_str!` in `diagnostics.rs`.

Warning files carry one machine-readable declaration directly below the title,
which `build.rs` requires (a missing or malformed line fails the build):

```markdown
# W010 — Unused port

**Warning level:** Component.

A port is defined on a **placed instance** ...
```

Error files must not carry the line — errors are never gated by a warning
level. See [diagnostics architecture](../diagnostics.md) for the full set of
declaration rules.
