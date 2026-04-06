# Web Frontend (`rhizz-web`)

Browser-based system model explorer. Pure SPA — no API, no external backend.

## Stack

| Layer          | Technology                                |
| -------------- | ----------------------------------------- |
| Runtime        | Deno                                      |
| Language       | TypeScript                                |
| UI framework   | Svelte 5                                  |
| Build tool     | Vite                                      |
| Visualisation  | Custom SVG renderer                       |
| Model compiler | `rhizz-wasm` (WASM build of `rhizz-core`) |

## Architecture

The frontend follows the same
[frontend contract](architecture.md#frontend-contract) as the CLI and GUI: all
model logic lives in `rhizz-core`, the frontend owns only I/O and presentation.

```
web/
├── deno.json                 # Deno tasks: dev, build, preview
├── package.json              # npm dependencies
├── vite.config.ts            # Svelte plugin + rhizz-wasm alias
├── index.html
└── src/                      # Source code
```

## WASM Integration

The `rhizz-wasm` package (built with `wasm-pack --target web`) is resolved via a
Vite alias pointing at `../crates/rhizz-wasm/pkg`.

### Typed bindings via wrapper structs

`rhizz-wasm` exposes **`#[wasm_bindgen]` wrapper structs** that convert from
`rhizz-core` types. Each wrapper has `#[wasm_bindgen(getter)]` methods for its
fields, so `wasm-pack` generates matching TypeScript class definitions with full
autocompletion — no manual `.d.ts` files needed.

Example — wrapping `rhizz_core::Diagnostic`:

```rust
// rhizz-wasm/src/lib.rs
#[derive(Clone)]
#[wasm_bindgen]
pub struct DiagnosticJS {
    code: String,
    message: String,
}

#[wasm_bindgen]
impl DiagnosticJS {
    // Getter makes the field visible in TypeScript definitions
    // and in JavaScript introspection (e.g. Object.keys, console.log).
    #[wasm_bindgen(getter)]
    pub fn code(&self) -> String { self.code.clone() }

    #[wasm_bindgen(getter)]
    pub fn message(&self) -> String { self.message.clone() }
}

impl From<&rhizz_core::Diagnostic> for DiagnosticJS {
    fn from(d: &rhizz_core::Diagnostic) -> Self {
        Self { code: d.code.code.to_string(), message: d.message.clone() }
    }
}
```

`wasm-pack` then generates:

```typescript
// rhizz_wasm.d.ts (auto-generated)
export class DiagnosticJS {
  free(): void;
  readonly code: string;
  readonly message: string;
}
```

```
rhizz-core types              rhizz-wasm wrappers          TS (auto-generated)
─────────────────              ───────────────────          ───────────────────
Diagnostic          ──From──▸  DiagnosticJS                 class DiagnosticJS { code, message, … }
Component           ──From──▸  ComponentJS                  class ComponentJS  { label, description, … }
ScoreReport         ──From──▸  ScoreReportJS                class ScoreReportJS { overall_percentage, … }
CategoryScore       ──From──▸  CategoryScoreJS              class CategoryScoreJS { complete, partial, … }
Project             ──From──▸  ProjectJS                    class ProjectJS { name, version, … }
Model               ──wrap──▸  ModelJS                      class ModelJS { components(), score(), … }
```

`CompileResultJS` is the main entry point — an opaque class that holds the
compiled state and returns typed wrappers from its methods:

```rust
#[wasm_bindgen]
impl CompileResultJS {
    pub fn compile(sources: JsValue) -> Result<CompileResultJS, JsError>;
    pub fn diagnostics(&self) -> Vec<DiagnosticJS>;
    pub fn error_count(&self) -> usize;
    pub fn warning_count(&self) -> usize;
    pub fn model(&self) -> Option<ModelJS>;
}
```

`ModelJS` holds the resolved model and provides typed access to its contents:

```rust
#[wasm_bindgen]
impl ModelJS {
    pub fn project(&self) -> ProjectJS;
    pub fn components(&self) -> Vec<ComponentJS>;
    pub fn component_by_name(&self, name: &str) -> Option<ComponentJS>;
    pub fn score(&self) -> ScoreReportJS;
}
```

### Design principles

- **`rhizz-core` has no wasm dependency** — all wasm-bindgen concerns stay in
  `rhizz-wasm`.
- **Wrappers use `From` conversions** — mechanical mapping, easy to extend.
- **Expose only what the frontend needs** — complex enums and internal IDs are
  flattened or omitted; more accessors are added as the frontend grows.
- **Arena IDs are plain `number` indices** — `ComponentId(3)` becomes `3` in TS,
  indexable into the corresponding array.

## Rendering Pipeline

1. User selects an example system (hardcoded HCL sources).
2. Sources are compiled via `rhizz-wasm` → `CompileResult`.
3. The resolved `Model` is fed to the layout engine, which positions components
   in a grid (non-leaf components expand to contain children).
4. Three.js `SVGRenderer` draws the scene: rectangles for components, lines with
   arrowheads for connections.
5. Pan/zoom via mouse drag and scroll wheel.
6. Hover hit-testing shows component details (description, tags, ports) in an
   overlay panel.
7. "Export SVG" serialises the current SVG DOM to a downloadable file.

## Current Scope (Prototype)

- **Read-only** — no editing capabilities.
- **Hardcoded examples** — drone system and BuzzVid social-media platform,
  embedded as HCL string literals.
- **No backend** — everything runs client-side in the browser.
- **No file I/O** — sources are compiled from in-memory strings.

## Build & Dev

```bash
cd web

# Install dependencies
deno install

# Development server
deno task dev

# Production build (output: web/dist/)
deno task build

# Preview production build
deno task preview
```

The WASM binary must exist before building
(`wasm-pack build crates/rhizz-wasm --target web --release`).
