# CLI Interface

## Binary name

`rhizz` (not `mbse` as in the original spec draft — matches the crate name).

## Usage

```
rhizz <command> [options] [path]
```

`path` defaults to `.` (current directory). The project's system model file (`system.hcl` or `main.hcl`) and any view definition files (`views.hcl` or individual view files) are discovered and compiled.

---

## Commands

| Command | Description                                                                 | Exit code                       |
| ------- | --------------------------------------------------------------------------- | ------------------------------- |
| `check` | Parse project `.hcl` files (`system.hcl`, view files), validate, print errors/warnings. | `0` if no errors, `1` otherwise |
| `score` | Run `check`, then print the completion report.                              | `0` if no errors, `1` otherwise |
| `views` | Run `check`, then generate `.dot` files for all (or selected) views.        | `0` if no errors, `1` otherwise |
| `build` | Run `check` + `score` + `views` in sequence. Default when no command given. | `0` if no errors, `1` otherwise |

Each command is a superset of the previous — `build` does everything. Early
abort on errors: if `check` finds errors, `score` and `views` are skipped.

---

## Global Options

| Flag           | Short | Type     | Default  | Description                                                   |
| -------------- | ----- | -------- | -------- | ------------------------------------------------------------- |
| `--output-dir` | `-o`  | `path`   | `./out/` | Directory for generated `.dot` files                          |
| `--strict`     |       | flag     | `false`  | Treat warnings as errors (exit `1` on any warning)            |
| `--json`       |       | flag     | `false`  | Machine-readable JSON output (for CI/CD)                      |
| `--view`       |       | `string` | all      | Only generate the named view (applies to `views` and `build`) |
| `--no-color`   |       | flag     | `false`  | Disable ANSI color codes in output                            |

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
  // present only if check passed:
  "score": {
    "system": "mini-drone",
    "components": { "complete": 8, "total": 12 },
    "ports": { "complete": 4, "total": 8 },
    "connections": { "complete": 3, "total": 7 },
    "messages": { "complete": 5, "total": 10 },
    "overall": { "complete": 20, "total": 37, "percent": 54.1 }
  },
  // present only if views were generated:
  "views": [
    { "name": "power-only", "file": "out/power.dot" }
  ]
}
```

---

## Implementation Notes

Use `clap` with derive API. Sketch:

```rust
#[derive(Parser)]
#[command(name = "rhizz", version, about = "MBSE model checker and view generator")]
struct Cli {
    #[command(subcommand)]
    command: Option<Command>,

    /// Path to project directory containing .hcl files
    #[arg(default_value = ".")]
    path: PathBuf,

    /// Output directory for generated .dot files
    #[arg(short, long, default_value = "./out/")]
    output_dir: PathBuf,

    /// Treat warnings as errors
    #[arg(long)]
    strict: bool,

    /// JSON output for CI/CD
    #[arg(long)]
    json: bool,

    /// Only generate a specific view
    #[arg(long)]
    view: Option<String>,

    /// Disable colored output
    #[arg(long)]
    no_color: bool,
}

#[derive(Subcommand)]
enum Command {
    Check,
    Score,
    Views,
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
check → parse_all → merge → resolve (with validation)
score → check + compute_scores + print_report
views → check + render_views + write_dot_files
build → check + score + views
```

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
