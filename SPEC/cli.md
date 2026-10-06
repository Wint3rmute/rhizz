# CLI Interface

## Binary name

`rhizz` (not `mbse` as in the original spec draft — matches the crate name).

## Usage

```
rhizz <command> [options] [path]
```

`path` defaults to `.` (current directory). The project's system model file (`system.hcl` or `main.hcl`) and any view definition files (`views/*.hcl`) are discovered and compiled.

---

## Commands

| Command | Description                                                                 | Exit code                       |
| ------- | --------------------------------------------------------------------------- | ------------------------------- |
| `check` | Parse project `.hcl` files (`system.hcl`, view files), validate, print errors/warnings. | `0` if no errors, `1` otherwise |
| `score` | Run `check`, then print the completion report.                              | `0` if no errors, `1` otherwise |
| `build` | Run `check` + `score` in sequence. Default when no command given.           | `0` if no errors, `1` otherwise |
| `fmt`   | Canonically format the model `.hcl` files in place (or verify with `--check`). | `0` on success, `1` if files need formatting (with `--check`) or on error |
| `watch` | Run `build`, then re-run on `.hcl` file changes.                            | `0` on clean exit (Ctrl-C)      |
| `web`   | Serve the web editor over HTTP (frontend + VFS persistence API).            | `0` on clean shutdown, `1` on error |

Each of `check`, `score`, `build` is a superset of the previous — `build` does
everything. Early abort on errors: if `check` finds errors, `score` is skipped.

---

## `web` — Web Server

```
rhizz web [--addr ADDR] [--data-dir DIR]
```

Starts an HTTP server (axum) that serves the compiled web frontend and
persists the browser-based virtual filesystem (VFS) to disk. The server
embeds the frontend at compile time (via `rhizz-server`'s `build.rs`), so the
`rhizz` binary is fully self-contained.

| Flag         | Env var          | Default          | Description                                     |
| ------------ | ---------------- | ---------------- | ----------------------------------------------- |
| `--addr`     | `RHIZZ_ADDR`     | `127.0.0.1:3000` | Address to bind the HTTP server to              |
| `--data-dir` | `RHIZZ_DATA_DIR` | `rhizz-data`     | Directory holding one sub-directory per project |

The server exposes:

- `GET /healthz` — liveness probe, returns `ok`
- `GET /api/vfs` — fetch the entire VFS state (all projects + nodes)
- `PUT /api/vfs` — persist the entire VFS state (authoritative; projects absent
  from the payload are deleted)
- `GET /*` — the embedded SPA frontend (falls back to the shell for client-side
  routes)

No authentication is implemented — the server assumes a trusted, public
environment.

---

## Global Options

| Flag       | Short | Type   | Default | Description                                |
| ---------- | ----- | ------ | ------- | ------------------------------------------ |
| `--strict`   |       | flag   | `false` | Treat warnings as errors (exit `1` on any warning) |
| `--json`     |       | flag   | `false` | Machine-readable JSON output (for CI/CD)   |
| `--no-color` |       | flag   | `false` | Disable ANSI color codes in output         |
| `--warning-level` |  | enum   | `component` | Least-detailed warning level to report: `business`, `architectural`, or `component`. Warnings are cumulative, so a lower level reports fewer of them; see [warning levels](warning-levels.md). Ignored by `fmt`. |

### `--json` output shape

When `--json` is set, all output is a single JSON object on stdout. Stderr
remains human-readable for fatal parse errors.

```jsonc
{
  "errors": [
    { "code": "E002", "file": "system.hcl", "line": 14, "message": "..." }
  ],
  "warnings": [
    { "code": "W001", "file": "system.hcl", "line": 31, "message": "..." }
  ],
  // the level the warnings above were filtered to
  "warning_level": "component",
  // present only if check passed:
  "score": {
    "system": "mini-drone",
    "components": { "complete": 8, "total": 12 },
    "ports": { "complete": 4, "total": 8 },
    "connections": { "complete": 3, "total": 7 },
    "messages": { "complete": 5, "total": 10 },
    "overall": { "complete": 20, "total": 37, "percent": 54.1 }
  }
}
```

---

## Implementation Notes

Use `clap` with derive API. Sketch:

```rust
#[derive(Parser)]
#[command(name = "rhizz", version, about = "MBSE model checker")]
struct Cli {
    #[command(subcommand)]
    command: Option<Command>,

    /// Path to project directory containing .hcl files
    #[arg(default_value = ".")]
    path: PathBuf,

    /// Treat warnings as errors
    #[arg(long)]
    strict: bool,

    /// JSON output for CI/CD
    #[arg(long)]
    json: bool,

    /// Disable colored output
    #[arg(long)]
    no_color: bool,

    /// Least-detailed warning level to report
    #[arg(long, global = true, default_value_t = WarningLevel::Component)]
    warning_level: WarningLevel,
}

#[derive(Subcommand)]
enum Command {
    Check,
    Score,
    Build,
}
```

When `command` is `None`, default to `Build`.

### Color handling

Respect `--no-color`, `NO_COLOR` env var, and non-TTY detection (in that
priority order). Use `colored` or `owo-colors` with a global toggle.

### Pipeline

Each command maps to a sequence of pipeline stages:

```
check → parse_all → merge → resolve (with validation) → filter by warning level
score → check + compute_scores + print_report
build → check + score
```

Warnings below the selected `--warning-level` are dropped as soon as the
compile finishes — before the summary line, the `--strict` escalation, and the
JSON encoding — so every downstream count sees one consistent set. Errors are
never dropped.

The resolved `Model` (see [models.md](models.md#resolved-models)) is the input
to all stages after `check`.

### Error/warning formatting

Human-readable (default):

```
✗ E002  connections.hcl:14  connection "uart-link" references undefined component "gps-module"
⚠ W001  fc.hcl:31           component "power-regulator" has no child components (leaf=false)
```

Format: `{icon} {code}  {file}:{line}  {message}`

Summary line after all diagnostics:

```
1 error, 2 warnings — aborting (fix errors to continue)
```

or:

```
0 errors, 2 warnings
```