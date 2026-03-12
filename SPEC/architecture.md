# Architecture

## Workspace Layout

The repository root is a Cargo workspace. All crates live under `crates/`.

```
rhizz/
  Cargo.toml          # workspace root
  crates/
    rhizz-core/       # model compiler — pure library, no I/O
    rhizz-dot/        # Graphviz DOT renderer — pure text transform
    rhizz-cli/        # CLI frontend
    rhizz-gui/        # egui desktop GUI frontend
    rhizz-wasm/       # WebAssembly bindings (browser / Node.js frontend)
    …                 # additional frontends (LSP, …) may be added here
  examples/
  SPEC.md
  TASKS.md
```

**Dependency rules:**

- `rhizz-dot` depends on `rhizz-core` (needs `Model` and `View` types).
- Frontends depend on `rhizz-core`. Frontends that emit DOT output also depend on `rhizz-dot`.
- Frontends do **not** depend on each other.
- Nothing depends on a frontend crate.

---

## `rhizz-core`

Pure library crate. No `std::fs`, no `std::env`, no terminal or rendering dependencies.

### Public API

```rust
/// A single source file supplied by the frontend.
pub struct Source {
    pub filename: String,
    pub content:  String,
}

/// The result of compiling a set of sources.
pub struct CompileResult {
    /// Fully resolved model; `None` when hard errors prevent resolution.
    pub model:       Option<Model>,
    pub diagnostics: Vec<Diagnostic>,
}

/// Compile a slice of source files into a resolved model.
pub fn compile(sources: &[Source]) -> CompileResult;

/// Compute the completion score for a resolved model.
pub fn score(model: &Model) -> ScoreReport;
```

### Invariants

- **No I/O** — must not perform any filesystem or network access.
- **`serde` on all public types** — `Model`, `Diagnostic`, `ScoreReport`, and all related structs derive `Serialize` and `Deserialize` so frontends can serialise results (JSON output, IPC, storage) without extra conversion.
- **`Clone` on all public types** — frontends may need to hold multiple snapshots of the model simultaneously (e.g. the GUI keeping the last valid model while the current edit contains errors).
- **Stable error codes** — `Diagnostic.code` strings (`E001`–`E011`, `W001`–`W011`) are part of the public API. Changing or renumbering them is a breaking change.

---

## `rhizz-dot`

Pure library crate. No I/O and no terminal dependencies. Depends on `rhizz-core` for the `Model` and `View` types.

### Public API

```rust
/// Render a single view to a DOT-format string.
/// The caller is responsible for writing it to disk or forwarding it elsewhere.
pub fn render_view(model: &Model, view: &View) -> String;
```

All view filter logic — tag inclusion/exclusion, level capping, component whitelist, `show_messages`, and connection direction inference from port roles — is implemented here. No frontend re-implements filtering.

---

## Frontend Contract

A frontend is any crate that consumes `rhizz-core` to expose the model to a user or automated process.

**Required behaviour:**

1. **Own all I/O** — discover, read, and (optionally) watch source files; write any generated output; manage stdin/stdout/stderr or a GUI window.
2. **Supply sources** — assemble `Vec<Source>` and call `rhizz_core::compile`. Do not parse or validate HCL independently.
3. **Render diagnostics** — present `Vec<Diagnostic>` in a medium-appropriate form (coloured terminal lines, inline editor annotations, notifications, etc.).
4. **Do not duplicate logic** — if behaviour needed by a frontend is missing from `rhizz-core` or `rhizz-dot`, add it there instead of implementing it in the frontend.

**CLI-specific notes** (`rhizz-cli`):

- Discovers `.hcl` files via `walkdir`, reads them, calls `compile`, then formats and prints diagnostics.
- Calls `rhizz-dot::render_view` for each view and writes the resulting string to the configured output directory.
- Exit code 0 when no errors; non-zero otherwise. With `--strict`, warnings also produce a non-zero exit.
- All model logic is delegated; `rhizz-cli` contains no parsing, validation, scoring, or rendering logic of its own.

See [gui.md](gui.md) for GUI-frontend-specific notes.

**Wasm-specific notes** (`rhizz-wasm`):

- A thin `cdylib` crate that wraps `rhizz-core` with [`wasm-bindgen`](https://rustwasm.github.io/wasm-bindgen/) bindings.
- Exposes a single function — `compile_sources(sources: JsValue) -> Result<JsValue, JsError>` — that accepts a JS array of `{ filename, content }` objects and returns a native JS object matching `CompileResult`.
- Serialisation between Rust and JS is handled by `serde-wasm-bindgen`; no JSON stringification is required on the JavaScript side.
- Built with `wasm-pack build --target web` (ES modules for browsers/Deno) or `--target nodejs` (CommonJS). The `pkg/` output is a self-contained npm package including `.wasm`, JS bindings, and TypeScript type declarations.
- Contains no I/O of its own; callers supply HCL content as strings (read from disk, a text editor, etc.) and receive the compiled result back as a plain JS object.

---

## `rhizz-wasm`

WebAssembly frontend crate. Depends on `rhizz-core`. No I/O, no filesystem access.

### Public API (JavaScript)

```ts
// ES module import after wasm-pack build --target web
import init, { compile_sources } from "./rhizz_wasm.js";

await init(); // loads and initialises the .wasm binary (--target web only)

const result = compile_sources([
  { filename: "project.hcl", content: "..." },
  { filename: "system.hcl",  content: "..." },
]);
// result: { model: Model | null, diagnostics: Diagnostic[] }
```

### Building

```bash
# Browser / Deno (ES modules)
wasm-pack build crates/rhizz-wasm --target web

# Node.js (CommonJS)
wasm-pack build crates/rhizz-wasm --target nodejs
```

Output lands in `crates/rhizz-wasm/pkg/` as a ready-to-publish npm package.

### Wasm-pack tests

```bash
wasm-pack test --node crates/rhizz-wasm
```
