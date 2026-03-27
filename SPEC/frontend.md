# Web Frontend (`rhizz-web`)

Browser-based system model explorer. Pure SPA — no API, no external backend.

## Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Deno |
| Language | TypeScript |
| UI framework | Svelte 5 |
| Build tool | Vite |
| Visualisation | Three.js (SVGRenderer) |
| Model compiler | `rhizz-wasm` (WASM build of `rhizz-core`) |

## Architecture

The frontend follows the same [frontend contract](architecture.md#frontend-contract) as the CLI and GUI: all model logic lives in `rhizz-core`, the frontend owns only I/O and presentation.

```
web/
├── deno.json                 # Deno tasks: dev, build, preview
├── package.json              # npm dependencies
├── vite.config.ts            # Svelte plugin + rhizz-wasm alias
├── index.html
└── src/                      # Source code
```

## WASM Integration

The `rhizz-wasm` package (built with `wasm-pack --target web`) is resolved via a Vite alias pointing at `../crates/rhizz-wasm/pkg`. The wrapper in `lib/rhizz.ts` provides a typed interface:

```ts
await initWasm();
const result: CompileResult = compile(sources);
// result.model: Model | null
// result.diagnostics: Diagnostic[]
```

All types in `lib/types.ts` mirror the Rust `Model` structs — arena-indexed IDs (`SystemId`, `ComponentId`, …) are plain `number` indices into the corresponding arrays.

## Rendering Pipeline

1. User selects an example system (hardcoded HCL sources).
2. Sources are compiled via `rhizz-wasm` → `CompileResult`.
3. The resolved `Model` is fed to the layout engine, which positions components in a grid (non-leaf components expand to contain children).
4. Three.js `SVGRenderer` draws the scene: rectangles for components, lines with arrowheads for connections.
5. Pan/zoom via mouse drag and scroll wheel.
6. Hover hit-testing shows component details (description, tags, ports) in an overlay panel.
7. "Export SVG" serialises the current SVG DOM to a downloadable file.

## Current Scope (Prototype)

- **Read-only** — no editing capabilities.
- **Hardcoded examples** — drone system and BuzzVid social-media platform, embedded as HCL string literals.
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

The WASM binary must exist before building (`wasm-pack build crates/rhizz-wasm --target web --release`).
