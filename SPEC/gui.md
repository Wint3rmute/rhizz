# GUI Frontend (`rhizz-gui`)

The desktop GUI is implemented in the `rhizz-gui` crate using `egui`. It follows the [frontend contract](architecture.md#frontend-contract) and adds the following responsibilities.

## File Watching and Live Recompile

- On startup, `rhizz-gui` scans the project directory for `.hcl` files and registers a filesystem watcher (via the `notify` crate).
- Any change to a `.hcl` file triggers an immediate recompile via `rhizz_core::compile`.
- The last successfully resolved `Model` is kept in memory as a fallback. If the current edit produces hard errors, the UI continues to display the previous valid state while showing the new diagnostics.

## In-Memory Editing

- Source text for each file is held in memory and displayed in an editor pane.
- Edits are compiled on each keystroke (or on a short debounce) without writing to disk first.
- Saving writes the buffer back to disk; the filesystem watcher then confirms the round-trip.

## Diagnostic Display

- Errors and warnings are shown inline in the editor pane, annotated at the relevant line.
- A sidebar panel lists all diagnostics with code, file, and message, and allows navigation to the offending location.

## View Rendering

- For each view defined in the model, `rhizz-gui` calls `rhizz_dot::render_view` to obtain a DOT string.
- The DOT graph is displayed within the UI. The rendering strategy (embedded layout engine vs. calling the system `dot` binary) is an implementation decision for the `rhizz-gui` crate.

## Score Dashboard

- The completion report from `rhizz_core::score` is rendered as a live dashboard panel that updates on every recompile.
