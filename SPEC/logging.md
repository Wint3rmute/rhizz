# Logging

rhizz uses the [`tracing`](https://docs.rs/tracing) ecosystem for structured
diagnostics and span-based instrumentation.

## Configuration

Log level is controlled via the `RUST_LOG` environment variable, following the
standard `tracing_subscriber` [EnvFilter] syntax.

```
RUST_LOG=debug rhizz build .
RUST_LOG=rhizz_core=trace,warn rhizz-gui .
```

When `RUST_LOG` is not set, both binaries default to **`warn`**, which means
only warnings and errors are emitted.  All output goes to **stderr** so it does
not interfere with JSON output (`--json`) or piped DOT content.

## Levels used

| Level   | Where                                     | Meaning                                        |
|---------|-------------------------------------------|------------------------------------------------|
| `trace` | `rhizz-core`, `rhizz-dot`, `rhizz-mermaid` | Entry/exit of every instrumented function      |
| `debug` | (reserved for future use)                 | Intermediate computed values                   |
| `info`  | (reserved for future use)                 | High-level pipeline progress                   |
| `warn`  | `rhizz-core` validation                   | Non-blocking diagnostic issues (W-codes)       |
| `error` | `rhizz-core` resolution                   | Hard errors that prevent model production      |

## Instrumented functions

The `#[instrument]` attribute is applied to all major public entry points:

- `rhizz_core::compile` — top-level compilation pipeline
- `rhizz_core::parse::parse_file` — HCL file parsing
- `rhizz_core::parse::merge_into` — source merging
- `rhizz_core::resolve::resolve` — model resolution
- `rhizz_core::validate::validate` — warning validation pass
- `rhizz_core::score::score` — completion scoring
- `rhizz_dot::render_view` — DOT rendering
- `rhizz_mermaid::render_view` — Mermaid flowchart rendering
- `rhizz_mermaid::render_view_svg` — SVG rendering
- `rhizz_mermaid::render_view_png` — PNG rendering

Library crates (`rhizz-core`, `rhizz-dot`, `rhizz-mermaid`) depend only on the
`tracing` facade and do **not** install a subscriber.  It is the responsibility
of the binary (`rhizz`, `rhizz-gui`) to set up the subscriber at startup, which
keeps the library API completely independent of any particular logging backend.

## Integration with other subscribers

Because the library crates use the `tracing` facade only, any application that
embeds rhizz crates can route events to its own subscriber (e.g. OpenTelemetry,
`tracing-journald`, `tracing-log`, …) without any changes to the library code.

[EnvFilter]: https://docs.rs/tracing-subscriber/latest/tracing_subscriber/filter/struct.EnvFilter.html
