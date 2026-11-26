# Logging

rhizome uses the [`tracing`](https://docs.rs/tracing) ecosystem for structured
diagnostics and span-based instrumentation.

## Configuration

Log level is controlled via the `RUST_LOG` environment variable, following the
standard `tracing_subscriber` [EnvFilter] syntax.

```
RUST_LOG=debug rhizome build .
RUST_LOG=rhizome_core=trace,warn rhizome build .
```

When `RUST_LOG` is not set, both binaries default to **`warn`**, which means
only warnings and errors are emitted. All output goes to **stderr** so it does
not interfere with JSON output (`--json`).

## Levels used

| Level   | Where                                      | Meaning                                   |
| ------- | ------------------------------------------ | ----------------------------------------- |
| `trace` | `rhizome-core`                               | Entry/exit of every instrumented function |
| `debug` | (reserved for future use)                  | Intermediate computed values              |
| `info`  | (reserved for future use)                  | High-level pipeline progress              |
| `warn`  | `rhizome-core` validation                    | Non-blocking diagnostic issues (W-codes)  |
| `error` | `rhizome-core` resolution                    | Hard errors that prevent model production |

## Instrumented functions

The `#[instrument]` attribute is applied to all major public entry points:

- `rhizome_core::compile` — top-level compilation pipeline
- `rhizome_core::parse::parse_file` — HCL file parsing
- `rhizome_core::parse::merge_into` — source merging
- `rhizome_core::resolve::resolve` — model resolution
- `rhizome_core::validate::validate` — warning validation pass
- `rhizome_core::score::score` — completion scoring

Library crates (`rhizome-core`) depend only on the
`tracing` facade and do **not** install a subscriber. It is the responsibility
of the binary (`rhizome`) to set up the subscriber at startup, which
keeps the library API completely independent of any particular logging backend.

## Integration with other subscribers

Because the library crates use the `tracing` facade only, any application that
embeds rhizome crates can route events to its own subscriber (e.g. OpenTelemetry,
`tracing-journald`, `tracing-log`, …) without any changes to the library code.

[EnvFilter]: https://docs.rs/tracing-subscriber/latest/tracing_subscriber/filter/struct.EnvFilter.html