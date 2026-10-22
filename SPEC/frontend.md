# Web Frontend (`web/` directory)

Browser-based system modeler & explorer. Pure SPA — no API, no external backend.

## Stack

| Layer          | Technology                                |
| -------------- | ----------------------------------------- |
| Runtime        | Node.js 24 (npm)                          |
| Language       | TypeScript                                |
| UI framework   | Svelte 5                                  |
| Build tool     | Vite                                      |
| Visualisation  | Custom SVG renderer                       |
| Model compiler | `rhizz-wasm` (WASM build of `rhizz-core`) |

## Architecture

The frontend follows the same
[frontend contract](architecture.md#frontend-contract) as the CLI: all
model logic lives in `rhizz-core`, the frontend owns only I/O and presentation.

```
web/
├── package.json              # npm dependencies and scripts: dev, build, preview
├── package-lock.json         # locked dependency tree (`npm ci`)
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
Component           ──From──▸  ComponentJS                  class ComponentJS  { label, full_name, … }
ScoreReport         ──From──▸  ScoreReportJS                class ScoreReportJS { overall_percentage, … }
CategoryScore       ──From──▸  CategoryScoreJS              class CategoryScoreJS { complete, partial, … }
```

`CompileResultJS` is the main entry point — an opaque class that holds the
compiled state and returns typed wrappers from its methods:

```rust
#[wasm_bindgen]
impl CompileResultJS {
    pub fn compile(sources: JsValue) -> Result<CompileResultJS, JsError>;
    pub fn has_model(&self) -> bool;
    pub fn diagnostics(&self) -> Vec<DiagnosticJS>;
    pub fn components(&self) -> Vec<ComponentJS>;
    pub fn score(&self) -> Option<ScoreReportJS>;
    pub fn error_count(&self) -> usize;
    pub fn warning_count(&self) -> usize;
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
6. Hover hit-testing shows component details (full_name, tags, ports) in an
   overlay panel.
7. "Export SVG" serialises the current SVG DOM to a downloadable file.

## Drawing a connection

Dragging an arrow from one component to another opens the **New connection**
dialog. Every connection the editor creates has a port on each end: the dialog
creates the connection and both ports in one `connect_components` op, so the
gesture is a single undo step and a single entry in the action log.

Everything is prefilled, so Enter creates with the defaults; Esc cancels and
writes nothing.

| Field            | Default                                                             |
| ---------------- | ------------------------------------------------------------------- |
| Connection name  | `<from>-to-<to>`, made unique across the model; focused on open     |
| Protocol         | none. A name that no protocol has yet creates an empty protocol     |
| Port name        | `link-<other component>`, made unique within the component          |
| Role             | unset                                                               |
| `external`       | `false` for a direct child of the connection's scope (siblings), `true` when the connection leaves a nested component |
| `required`       | `true` (the spec default)                                           |

- A port name is neutral on purpose: a connection has no direction of its own
  (roles carry it, see SPEC.md §6), so `to-<other>` would claim one.
- With a protocol that defines `roles`, each end offers those roles and the
  source and target start on the first and second one (`E009` otherwise). A
  protocol without roles shows "No roles defined". Without a protocol the role
  is free text.
- Defaults are computed once, when the dialog opens. They are not recomputed
  when another field changes, apart from the roles following the protocol.
- Ports are created on the component *definitions* the instances are sourced
  from, so every instance of a definition gets the new port.
- A drag that starts or ends on an existing port dot keeps that port and
  creates one only for the other end.
- Any refusal (taken label, unknown component, …) leaves the model untouched
  and the dialog open.

## Persistence

The editor keeps every project in a virtual filesystem (`web/src/vfs/`), which
has two interchangeable backends. The path-based facade (`vfs/fs.ts`, shaped
after `node:fs/promises`) is the only thing pages use; the id-based
`ProjectStore` beneath it is an implementation detail.

- **Browser** (default): one JSON document in `localStorage` under
  `rhizz:vfs:v1`.
- **`rhizz web`** (when the build sets `VITE_RHIZZ_SERVER_URL`): a
  `GET`/`PUT /api/vfs` pair carrying the whole VFS as
  `{ version, projects, nodes }`.

The server does not invent a container format for that payload: it expands a
project into a **directory of ordinary files** — `system.hcl`, `views/*.hcl`,
`docs/*.md`, plus anything else the project contains — one directory per
project, named by the project's address (`vfs/slug`). So a data dir is a plain
directory tree, the repository's `examples/` is a valid one, and the files a
project is made of are the files on disk. See `rhizz-server`'s `storage`
module for the exact layout and what it deliberately ignores (hidden entries,
symlinks, directories that are not projects).

> The sections above describe an earlier prototype of this app (a read-only
> viewer over hardcoded examples). The persistence layer described here is
> current.

## Build & Dev

```bash
cd web

# Install dependencies
npm ci

# Development server
npm run dev

# Production build (output: web/build/)
npm run build

# Preview production build
npm run preview
```

The WASM binary must exist before building
(`wasm-pack build crates/rhizz-wasm --target web --release`).
