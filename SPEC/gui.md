# GUI Frontend (`rhizz-gui`)

The desktop GUI is implemented in the `rhizz-gui` crate using `egui`. It follows the [frontend contract](architecture.md#frontend-contract) and adds the following responsibilities.

## File Watching and Live Recompile

- On startup, `rhizz-gui` scans the project directory for `.hcl` files and registers a filesystem watcher (via the `notify` crate).
- Any change to a `.hcl` file triggers an immediate recompile via `rhizz_core::compile`.
- The last successfully resolved `Model` is kept in memory as a fallback. If the current edit produces hard errors, the UI continues to display the previous valid state while showing the new diagnostics.

## Editing

- The user is expected to edit `.hcl` files with their editor of choice. The UI only serves as a validation/viewing tool

## Diagnostic Display

- Errors and warnings are shown in a dedicated pane
- A sidebar panel lists all connections, components, systems

## View Rendering

- For each view defined in the model, `rhizz-gui` calls `rhizz_dot::render_view` to obtain a DOT string.
- The DOT string is fed to the [`layout-rs`](https://crates.io/crates/layout-rs) crate, which parses it and computes a layered graph layout entirely in-process — no Graphviz installation required.
- The resulting node positions and edges are drawn directly onto an `egui::Painter` inside a `ScrollArea`, giving the user free pan and zoom.
- Each view is rendered into its own tab.

## Score Dashboard

- The completion report from `rhizz_core::score` is rendered as a live dashboard panel that updates on every recompile.
