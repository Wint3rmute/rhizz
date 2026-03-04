# Implementation Tasks

How to work on this file:

- Read the next task
- Implement it, use red/green TDD
- Run tests & linters (`cargo test`, `cargo clippy`, `cargo build`) until it's all working
- Once all linters/builds/tests pass, run `cargo fmt`
- Delete the task from the file once done, report that you're finished

## Task 5 — Graphviz DOT Generation

- Implement `render_view(model: &Model, view: &View) -> String`
- Apply filter predicates: tag inclusion/exclusion, `max_level`, component whitelist, `show_messages`
- Emit `subgraph cluster_*` for non-leaf components, box nodes for leaf components
- Emit directed/undirected edges for interfaces; include message names in edge labels when `show_messages = true`
- Write rendered `.dot` files to `--output-dir`
- **Test:** render all views in each example; assert output contains expected node/edge identifiers

---

## Task 6 — CLI

- Implement `clap` arg parser as specified in `SPEC/cli.md`: `check`, `score`, `views`, `build` subcommands; default to `build`
- Implement human-readable diagnostic output: `✗ E002  file.hcl:14  message` / `⚠ W001 ...`
- Implement `--json` output mode with the schema from `SPEC/cli.md`
- Implement `--strict` (warnings → errors), `--no-color`, `NO_COLOR` env var, non-TTY detection
- Wire exit codes: `0` on success, `1` on errors (or warnings under `--strict`)
- **Test:** run `rhizz build` on each example, assert exit code and stdout content
