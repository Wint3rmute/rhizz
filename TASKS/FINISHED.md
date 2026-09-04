# Finished Tasks

Completed tasks are listed here, most recent first.

---

## Task 103 — Rewrite the book/ preprocessor in Rust

Replaced the Python mdBook preprocessor (`book/preprocessors/rhizz.py` + its
unittest suite, ~1180 lines) with a new workspace crate `crates/rhizz-book`.
Python is fully gone from the repo and the dev shell; the book build chain is
now pure Rust end-to-end.

- **`crates/rhizz-book`** (new crate, bin + lib, workspace lints, in-process
  compile via `rhizz-core` — no CLI spawning, no tempdirs, no binary discovery):
  - `blocks.rs` — `` ```rhizz `` fence parsing (attrs incl. `ignore`),
    `str.splitlines()`-parity splitting, SHA-256 body hashing.
  - `compile.rs` — one compile per distinct body keyed by hash; `Verdict`
    keeps diagnostics in compiler emission order for panels plus a stably
    sorted copy for the lock; score object byte-matches `--json build`.
  - `normalize.rs` — lock-comparable diagnostics (`code` / optional `line` /
    `message`, file dropped), canonical `(code, line, message)` ordering.
  - `lock.rs` — `book.lock` read/write (atomic tmp+rename) / compare
    (new/changed/removed block, format mismatch, version-drift note),
    `BOOKLOCK_ACCEPT_CHANGES` flag parser. Field order is alphabetical to
    keep the JSON byte-identical to the historical Python writer. Output
    changes render as a git-style unified diff (`--- book.lock` vs
    `+++ current compiler`) of the pretty-printed JSON via the `similar`
    crate, so reviewers see exactly which diagnostic/score lines drifted;
    when stderr is a terminal (and `NO_COLOR` is unset) the diff is
    ANSI-colored with git's own scheme (bold-yellow headers, cyan hunks,
    red removals, green additions).
  - **tracing logs**: block processing is now instrumented with `tracing`
    (already in the workspace) — `info!` events per distinct body (bytes,
    error/warning counts, scored flag) and per rendered block (chapter, sha,
    counts, compiled flag), plus a pipeline summary. `main` installs a
    stderr-only subscriber defaulting to `info` (overridable via `RUST_LOG`)
    with the same TTY/`NO_COLOR` color policy as the lock diff; stdout stays
    clean for the mdbook protocol. The formatter mirrors mdbook's own style
    (bare `LEVEL message`, no timestamps/targets/span context — all useful
    fields are inline on each event). Compile events name their owning chapter
    (or `chapters=N` for bodies shared by several chapters, tracked via a
    reverse chapter index during collection).
  - `render.rs` — HTML verdict panels reproduced byte-for-byte (same class
    names, ✓/⚠/✗ glyphs, em dashes, score stats, `html.escape` semantics).
  - `transform.rs` — chapter rewriting (`` ```hcl `` + panel) and lock traces.
  - `protocol.rs` — mdbook 0.5.x protocol (`supports` probe + stdin/stdout
    JSON roundtrip, `preserve_order` serde_json so untouched bytes survive),
    depth-first chapter traversal, and the `process_book` pipeline.
  - `main.rs` — thin entry point returning `ExitCode` (no `process::exit`).
- **54 unit tests** (red/green): ported the entire Python unittest suite 1:1
  (normalization, sorting, lock compare, accept flag, block parsing, chapter
  transformation) and added pipeline tests (`process_book` end-to-end with a
  temp lock: generate → verify → stale-lock refusal + diff output).
- **Wiring:** `book.toml` → `command = "cargo run --quiet --bin rhizz-book"`
  (mdbook runs preprocessors with cwd = book root, so cargo walks up to the
  workspace root; verified empirically with mdbook 0.5.4); Justfile `book`/
  `book-accept` build `--bin rhizz-book`; `just test` drops the Python
  unittest step; `flake.nix` drops `pkgs.python3`; CI book job builds both
  binaries. Deleted `book/preprocessors/`.
- **E2E trace, verified byte-for-byte:** (1) probe `supports html`/`latex`
  exit codes; (2) hand-built book JSON through the binary; (3) full `mdbook
  build book` against the committed `book.lock` — validates with **zero lock
  churn** (the circulated lock needed no regeneration; `book.lock` stays
  byte-identical, including the historical Python `sort_keys` key order and
  trailing newline); (4) cross-check: built the book with the old Python
  preprocessor pinned to the same compiler (`RHIZZ_BIN`) — the two outputs
  are byte-for-byte identical; (5) CI config updated (rust job already covers
  `cargo test --all`; book job `cargo build --bin rhizz --bin rhizz-book`).
- Bonus fix: Python's binary discovery preferred a stale `target/release/
  rhizz` over the fresh debug build, so book builds could silently run an old
  compiler (it briefly corrupted `book.lock` mid-session; the Rust
  preprocessor eliminates the class of bug entirely by compiling in-process).
- Validated with `just format`, `just test` (all Rust + 474 web unit tests),
  `just lint`, `just build`. (`just test`'s storybook leg needs Playwright's
  Chromium, which is not installed on this NixOS machine — pre-existing
  local limitation, unrelated to this change.)

---

## Task 102 — Respect browser's default theme (Auto / Light / Dark)

On startup the web app now follows the browser's preferred color scheme
(`prefers-color-scheme`) instead of defaulting to dark, and only a manual
user interaction "pins" the theme to a concrete Light/Dark value. The theme
is a tri-state selection ("auto" | "light" | "dark", persisted under the
existing `THEME` key) with a resolved "light"/"dark" that daisyUI actually
applies.

- **`web/src/theme.ts`** (new, pure & unit-tested — 17 tests):
  `ThemeSelection`/`ResolvedTheme` types, `loadSelection` (tolerates corrupt
  storage, accepts both the legacy raw format `"dark"` and JSON-encoded
  values, falls back to "auto"), `resolveTheme` ("auto" maps to the OS
  preference), and `nextSelectionOnToggle` (toggling always pins the
  opposite of the currently applied theme).
- **`web/src/ThemeState.svelte`**: thin Svelte wrapper over `theme.ts`.
  `selection` + tracked `prefersDark` ($state), `matchMedia` change listener
  so live OS theme switches apply while in Auto mode, `$effect.root` keeps
  `<html data-theme>` and localStorage in sync, exports `getTheme`,
  `getSelection`, `setSelection`, `toggleTheme`.
- **`web/src/app.html`**: tiny dependency-free pre-paint script that reads
  the stored selection + `matchMedia` and sets `data-theme` before first
  paint — kills the wrong-theme flash for light-mode users (previously
  hardcoded `data-theme="dark"`).
- **`web/src/components/Navbar.svelte`**: desktop toggle unchanged in
  behavior (now pins an explicit value when leaving Auto); the mobile menu's
  single toggle became a tri-state picker (Auto / 🌙 Dark / ☀️ Light) using
  daisyUI `join`, so users can explicitly unpin back to Auto.
- **`web/src/components/Navbar.stories.ts`**: new `MobileThemePicker` story
  exercising the tri-state row; uses CSF `beforeEach`/`afterEach` to pin a
  concrete selection without leaking global ThemeState into other stories.

---

## Task 101 — Inventory subpage (browse & inspect all model entities)

Added an "Inventory" subpage at `/projects/[id]/inventory` that lists every
**component definition** (never instances) in the compiled model in a
searchable, filterable sidebar, with a read-only preview of the definition's
default diagram (`diagrams/<label>.hcl`) and a tabbed detail pane.

- **`web/src/routes/projects/[id]/inventory/`** (new route, mirroring the
  `explore/` page + pure-helpers + stories pattern):
  - `inventory.ts` (pure, unit-tested): `InventoryTab` (All / Components /
    Interfaces), `filterDefinitions` (tab + free-text search across label,
    description, tags), `definitionDepth` (drives `L1`/`L2`/… badges),
    `completionBadge` (mirrors `rhizz-core`'s `score_component` semantics
    locally, since `rhizz-wasm` only exposes aggregate category scores), and
    `defaultDiagramPath` (`diagrams/<label>.hcl`). 14 unit tests.
  - `Inventory.svelte`: three-region layout — Inventory Browser sidebar (filter
    tabs, search, definition cards), diagram preview, detail pane. Data comes
    from the compiled model's raw payload (`model.to_js()`), reading
    `raw.definitions` so zero-instance definitions are listed (Task 100
    retention). The preview loads `diagrams/<label>.hcl` via
    `readDiagramLayoutFile` (existence probed first to distinguish an empty
    diagram from a missing file), maps layout keys to component indices like
    Explore, and emphasizes the selected definition's subtree via
    `DiagramStaticView`'s `selected` set. Missing diagram file → empty state:
    *"Please create a default view diagram under `diagrams/<label>.hcl`"*
    (display-only, no auto-create). Read-only: no model mutations; `Edit`
    deep-links to the Diagrams editor.
  - `DefinitionCard.svelte`: icon, label, completion badge
    (`100% Specified` / partial % / `Draft`), level badge, description.
  - `DetailPane.svelte`: Description (single-rendered Markdown — the mockup's
    duplicated-text defect is avoided), Ports (N) table, Requirements
    placeholder tab, Metadata (kind/level/leaf/visual attrs/tags/children),
    and an `Edit` button deep-linking into the Diagrams editor.
  - `+page.svelte`: SvelteKit route passing `projectId`.
  - `InventoryPage.stories.ts`: Desktop (asserts 4 definitions listed, no
    instances), Mobile, MissingDefaultDiagram (empty state), EmptyModel, and
    an Apollo-11 example story.
- **`Navbar.svelte`**: added an "Inventory" link (desktop + mobile menus).
- **`eslint.config.js`**: added the stories file to the existing scoped
  override for `.ts` files importing first-party `.svelte` modules
  (documented false-positive pattern).

Validated with `just test` (527 tests incl. storybook), `just lint`,
`just build`, and `just format`.

---

## Task 100 — First-class reusable component definitions

Made a reusable component definition a first-class, top-level entity that can
exist with **zero current instances** and survive the roundtrip, end-to-end from
core to GUI. Reuse is an explicit `instance` block.

**Backend (`rhizz-core` + `rhizz-wasm`):** `component "<label>" { ...body... }`
is now ONLY a top-level reusable definition; a system or definition reuses it
via `instance "<local>" { source = "<definition>" }`, and the old
`component { source = ... }` form is removed. Added `ComponentKind`
(Definition|Instance), `Model.definitions`, and `Component.parent: Option`
(`None` for definitions). The parser accepts `instance`; the resolver registers
definitions as retained (surviving with zero instances) and clones their body
per instance; the serializer emits definitions by label and instances as
`instance` blocks. W012 no longer flags unused definitions. All six worked
examples (drone, social-media, software-house, web-app, apollo-11, single-file)
were migrated to definitions + `instance`. W006 skips parentless definitions;
definitions and placed instances are both scored.

**Frontend (`web`):**
- **`DocumentStore` (web)**: added `definitions: ComponentData[]` (top-level,
  no parent); `systemHcl` emits definitions first (sorted), then systems with
  their instances + connections; definitions' bodies emit their child instances,
  ports and sub-connections. `loadFromRawModel` reads `raw.definitions` plus
  each component's `kind`/`source`/`parent`, populating `definitions` and each
  system's instances. Wired `addComponentDefinition(label, options)`
  (top-level) and `addInstance(parentPath, label, sourceLabel)`; the mutation
  observer, `deleteComponent`/`updateComponent`/`renameComponent`/reparent and
  connection mutations all resolve definitions by bare label.
- **`CreateComponentModal` + diagrams `+page.svelte`**: "New Component
  Definition" now creates a top-level reusable definition with no system
  parent; "Use Existing Component" creates an instance in the chosen parent.
  The reusable-definitions pool is derived from `DocumentStore.definitions` (so
  zero-instance definitions are offered). Added a Definitions list to the
diagram sidebar.
- **`actionLog.ts`**: `add_component` split into `add_component_definition`
  (→ `addComponentDefinition`) and `add_instance` (→ `addInstance`); codegen
  updated.
- **Tests / stories**: rewrote `DocumentStore.test.ts` (definitions + instances
  round-trips, reuse across systems) and `actionLog.test.ts`; migrated storybook
  HCL fixtures (`DiagramPage`, `DiagramGridPage`, `Explore`, `rhizz_wasm_wrapper`)
  to definitions + instance syntax; added a `TopLevelDefinition` modal story.

Validated with `just test` (507 frontend + all Rust), `just lint`, `just build`,
and `just format`.

## Task 99 — Component reuse via existing definitions (end-to-end demo)

Made it possible to reuse an already-instantiated component definition in
multiple systems from the GUI, as a preliminary end-to-end demo. No compiler
roundtrip invariants were changed.

- **`DocumentStore` (web)**: added `addComponentSource(parentPath, label,
  sourceLabel)` — creates a component whose body is a `source = "<sourceLabel>"`
  reference (an instance) rather than an inline body. Mirrors the model's
  existing `source` reuse semantics and emits the mutation to the action-log
  observer.
- **`CreateComponentModal`**: added a mode toggle at the top — **"New Component
  Definition"** (unchanged inline-body flow) vs **"Use Existing Component"**
  (pick a reusable definition from a searchable dropdown; the instance
  references it via `source`). The inline-body inspector is shown only in "new"
  mode.
- **diagrams `+page.svelte`**: computed the reusable-definitions pool from the
  compiled model — sourced components' `source` labels plus inline top-level
  components' structural paths, deduplicated — and dispatched to
  `addComponentSource` when the modal returns a `sourceLabel` (the modal is
  reached from both the "+ Component" button and canvas double-click).
- **`rhizz-wasm`**: exposed `ComponentJS.source()` so the frontend can read the
  `source` label of compiled components.
- **`actionLog.ts`**: extended the `add_component` action with an optional
  `source`; codegen emits `addComponentSource(...)` for sourced instances so
  the debug replay stays faithful.
- **Tests / stories**: unit tests for `addComponentSource` round-trip/reuse and
  the `addComponentSource` codegen; Storybook stories for "Use Existing
  Component" and the empty-definitions state.
- Validated with `just test` (504 tests), `just lint`, `just build`, and
  `just format`.

---

## Task 98 — Export a sequence of model mutations from frontend logs

Added a way to capture every durable model / layout-persistence mutation the
user makes in the Diagrams editor and turn it into a copy-pasteable TypeScript
test that replays the exact session — so a bug found by manual clicking can be
reproduced deterministically without redoing each step.

- **New pure module `actionLog.ts`** (unit-tested, red/green): a dependency-free
  `ModelAction` union mirroring the real `DocumentStore` mutators (add/rename/
  delete/reparent component, update component, add/delete connection, ports,
  protocols, views, node layout) plus `createActionLog()`, `encodeCall()` (one
  TS line per action, escaping labels/paths/quotes), and `asTestScript()` which
  renders a self-contained Vitest test body: construct a fresh `DocumentStore`,
  seed it with the session's baseline HCL (matching how the UI loads the primary
  file before each edit), replay the actions, and assert the canonical
  `systemHcl` matches the traced final state.
- **`actionLogConsole.ts`** (thin browser glue): `attachConsoleMirror()` logs
  each action to the console under a `[rhizz-replay]` prefix as it happens, and
  `copyDebugScript()` copies the full test block to the clipboard.
- **`+page.svelte` instrumentation**: the shared `actionLog` is cleared on
  project load and records a `ModelAction` next to each *successful* mutation
  (only when the mutator actually changed something, so no-op edits aren't
  logged): component create/update/rename/delete, reparent, connection
  add/delete, and system add. Selection/pan/zoom/grid/snap are deliberately
  excluded (no UI noise).
- **`DocumentStore.svelte.ts`**: `addComponent` now also accepts an options
  object (leaf/description/tags/icon/color/border/font/ports) so the emitted
  call maps to a real method, and a new `renameComponent(path, newLabel)`
  first-class mutation (the inspector previously mutated `comp.label` directly).
- **`DiagramToolbar.svelte`**: new "Copy Debug Info" button (gated on an
  `oncopydebug` handler, mirroring + System / + Component), showing a transient
  "✓ Copied Debug Info" state. New Storybook stories (`CopyDebugInfo`,
  `CopyDebugInfoCopied`) exercise it.
- **Tests**: `actionLog.test.ts` covers codegen (exact emitted lines, escaping,
  options-object form, port/protocol/layout variants) and the full test-script
  shape. All 497 frontend tests pass.
- Validated with `just test`, `just lint`, `just build`, and `just format`.

  > Note: connection start/end side decorations and diagram node layout persist
  > through the separate `diagrams/*.hcl` VFS subsystem (not `DocumentStore`),
  > so they are not part of the emitted replay — the trace faithfully covers
  > the system-model mutations that affect `systemHcl`. The `update_node_layout`
  > / `add_view` actions are part of the replayable vocabulary for when a
  > unified command history (next task) routes layout through the same store.

---

## Task 97 — More visible scale/graduation marks on the diagram grid

Made the background grid's alignment easy to read at any zoom by drawing one
graduation level per scale, each more visible than the last: faint 1px lines
every 10 units (base spacing), medium 1.5px lines every 100 units, and bold
primary-tinted 2.5px lines every 1000 units.

- **New pure module `grid.ts`** (unit-tested, red/green): `GRID_GRADUATIONS`
  is the tunable ladder — multiples (10/100/1000) plus per-level theme-color,
  stroke width and opacity — and `buildGraduatedGridPatterns()` turns it into
  a chain of nested SVG pattern descriptors. Each coarser tile is filled with
  the next-finest pattern (aligned to the same world-space origin via
  `patternUnits="userSpaceOnUse"`) and draws its own bolder edge lines on top,
  so tiles stay small, every line lands exactly on the base spacing, and
  panning/zooming is free via the viewBox. Misaligned multiples throw loudly.
- **`+page.svelte`**: replaced the hardcoded two-level pattern (minor 0.08 +
  tile-edge 0.2, both 1px) with the `{#each gridPatterns}` chain and a canvas
  rect filled with the coarsest level (`url(#Grid-g1000)`). Nothing else
  changed — the "Toggle Grid" button hits the same `gridVisible` flag and the
  transparent pan/marquee hit target is untouched. Snap settings are
  unaffected (they're orthogonal to display graduations).
- **Storybook**: new `DiagramGridPage.stories.ts` with two stories —
  *Grid Graduations Enabled* (editor window, Grid option on by default; a
  valid 2-component project straddling a 1000-unit line; asserts all three
  pattern levels, the fill chain and the canvas fill) and *Grid Toggled Off*
  (toggle hides the grid, toggle again restores it). One gotcha: stories in a
  file inherit the *default* meta's args, so the grid stories live in their
  own file with explicit per-story args instead of inheriting the broken
  project from the compilation-error page's meta.
- **eslint.config.js**: whitelisted the new story file for the known
  first-party-Svelte-module unsafe-type false positive.
- Validated with `just test`, `just lint`, `just build`, and `just format`.

  > Note: two `DocumentStore` round-trip tests (`serializes multi-system
  > reuse…`, `keeps a definition's label…`) fail intermittently in the full
  > frontend suite (they pass in isolation; also present on `main` before
  > this task, verified via `git stash`). Unrelated to this change — flagged
  > here for whoever picks up the flat-serialization follow-up.

---

## Note — Flat model serialization for component reuse (UI-first editing)

Refactored the round-trip serialization so the project hierarchy stays flat and
components can be re-used across parents/systems, keeping the model compatible
with UI-first editing.

- **Problem:** the round-trip logic inlined every component under its parent,
  which destroyed multi-system reuse (e.g. the same plane on-air vs in a hangar,
  or redundant avionics) and broke the editor's model↔HCL round-trip.
- **Rust core (`rhizz-core`)**: `serialize_model` now emits every component as a
  standalone top-level definition (keyed by its `source` label when it is an
  instance of a shared definition, otherwise by its qualified path), and
  systems/parents reference children via `source = "<label>"` instead of
  inlining clones. Added `source` provenance to the resolved `Component` so the
  serializer can emit `source` references rather than losing the sharing.
- **Frontend (`DocumentStore`)**: the editor's serializer was rewritten to match
  — capturing `source` from the WASM model, emitting flat standalone definitions,
  and computing scope-relative connection paths so connections resolve correctly
  regardless of where they're declared.
- **Bugs found & fixed along the way:** definitions were being renamed to their
  instantiation paths (`main/satellite` instead of `satellite`), and connections
  from a child to a sibling component emitted bare labels that failed to resolve
  (E002). Both were isolated in regression tests.
- Validated with `just test`, `just lint`, `just build`, and `just format`.

---

## Task 96 — Delete components and connections with the `delete` key

Pressing Delete (or Backspace) while the diagram canvas has focus deletes the
selected connection (skipping the confirm dialog, since a deliberate key press)
or the selected component if no connection is selected.

- Wired the Delete/Backspace key into the page's `onDiagramKeyDown` handler.
- The shortcut only fires while the canvas has focus (`canvasFocused`), so it
  never triggers while typing in the inspector or the HCL editor.
- `handleDeleteSelectedConnection` gained a `skipConfirm` parameter used by the
  keyboard path.
- Validated with `just test`, `just lint`, `just build`, and `just format`.

---

## Task 95 — Keyboard-driven attribute editing

Cycle the selected component's visual attributes with keyboard shortcuts while
the canvas has focus:

- `t` — cycle text alignment (`center`, `top-center`, `top-left`)
- `b` — cycle border (`solid`, `dashed`, `dotted`)
- `c` — cycle color (the inspector's `COLOR_OPTIONS`)
- `f` — cycle font (`bold`, `italic`, `underline`)

- Added `canvasFocused` state via `tabindex` + focus/blur handlers on the SVG,
  and gated the shortcuts on it (plus no modifier held) so they never fire
  while typing in the inspector or HCL editor.
- Reused the inspector's `COLOR_OPTIONS` from `./visuals` for the color set.
- Added a `nextInCycle` helper and `cycleSelectedAttribute` dispatcher.
- Validated with `just test`, `just lint`, `just build`, and `just format`.

---

## Task 94 — Multi-select when holding Shift

Holding Shift while clicking a node now toggles it in/out of the current
selection instead of replacing it, enabling multi-select.

- Updated `onNodeMouseDown` so Shift+click calls `select`/`deselect` (toggle),
  while a plain click keeps the existing behavior (select only if not already
  selected, so dragging a multi-selection moves the whole group).
- Validated with `just test`, `just lint`, `just build`, and `just format`.

---

## Task 93 — Reverse "Snap to grid" defaults

Snapping to grid is now enabled by default, and holding Ctrl/Cmd temporarily
*disables* it (previously: disabled by default, Ctrl/Cmd enabled it).

- Changed `snapEnabled` default from `false` to `true`.
- `snapActive` is now `snapEnabled && !isModifierHeld()` (was
  `snapEnabled || isModifierHeld()`).
- Updated the toolbar tooltip to reflect the reversed modifier behavior.
- Validated with `just test`, `just lint`, `just build`, and `just format`.

---

## Task 92 — Refresh the landing page

Replaced the barebones "rhizz — System Model Explorer" landing card with the
unified Projects page, and upgraded the no-projects state into a proper landing
with call-to-action cards.

- **Single source of truth**
  - Extracted the former `routes/projects/+page.svelte` logic into a reusable
    `web/src/components/ProjectsPage.svelte` (project list sorted by `updatedAt`,
    open/rename/delete, "New project" via prompt + `createProjectWithMainFile`,
    "New from example" modal with bundled examples and diagram seeding for the
    single-file example).
  - `/` (the landing) and `/projects` (the navbar link) both render the same
    `<ProjectsPage />` — no more redundant intermediate page.
- **Richer empty/landing state**
  - With no projects, the page now shows a hero (rhizz tagline + description)
    with two CTA cards: "Start from an example" (opens the existing example
    modal) and "New project" (blank `system.hcl`), both reusing the existing
    handlers. The populated-list header layout is unchanged.
- **Testability seam**
  - Optional `projects`/`loading` props let Storybook (and future component
    tests) render deterministic fixtures without touching the project store;
    when absent the component reads live from `projectStore` exactly as before.
- **Storybook coverage** (new `ProjectsPage.stories.ts`)
  - `WithProjects`: populated list with rename/delete/new-project controls.
  - `EmptyLanding`: hero + both call-to-action cards.
  - `EmptyLandingOpensExampleModal`: clicks "Start from an example" and
    asserts the modal lists the real bundled example projects (WASM init).
- Validated with `just test` (18 rust tests + 465 frontend tests, +3 new story
tests), `just lint`, `just build`, and `just format`.

---

## Task 91 — Rhizz server as a new crate

Added `rhizz-server`, a standalone axum HTTP server that serves the compiled web
editor and persists the frontend's virtual filesystem, plus a frontend storage
backend that uses it (with the browser-only mode preserved as the default).

- **Crate bootstrap & sample server**
  - New workspace member with a `lib`/`bin` split; axum 0.8 router assembled in
    `server::app()` (single place that registers routes), `server::run()` binds a
    listener, tracing via `tracing-subscriber` (env-filter, like the CLI).
    Router exercised in-process with `tower::ServiceExt::oneshot` tests.
- **Static file bundling**
  - `build.rs` embeds the vite output (`web/build`) via `rust-embed`; the SPA
    build produces only `404.html` (shell, `ssr=false`/`prerender=false`) plus
    `_app/` hashed assets, so that shell is the marker. When the frontend was
    never built (gitignored output, node-less CI rust job) a placeholder shell
    is embedded and the `rhizz_has_embedded_assets` cfg stays off.
  - `just build` now builds wasm + vite *before* `cargo build` so the canonical
    flow embeds the real UI.
  - Serving: real files with guessed mime types, immutable caching for `_app/`,
    SPA fallback to the shell for client-side routes, 404 for missing dotted
    files and unknown `/api/*` paths.
- **VFS persistence API**
  - `GET /api/vfs` / `PUT /api/vfs` dump the whole VFS state (no optimisation),
    stored as one JSON file per project in a configurable data dir
    (`RHIZZ_DATA_DIR`, default `./rhizz-data`); malformed payloads 400, IO
    failures 500. The server is a dumb store — schema ownership stays in the
    frontend's zod layer.
- **Frontend integration**
  - New `ServerProjectStore` implementing the existing async `ProjectStore`
    interface: read → `ops.*` mutate → dump-back over HTTP. The forgiving blob
    parser moved from `localStorageStore` into shared `sanitizeVfsData`.
  - Selection switch: `VITE_RHIZZ_SERVER_URL` build-time env var — set → server
    persistence, unset (default) → fully in-browser via localStorage. No other
    app code changed.
- Validated with `just test` (18 rust tests + 462 frontend tests incl. the full
  ProjectStore contract suite against the server store), `just lint`, `just
  build`, and `just format`.

---

## Task 90 — PoC Markdown-based model knowledge database

Added a Markdown "knowledge database" per project, authored in the Editor and surfaced as a hover popup in Explore.

- **Markdown rendering**
  - Added `marked` as a dependency and a thin `markdownRenderer.ts` wrapper that escapes raw HTML (marked does not sanitize by default), so docs rendered via `{@html}` cannot execute scripts.
  - Added a reusable `Markdown.svelte` component (Tailwind `prose` styling) with Storybook coverage.
- **Docs storage**
  - Added `docs.ts` with `readProjectDocs(fs)` that recursively reads `docs/*.md`, keyed by path minus the `.md` suffix so a doc maps to a component's qualified key (e.g. `docs/home-monitor/controller/mcu.md` ↔ `home-monitor/controller/mcu`).
  - Unit tests for key mapping and non-markdown filtering.
- **Editor authoring**
  - The Editor now sets Monaco's language to `markdown` for `.md` files (was hardcoded to `hcl`); docs are created/edited through the existing file tree.
- **Explore hover popup**
  - `DiagramElements`/`DiagramStaticView` gained an optional `onnodehover` callback (enter with index + mouse event, leave with `null`).
  - Explore loads docs, matches the hovered component's qualified key to a doc, and renders a positioned popup near the cursor containing the rendered Markdown.
  - Added an Explore story seeding a doc and asserting the popup appears on hover.
- Validated with `just test` (421 frontend tests), `just lint`, `just build`, and `just format`.

---

## Task 89 — Deterministic state-machine simulation & property testing for model/UI transformations

Added headless deterministic simulation and property-based testing across the frontend workspace lifecycle and Rust model serialization.

- **Stable UI identity / regression fix**
  - Reproduced the software-house first-visual-edit selection jump headlessly: recompilation preserves logical components but can reorder arena indices.
  - Diagram selection now stores qualified component keys and derives current arena indices for rendering/interactions, preserving selection across recompilation; rename/reparent remap keys and delete/undo clear selection.
  - Added a deterministic software-house regression covering both first and subsequent visual edits.
- **Frontend workspace simulation**
  - Added `WorkspaceHarness` over in-memory project VFS → WASM compile → `DocumentStore` mutation/write → recompile, with empty, drone, software-house and Apollo 11 fixtures.
  - Added canonical round-trip, compilability, stable selection, mutation-isolation and UI-state referential invariants.
  - Added `fast-check` and 500 deterministic, shrinking-enabled multi-step runs combining visual mutations, layout moves and diagram-view state changes.
  - Apollo participates in compile/round-trip/UI-state simulation; sourced-component visual rewrites are excluded because the current primary-file `DocumentStore` writer cannot safely flatten sourced instances without E011.
- **Rust property testing**
  - Added `proptest` coverage for generated valid architectural HCL through compile/serialize/recompile canonical round trips and generated view-definition serialize/parse round trips (256 cases each).
- Validated with `just test` (all Rust tests + 406 frontend unit/Storybook tests, including the 500-run simulation), `just lint`, `just build`, and `just format`.

---

## Task 88 — Interactive drill-down navigation in Explore view via URL routing & global toast/notification service

Added URL-driven drill-down navigation to Explore and a reusable app-wide toast service.

- **Explore navigation**
  - Component nodes now resolve matching detail diagrams by qualified path first and component label second, with linked/unlinked visual affordances.
  - Linked nodes navigate through SvelteKit `goto` using the `?diagram=` search parameter; URL state drives selection so direct links and browser back/forward remain synchronized.
  - Missing detail diagrams show `"No detailed view for <component name> created"` through the global toast service.
  - Added a diagram breadcrumb and kept sidebar/mobile diagram selection on the same URL navigation path.
- **Reusable diagram rendering**
  - `DiagramStaticView`/`DiagramElements` accept optional node interaction and linked-node metadata while remaining read-only by default for existing consumers.
- **Global notifications**
  - Added a reactive `ToastState` singleton with `info`, `warning`, `error`, and `success` levels, automatic timeouts, and explicit dismissal.
  - Added `ToastContainer` at the root app layout so notifications are available across all routes.
- **Coverage**
  - Added unit tests for toast lifecycle and diagram matching.
  - Added Storybook coverage for standalone toast levels, Explore drill-down, missing-detail feedback, and breadcrumbs.
- Validated with `just test`, `just lint`, `just build`, and `just format`.

---

## Task 87 — Stricter TypeScript and ESLint configuration

Upgraded TypeScript and ESLint linting in `web/` to mirror the strictness applied to Rust in Task 85 (Clippy denial suite).

- **`web/tsconfig.json`**
  - Enabled `noUncheckedIndexedAccess`, `noImplicitOverride`, `exactOptionalPropertyTypes`, and `noFallthroughCasesInSwitch`.
  - Fixed the resulting typing violations across `web/src/` (indexed-access guards, optional-property widenings, explicit `| undefined` on WASM-boundary interfaces).
- **`web/eslint.config.js`**
  - Upgraded the `@typescript-eslint` preset from `ts.configs.recommended` to `ts.configs.strictTypeChecked` + `ts.configs.stylisticTypeChecked`, scoped to TS/Svelte sources with `projectService` type info.
  - Added explicit strict safety rules: `no-explicit-any`, `no-non-null-assertion`, `no-floating-promises`, `no-misused-promises`, `only-throw-error`, `switch-exhaustiveness-check`, `consistent-type-assertions` (`assertionStyle: "as"`), `no-warning-comments`, and `no-debugger`.
  - Fixed the resulting violations across `web/src/` (nullish-coalescing, `String()` in template literals, `await` on Storybook async `expect`, exhaustive switches, removed `!` assertions, removed a `TODO` marker).
- **Tooling-boundary notes**
  - ESLint's `projectService` can't parse first-party `.svelte` module files, so `no-unsafe-*` false-positives on files importing them are scoped off for exactly those files (svelte-check, part of `just lint`, types them correctly).
  - `no-unused-vars` false-positives on Svelte `interface Props` callback parameter names are disabled for `.svelte` files only; pure `.ts` files keep full checking.
- Validated with `just lint` (clippy `-D warnings` + ESLint + svelte-check), `just test` (all Rust + 334 Vitest tests pass), `just build`, and `just format`.

---

## Task 86 — Make selection box less obstructive

Replaced the selection box so it no longer overrides a node's border style.

- **`web/src/routes/projects/[id]/diagrams/visuals.ts`**
  - Added `SELECTION_OUTLINE_OPACITY` (0.5) and `SELECTION_OUTLINE_DASHARRAY`
    (`"1.5 3"`) constants describing the selection indicator's presentation.
- **`web/src/routes/projects/[id]/diagrams/+page.svelte`**
  - The node `<rect>` now always renders the component's own border
    (`borderSvg.stroke`/`dasharray`) instead of swapping to a solid bold
    primary stroke when selected.
  - Selection is now indicated by a separate 50%-transparent dotted outline
    `<rect>` drawn on top of the node, so the component's color/border style
    stays visible and isn't obscured.
- **`web/src/routes/projects/[id]/diagrams/visuals.test.ts`**
  - Added a unit test asserting the selection-outline constants.
- Validated with `just test` (all Rust + 333 Vitest tests pass), `just lint`
  (clippy `-D warnings` + ESLint + svelte-check), `just build`, and
  `just format`.

---

## Task 85 — Make clippy more strict

Enabled strict Clippy lints across the workspace and fixed all resulting warnings.

- **Workspace lint config (`Cargo.toml`)**
  - Added `[workspace.lints.clippy]` enabling `pedantic` and `nursery` at `deny` level, plus explicit denials for panic-related and unsafe lints: `unwrap_used`, `expect_used`, `indexing_slicing`, `arithmetic_side_effects`, `unreachable`, `unimplemented`, `unchecked_time_subtraction`, `todo`, `string_slice`, `panic_in_result_fn`, `panic`, `exit`, and `as_conversions`.
- **`clippy.toml`**
  - Added test-scoped allowances so unit/integration tests may still use `unwrap`/`expect`/`panic`/indexing-slicing.
- **Code fixes**
  - Applied mechanical and targeted fixes across `rhizz-core`, `rhizz-cli`, and `rhizz-wasm` to satisfy the newly enabled lints (one file at a time, committing after each fix).
- Validated with `just lint` (clippy `-D warnings` + ESLint + svelte-check), `just test` (all Rust + 332 Vitest tests pass), and `just format`.

---

## Task 84 — Visual attributes for components (color, border, font)

Make it possible to define model-level visual attributes on components so diagrams can be styled.

- **Core model & parser (`rhizz-core`)**
  - Added `BorderStyle` enum (`solid`/`dashed`/`dotted`, `solid` default; serde lowercase + `Display`/`as_str`) and `color`/`border`/`font` fields on `Component`.
  - Parse them in `ComponentAttrs`/`RawComponent`; a `border` deserializer maps unknown values to `Solid`. Resolver propagates them (including through the top-level `source` body); the two placeholder/error paths default to `None`.
- **Serializer (`rhizz-core`)**
  - Emit `color`/`font` when set and `border` when not `Solid` (so output stays minimal and idempotent). Added a visual-attribute roundtrip test.
- **WASM (`rhizz-wasm`)**
  - Expose `color`/`border`/`font` getters on `ComponentJS`; assert values and defaults in `wasm-pack test` (13 tests pass).
- **Frontend data model (`web/src/DocumentStore.svelte.ts`)**
  - Add `color`/`border`/`font` to `ComponentData` + the raw-model payload; load them in `loadFromRawModel` and emit them in `serializeComponent` (dropping the `solid` default). Roundtrip test added.
- **Rendering (`web/src/routes/projects/[id]/diagrams/`)**
  - Added pure `visuals.ts` helpers mapping border→SVG dash-array and font→SVG text presentation (unit-tested).
  - Applied in both the interactive canvas (`+page.svelte`) and the static/embed `DiagramElements.svelte`: component rect uses border color/dash-array; label uses the font style. `DiagramStaticComponent` carries the new fields.
- **Editor (`NodeInspector.svelte`)**
  - Added Color (text), Border (solid/dashed/dotted select), and Font (unstyled/bold/italic/underline select) controls wired through `onupdate`.
- **Docs/example**
  - Documented `color`/`border`/`font` in the `component` attribute table in `SPEC.md`; annotated the drone example's `gps` component to demonstrate the feature.
- Validated with `just test` (all Rust + wasm-pack + 326 Vitest tests pass), `just lint`, `just format`, and `just build`.

---

## Task 83 — Reuse the FileTree tree to display the component hierarchy in the Diagrams sidebar

- **Reusable Tree Shell (`web/src/components/Tree.svelte`, `treeTypes.ts`)**:
  - Extracted the collapsible-tree chrome shared by file and component hierarchies: expand/collapse (`▸/▾` based on `isExpandable`, folded per-node via a `SvelteSet` of collapsed ids), depth-based indentation, single-row selection (`aria-current`), and an empty-state message.
  - Injected tree-specific chrome (icons, checkboxes, CRUD buttons) through `leading`/`rowTail` snippets — the shell has no file-vs-component knowledge. `leading` receives the row's `collapsed` state so a provider can render a collapsible-aware icon (e.g. open/closed folder). Added an optional `onselect` hook fired after a label click.
  - Defined the `TreeNode` shape (`id`, `name`, `isExpandable`, `children`) in `treeTypes.ts`, decoupled from any particular data source.
- **Refactored `FileTree` into a thin adapter** (`editor/FileTree.svelte`):
  - Now builds `TreeNode[]` from `buildPathTree` and renders via `Tree`. Public props (`entries`, `bind:selectedPath`, `oncreatefile/oncreatedirectory/onrename/ondelete`) are unchanged, so all three call sites (editor, explore, diagrams) and `FileTree.stories.ts` keep working without modification.
- **Component-Hierarchy Builder + Tests (`diagrams/componentTree.ts`, `componentTree.test.ts`)**:
  - Added pure `buildComponentTree(systems, components)` translating the WASM model's flat arena-index parent links into a nested `TreeNode[]` (systems as roots; orphans kept as roots defensively). Component nodes are keyed by arena index (unique; labels are only unique within a parent scope, SPEC §2.3), systems by `sys:<index>`.
  - Three-pass build (materialize nodes → attach to parents → set `isExpandable`) so a parent always exists before its children attach regardless of input order.
  - Added 7 unit tests (empty model, roots=systems, nesting, arena-keying, input-order independence, orphan fallback, expandable-only-non-leaf).
- **New `ComponentHierarchyTree` component (`diagrams/ComponentHierarchyTree.svelte`)** + story:
  - Renders the component hierarchy in the Diagrams right sidebar with expand/collapse. Each component row has a placement checkbox (routes through the shared `toggleComponentChecked`), a label that selects the node (mutates the canvas `selected` set so the node highlights and the inspector opens), and a component icon when present.
- **Wiring in the Diagrams page (`diagrams/+page.svelte`)**:
  - Replaced the flat, non-collapsible "Components" `<ul>` with `ComponentHierarchyTree`.
  - Extracted the sidebar checkbox's check/uncheck logic (remembered-layout restore, active-parent clamping, `reclampChildren`, undo point, selection deselect) into a single `toggleComponentChecked(index)`.
  - Added `checkedIndices` (a `SvelteSet` derived from `checked` via the reverse key→index map) to drive checkbox state.
- **Tests/validation**: `componentTree.test.ts` added to the unit suite (7 tests); added `ComponentHierarchyTree.stories.ts`. Validated with `just test` (all Rust tests + 319 Vitest tests pass), `just lint`, `just format`, and `just build`.

---

## Task 79 — Allow resizing of components by dragging from any edge or corner

- **Pure Geometry Computation (`geometry.ts`, `geometry.test.ts`)**:
  - Added `ResizeHandle` type (`"top" | "bottom" | "left" | "right" | "top-left" | "top-right" | "bottom-left" | "bottom-right"`).
  - Implemented `computeResizedBox(startBox, handle, deltaX, deltaY, minSize)` supporting all 8 resize directions with min-size clamping and opposite-anchor retention.
  - Added unit tests in `geometry.test.ts` covering all edge/corner directions and limit conditions.
- **Interactive Canvas Handles (`+page.svelte`)**:
  - Replaced the single-corner restriction with full-perimeter hit zones: 4 edge strips (`top`, `bottom`, `left`, `right`) and 4 corner handles (`top-left`, `top-right`, `bottom-left`, `bottom-right`).
  - Allowed resizing components even when they are not pre-selected (auto-selects on grab).
  - Maintained undo/redo tracking, active-parent boundary clamping, and child cascade reclamping.
- Validated with `just test` (all 78 Rust tests + 310 Vitest tests pass), `just lint`, `just format`, and `just build`.

---

## Task 78 — Better examples (Single Source of Truth)

- **Single Source of Truth for Examples (`rhizz-core`, `build.rs`, `examples.rs`)**:
  - `crates/rhizz-core/build.rs` scans all subdirectories of `examples/` (`apollo-11`, `drone`, `single-file`, `social-media`, `software-house`, `web-app`) and embeds all `.hcl` files at compile time via static `ExampleProject` and `ExampleFile` structures in `$OUT_DIR/example_projects.rs`.
  - Exposed `pub mod examples;` and `rhizz_core::example_projects()` function.
- **WASM Exports (`rhizz-wasm`)**:
  - Added `get_example_projects()` returning a structured JS array of `{ id, name, description, files: [{ path, content }] }`.
- **Frontend Workspace & Example Selector (`web/`)**:
  - Added `get_example_projects()` to `web/src/rhizz_wasm_wrapper.ts`.
  - Added `createProjectWithFiles()` to `web/src/ProjectState.svelte` to populate multi-file projects in the virtual filesystem.
  - Replaced hardcoded single example on `/projects` with a responsive modal dialog allowing users to browse and initialize workspaces from any bundled example architecture.
  - Eliminated hardcoded HCL duplication in `web/src/example_system.ts`.
- Validated with `just test` (all 78 Rust core tests + 302 Vitest tests pass), `just lint`, `just format`, and `just build`.

---

## Task 77 — Allow customizing the starting point of a connection in Diagrams

- **Diagram-Specific Connection Layout & Persistence (`persistence.ts`, `rhizz-core`)**:
  - Added `ConnectionSide` type (`"top" | "bottom" | "left" | "right"`).
  - Added `ConnectionLayout` model (`connection`, `start_side`) to `ViewDefinition` in `crates/rhizz-core/src/model.rs` and `web/src/rhizz_wasm_wrapper.ts`.
  - Updated `serialize_views` and `parse_views` in `crates/rhizz-core/src/serialize.rs` to format and parse `connection "name" { start_side = "..." }` blocks inside `view` definitions.
  - Updated `DiagramLayout` and `readDiagramLayoutFile`/`writeDiagramLayoutFile` to persist and restore connection layout settings per diagram.
- **Routing & Directional Geometry (`geometry.ts`)**:
  - Implemented `boxSidePoint(box, side)` computing border anchor coordinates.
  - Updated `computeVisibleConnections` to route starting points from custom sides (`top`/`bottom` -> vertical leave, `left`/`right` -> horizontal leave) while automatically orienting the arrival side facing the line.
  - Implemented `computeDirectionalHandles` generating 4 drag handles (top, right, bottom, left) on components.
- **Interactive Canvas & Inspector (`+page.svelte`)**:
  - Rendered 4 directional drag-to-connect handles on selected components on the canvas.
  - Made connection lines interactive and selectable on click with glowing highlight (`#arrow-selected`).
  - Added connection inspection panel allowing users to configure starting points (`Auto`, `Top`, `Right`, `Bottom`, `Left`) or delete connections.
- **Tests**:
  - Added unit tests in `geometry.test.ts` (verifying `boxSidePoint`, `computeDirectionalHandles`, and side routing in `computeVisibleConnections`).
  - Added unit tests in `persistence.test.ts` (verifying HCL view connection layout serialization and roundtripping).
- Validated with `just test` (all 78 core tests + 300 Vitest tests pass), `just lint`, `just format`, and `just build`.

---

## Task 76 — Install FontAwesome icons, use them in the FileTree and Diagrams

- **Core Model & Parser (`crates/rhizz-core`)**:
  - Added optional `icon` attribute to `Component`, `RawComponent`, and `ComponentAttrs`.
  - Updated HCL parser, resolver, and bidirectional serializer to parse and format `icon = "..."`.
- **WASM Bindings (`crates/rhizz-wasm`)**:
  - Added `icon()` getter to `ComponentJS`.
- **Frontend & Diagrams (`web/`)**:
  - Created `web/src/iconHelper.ts` resolving any FontAwesome solid icon (supporting camelCase, kebab-case, or `fa-` prefixes) into SVG geometry (`width`, `height`, `svgPath`).
  - Updated `FileTree.svelte` to render FontAwesome folder (`faFolder`/`faFolderOpen`) and file (`faFileCode`) SVG icons.
  - Updated `DiagramElements.svelte` and interactive canvas `ViewNode` in `+page.svelte` to render component SVG icons inside diagram boxes.
  - Updated `NodeInspector.svelte` with an Icon input field to view and edit component icons.
- **Tests**:
  - Added unit tests in `crates/rhizz-core/src/parse.rs`, `crates/rhizz-wasm/tests/wasm_test.rs`, and `web/src/iconHelper.test.ts`.
- Validated with `just test` (all 78 core tests + 288 Vitest tests pass), `just lint`, `just format`, and `just build`.

---

## Task 82 — `web`: Update frontend TypeScript types and worked examples

- **Frontend Data Model & DocumentStore (`web/src/DocumentStore.svelte.ts`)**:
  - Added `ProtocolData` interface (`label`, `description`, `tags`, `roles`, `messages`).
  - Updated `PortData` interface with `external` and `required` attributes and stripped direct message arrays.
  - Implemented `addProtocol`, `getProtocol`, `deleteProtocol` store mutations and protocol serialization.
  - Updated `loadFromHcl` to ingest protocols, messages, and port attributes.
- **Node Inspector (`web/src/routes/projects/[id]/diagrams/NodeInspector.svelte`)**:
  - Updated port configuration panel with `External (Boundary)` and `Required` toggle controls.
- **Worked Examples (`examples/`)**:
  - Updated `examples/drone` (added `protocols.hcl` with `dshot600`, `uart`, `crsf`, `spi`, `power-dc`, `analog-video`, `i2c`).
  - Updated `examples/social-media` (added `https`, `hls`, `push`, `grpc`, `sql`, `s3` protocols).
  - Updated `examples/software-house` (added `pr-review`, `cicd`, `agile`, `design`, `tickets`, `release`, `test-suites`, `feedback` protocols).
  - Updated `examples/web-app` (added `jwt`, `https`, `ui-nav`, `websocket`, `postgresql` protocols).
- **Tests**:
  - Updated `web/src/DocumentStore.test.ts` verifying protocol and port creation, serialization, and round-tripping.
  - Updated `NodeInspector.stories.ts`.
- Validated with `just test` (all 78 core tests + 283 Vitest tests pass), `just lint`, `just format`, and `just build`.

---

## Task 81 — `rhizz-wasm`: Export protocol types and updated port metadata to JavaScript

- **WASM Bindings (`crates/rhizz-wasm/src/lib.rs`)**:
  - Added `ProtocolJS` wrapper exposing `label`, `description`, `tags`, and `roles`.
  - Added `PortJS` wrapper exposing `label`, `description`, `protocol`, `role`, `external`, `required`, `tags`, and `owner_component_index`.
  - Added `protocols()` and `ports()` methods to `ModelJS`.
- **Tests**:
  - Added WASM test `protocols_and_ports_return_typed_wrappers` in `crates/rhizz-wasm/tests/wasm_test.rs`.
- Validated with `just test` (all 78 core tests + 283 Vitest tests pass), `just lint`, `just format`, and `just build`.

---

## Task 80 — `rhizz-core`: HCL serialization for protocols and port attributes

- **HCL Serialization (`crates/rhizz-core/src/serialize.rs`)**:
  - Implemented `serialize_protocol` formatting top-level `protocol` blocks with description, tags, roles, and child messages/fields.
  - Updated `serialize_port` to format `external = true` and `required = false` attributes, while stripping child message blocks (now owned by protocols).
  - Serialized protocols in sorted deterministic order at the project root level.
- **Tests**:
  - Added unit test `test_protocol_and_port_attributes_roundtrip` verifying idempotent serialization and round-trip parsing of protocol blocks and port attributes.
- Validated with `just test` (all 78 core tests + 283 Vitest tests pass), `just lint`, `just format`, and `just build`.

---

## Task 79 — `rhizz-core`: Locality of port verification & completion scoring for protocols

- **Port Locality Verification (`crates/rhizz-core/src/validate.rs`)**:
  - Updated `W010` unconnected port diagnostic checks:
    - Optional external ports (`external = true, required = false`) are allowed to remain open without triggering `W010`.
    - Required external ports (`external = true, required = true`) and internal ports (`external = false`) emit `W010` when unconnected.
- **Orphan Protocol Detection (`crates/rhizz-core/src/resolve.rs`)**:
  - Tracked referenced protocols across all component ports.
  - Emitted warning `W012` for any top-level `protocol` not referenced by any port in the project.
- **Completion Scoring (`crates/rhizz-core/src/score.rs`)**:
  - Ports referencing a protocol inherit its message schema for scoring (scores 1.0 when all protocol messages are complete, 0.5 when partially complete, 0.0 when incomplete or missing messages).
- **Tests**:
  - Added unit tests in `validate.rs`: `w010_optional_external_port_no_warning`, `w010_required_external_port_emits_warning`, `w010_internal_port_unconnected_emits_warning`.
  - Added unit tests in `resolve.rs`: `w012_unreferenced_top_level_protocol_emits_warning`, `w012_referenced_protocol_no_warning`.
  - Added unit tests in `score.rs`: `port_with_complete_protocol_messages_scores_complete`, `port_with_empty_protocol_scores_incomplete`.
- Validated with `just test` (all 77 core tests + 283 Vitest tests pass), `just lint`, `just format`, and `just build`.

---

## Task 78 — `rhizz-core`: Resolution pass, protocol linking, and connection LCA placement validation

- **Protocol Resolution & Linking (`crates/rhizz-core/src/resolve.rs`)**:
  - Indexed top-level `protocol` blocks, validating duplicate labels (`E001`) and processing protocol child messages/fields.
  - Resolved `port.protocol`: links matching `ProtocolId` when defined; emits warning `W014` (`Undefined protocol reference`) when undefined without halting compilation.
  - Validated port `role` against protocol `roles`: emits non-blocking warning `W013` (`Port role not permitted by protocol`) when the port role is disallowed.
- **Connection LCA Placement Validation (`crates/rhizz-core/src/resolve.rs`)**:
  - Implemented `is_ancestor_or_self` helper checking parent hierarchy chains.
  - Enforced Lowest Common Ancestor placement: verified that the declaring scope is an ancestor of both `from` and `to` endpoints; emits blocking error `E015` (`Connection declared outside Lowest Common Ancestor`) when declared in an invalid child scope.
- **Tests**:
  - Added unit tests in `resolve.rs`:
    - `resolve_protocol_definition_and_linking`: verifies protocol resolution, message/field indexing, and port linking.
    - `w014_undefined_protocol_warning`: verifies `W014` warning emission for undefined protocols.
    - `w013_role_not_permitted_by_protocol_warning`: verifies `W013` warning emission for disallowed port roles.
    - `connection_declared_outside_lca_emits_e015`: verifies blocking `E015` error when connection is declared outside LCA.
- Validated with `just test` (all 70 core tests + 277 Vitest tests pass), `just lint`, `just format`, and `just build`.

---

## Task 77 — `rhizz-core`: Data models & HCL parser for `protocol` blocks and port `external`/`required` attributes

- **Raw (AST) Models (`crates/rhizz-core/src/parse.rs`)**:
  - Added `RawProtocol` struct (`description`, `tags`, `roles`, `messages`).
  - Added `protocols: Vec<Labeled<RawProtocol>>` to `RawFile`.
  - Added `external: Option<bool>` and `required: Option<bool>` to `RawPort` and `PortAttrs`.
  - Added `ProtocolAttrs` helper and `parse_protocol()` parser for top-level `protocol` blocks.
  - Updated `parse_file()` and `merge_into()` to process and merge `protocol` blocks across files.
- **Resolved IR Models (`crates/rhizz-core/src/model.rs`)**:
  - Added `ProtocolId(pub usize)` arena index type.
  - Added `Protocol` struct (`label`, `description`, `tags`, `roles`, `messages`).
  - Added `protocols: Vec<Protocol>` to `Model`.
  - Added `protocol_id: Option<ProtocolId>`, `external: bool`, and `required: bool` fields to `Port`.
- **Tests**:
  - Added unit tests in `parse.rs` verifying parsing of top-level `protocol` blocks (with description, tags, roles, nested messages/fields), port `external`/`required` attributes, and merging multi-file protocols.
- Validated with `just test` (all 67 core tests + 276 Vitest tests pass), `just lint`, `just format`, and `just build`.

---

## Task 75 — Allow embedding diagrams via unique URLs

- Implemented unique URL routing scheme for embeddable diagrams: `/projects/[id]/diagrams/embed/[...diagram]`
- Created `web/src/routes/projects/[id]/diagrams/DiagramEmbedView.svelte`:
  - Standalone, chromeless full-bleed container suitable for `<iframe>` embedding in external documentation and websites.
  - Interactive pan and zoom (mouse drag, wheel zoom, touch drag, and two-finger pinch-to-zoom).
  - Auto-fit framing on load (`zoomToFill()`).
  - Read-only: disabled node dragging, node resizing, port wiring, and double-click component creation.
  - Minimal floating toolbar: `Fit` (zoom-to-fill), `Reset` (100% zoom), zoom percentage readout, and `Open in Rhizz ↗` external link targeting the full project diagram.
- Added Storybook stories (`DiagramEmbedView.stories.ts`) for Desktop and Mobile viewports.
- Added unit tests in `DiagramEmbedView.test.ts`.
- Validated with `just test` (all 64 core tests + 268 Vitest tests pass), `just lint`, `just format`, `just build`, and `npx storybook build`.

---

## Task 74 — Use UNIX-style paths for component and port references

- Replaced colon-separated connection reference notation (e.g. `comp:port`) with standard UNIX-style path notation (`comp/port`, `/system/comp/subcomp/port`, `../sibling/port`).
- **Path Resolution & Validation**:
  - Implemented path resolution in `crates/rhizz-core/src/resolve.rs` supporting relative sibling paths (`sensor/i2c`), nested subcomponents (`controller/mcu/spi`), parent traversal (`../battery/power-out`), and absolute root paths (`/system/comp/port`).
  - Added strict validation rejecting invalid non-UNIX colon notation with blocking `E002` errors.
- **Serialization**:
  - Updated connection serialization in `crates/rhizz-core/src/serialize.rs` to output UNIX-style `comp/port` paths.
  - Updated `DocumentStore.svelte.ts` and interactive connection wiring on the diagram canvas to use `/` paths.
- **Examples & Docs**:
  - Updated all worked examples (`examples/drone`, `examples/social-media`, `examples/software-house`, `examples/single-file`, `examples/web-app`).
  - Updated `SPEC.md`, `SPEC/models.md`, and diagnostic documentation (`E010.md`, `E011.md`).
- **Tests**:
  - Added unit tests in `resolve.rs` verifying relative, nested, parent traversal, absolute paths, and colon rejection.
- Validated with `just test` (all 64 core tests + 266 Vitest tests pass), `just lint`, `just format`, and `just build`.

---

## Task 73 — Interactive visual wiring (drag-to-connect ports & connections)

- Implemented interactive visual connection drag-and-drop between ports and components on the diagram canvas.
- Features:
  - Added pure `computePortPositions` in `geometry.ts` to calculate border coordinates for consumer (left), provider (right), and peer (bottom) ports, with unit tests in `geometry.test.ts`.
  - Rendered color-coded interactive port handles on component boundaries (green for provider, orange for consumer, blue for peer) with hit targets and tooltips.
  - Added generic connect anchor handle for components without declared ports.
  - Added `connecting` interaction state with live dashed preview line and arrow tracking the mouse cursor in real time.
  - Target detection (`findHoveredTarget`): detects drop onto specific ports or component boxes, validates sibling scope, prompts for connection label, creates the connection in `DocumentStore`, and updates the VFS (`main.hcl`).
  - Emits real-time compilation and compiler diagnostic feedback (e.g. role incompatibility, protocol mismatches) on drop.
- Validated with `just test` (Rust + Vitest 262/262 pass), `just lint`, `just format`, `just build`, and `deno task --cwd web check`.

---

## Task 72 — Interactive property and message inspector panel

- Created `web/src/routes/projects/[id]/diagrams/NodeInspector.svelte` allowing users to configure component properties, ports, messages, and fields in the GUI.
- Features:
  - Component properties: edit name (with canvas position key preservation), description, comma-separated tags, and atomic `leaf` status.
  - Text alignment controls: `center`, `top-center`, `top-left`.
  - Port management: add/remove ports, configure port label, protocol, and role (`provider`, `consumer`, `peer`).
  - Message & field schemas: add/remove messages inside ports, configure typed fields (`type`, `unit`, `required`), and delete fields.
  - Live persistence & feedback: updates `DocumentStore`, writes to `main.hcl`, and updates completion score and error/warning badges in real time.
- Wired live completion score and diagnostics across the app via `ProjectState.svelte` and displayed the score badge in `Navbar.svelte`.
- Added Storybook story `NodeInspector.stories.ts`.
- Validated with `just test`, `just lint`, `just format`, `just build`, and `deno task --cwd web check`.

---

## Task 71 — Visual node creation and hierarchy editing on the canvas

- Added visual creation actions to the diagram canvas toolbar (`+ System` and `+ Component`).
- Implemented double-click on empty canvas space to immediately create and place a new component at the cursor position.
- Implemented visual hierarchy nesting and reparenting:
  - Added pure `findReparentTarget` helper in `web/src/routes/projects/[id]/diagrams/geometry.ts` to detect the deepest container enclosing a dragged node.
  - Live drop-target visual highlight ring (`stroke-dasharray="4 4"`, `animate-pulse`) rendered around candidate parent components during drag.
  - On drop, reparents the component in the document store, saves the updated HCL to the VFS (`main.hcl`), and updates live compiler diagnostics/score.
- Added unit tests for `findReparentTarget` in `geometry.test.ts`.
- Validated with `deno task --cwd web test run --project unit_tests` (260/260 pass), `deno task --cwd web check` (0 errors/warnings), `npm run --prefix web build`, and `cargo test --all`.

---

## Task 70 — Reactive document store for multi-file workspace (`system.hcl` + `views.hcl`)

- Created `web/src/DocumentStore.svelte.ts` managing reactive in-memory system architecture and diagram view state using Svelte 5 `$state` and `$derived`.
- Implemented reactive derivations:
  - `systemHcl`: Automatically formatted, canonical HCL string representing the complete system architecture model.
  - `viewsHcl`: Automatically formatted HCL for `views.hcl` keeping layout coordinates and filters isolated from the system model.
  - `compileResult`, `model`, `diagnostics`, and `score`: Real-time compilation and score calculations recalculating on every state mutation.
- Provided foundational mutation methods:
  - `addSystem`, `removeSystem`, `getSystem`.
  - `addComponent`, `updateComponent`, `deleteComponent`, `reparentComponent`.
  - `addPort`, `updatePort`, `deletePort`.
  - `addConnection`, `deleteConnection`.
  - `addView`, `updateNodeLayout`.
  - `loadFromHcl`: Ingests existing `system.hcl` and `views.hcl` files into the store.
- Added test suite in `web/src/DocumentStore.test.ts` (7 tests) covering all store mutations, reparenting, diagnostics, view isolation, and HCL round-tripping.
- Validated with `deno task --cwd web test run --project unit_tests` (257/257 pass), `deno task --cwd web check` (0 errors/warnings), `npm run --prefix web build`, and `cargo test --all`.

---

## Task 69 — Expose HCL serialization and model deserialization in `rhizz-wasm`

- Extended `crates/rhizz-wasm` with full WASM bindings for model and view serialization:
  - `ModelJS::to_hcl(&self) -> String` and `serialize_model(model: &ModelJS) -> String`.
  - `ModelJS::from_json(json: &str)` and `ModelJS::to_json(&self)`.
  - `ModelJS::from_js(val: JsValue)` and `ModelJS::to_js(&self)`.
  - `serialize_views(views: JsValue) -> Result<String, JsError>`.
  - `parse_views(hcl: &str) -> Result<JsValue, JsError>`.
- Updated `web/src/rhizz_wasm_wrapper.ts` with strongly-typed interfaces (`NodeLayout`, `ViewDefinition`, `ViewFilterDefinition`, `ViewOutputDefinition`) and exported helper functions (`serialize_model`, `serialize_views`, `parse_views`, `compile_system`).
- Added integration tests in `crates/rhizz-wasm/tests/wasm_test.rs` covering WASM-level model serialization, JSON round-tripping, and views parsing/serializing.
- Added unit tests in `web/src/rhizz_wasm_wrapper.test.ts` verifying compile, serialization, and views parsing through the WASM boundary in Vitest.
- Validated with `cargo test`, `cargo clippy --all-targets --all-features -- -D warnings`, `cargo doc`, `cargo build`, `wasm-pack test --node crates/rhizz-wasm`, `deno task --cwd web check`, `deno task --cwd web test run --project unit_tests`, and `npm run --prefix web build`.

---

## Task 68 — HCL serializer and parser for diagram views and layout metadata in `rhizz-core`

- Implemented `NodeLayout`, `ViewDefinition`, `ViewFilterDefinition`, and `ViewOutputDefinition` in `crates/rhizz-core/src/model.rs`.
- Implemented `serialize_views(views: &[ViewDefinition]) -> String`, `parse_views(hcl: &str) -> anyhow::Result<Vec<ViewDefinition>>`, and `serialize_resolved_views(views: &[View], model: &Model) -> String` in `crates/rhizz-core/src/serialize.rs`.
- Guarantees complete separation of concerns: diagram visual coordinates (`x`, `y`, `width`, `height`, `text_align`) and filter/output settings live in `views.hcl`, completely free from `system.hcl`.
- Enforces sorted deterministic ordering of views (by view label) and node layout blocks (by component path/label).
- Added comprehensive unit tests for views with `node` placement blocks and round-trip integration tests verifying idempotency across all workspace example `views.hcl` files (`drone`, `social-media`, `software-house`, `web-app`).
- Validated with `cargo test`, `cargo clippy --all-targets --all-features -- -D warnings`, `cargo doc`, `cargo build`, and `cargo fmt`.

---

## Task 67 — Deterministic HCL serializer for core system model in `rhizz-core`

- Implemented canonical HCL serialization in `crates/rhizz-core/src/serialize.rs` via `pub fn serialize_model(model: &Model) -> String`.
- Exposes `serialize_model` as part of `rhizz_core`'s public API.
- Serializes `project`, `system`, nested `component`, `port`, `connection`, `message`, and `field` blocks into formatted, standard HCL.
- Guarantees strict determinism and round-trip stability / idempotency:
  `serialize(compile(serialize(model))) == serialize(model)`.
- Enforces sorted deterministic ordering of sibling systems, components, ports, connections, messages, and fields by label.
- Omit/default handling matches canonical HCL schema (standard levels, default port roles, empty lists/descriptions).
- Added comprehensive unit tests and integration tests covering deep nested hierarchies, character escaping, and all workspace examples (`drone`, `social-media`, `software-house`, `single-file`, `web-app`).
- Validated with `cargo test`, `cargo clippy --all-targets --all-features -- -D warnings`, `cargo doc`, `cargo build`, and `cargo fmt`.

---

## Task 65 — Remove legacy data-migration code

The app is still pre-release (no real users on old data shapes to
support), so all one-time "migrate legacy localStorage data forward"
logic accumulated across Tasks 39/57/60/66 was surgically removed rather
than carried forward indefinitely:

- `ProjectState.svelte`: removed `LEGACY_SYSTEM_INPUT_KEY`,
  `migrateLegacySystemInputBox()` (and its `if (typeof window !== ...)`
  auto-run at module load), plus the diagram-layout-specific
  `LEGACY_CHECKED_NODES_KEY`/`LEGACY_SAVED_LAYOUT_KEY`,
  `parseLegacyDiagramRecord()`, and `migrateLegacyDiagramLayout()` added
  by Task 66. `createProjectWithMainFile()` (still used by the `/projects`
  page's "new project"/"new from example" actions) was kept.
- `persistence.ts`: removed `migrateLegacyDiagramFiles()`,
  `readLegacyFlatRecord()`, and the `LEGACY_CHECKED_NODES_PATH`/
  `LEGACY_SAVED_LAYOUT_PATH` constants added by Task 66 — no code path
  anywhere reads `.rhizz/diagrams/checked.json`/`saved-layout.json`
  anymore.
- `diagrams/+page.svelte`: removed `stripLegacyIndexKeys()` and its call
  sites (the diagram-load effect now assigns `layout.checked`/
  `layout.savedLayout` directly), and the `migrateLegacyDiagramFiles(fs)`
  call in the project-switch effect (now just calls
  `refreshDiagramEntries()` directly).
- `persistence.test.ts`: removed the `describe("migrateLegacyDiagramFiles", ...)`
  suite (4 cases) along with the now-unused import.
- Validated with `deno task check`, `deno run lint`,
  `npx vitest run --project unit_tests` (248 tests passing), and
  `deno task build`.

## Task 66 — Multiple named diagrams per project, selectable via `FileTree`

Follow-up to Task 60: replaced the single implicit per-project diagram
(`checked.json` + `saved-layout.json`) with any number of named diagrams,
selectable from a `FileTree` sidebar on the diagrams page — reusing the
editor's `FileTree.svelte` completely unmodified, since it was already
generic over `Dirent[]` + path callbacks. (Note: this task's own migration
helpers — `migrateLegacyDiagramFiles`/`migrateLegacyDiagramLayout` — were
removed again immediately afterward by Task 65, which landed in the same
session; see that entry above for what's actually still in the tree.)

- `persistence.ts`: replaced `CHECKED_NODES_PATH`/`SAVED_LAYOUT_PATH`
  with `DIAGRAM_LAYOUT_DIR` (`.rhizz/diagrams`) and a `DiagramLayout`
  shape (`{ checked, savedLayout }`) — one JSON file per diagram (e.g.
  `.rhizz/diagrams/main.json`), rather than two fixed-name files.
  `readDiagramLayoutFile`/`writeDiagramLayoutFile` now read/write that
  combined shape; `StoredBoxSchema`/`sanitizeStoredRecord` stayed the
  per-entry validation layer.
- `+page.svelte`: added `selectedDiagramPath`/`diagramEntries` state and
  a `FileTree` sidebar (leftmost of three, alongside the existing
  Inspector/Components sidebars) for picking which diagram is open.
  Wired `oncreatefile`/`oncreatedirectory`/`onrename`/`ondelete` to
  `ProjectFs` calls scoped under `DIAGRAM_LAYOUT_DIR`, copying the
  editor's `+page.svelte` prompt()-based create/rename flow exactly
  (including the "Untitled.json"-style default name). A brand new
  project with no diagrams yet gets one auto-seeded ("main.json") the
  first time its diagrams page loads, so checking a component onto the
  canvas is never silently non-persistent. The Components sidebar shows
  a "No diagram selected" hint (instead of the checklist) on the rare
  edge case where every diagram has been deleted.
  The load/write `$effect`s from Task 60's reactivity-tracking fix now
  key off `fullDiagramPath` (derived from `selectedDiagramPath`) instead
  of the two fixed path constants, still using `$state.snapshot()` for
  correct dependency tracking.
- Extended `persistence.test.ts` with `DiagramLayout`-shaped
  round-trip/malformed-data cases.
- Fixed a pre-existing duplicate/misnumbered pair of "allow embedding
  diagrams via unique URLs" tasks in `TASKS.md` (was Task 61 and Task 62
  with identical text) while renumbering around this task.
- Validated with `deno task check`, `deno run lint`,
  `npx vitest run --project unit_tests` (252 tests passing), and
  `deno task build`.

## Task 60 — Move diagram layout persistence into the VFS

Sixth (and last) of the VFS sequence (55–60). Replaced the diagrams
page's global `localStorage`-backed `checked`/`savedLayout` records
(`persisted("DIAGRAM_CHECKED_NODES", ...)`/`persisted("DIAGRAM_SAVED_LAYOUT", ...)`)
with JSON files inside the active project's VFS, so diagram layouts now
travel with the project instead of being shared globally across every
project in the browser.

- `persistence.ts` gained `readDiagramLayoutFile`/`writeDiagramLayoutFile`,
  built on `ProjectFs` (`fs.readFile`/`fs.writeFile`/`fs.mkdir`), storing
  each record at a conventional path — `.rhizz/diagrams/checked.json` and
  `.rhizz/diagrams/saved-layout.json` (one file per persisted record,
  identified by path convention the same way `vfs/compile.ts` identifies
  `.hcl` source files). `StoredBoxSchema`/`sanitizeStoredRecord` stayed
  the validation layer for the JSON stored inside each file — only
  *where* that JSON is read from/written to changed. `readDiagramLayoutFile`
  tolerates a missing file (ENOENT → `{}`), malformed JSON, and a
  non-object top level, all by falling back to an empty record rather
  than throwing.
- `+page.svelte`'s `checked`/`savedLayout` became plain `$state` records
  (no longer the `persisted()` `{ value }` wrapper — every `.value`
  access was dropped). A `diagramLayoutLoaded` flag guards the two
  write-back `$effect`s against firing with stale/empty data while the
  load for the *current* project (keyed off `data.projectId`, like the
  existing `sources` effect) is still in flight, so navigating directly
  between two projects' diagram pages can't cross-contaminate their
  layout files.
- Extended `ProjectState.svelte`'s existing one-time legacy migration
  (Task 57's `migrateLegacySystemInputBox`): after the legacy HCL string
  is moved into a new "Migrated project", `migrateLegacyDiagramLayout`
  now also copies any pre-existing `DIAGRAM_CHECKED_NODES`/
  `DIAGRAM_SAVED_LAYOUT` global localStorage data into that same
  project's new VFS-backed files, then removes the legacy keys.
- Added VFS-backed round-trip/malformed-data test coverage for
  `readDiagramLayoutFile`/`writeDiagramLayoutFile` to
  `persistence.test.ts` (using `InMemoryProjectStore` + `openProjectFs`).
  Existing `persistence.test.ts`/`history.test.ts`/`geometry.test.ts`
  suites were unaffected apart from the new cases.
- No behavior change from the user's point of view beyond "diagrams now
  belong to a project" — same drag/resize/pin/undo interactions as
  before.
- Validated with `deno task check`, `deno task build`, `deno run lint`,
  and `npx vitest run --project unit_tests` (247 tests passing).

## Task 59 — File-tree sidebar in the editor, wired to `ProjectFs`

Fifth of the VFS sequence (55–60). Replaces the editor's interim
"hardcoded main.hcl" convention (Task 58) with a real, multi-file file
tree — the last piece needed before a project can hold more than one
source file in practice.

- Added `web/src/vfs/pathTree.ts`: `buildPathTree(entries: Dirent[])`, a
  pure path-only tree builder (no ids, no `ProjectStore`) that turns
  `ProjectFs.readdir(".", { recursive: true })`'s flat output into a
  nested `PathTreeNode[]` (directories before files, then alphabetical).
  Deliberately **not** a reuse of `vfs/tree.ts`'s id-based `buildTree()`
  as the task text originally sketched — that would have required the
  editor to import `FsNode`/ids again, undoing Task 58's "nothing outside
  `./vfs` touches an id" boundary. `pathTree.ts` sits alongside
  `compile.ts` as a small higher-level helper built purely on
  `ProjectFs`'s public shape (it imports `Dirent`'s *type* from `fs.ts`,
  never the reverse, so the dependency direction stays one-way). 8 new
  tests in `pathTree.test.ts`, including an input-order-independence
  check and a defensive "entry whose parent isn't in the list" case.
- Added `web/src/routes/projects/[id]/editor/FileTree.svelte`: renders
  `buildPathTree`'s output as a collapsible tree (expand/collapse state
  via `SvelteSet`, since it's a real mutated-in-place reactive set, unlike
  the throwaway ones flagged by `svelte/prefer-svelte-reactivity` in Task
  "lint fix 3/4"). Per-row hover actions for rename/delete, plus
  create-file/create-directory on directories and at the root toolbar.
  Talks to the page only through props (`entries`, bindable
  `selectedPath`, and `oncreatefile`/`oncreatedirectory`/`onrename`/
  `ondelete` callbacks) — it never imports `ProjectFs`/`ProjectStore`
  itself, keeping I/O (and its error handling) owned by `+page.svelte`.
- Rewrote `editor/+page.svelte`:
  - Loads the full tree via `fs.readdir(".", { recursive: true })` once
    per project, defaulting the initial selection to the first `.hcl`
    file found (so existing single-file projects keep opening exactly
    the file they always did).
  - Selecting a file loads it via `fs.readFile`; edits write back via
    `fs.writeFile` on every change (no debounce yet, matching the
    pre-existing behavior this replaces).
  - Create/rename/delete handlers call straight into `ProjectFs`
    (`writeFile`/`mkdir`/`rename`/`rm`), never `ProjectStore`, with
    `prompt()`/`confirm()` dialogs and `alert()` error reporting —
    consistent with the existing dialog style already used on the
    `/projects` page. Deleting (or renaming away) the currently-open file
    clears/updates the selection appropriately; deleting the last file
    falls back to "no file selected", which the editor now renders as an
    explicit placeholder instead of an empty Monaco instance.
  - Compilation switched from the single hardcoded-file `compile_system`
    call to `readProjectSources(fs)` (matching `diagrams`/`overview`'s
    existing "flat merge of a directory" semantics) — with one
    refinement beyond the task's literal wording: the currently-open
    file's entry is patched with the *live* in-editor `content` rather
    than trusting `readProjectSources`' own (possibly one-write-stale,
    since the write-back effect is async) read of it, so diagnostics
    never visibly lag behind typing for the file actually being edited.
  - Drag-and-drop move wasn't implemented (explicitly a nice-to-have per
    the task text) — `fs.rename` is exercised via the rename action only.
- No new dependencies.
- Validated with `npx svelte-check` (0 errors/warnings), `npx eslint .`
  (0 problems), `npx vite build` (succeeds), `deno fmt` (clean), and the
  pure-function Vitest project (241/241 passing, including the 8 new
  `pathTree.test.ts` cases). The browser-mode Storybook/`addon-vitest`
  project could not be exercised in this environment — confirmed via
  extensive bisection to be a pre-existing local Playwright/Chromium
  environment hang unrelated to any code in this repo (see the "tests
  hang indefinitely" investigation in conversation history) — so this
  task adds no new Storybook stories and relies on `svelte-check`/`eslint`/
  `vite build` plus manual verification for its UI-heavy parts
  (`FileTree.svelte`'s rendering, the create/rename/delete dialogs).

## Task 58 — Refactor the VFS into a `node:fs`-style path-based API

Unplanned insertion into the VFS sequence (55–60, was 55–59), prompted by
a review: Task 56's `ProjectStore` was an id/inode-style CRUD interface
(`createFile(projectId, parentId, name, contentType, content)`,
`updateFileContent(fileId, content)`), and pages (Task 57) had to hold
raw `FsNode[]` arrays and helpers like `firstHclFile`/`projectSources` to
cope — i.e. "inode" concerns leaking into high-level UI code. Real
filesystems don't expose inode numbers to userland either; they keep
them behind a path-based syscall API. This task does the same here.

- Added `web/src/vfs/fs.ts`: the new public surface, deliberately shaped
  after `node:fs/promises`:
  - `ProjectFs` interface: `readFile`, `writeFile` (creates-or-overwrites,
    like real `fs.writeFile`), `mkdir` (with `{ recursive }`), `readdir`
    (with `{ recursive }`, returning `Dirent`-like `{ name, path,
    isFile(), isDirectory() }`), `rm` (with `{ recursive, force }`),
    `rename`, `stat` (returning `{ isFile(), isDirectory() }`).
  - `openProjectFs(store: ProjectStore, projectId): ProjectFs` — opens a
    filesystem view scoped to one project.
  - `VfsError extends Error` with a Node-style `.code` (`ENOENT`,
    `EISDIR`, `ENOTDIR`, `EEXIST`, `ENOTEMPTY`, `EINVAL` for the
    move-into-own-subdirectory case), so callers can branch on `.code`
    the way real `node:fs` error handling does.
  - Internally resolves paths via new pure helpers in `tree.ts`
    (`splitPath`, `resolveNode`, `resolveDirectory`, `splitBasename`) and
    delegates the actual mutation to the existing id-based `ProjectStore`
    — `ProjectStore`/`operations.ts` are now explicitly documented as an
    internal "inode layer", not meant to be imported outside `./vfs`
    (except `ProjectState.svelte`, which legitimately needs whole-project
    operations with no path-based equivalent).
- Added `web/src/vfs/compile.ts`: `readProjectSources(fs: ProjectFs)`,
  replacing `tree.ts`'s old `projectSources(nodes)`. This is the one
  place that knows "a rhizz source file is named `*.hcl`" — built
  entirely on `ProjectFs.readdir`/`readFile`, exactly like a real Node
  program gathering source files off a real directory (mirroring
  `rhizz-core`'s own `**/*.hcl` glob-based discovery). `fs.ts` itself
  stays fully generic, with no rhizz-specific knowledge.
- Removed `contentType` from `FsFile` (`types.ts`) entirely: a real
  filesystem has no "content type" tag on a file, only a name/extension
  convention. `firstHclFile`/`projectSources` (`tree.ts`) are gone;
  "which files are sources" is now purely a `.hcl`-extension convention
  applied by `compile.ts`, not a schema field.
- Editor/diagrams/overview pages (`routes/projects/[id]/...`) rewritten
  to use `openProjectFs`/`readProjectSources` exclusively — none of them
  import `FsNode`, touch `.id`/`.parentId`, or call `ProjectStore`
  directly anymore. The editor now just does `fs.readFile("main.hcl")`/
  `fs.writeFile("main.hcl", content)` against a well-known path, exactly
  like ordinary fs-based code opening a known file — no more
  `firstHclFile` node-lookup dance.
- `ProjectState.svelte`'s `createProjectWithMainFile` now seeds a project
  via `openProjectFs(...).writeFile("main.hcl", content)` instead of a
  raw `projectStore.createFile(..., "hcl", ...)` call.
- New test files: `web/src/vfs/fs.test.ts` (35 cases covering every
  `ProjectFs` method's success and error paths, using
  `InMemoryProjectStore` as the backing store) and
  `web/src/vfs/compile.test.ts` (4 cases). `tree.test.ts` gained tests for
  the new path-resolution helpers and dropped the removed
  `firstHclFile`/`projectSources` tests. `types.test.ts` dropped its
  `contentType` cases. `store.contract.test.ts`'s `createFile` calls
  updated to drop the now-removed `contentType` argument.
- No new dependencies.
- Validated with `deno task --cwd web test` (211/211 pass, up from 164),
  `deno task --cwd web build` (succeeds), and `deno fmt --check web`
  (clean). `deno task --cwd web check` reports the same 5 pre-existing,
  unrelated errors it did before this change (`@storybook/svelte` is
  declared in `package.json` but not installed in this sandbox's
  `node_modules` — affects `*.stories.ts` files added in a prior,
  unrelated commit; not fixed here as it's outside this task's scope and
  a `node_modules` install issue, not a code issue).
- **Post-review fix:** `rename()` didn't check whether `newPath` was
  already occupied by a *different* node before moving/renaming into it
  — could leave two distinct nodes resolving to the same path, with
  `resolveNode()` then silently returning whichever happened to come
  first. Now rejects with `EEXIST` when the destination is taken by a
  node other than the one being renamed (renaming a path onto itself is
  still a harmless no-op, matching real `fs.rename`). Added 4 more tests
  to `fs.test.ts` (`215/215` passing) covering the file/directory
  destination-occupied cases, the same-node no-op case, and an explicit
  "never leaves two nodes at one path" regression check.
- **Post-review fix:** the previous fix only covered `fs.ts`'s own
  check-before-call in `writeFile`/`mkdir`/`rename` — `operations.ts`
  itself (`createFile`, `createDirectory`, `renameNode`, `moveNode`)
  still had no same-name-sibling guard of its own, so anything calling
  `ProjectStore` directly (bypassing `fs.ts`) could still create two
  siblings sharing a name, breaking `resolveNode`/`pathOf`'s
  single-match assumption. Added a shared `assertNoSiblingWithName()`
  helper in `operations.ts`, applied to all four mutating operations
  (scoped by `projectId` + `parentId`, excluding the node's own id for
  rename/move so a same-name no-op still succeeds; a file and directory
  can't share a name either, matching real filesystem semantics). Added
  18 new cases to `store.contract.test.ts` (`233/233` passing, run
  against both `LocalStorageProjectStore` and `InMemoryProjectStore`)
  covering create/rename/move collisions across file×file, file×
  directory, cross-parent, and cross-project scenarios.

## Task 57 — `/projects` route, `ProjectState`, and legacy-data migration

Third of the five-task VFS sequence (55–59). Turns the single-project SPA
into a multi-project one: a `/projects` landing page, project-scoped
routing for the editor/diagrams/overview pages, and a one-time migration
of any pre-existing single-project data. Still local-first/single-editor;
no locking, no CRDT.

- Added `web/src/ProjectState.svelte` (a module-only `.svelte` file with
  `<script module>`, matching the established `ThemeState.svelte`/
  `KeyboardState.svelte` pattern — not `ProjectState.svelte.ts` as
  originally sketched in TASKS.md, since that's not actually this
  codebase's convention for shared singleton state). Exports:
  - `projectStore`: the one app-wide `LocalStorageProjectStore` instance.
  - `getCurrentProjectId()`/`getCurrentProject()` + `setCurrentProject(id)`/
    `refreshCurrentProject()`: reactive `$state` tracking only the active
    project's *metadata* (id + `Project`), not its node list — deliberately,
    so pages that need file contents (editor/diagrams/overview) always
    fetch fresh from `projectStore` themselves instead of risking a stale
    shared cache shadowing their own edits.
  - `createProjectWithMainFile(name, content)`: creates a project and
    seeds it with one root-level `main.hcl` file — the interim "exactly
    one editable file per project" convention until Task 58 adds a real
    file-tree UI.
  - A one-time `migrateLegacySystemInputBox()` migration, run
    automatically at module load: if the legacy `SYSTEM_INPUT_BOX`
    localStorage key exists (JSON-quoted, per `Persisted.svelte.ts`'s
    storage format), its content is moved into a new "Migrated project"
    via `createProjectWithMainFile`, then the legacy key is removed —
    making it a no-op on every subsequent load.
- Added `firstHclFile(nodes)` to `web/src/vfs/tree.ts` (+ 4 new tests in
  `tree.test.ts`): picks the first hcl-content file in a node list, used
  by the editor page and `createProjectWithMainFile`'s convention above.
- Added `renameProject(id, name)` to the `ProjectStore` interface
  (`store.ts`), its pure implementation in `operations.ts`, both
  `LocalStorageProjectStore`/`InMemoryProjectStore`, and 2 new contract
  tests — needed once the `/projects` page's "Rename" action existed, but
  missing from Task 56 (which only covered node rename, not project
  rename).
- Added `web/src/routes/projects/+page.svelte`: lists projects (sorted by
  most recently touched, via each project's `updatedAt`), with "New
  project" (prompts for a name, seeds an empty main file), "New from
  example" (seeds `example_system.ts`'s `EXAMPLE_SYSTEM_HCL` — moved here
  from the editor page's old "?" button), Rename, and Delete actions.
- Added `web/src/routes/projects/[id]/+layout.ts` (`{ projectId:
  params.id }`) and `+layout.svelte` (calls `setCurrentProject` whenever
  `[id]` changes, showing a loading state, then either a "Project not
  found" fallback with a link back to `/projects`, or the child route).
- Moved `routes/editor`, `routes/diagrams`, `routes/overview` (with all
  their colocated helper modules/tests: `forceLayout.ts`, `geometry.ts`,
  `history.ts`, `persistence.ts` + `*.test.ts`) under
  `routes/projects/[id]/...`, fixing relative import depths throughout.
  Each page now sources its compiled model from
  `projectSources(await projectStore.listNodes(projectId))` (Task 55's
  helper) instead of the global `persisted("SYSTEM_INPUT_BOX", ...)`
  string:
  - `editor/+page.svelte`: binds Monaco to `firstHclFile`'s content,
    writing back via `projectStore.updateFileContent` on every change
    (no debounce yet — same as the old `persisted()` behavior; Task 58
    may add debouncing once there's more than one file to write).
  - `diagrams/+page.svelte`/`overview/+page.svelte`: read-only
    compilation from the project's nodes. Diagram canvas layout
    (`DIAGRAM_CHECKED_NODES`/`DIAGRAM_SAVED_LAYOUT`) and camera state
    (`DIAGRAM_VIEW`) deliberately still use global `localStorage` —
    that's Task 59's job.
- Updated `Navbar.svelte` to read the active project directly from
  `ProjectState` (no prop-drilling needed, since Navbar lives in the root
  layout, outside `/projects/[id]`'s own layout data): shows
  project-scoped Editor/Diagrams/Overview links (hidden when no project
  is active) and the active project's name, alongside the pre-existing
  (and, it turns out, already-unused — nothing was passing it any props)
  compiled-HCL-project display.
- Updated the root `/+page.svelte` to link to `/projects` instead of the
  now-nested `/editor`/`/diagrams`/`/overview`.
- No new dependencies.
- Validated with `deno task --cwd web test` (164/164 pass, 8 new: 4
  `firstHclFile` cases + 4 `renameProject` contract cases across both
  store implementations), `deno task --cwd web check` (`svelte-check`: 0
  errors/warnings), `deno task --cwd web build` (succeeds, including the
  new `/projects` and `/projects/[id]/...` routes), and `deno fmt --check
  web` (clean, `.svelte` files included via the `fmt-component` unstable
  flag). The legacy-data migration itself has no automated test — it's a
  one-shot `localStorage`-coupled module side effect in the same vein as
  `ThemeState.svelte`/`KeyboardState.svelte`, neither of which have tests
  either; recommend a manual spot-check (load the app with a pre-existing
  `SYSTEM_INPUT_BOX` key set, confirm a "Migrated project" appears and the
  key is gone afterward).

## Task 56 — `ProjectStore` interface + localStorage-backed implementation

Second of the five-task VFS sequence (55–59). Introduces the actual
storage engine behind a storage-agnostic interface, with zero new
dependencies — the entire VFS lives in one JSON blob under one
`localStorage` key, matching the existing `Persisted.svelte.ts` pattern.
Still local-first/single-editor; no locking, no CRDT.

- Added `web/src/vfs/operations.ts`: pure, synchronous functions
  (`listProjects`, `createProject`, `deleteProject`, `listNodes`,
  `createFile`, `createDirectory`, `updateFileContent`, `renameNode`,
  `moveNode`, `deleteNode`) operating on a `VfsData` snapshot
  (`{ version: 1, projects: Project[], nodes: FsNode[] }`). Each either
  returns a new `VfsData` (never mutating its input) or throws —
  validation (unknown project/node ids, parent-must-be-a-directory,
  parent-must-belong-to-the-same-project, `wouldCreateCycle` before a
  move), cascading deletes (via `descendantsOf`, from Task 55's
  `tree.ts`), and "touch the owning project's `updatedAt`" bookkeeping all
  live here exactly once, shared by every store implementation instead of
  being reimplemented per backend.
- Added `web/src/vfs/store.ts`: the `ProjectStore` interface (`listProjects`,
  `createProject`, `deleteProject`, `listNodes`, `createFile`,
  `createDirectory`, `updateFileContent`, `renameNode`, `moveNode`,
  `deleteNode`), documented with its rejection rules. Every method returns
  a `Promise` even though both current implementations are fully
  synchronous — kept deliberately so a future network- or sync-queue-backed
  implementation is a drop-in replacement with no call-site changes.
- Added `web/src/vfs/inMemoryStore.ts`: `InMemoryProjectStore`, a thin
  `ProjectStore` wrapper holding one in-memory `VfsData` and delegating
  every method to `operations.ts`. No storage dependency — the default
  fast test double.
- Added `web/src/vfs/localStorageStore.ts`: `LocalStorageProjectStore`,
  a thin `ProjectStore` wrapper that on every call reads the single
  `"rhizz:vfs:v1"` localStorage key, `JSON.parse`s + validates it with
  zod (dropping individually-malformed projects/nodes rather than
  discarding the whole blob — same forgiving-parse philosophy as
  `sanitizeStoredRecord` in `diagrams/persistence.ts`), delegates the
  mutation to `operations.ts`, then `JSON.stringify`s and writes the
  result back. Constructor takes an optional `StorageLike` (`{ getItem,
  setItem }` — the minimal subset actually needed, deliberately not the
  full DOM `Storage` interface's `removeItem`/`clear`/`length`/`key`),
  defaulting to `globalThis.localStorage`, plus an optional clock
  function — both purely to keep the class unit-testable without a DOM
  environment (this project's Vitest setup has no jsdom/happy-dom — see
  Task 36's notes).
- Added `web/src/vfs/store.contract.test.ts`: exports
  `runProjectStoreContractTests(label, makeStore)` (23 `it`s across
  project CRUD, file/directory CRUD, rename, move — including the
  self-move and descendant-move cycle-rejection cases — recursive delete,
  and revision/updatedAt bookkeeping) and calls it once for
  `InMemoryProjectStore` and once for `LocalStorageProjectStore` (backed by
  a plain `Map`-based fake storage, plus a deterministic incrementing
  clock so timestamp assertions can't flake on real wall-clock
  resolution) — 46 tests total, both implementations verified against the
  exact same rules.
- No UI changes. No new dependencies — only `zod` (already present) plus
  `localStorage`/`JSON`/`crypto.randomUUID()`, all browser built-ins.
- Validated with `deno task --cwd web test` (156/156 pass, 46 new),
  `deno task --cwd web check` (`svelte-check`: 0 errors/warnings),
  `deno task --cwd web build` (succeeds), and `deno fmt --check web`
  (clean). Commands run via `nix develop --command deno ...` per the
  user's environment, using `deno task --cwd <dir>` (this sandbox's
  `deno` doesn't support the `-C` shorthand).

## Task 55 — VFS domain types & pure tree helpers

First of a five-task sequence (55–59) building a virtual filesystem
hierarchy for the frontend, to support multiple multi-file projects &
diagrams stored locally in the browser. Explicitly local-first,
single-editor — no real-time collaboration/CRDT; a future file-locking
mechanism is left as a possible follow-up once there's a backend, not
designed for here.

- Added `web/src/vfs/types.ts`: zod schemas + inferred types for the VFS
  domain — `FsFileContentTypeSchema` (`"hcl" | "diagram-layout"`),
  `FsDirectorySchema`, `FsFileSchema`, `FsNodeSchema` (a
  `z.discriminatedUnion("kind", ...)` of the two), and `ProjectSchema`.
  IDs (`id`/`projectId`/`parentId`) are plain strings, intended to be
  client-generated UUIDs (`crypto.randomUUID()`) — never names/paths —
  so a future backend can accept client-created records without an
  ID-remapping step. `FsFile` carries `revision`/`updatedAt` so even a
  naive last-write-wins sync strategy has something to compare later.
  Added `isFile`/`isDirectory` type guards for narrowing `FsNode` in
  `.filter(...)` chains.
- Added `web/src/vfs/tree.ts`: pure functions operating on flat `FsNode[]`
  lists, with zero Svelte/DOM/storage dependency —
  - `buildTree(nodes)` — flat list to nested `TreeNode[]` for sidebar
    rendering; treats a node as a root if `parentId` is `null` *or*
    points outside the given list, so it works whether called with every
    node in the store or a pre-filtered per-project slice.
  - `pathOf(nodeId, nodes)` — `"/"`-joined ancestor path (e.g.
    `"components/imu.hcl"`); throws on an unknown id or a detected cycle.
  - `descendantsOf(nodeId, nodes)` — breadth-first list of all
    descendants, for recursive directory delete.
  - `wouldCreateCycle(nodeId, newParentId, nodes)` — guard intended for a
    future `ProjectStore.moveNode` (Task 56); `null` target is never a
    cycle, moving under self or under a descendant is.
  - `projectSources(nodes)` — filters `contentType: "hcl"` files and maps
    them to `{ filename: pathOf(node), content }`, the exact `Source[]`
    shape `rhizz_wasm_wrapper.ts`'s `compile_system` already accepts, so
    diagnostics can eventually point at real per-file paths instead of
    the current hardcoded `"all.hcl"`.
- Added `web/src/vfs/types.test.ts` (14 tests) and `web/src/vfs/tree.test.ts`
  (18 tests) covering schema acceptance/rejection (including the
  discriminated union and the type guards) and each tree helper's edge
  cases (empty input, cycles, grandchildren, unrelated-node moves).
- No storage engine, no UI changes — that's Task 56 onward.
- No new dependencies (only `zod`, already present).
- Validated with `deno task --cwd web test` (110/110 pass, 32 new),
  `deno task --cwd web check` (`svelte-check`: 0 errors/warnings),
  `deno task --cwd web build` (succeeds), and `deno fmt --check web`
  (clean). Commands were run via `nix develop --command deno ...` in this
  environment, using `deno task --cwd <dir>` since this sandbox's `deno`
  didn't support the `-C` shorthand.

---

## Task 54 — Display current editing state as a bottom-right hint

- `web/src/routes/diagrams/+page.svelte` gained a `currentActivity`
  `$derived.by`, resolving the two overlapping state sources into one
  label: `autoLayoutRunning` first ("Calculating…"), then
  `interaction.type` (`"Resizing"`, `"Panning"`, `"Selecting"` for
  marquee). Deliberately excludes `"dragging"` (per explicit feedback —
  already visually obvious from the node moving under the cursor, a text
  label would just be noise) and `"idle"` (nothing to announce).
- Fade timing needed its own small state machine, not just a CSS
  transition bound straight to a derived value: an `$effect` watches
  `currentActivity` and, on entering a new activity, immediately sets
  `activityHintLabel`/`activityHintVisible = true`; on returning to
  idle/dragging, schedules a `setTimeout` (after `ACTIVITY_HINT_
  SUSTAIN_MS`) that hides it. If a new activity starts before that
  timeout fires, Svelte's automatic effect-cleanup (the function returned
  from the effect) clears the pending timeout before the effect re-runs
  — so quick back-to-back activities never visibly flicker out and back
  in.
- `ACTIVITY_HINT_FADE_IN_MS` (100), `ACTIVITY_HINT_SUSTAIN_MS` (500), and
  `ACTIVITY_HINT_FADE_OUT_MS` (400) are extracted as top-level constants
  per request, so they can be tweaked without touching markup. The
  template interpolates whichever duration applies directly into an
  inline `transition-duration` style (rather than baking fixed Tailwind
  `duration-*` classes into markup), so the constants are the single
  source of truth for both the JS timing and the CSS animation.
- Positioned `absolute bottom-2 right-2` inside the same canvas-relative
  container as the bottom-center toolbar (that toolbar moved to
  bottom-*center* a few tasks ago, so bottom-right was free); `pointer-
  events-none` so it can never intercept clicks.
- No automated test coverage — this is UI/timing behavior tightly coupled
  to Svelte's `$effect`/`setTimeout`, unlike the project's pure-function
  Vitest-covered modules (`geometry.ts`/`forceLayout.ts`/`history.ts`).
  Validated with `deno task check` (0 errors/warnings), `deno task build`
  (succeeds), `deno task test` (78/78 pass, unaffected), and `deno fmt`
  (clean); the animation itself needs manual/browser verification.

---

## Task 50 — Automatic layout via force simulation

Implemented an "Auto Layout" button on the diagrams page's bottom
toolbar: force-arranges the current selection, or every currently-placed
node (any level) if nothing's selected. One remaining concrete piece of
the original scope (pinning pre-existing nodes so only newly-added ones
get laid out) was split out as Task 53; the vaguer "exploring the system
model interactively" use-case was deliberately left untracked, since
there's still no concrete trigger to hang it off of.

- `web/src/routes/diagrams/forceLayout.ts`: pure, Svelte/`rhizz-core`-free
  wrapper around `d3-force` (+ `@types/d3-force`). Exposes
  `createForceLayout` (a `{ tick(), alpha() }` pair for frame-by-frame
  driving), `runForceLayout` (synchronous convergence, used by tests),
  and `groupBySiblings` (partitions nodes by immediate parent). Nodes are
  approximated as circles (`Math.hypot(width, height) / 2`) for the
  collision force; a node's own diagram index round-trips via a
  `componentIndex` field, not `index` (which d3-force reserves for its
  own bookkeeping and silently overwrites). Supports pinning a node via
  `fixed: true` (sets d3-force's `fx`/`fy` — not yet wired to any UI, see
  Task 53). A custom `forceOrthogonalAlign` force biases connected pairs
  toward strictly horizontal/vertical alignment rather than arbitrary
  diagonals. A `warmupTicks` option eases the animation in over the first
  N ticks (verified to never change the eventual converged result). 31
  Vitest tests across `forceLayout.test.ts`.
- The target set is partitioned into sibling groups (`groupBySiblings`,
  keyed by parent) and each group gets its own independent simulation,
  centered on its parent's current box (or its own bounding box for
  top-level/orphaned groups) — avoiding a flat simulation that would let
  unrelated hierarchy levels interfere with each other. All groups run
  together via one shared `requestAnimationFrame` loop; every result is
  still written through `writeClampedToActiveParent` (Tasks 45/46's
  containment path) regardless of grouping, as a safety net. Only the
  final settling frame is snapped to grid, so the animation stays smooth
  even with snap-to-grid on.
- `autoLayoutRunning` disables the button (`wait` cursor on hover) and
  locks out drag/resize/pan/marquee-select for the duration (matching
  `wait` cursors across the canvas, nodes, and resize handles), so
  clicking around mid-animation can't silently fight the simulation's
  writes.
- `geometry.ts`'s `clampWithin` gained an optional 4th `topMargin`
  parameter (defaults to `margin`, so existing 3-arg callers are
  unaffected); `+page.svelte` passes a `CHILD_CONTAINMENT_TOP_MARGIN`
  (28) at every child-vs-parent clamp site, so a child can never be
  dragged, resized, or auto-laid-out over the area where its parent's
  title text renders.
- Integrates with Task 51's undo/redo (one undo point per auto-layout
  run, recorded before the animation starts) and Task 52's persistence
  (writes go through the same `checked`/`savedLayout` storage as every
  other diagram edit).
- Validated with `deno task check` (0 errors/warnings), `deno task build`
  (succeeds), `deno task test` (68/68 pass at the time), and `deno fmt`
  (clean).

---

## Task 52 — Persist the diagram's camera (pan/zoom) state

From user testing feedback: diagram content (`checked`/`savedLayout`)
survived page reloads via `persisted()`, but the camera (pan/zoom) did
not, since `ViewEditorState.svelte`'s `create_editor_state()` was pure
in-memory `$state` (a deliberate factory, not a persisted singleton, per
Task 40 — so a future multi-view feature could create independent
instances without them fighting over shared state).

- `create_editor_state()` now takes an optional `storageKey` parameter.
  When omitted, behavior is unchanged (in-memory-only `$state`, as
  before). When given, it delegates to the *same* `persisted()` helper
  `checked`/`savedLayout`/`input`/`snapGridSize` already use — rather than
  re-implementing `localStorage` load/save a second time — reshaped via a
  `get view()` accessor so every existing call site in `+page.svelte`
  keeps mutating `editor_state.view.x/y/zoom` directly, exactly as before;
  only the single construction line changed, to
  `create_editor_state("DIAGRAM_VIEW")`.
- Keeping the storage key caller-supplied (not hardcoded inside
  `ViewEditorState.svelte`) preserves Task 40's original intent: two
  independent view instances (e.g. a future split view) would use two
  different keys and never collide, unlike a single global `persisted()`
  call baked into the module.
- Validated with `deno task check` (0 errors/warnings — including
  re-hitting and re-fixing the same `$state(...)` "must be assigned to a
  variable first" compiler error from Task 40), `deno task build`
  (succeeds), `deno task test` (78/78 pass, unaffected), and `deno fmt`
  (clean).

---

## Task 51 — Diagram edit history (undo/redo)

Grew out of Task 50's "undo/snapshot safety net" brainstorm idea, but
expanded per user request into a full general-purpose diagram undo/redo
system (Ctrl/Cmd+Z / Ctrl/Cmd+Y), not just a one-shot "undo the last
auto-layout" affordance.

- Added `web/src/routes/diagrams/history.ts`: a generic, bounded undo/redo
  stack (`createHistoryStack<T>()`, `pushHistory`, `undoHistory`,
  `redoHistory`) with zero dependency on any diagram-specific type — `T`
  is opaque to the module, so it's reusable for any snapshot-able state,
  not just the diagram layout. `pushHistory` clears the redo stack (a new
  edit invalidates the old "future"); both stacks are capped at a caller-
  supplied `limit`, discarding the oldest entry once exceeded. 10 Vitest
  tests in `history.test.ts`, using plain strings/numbers — no diagram
  context needed.
- `web/src/routes/diagrams/+page.svelte`: added a `DiagramSnapshot` type
  (`{ checked, savedLayout }` — deliberately excluding `selected` and
  view/grid/snap preferences, which aren't "diagram content") and a
  page-level `diagramHistory = createHistoryStack<DiagramSnapshot>()`,
  capped at `UNDO_HISTORY_LIMIT = 100`. `recordUndoPoint()` snapshots the
  current state (a shallow copy of both records — safe because
  `setNodeBox()` always replaces a `StoredBox` entry wholesale rather than
  mutating one in place, so a shallow copy is a fully independent
  snapshot) and pushes it; `undoDiagramEdit()`/`redoDiagramEdit()` pop the
  matching stack and call `applyDiagramSnapshot()`, which assigns fresh
  copies (`{ ...snapshot.checked }`) back onto `checked.value`/
  `savedLayout.value` and clears `selected` (a restored snapshot may not
  match the current selection).
- `recordUndoPoint()` is called once per *gesture*, not once per
  `setNodeBox()` write — at the top of `onNodeMouseDown`'s drag-start
  path, `onResizeHandleMouseDown`'s resize-start path, the sidebar
  checkbox's check/uncheck handler, `setSelectedTextAlign` (skipped for a
  no-op re-click of the already-active alignment), and once before
  `runAutoLayout`'s animation begins (not per-frame). A drag/resize/auto-
  layout's many intermediate writes are covered by the single snapshot
  taken at the gesture's start, so undo reverts the whole gesture in one
  step.
- Added `<svelte:window onkeydown={onDiagramKeyDown} />` to the page
  template. Deliberately page-scoped (not added to the app-wide
  `KeyboardState.svelte` module) since "undo" here specifically means
  "undo a diagram edit" — a different page (e.g. the HCL text editor)
  would want its own, unrelated undo behavior. Recognizes Ctrl/Cmd+Z
  (undo), Ctrl/Cmd+Y (redo, as requested), and also Ctrl/Cmd+Shift+Z
  (the Mac-idiomatic alternative redo binding) as a bonus. Both
  `undoDiagramEdit`/`redoDiagramEdit` are blocked while
  `autoLayoutRunning`, same as every other diagram-mutating interaction
  — restoring a snapshot mid-animation would just be immediately
  overwritten by the next frame.
- History is in-memory only (not persisted to `localStorage`), matching
  how undo history conventionally resets on reload in most editors; not
  wrapped in the existing `persisted()` helper.
- Validated with `deno task check` (0 errors/warnings), `deno task build`
  (succeeds), `deno task test` (78/78 pass — 10 new `history.test.ts`
  cases), and `deno fmt` (clean).

---

## Task 46 — Enforce containment during group-resize

- `applyGroupScale` (`web/src/routes/diagrams/+page.svelte`) now clamps
  each node's scaled box against its own `activeParentBox` (if any) before
  writing it, exactly mirroring what `applyGroupDelta` already did for
  drag — clamped individually per-node rather than solving for one "safe"
  group scale factor upfront. Resizing a group can therefore end up not
  perfectly uniform when some members are parent-constrained and others
  aren't, an accepted trade-off matching the one `applyGroupDelta` already
  documents for drag.
- Extracted the now-identical "clamp against own active parent, write via
  setNodeBox, cascade via reclampChildren" tail shared by both
  `applyGroupDelta` and `applyGroupScale` into one helper,
  `writeClampedToActiveParent(index, next)`. Both functions now only
  compute their own `next: Box` (a positional delta vs. a size/position
  scale) and delegate the rest to the shared helper — removing the last
  bit of duplication between the two.
- Validated with `deno task check` (0 errors/warnings), `deno task build`
  (succeeds), `deno task test` (47/47 pass, unaffected), and `deno fmt`
  (no changes needed). Manual browser verification (nest a component,
  select a group including it alongside unconstrained nodes, resize the
  group) was not performed in this environment — worth a spot check.

---

## Task 45 — Extend containment clamping to grandchildren (multi-level nesting)

- `reclampChildren(parentIndex)` in `web/src/routes/diagrams/+page.svelte`
  now recurses: after clamping each direct child of `parentIndex` against
  `parentIndex`'s box and writing it via `setNodeBox`, it calls
  `reclampChildren(childIndex)` on that same child, so grandchildren (and
  deeper) get re-clamped against their own just-updated parent in turn.
  Containment now cascades through the whole ancestor chain instead of
  stopping one level down.
- The recursion is naturally bounded by what's actually placed on canvas
  — `reclampChildren` already bails out early (`if (!parentBox) return;`)
  for any component without a box, so no separate depth limit was needed.
- `activeParentBox` (and the per-node clamp during drag) intentionally
  stayed unchanged — a node only ever needs to stay within its own
  *immediate* parent; the transitive part is entirely handled by
  `reclampChildren`'s cascade once a middle ancestor's box changes. Updated
  both functions' doc comments to describe this division of
  responsibility and removed the now-outdated reference to this being
  "explicitly out of scope" (that was this same task, previously
  postponed).
- Caught during manual review: `applyGroupScale` (which handles *all*
  resizing, single- or multi-node, since Task 42's refactor) never called
  `reclampChildren` at all, so resizing a parent didn't cascade
  containment to its children/grandchildren even after the fix above —
  only drag exercised the new recursion. Added `reclampChildren(index)`
  right after each `setNodeBox(index, next)` in `applyGroupScale`'s loop,
  mirroring `applyGroupDelta`, so resize now cascades containment to
  descendants exactly like drag does. `applyGroupScale` still
  intentionally does *not* clamp the resized node itself against its own
  parent (that remains Task 46's scope) — updated its doc comment to spell
  out that distinction precisely.
- This is UI-interaction-driven behavior not easily covered by the
  existing pure geometry unit tests; validated with `deno task check` (0
  errors/warnings), `deno task build` (succeeds), and `deno task test`
  (47/47 pass, unaffected). Manual browser verification (place a 3-level
  `A ⊃ B ⊃ C` hierarchy; drag `A` far enough that `B` clamps and confirm
  `C` follows; separately resize `A` and confirm `B`/`C` are re-clamped
  too) was not performed in this environment — worth a spot check.

---

## Task 44 — Make diagram tuning constants configurable

- Scoped to `SNAP_GRID_SIZE` only, per the task's own priority —
  `MIN_NODE_SIZE`, `ZOOM_TO_FILL_FRACTION`, `CHILD_CONTAINMENT_MARGIN`, and
  `TEXT_ALIGN_PADDING` stay hardcoded until a concrete need for exposing
  them shows up.
- Replaced `const SNAP_GRID_SIZE = 10;` in
  `web/src/routes/diagrams/+page.svelte` with `let snapGridSize =
  persisted("DIAGRAM_SNAP_GRID_SIZE", DEFAULT_SNAP_GRID_SIZE);`, reusing
  the same `persisted()` helper already backing
  `checked`/`savedLayout`/`input`, so the chosen grid size survives page
  reloads. Added `SNAP_GRID_SIZE_OPTIONS = [10, 20, 50, 100] as const`
  (fixed, "nice" round numbers that line up with
  MINOR_GRID_SPACING/MAJOR_GRID_SPACING) and a `DEFAULT_SNAP_GRID_SIZE`
  derived from it. `snap()` falls back to `DEFAULT_SNAP_GRID_SIZE`
  whenever the persisted value isn't positive (e.g. a hand-edited `0` or
  negative `localStorage` value), so it can never divide by a
  zero/negative grid size.
- Added a `<select>` dropdown (daisyUI `select select-sm`, grouped with
  the existing "Snap to Grid" button via a `join` wrapper so they read as
  one control) `bind:value={snapGridSize.value}`, populated from
  `SNAP_GRID_SIZE_OPTIONS`, next to the "Snap to Grid" button in the
  bottom-right button row — a fixed set of choices rather than a
  free-form numeric input, and rather than a general settings panel for a
  single value. Updated the button's tooltip to interpolate the live
  `snapGridSize.value` instead of the old constant.
- Validated with `deno task check` (0 errors/warnings), `deno task build`
  (succeeds), and `deno task test` (47/47 pass, unaffected by this
  change).

---

## Task 43 — Add schema validation for persisted diagram localStorage data

- Added `zod` (v4) as a `web/package.json` dependency and a new
  `web/src/routes/diagrams/persistence.ts` module: `StoredBoxSchema`
  (`z.object({ x: z.number(), y: z.number(), width: z.number().optional(),
  height: z.number().optional(), textAlign: z.enum(["center",
  "top-center", "top-left"]).optional() })`), `StoredBox` (now `z.infer<
  typeof StoredBoxSchema>` instead of a hand-written type — one source of
  truth for the shape), and `sanitizeStoredRecord()`.
- `sanitizeStoredRecord(record: Record<string, unknown>)` runs
  `StoredBoxSchema.safeParse()` **per entry** (not one whole-object parse),
  keeping every valid entry and dropping only the malformed ones, with a
  single `console.warn` naming every dropped key in one line.
- `web/src/routes/diagrams/+page.svelte` removed its hand-written
  `StoredBox` type (now imported from `persistence.ts`) and now chains
  `checked.value = sanitizeStoredRecord(stripLegacyIndexKeys(checked.value))`
  (same for `savedLayout`) right at load time — the one spot both existing
  migration logic and the new validation run, so every other read/write
  site (`nodeBox()`, `setNodeBox()`, the hot drag/resize path) keeps
  trusting that anything already in `checked.value` is well-formed.
- Added `web/src/routes/diagrams/persistence.test.ts` (13 tests, matching
  `geometry.test.ts`'s pattern): valid entries pass through unchanged,
  entries with only the required `x`/`y` still parse (backwards-compat
  with pre-width/height/textAlign data), non-numeric/missing/invalid
  fields and fully-malformed entries (`null`, a string, an array) are
  rejected, malformed entries are dropped independently of valid
  siblings, and the single-`console.warn`-naming-every-dropped-key
  behavior is asserted directly (via a `vi.spyOn(console, "warn")`).
- No behavior change for well-formed data — this is purely a guardrail
  for corrupted/hand-edited `localStorage` entries or future schema
  drift. Chose Zod (a TS-only schema library) over an earlier brainstormed
  Rust/serde/wasm approach: for a small, frequently-tweaked, frontend-only
  concern like this, a TS schema library wins on iteration speed, type
  inference (`z.infer`), and testability, even though the Rust option
  would better seed a future "backend defines the schema" pattern.
- Validated with `deno task check` (0 errors/warnings), `deno task build`
  (succeeds), and `deno task test` (47/47 — 34 existing geometry tests +
  13 new persistence tests — pass).

---

## Task 42 — Deduplicate drag/resize coordinate-and-clamp logic in the diagrams canvas

- Extracted the per-node write loops out of `onSvgMouseMove`'s
  `"dragging"`/`"resizing"` switch cases in
  `web/src/routes/diagrams/+page.svelte` into two named top-level
  functions:
  - `applyGroupDelta(startPositions, deltaX, deltaY)` — moves every node in
    a position snapshot by the same offset, clamping each individually to
    its own active parent and cascading via `reclampChildren`. Used for
    both single- and multi-node drags (a single dragged node is just a
    selection of one).
  - `applyGroupScale(startBoxes, groupBox, scaleX, scaleY)` — scales every
    node in a box snapshot by the same factor, relative to the selection's
    fixed top-left. Used for both single- and multi-node resizes.
- The two switch cases now each follow the same two-step shape: compute an
  anchor-derived parameter (a delta for drag, a scale factor for resize),
  then apply it to the whole snapshot via the corresponding helper —
  instead of inlining the per-node loop directly in the switch case.
- Pure refactor, no behavior change. Validated with `deno task check` (0
  errors/warnings), `deno task build` (succeeds), and `deno task test`
  (34/34 geometry tests still pass).

---

## Task 41 — Replace plain Set with SvelteSet for the selection state

- `selected` in `web/src/routes/diagrams/+page.svelte` is now `const
  selected = new SvelteSet<number>();` (imported from
  `svelte/reactivity`), replacing the old `let selected: Set<number> =
  $state(new Set());`. `SvelteSet` is deeply reactive on its own, so
  `add()`/`delete()`/`clear()` are directly tracked — no more
  reassigning a fresh `Set` just to trigger reactivity, and no more risk
  of a future direct `.add()`/`.delete()` call silently becoming a no-op.
- Simplified the three call sites that used to reconstruct a new `Set`:
  - `onNodeMouseDown`'s "replace selection with just this node" path is
    now `selected.clear(); selected.add(index);` instead of `selected =
    new Set([index]);`.
  - `onSvgMouseUp`'s marquee-commit path is now `selected.clear(); if
    (...) { for (const index of marqueeCandidates) selected.add(index); }`
    instead of ternary-constructing a whole new `Set`.
  - The sidebar checkbox's uncheck handler is now a single
    `selected.delete(index);` (removed the redundant `has()` check +
    copy-then-delete-then-reassign dance, since `delete()` on a key
    that isn't present is already a harmless no-op).
- `marqueeCandidates` (a `$derived.by` producing a brand new `Set` each
  recompute, never mutated in place) was deliberately left as a plain
  `Set` — it's freshly constructed every time, so there's no reactivity
  gap to fix there.
- Validated with `deno task check` (0 errors/warnings), `deno task build`
  (succeeds), and `deno task test` (34/34 geometry tests still pass).

---

## Task 40 — Make the diagram view (pan/zoom) page-scoped instead of a module-level singleton

- `web/src/ViewEditorState.svelte` no longer holds a module-level
  `editor_state` singleton or a `get_editor_state()` accessor. Replaced
  with `create_editor_state()`, a factory that returns a fresh
  `$state`-backed `ViewEditorState` (`{ view: { x, y, zoom } }`) on every
  call, plus the exported `ViewEditorState` type. `clamp_zoom()` is
  unchanged (already a pure, stateless function).
- `reset_view()` now takes the state instance to reset as a parameter
  (`reset_view(state: ViewEditorState)`) instead of implicitly resetting
  the old shared singleton.
- `web/src/routes/diagrams/+page.svelte` now calls
  `const editor_state = create_editor_state();` to construct its own
  independent instance, and the "Reset View" button now calls
  `reset_view(editor_state)`.
- This is a pure refactor with the diagrams page as the sole consumer, so
  behavior is unchanged today, but any future feature needing more than
  one independent diagram view (split view, a thumbnail preview, ...) can
  now just call `create_editor_state()` again instead of fighting over one
  shared pan/zoom. Matches the intentional distinction already documented
  in `ViewEditorState.svelte`: unlike genuinely global concerns
  (`KeyboardState.svelte`'s physical key state, `ThemeState.svelte`'s
  app-wide theme), pan/zoom is inherently per-view.
- Hit and fixed a Svelte compiler error (`$state(...) can only be used as
  a variable declaration initializer...`) from initially writing
  `create_editor_state()` as `return $state({...})` directly — `$state()`
  must be assigned to a local variable first, then returned.
- Validated with `deno task check` (0 errors/warnings), `deno task build`
  (succeeds), and `deno task test` (34/34 geometry tests still pass).

---

## Task 39 — Make diagram layout persistence keys stable across HCL source edits

- Added a minimal `SystemJS` wrapper (`label` getter only) and
  `ModelJS::systems()` to `crates/rhizz-wasm/src/lib.rs`, mirroring the
  existing `ComponentJS`/`ConnectionJS` wrapper pattern. System labels are
  globally unique (unlike component labels, which are only unique within
  their parent scope — SPEC.md §2.3), so a system's label is a safe root
  for a stable path. Rebuilt the wasm bindings with `wasm-pack build
  crates/rhizz-wasm --target web` so `web/src/routes/diagrams/+page.svelte`
  picks up the new binding (linked via the existing `"rhizz":
  "file:../crates/rhizz-wasm/pkg/"` dependency).
- Added `componentKey(index)` in `+page.svelte`, which walks the chain of
  `parent_component_index` up to the root and prepends the root's parent
  system's label (via the new `systems` derived + `parent_system_index`),
  producing a path like `"home-monitor/controller/mcu"`. This replaces the
  raw arena index as the storage key for both `checked` and `savedLayout`
  (now typed `Record<string, StoredBox>` instead of `Record<number,
  StoredBox>`), so reordering/inserting components earlier in the HCL
  source no longer silently reattaches a persisted position to the wrong
  component.
- Added `keyToIndex`, a `$derived.by` reverse map from `componentKey()` →
  current arena index, rebuilt whenever `components`/`systems` change.
  `renderOrder` now maps `Object.keys(checked.value)` through this reverse
  map (dropping keys that no longer resolve to a component) instead of
  parsing them back with `Number(...)`.
- All other read/write sites (`setNodeBox`, `nodeBox`,
  `setSelectedTextAlign`, `onNodeMouseDown`'s drag-start snapshot, and the
  sidebar checkbox's check/uncheck handlers) now key through
  `componentKey(index)` instead of the bare arena index.
- Migration: added `stripLegacyIndexKeys()`, run once against
  `checked.value`/`savedLayout.value` right after they're loaded. Old
  arena-index keys are plain-integer strings (e.g. `"0"`, `"1"`), which
  can never occur as a `componentKey()` path (a real path always contains
  at least one `"/"`, from its root system label), so they're identified
  unambiguously and dropped rather than left to linger unused in
  `localStorage` forever. There's no reliable way to migrate their values
  forward (the whole point of this change is that the old
  index→component mapping could silently be wrong), so anyone with
  pre-existing diagram layouts gets a one-time reset, as the task allowed.
- Fixed a TS7022 circular-inference compiler error (`'component'
  implicitly has type 'any' because it ... is referenced ... in its own
  initializer`) surfaced by `componentKey`'s `while` loop reassigning its
  loop variable, by explicitly annotating the loop-local `const component:
  ComponentJS | undefined = components[current]` (imported `ComponentJS`
  as a type from `"rhizz"`, matching the existing pattern in
  `Navbar.svelte`) — a known TypeScript design limitation with loops that
  both read and reassign a shared variable across iterations.
- Validated with `cargo build`/`cargo test --all` (rhizz-wasm + workspace,
  all pass; `cargo clippy` is unavailable in this sandbox's Nix devshell,
  so it could not be run for the Rust change), and `deno task check` (0
  errors/warnings), `deno task build`, and `deno task test` (all 34
  existing geometry tests still pass) for the frontend. Manual
  browser verification of reordering components in the HCL source was not
  performed (no interactive browser available in this environment) —
  recommend the user spot-check this manually.

---

## Task 38 — Replace ad hoc interaction state with a discriminated-union state machine

- In `web/src/routes/diagrams/+page.svelte`, replaced the four
  independently-nullable state variables `dragging`, `resizing`,
  `panning`, and `marquee` (plus the separate `MarqueeState` type) with a
  single discriminated union `Interaction` (`{ type: "idle" } | { type:
  "dragging", ... } | { type: "resizing", ... } | { type: "panning", ... }
  | { type: "marquee", ... }`) held in one `interaction: Interaction =
  $state({ type: "idle" })`. This restores the spirit of the old
  discriminated-union `EditorState` (`idle | moving_canvas | zooming`)
  that used to live in `ViewEditorState.svelte` before it was removed
  earlier in the session in favor of separate flags.
- Updated `onNodeMouseDown`, `onCanvasMouseDown`,
  `onResizeHandleMouseDown`, `onSvgMouseMove`, and `onSvgMouseUp` to read
  and write `interaction` via exhaustive `switch`/discriminant checks
  instead of independent `if` chains. `onSvgMouseMove` captures
  `const current = interaction;` at the top and switches on
  `current.type`, since TypeScript can't reliably narrow directly on a
  live `$state` binding across branches — each `case` body reads from
  `current`, and only reassigns the live `interaction` when it needs to
  persist updated fields (`panning`'s `lastX`/`lastY`, `marquee`'s
  `x`/`y`) for the next move event.
- `marqueeBox` (the derived marquee rectangle) is now computed from
  `interaction` via `$derived.by` with the same capture-then-narrow
  pattern, rather than from the old standalone `marquee` variable.
- Updated template usages: the SVG cursor style and the `ViewNode`
  snippet's `highlighted` computation now switch on `interaction.type`
  instead of checking the old `dragging`/`resizing`/`panning`/`marquee`
  variables directly.
- Pure refactor — no behavior change. Validated with `deno task check`
  (0 errors/warnings), `deno task build` (succeeds), and `deno task test`
  (all 34 existing geometry tests still pass).

---

## Task 37 — Add unit tests for the extracted geometry module

- Expanded `web/src/routes/diagrams/geometry.test.ts` from the initial
  3-function smoke test to full coverage of every exported function in
  `geometry.ts`: `boxCenter`, `boxContains`, `clampWithin`,
  `clampResizeWithin`, `unionBox`, `textPosition`, `boxBoundaryPoint`,
  `elbowPath`, `depthOf` — 34 tests total.
- `elbowPath` is tested structurally rather than via snapshot/exact-string
  matching (which would be brittle to assert on by hand and wouldn't
  independently verify correctness, only lock in whatever the current
  output happens to be). A small test-local `waypoints()` helper parses
  out the ordered M/L/A endpoints, and tests assert the property that
  actually matters: horizontal orientation keeps `y` fixed on the first
  and last legs (H-V-H), vertical orientation keeps `x` fixed on the first
  and last legs (V-H-V) — exactly the behavior fixed earlier when the
  original bug (always H-V-H regardless of orientation) was found.
- Hardened `unionBox` while writing its tests: an empty input array
  previously fell through to `Math.min()`/`Math.max()` on an empty array
  (`+/-Infinity`), silently producing garbage geometry. Now throws a clear
  error instead — every current call site (`onResizeHandleMouseDown`,
  `zoomToFill`) already guards against calling it with no boxes, so this
  is a pure hardening change with no behavior change at any real call
  site.
- Validated with `deno task test` (34/34 passing), `deno task check`, and
  `deno task build`.

---

## Task 36 — Extract pure geometry helpers from diagrams/+page.svelte into a dedicated module

- Created `web/src/routes/diagrams/geometry.ts`, a Svelte/DOM-independent
  module holding `clampWithin`, `clampResizeWithin`, `unionBox`,
  `boxContains`, `boxCenter`, `boxBoundaryPoint`, `elbowPath`,
  `textPosition`, `depthOf`, the `Box`/`ConnectionOrientation`/`TextAlign`
  type aliases, and the `MIN_NODE_SIZE`/`TEXT_ALIGN_PADDING` constants they
  depend on.
- `depthOf` was refactored to take an explicit `parentOf: (index) => number
  | undefined` lookup function instead of closing over the reactive
  `components` array, so it's a pure function usable outside the
  component. `+page.svelte` now defines a small `parentOf` wrapper and
  passes it at the call site.
- `+page.svelte` imports everything it needs from `./geometry` instead of
  defining these inline; `snap()` stayed in the component since it reads
  component-local `snapActive` state.
- No behavior change — confirmed via `deno task check` and `deno task
  build`, both passing identically to before the extraction.
- Set up the test infrastructure this unblocks: added `vitest` to
  `web/package.json` (`deno task test` runs `vitest run`, using Deno's
  fallback to `package.json` scripts — no `deno.json` task needed), and
  configured it via `test: {...}` in `vite.config.ts` (imported from
  `"vitest/config"` instead of plain `"vite"` for typing). No DOM
  environment configured yet, since only pure-function tests exist so far;
  add jsdom/happy-dom + `@testing-library/svelte` if/when component tests
  are needed.

---

## Task 35 — Enforce parent/child containment constraints on the canvas

- Added `activeParentBox(index)`: returns a node's parent's box, but only
  if that parent is itself currently placed ("active") on the canvas —
  built on `ComponentJS.parent_component_index` (already exposed by
  `rhizz-wasm`) and the index-keyed canvas state from Task 29.
- Added a pure `clampWithin(child, parent, margin)` helper: clamps the
  child's position (and shrinks its size if it doesn't fit) so its full box
  stays inside the parent's box, inset by `CHILD_CONTAINMENT_MARGIN` (`10`
  world units). Used for drag, initial placement, and cascading, where the
  child's top-left corner is free to move.
- Added a second pure helper, `clampResizeWithin(box, parent, margin)`, for
  the resize case specifically — resizing keeps the top-left corner fixed,
  so only width/height are capped against the parent's remaining inner
  space (rather than also letting position float, which `clampWithin`
  does).
- Added `reclampChildren(parentIndex)`: re-clamps every currently-placed
  *direct* child of a parent against the parent's current box. Called
  after every parent drag/resize move event (so children's constraint
  region follows live, not just on drop) and after checking a new
  component (in case it's a parent of children that were already placed).
- Wired the clamp into `onSvgMouseMove`'s `dragging` and `resizing`
  branches, and into the sidebar checkbox's initial-placement logic
  (replacing the old blind `(100, 100)` default when the parent is active).
- Added `depthOf(index)` (walks the `parent_component_index` chain) and a
  `renderOrder` derived value (currently-placed indices sorted
  shallowest-first) so parents always paint before their children,
  regardless of arena order — otherwise a child could end up visually
  hidden behind its parent's fill.
- End-to-end result: place a composite component and one of its children
  (e.g. the example system's `controller` → `mcu`/`power-supply`) —
  dragging/resizing the child is bounded to the parent's box; moving/
  resizing the parent carries the constraint region with it live.
- Validated with `deno task check` (`svelte-check`: 0 errors/warnings) and
  `deno task build` (production build succeeds). Also independently
  validated the new example-system hierarchy (added earlier) against the
  real Rust checker (`cargo run -p rhizz-cli -- check/score`): 0 errors, 0
  warnings, 100% completion score.

---

## Task 34 — Add text alignment control to the node inspector

- Extended the per-node record (from Task 31) with an optional
  `textAlign?: "center" | "top-center" | "top-left"` field (a new
  `TextAlign` type alias); `nodeBox()` backfills it to `"center"`
  (`DEFAULT_TEXT_ALIGN`) for entries persisted before this task.
- Added `setSelectedTextAlign(align)` to update the currently selected
  node's alignment, and a `selectedBox` derived value so the inspector can
  read the current value.
- Added a 3-button daisyUI `join` segmented control ("Center" / "Top" /
  "Top-left") to the inspector panel from Task 33, highlighting the active
  option with `btn-primary`.
- Added `textPosition(align, width, height)`, mapping alignment to the
  label `<text>`'s `x`/`y`/`text-anchor`/`dominant-baseline`; the two
  top-aligned variants are inset by `TEXT_ALIGN_PADDING` (`8` world units)
  from the node's edges.
- `ViewNode` snippet and its render call site now thread `textAlign`
  through from `nodeBox()`.
- End-to-end result: select a node, change alignment in the inspector, the
  label repositions live inside the box and persists across reload.
- Validated with `deno task check` (`svelte-check`: 0 errors/warnings) and
  `deno task build` (production build succeeds).

---

## Task 33 — Add left-side inspector panel for the selected node

- Added a `selectedComponent` derived value (`components[selected] ?? null`)
  on `web/src/routes/diagrams/+page.svelte`.
- Added a new left sidebar, shown only when `selectedComponent` is set,
  mirroring the existing right sidebar's structure/styling (`w-64 shrink-0
  bg-base-100 text-base-content p-4 overflow-y-auto`, `border-r` instead of
  `border-l` since it sits on the opposite side).
- For now, shows the selected component's label (header) and description
  (if any) — an empty shell with a placeholder comment marking where style
  controls (text alignment, etc.) will be added in Task 34.
- End-to-end result: selecting a node opens the panel; deselecting (or
  unchecking the selected component) closes it.
- Validated with `deno task check` (`svelte-check`: 0 errors/warnings) and
  `deno task build` (production build succeeds).

---

## Task 32 — Add corner-drag resize interaction for the selected node

- Added a small resize-handle square at the bottom-right corner of a node,
  rendered only when that node is `selected`.
- Added `resizing: { index: number } | null` state, mirroring the existing
  `dragging`/`panning` pattern. Resize keeps the node's top-left corner
  fixed and recomputes `width`/`height` live from the pointer's current
  world-space position each move event (via the existing `svgPoint()`
  helper, so pan/zoom are automatically accounted for) — no delta-tracking
  needed. Size is clamped to a `MIN_NODE_SIZE` (`40`) floor.
- The handle's `onmousedown` calls `event.stopPropagation()` so it doesn't
  also bubble into the node's own `onmousedown` (which would start a drag
  at the same time).
- `onSvgMouseMove`/`onSvgMouseUp` extended with a `resizing` branch
  alongside `dragging`/`panning`; cursor style now also shows `grabbing`
  while resizing.
- **Fixed a latent bug found while implementing this**: node dragging was
  overwriting the entire `checked.value[index]` record with just `{x, y}`,
  silently dropping any custom `width`/`height` set in Task 31 on every
  drag move. Changed to a spread merge (`{...box, x, y}`) so size survives
  dragging.
- End-to-end result: select a node, drag its corner, it resizes (respecting
  the minimum size) and the new size persists across reload.
- Validated with `deno task check` (`svelte-check`: 0 errors/warnings) and
  `deno task build` (production build succeeds).

---

## Task 31 — Add resizable size to diagram nodes (data model)

- Extended the per-node persisted record from `{x, y}` to
  `{x, y, width?, height?}` (`width`/`height` optional in storage so entries
  persisted before this task still parse without a migration step).
- Added `nodeBox(index)`, a helper that reads a checked node's position and
  size, backfilling `DEFAULT_NODE_WIDTH`/`DEFAULT_NODE_HEIGHT` (`100x100`,
  matching the previous hardcoded size) when `width`/`height` are missing.
- `nodeCenter` now derives the centre point from `nodeBox`'s actual
  width/height instead of the fixed `+50` offset.
- The `ViewNode` snippet and its canvas call site now render dynamic
  `width`/`height` (via `{@const box = nodeBox(index)}`) instead of the
  hardcoded `"100"`/`"100"`; the label text re-centers at `width/2, height/2`.
- Checking a new component from the sidebar now writes `width`/`height`
  explicitly (still defaulting to `100x100`), so freshly-placed nodes don't
  rely on the backfill path.
- No visible/behavioral change yet (all nodes still default to `100x100`),
  but the data model now supports variable node size — unblocks Task 32.
- Validated with `deno task check` (`svelte-check`: 0 errors/warnings) and
  `deno task build` (production build succeeds).

---

## Task 30 — Add node selection state to the diagram canvas

- Added `selected: number | null` (component arena index) as page state on
  `web/src/routes/diagrams/+page.svelte`. Not persisted — selection is
  transient UI state.
- `onNodeMouseDown` now sets `selected = index`; `onCanvasMouseDown`
  (background rect, already used for panning) sets `selected = null`, so
  clicking empty canvas deselects.
- Selected node renders with an accent-colored (`var(--color-primary)`),
  slightly thicker stroke instead of the default white one.
- Edge case: unchecking a component from the sidebar while it's selected
  now also clears `selected`, avoiding stale selection pointing at a node
  that's no longer rendered.
- No sidebar yet (that's Task 33) — this step only proves the selection
  mechanic and gives visual feedback.
- Validated with `deno task check` (`svelte-check`: 0 errors/warnings) and
  `deno task build` (production build succeeds).

---

## Task 29 — Rekey diagram canvas state by component index instead of label

The `/diagrams` canvas keyed its per-node state (`checked`) by
`component.label`. Per `SPEC.md` §2.3, labels are only guaranteed unique
**within a parent scope** — two components in different branches of a
hierarchical model may legally share a label (e.g. two different `"mcu"`
leaves under two different composites), so label-keyed canvas state would
collide once nested components appear on the same canvas.

- Changed `checked`'s keys (and the sidebar checkbox `id`s) from
  `component.label` to the component's arena index (its position in
  `model.components()`), matching the index space already used by
  `ConnectionJS.from`/`to` and `ComponentJS.parent_component_index`.
- `web/src/routes/diagrams/+page.svelte`: `dragging`, `nodeCenter`,
  `onNodeMouseDown`, `checked`'s type, and both `{#each}` loops (canvas nodes
  and sidebar list) now use the numeric index instead of the label string.
- Simplified `visibleConnections`: since `conn.from`/`conn.to` are already
  component indices, dropped the now-unnecessary `model.component_by_id(...)`
  lookups that existed solely to get `.label` for the old `nodeCenter(label)`
  calls.
- No visible behavior change (existing persisted layouts under the old
  label-keyed scheme will not carry over, since the key space changed).
- Validated with `deno task check` (`svelte-check`: 0 errors/warnings) and
  `deno task build` (production build succeeds).

---

## Task 27 — Typed WASM wrappers for rhizz-core structs

Implement `#[wasm_bindgen]` wrapper structs in `rhizz-wasm` for the core types
the web frontend needs. Each wrapper converts from its `rhizz-core` counterpart
via a `From` impl and exposes fields as `#[wasm_bindgen(getter)]` methods so
that `wasm-pack` generates typed TypeScript class definitions.

- Removed the `TestStruct` / `InnerStruct` scaffolding.
- Added wrapper structs: `DiagnosticJS`, `ComponentJS`, `ScoreReportJS`,
  `CategoryScoreJS`, `ProjectJS`.
- Each wrapper derives `Clone` and implements `From<&rhizz_core::T>`.
- Exposed all fields relevant to the frontend as `#[wasm_bindgen(getter)]`
  methods (strings, numbers, booleans, `Vec<primitive>`). For nested
  wasm_bindgen structs, return the wrapper type directly.
- Updated `CompileResultJS` methods:
  - `diagnostics() -> Vec<DiagnosticJS>` (typed, replaces `JsValue` version)
  - `error_count() -> usize`
  - `warning_count() -> usize`
  - `components() -> Vec<ComponentJS>` (returns empty vec when model is `None`)
  - `score() -> Option<ScoreReportJS>` (calls `rhizz_core::score()`, returns
    `None` when model is `None`)
  - `project() -> Option<ProjectJS>`
- Updated `tests/wasm_test.rs` to exercise the new typed API.
- Spec reference: `SPEC/frontend.md` § WASM Integration.

---

## Task 26 — Replace SPEC.md §4 tables with a pointer to `SPEC/diagnostics/`

Remove the error and warning tables from SPEC.md §4.1 and §4.2 and replace them
with a reference to the `SPEC/diagnostics/` folder. The section should state
that each code is documented in its own file and list the folder path.

### Acceptance criteria

- SPEC.md §4.1 and §4.2 no longer contain the per-code tables.
- §4 includes a note such as: "Each diagnostic code is documented in its own
  file under `SPEC/diagnostics/` (e.g. `E001.md`, `W003.md`). Error codes
  (`Exxx`) halt compilation; warning codes (`Wxxx`) are non-blocking."
- The rest of SPEC.md is unchanged.
- No code changes in this task.

---

## Task 25 — Attach diagnostic Markdown to `DiagnosticCode` via `include_str!`

Use `#[doc = include_str!(...)]` on each `DiagnosticCode` const to pull the long
description from the corresponding `SPEC/diagnostics/*.md` file. Remove the
hand-written one-liner doc comments that are now redundant.

**Spec reference:** SPEC/diagnostics/*.md (created in Task 25).

### Acceptance criteria

- Every `DiagnosticCode` const (`E000`–`E011`, `W000`–`W011`) has
  `#[doc = include_str!("../../../SPEC/diagnostics/Xxxx.md")]` instead of a
  hand-written doc comment. (Note: actual path is `../../../` from the source
  file.)
- `cargo doc` generates documentation that includes the full markdown content
  (description, HCL examples) for each code.
- `cargo test --all`,
  `cargo clippy --all-targets --all-features -- -D warnings`, `cargo doc`,
  `cargo build`, `cargo fmt` all pass.

---

## Task 24 — W012: orphan top-level component warning

Detect top-level components that are not referenced by any `source` attribute
anywhere in the model and emit warning W012.

**Spec reference:** SPEC.md §4.2 (W012).

### Acceptance criteria

- New `DiagnosticCode::W012` is defined.
- After resolving all systems and expanding all `source` references, the
  resolver tracks which top-level component labels were actually used. Any
  unused labels produce W012.
- Unit tests:
  - A top-level component referenced by `source` → no W012.
  - A top-level component not referenced by any `source` → W012.
  - A top-level component referenced multiple times → no W012.
- All existing tests continue to pass (no orphan top-level components exist in
  the examples after Task 23).
- `cargo test --all`,
  `cargo clippy --all-targets --all-features -- -D warnings`, `cargo doc`,
  `cargo build`, `cargo fmt` all pass.

---

## Task 23 — Update drone example to use `source`

Now that all the infrastructure is in place (Tasks 20–22), update the drone
example to demonstrate the feature end-to-end.

**Spec reference:** SPEC.md §2.3.

### Acceptance criteria

- In `examples/drone/systems.hcl`, replace the inline `flight-controller`
  component (approx 120 lines of ports, children, connections) with:
  ```hcl
  component "flight-controller" {
    source = "flight-controller"
  }
  ```
- `examples/drone/components/flight-controller.hcl` already exists as a
  top-level `component "flight-controller" { … }` with the full body. Verify it
  matches the removed inline definition (same ports, children, connections).
- `examples/drone/README.md` is updated to mention the `source` feature and list
  the `components/flight-controller.hcl` file.
- All integration tests that compile the drone example pass — the resolved model
  must be identical (same components, ports, connections, messages, scores,
  views) to the previous inline version.
- `cargo test --all`,
  `cargo clippy --all-targets --all-features -- -D warnings`, `cargo doc`,
  `cargo build`, `cargo fmt` all pass.

---

## Task 22 — Add `source` attribute and resolve component references

Add the `source` attribute to `RawComponent` and implement resolution: when a
component inside a system (or parent component) has `source = "some-label"`, the
resolver looks up the top-level component with that label, validates
exclusivity, detects cycles, and clones the body into the sourced component
slot.

**Spec reference:** SPEC.md §2.3 (source rules), SPEC/models.md (source
resolution during resolution pass).

**Important:** do NOT modify any existing example `.hcl` files in this task.
Write unit tests that exercise `source` with inline HCL strings. The drone
example update is Task 23.

### Acceptance criteria

- `RawComponent` gains `source: Option<String>`.
- `ComponentAttrs` serde helper gains `source: Option<String>`.
- `parse_component` reads the `source` attribute from HCL.
- New `DiagnosticCode` variants: `E012`, `E013`, `E014` are defined and emitted:
  - E012: component with `source` has other attributes or child blocks.
  - E013: circular `source` chain detected.
  - E014: `source` references an undefined top-level component.
- During resolution, before walking a system's component tree, the resolver
  builds a `HashMap<String, RawComponent>` from `RawFile.components`. Duplicate
  top-level component labels → E001.
- When a component has `source`:
  1. Check exclusivity (E012).
  2. Look up the label in the top-level component map (E014 if missing).
  3. Check the ancestor set for cycles (E013).
  4. Clone the top-level component's body (description, tags, level, leaf,
     ports, children, connections) into the sourced slot. The label at the usage
     site is kept.
  5. Recurse into the cloned children for nested `source` references.
- Unit tests (all using inline HCL strings — no example file changes):
  - Component with `source` pointing to a valid top-level component → body
    cloned correctly, resolved model is identical to inline definition.
  - Component with `source` + inline `description` → E012.
  - Component with `source` pointing to undefined label → E014.
  - Circular `source` (A sources B, B sources A) → E013.
  - Nested `source` (A sources B, B has child that sources C) → works.
  - Same top-level component sourced into two different systems → works.
- All existing tests continue to pass.
- `cargo test --all`,
  `cargo clippy --all-targets --all-features -- -D warnings`, `cargo doc`,
  `cargo build`, `cargo fmt` all pass.

---

## Task 21 — Recursive file discovery

The CLI's `load_sources` and the test helper `parse_dir` currently scan only
`max_depth(1)`. Change them to recursively discover all `.hcl` files in the
project directory tree so that files in subdirectories are parsed and merged
like any other file.

**Spec reference:** SPEC.md §1 (project structure).

**Why this is safe now:** Task 20 already taught the parser to accept top-level
`component` blocks. After this task, the drone example's
`components/flight-controller.hcl` will be discovered and parsed, but since it
only adds entries to `RawFile.components` (which the resolver currently
ignores), no tests break.

**Important:** do NOT modify any example `.hcl` files in this task. Existing
tests should pass as-is.

### Acceptance criteria

- `load_sources` in `rhizz-cli/src/cli.rs` uses `WalkDir::new(dir)` without
  `max_depth(1)` — all `.hcl` files at any depth are collected and returned.
- `parse_dir` test helper in `rhizz-core/src/parse.rs` is updated the same way.
- `rhizz-gui` file discovery is updated the same way.
- All existing tests and examples pass unchanged.
- `cargo test --all`,
  `cargo clippy --all-targets --all-features -- -D warnings`, `cargo doc`,
  `cargo build`, `cargo fmt` all pass.

---

## Task 20 — Parse top-level `component` blocks

- Added `components: Vec<Labeled<RawComponent>>` field to `RawFile`.
- `parse_file` now handles `"component"` as a top-level block identifier.
- `merge_into` concatenates `components` vecs from all files.
- Unit tests: top-level component parses, mixed blocks parse, merge across
  files.

---

## Task 19 — Replace custom RenderBackend with SVG rasterization in rhizz-gui

**Note:** this task has been cancelled, rendering quality & performance were
unsatisfactory. No code changes were made.

The current `EguiBackend` (`RenderBackend` impl, ~300 lines) re-implements
primitive drawing on top of `layout-rs` internals. Replace it with `layout-rs`'s
built-in SVG output rasterized by `resvg` + `tiny-skia`, displayed as an
`egui::ColorImage` texture.

## Task 18 — Spec v0.3: Migrate rhizz-cli and rhizz-gui frontends

### rhizz-cli

- Update `ScoreReport` display: show `Ports` and `Connections` rows instead of
  `Interfaces`
- Update JSON output `score` object: replace `"interfaces"` with `"ports"` and
  `"connections"` keys
- Update human-readable diagnostic examples if any are hardcoded
- Update CLI tests (16 tests)

### rhizz-gui

- Sidebar tree: replace interface listing with connections listing; optionally
  show ports under each component
- Any references to `model.interfaces` → `model.connections`
- Update GUI tests (5 tests)

Run: `cargo test --all`,
`cargo clippy --all-targets --all-features -- -D warnings`, `cargo doc`,
`cargo build`, `cargo fmt`

---

## Task 17 — Spec v0.3: Migrate rhizz-mermaid renderer

Same changes as Task 16 but for Mermaid output.

- Replace `InterfaceId`/`Interface`/`Direction` references with
  `ConnectionId`/`Connection`
- Infer arrow style from port roles: `-->` (unidirectional), `<-->`
  (bidirectional), `-.->` (unknown/ambiguous)
- Messages from connected ports when rendering edge labels
- Update all Mermaid rendering tests (14 tests)

Run: `cargo test -p rhizz-mermaid`,
`cargo clippy -p rhizz-mermaid -- -D warnings`, `cargo fmt`

---

## Task 16 — Spec v0.3: Migrate rhizz-dot renderer

Update DOT rendering to use `Connection` + `Port` instead of `Interface`.

- Replace all `InterfaceId`/`Interface` references with
  `ConnectionId`/`Connection`
- Infer edge direction from port roles on `ConnectionEndpoint`:
  - `provider` → `consumer`: directed arrow
  - `consumer` → `provider`: reversed arrow
  - `peer` ↔ `peer`: undirected line (`dir=none`)
  - Either side untyped or roles ambiguous: dashed line
- When `show_messages = true`, collect messages from the connected port(s) (both
  endpoints if both are typed)
- Edge `ltail`/`lhead` logic uses `ConnectionEndpoint.component` (unchanged
  concept, new type)
- Update all DOT rendering tests (14 tests)

Run: `cargo test -p rhizz-dot`, `cargo clippy -p rhizz-dot -- -D warnings`,
`cargo fmt`

---

## Task 15 — Spec v0.3: Migrate rhizz-core + examples to ports & connections

This is the core migration from spec v0.2 (interface-centric) to spec v0.3
(port + connection model). After this task, `cargo test -p rhizz-core` must
pass. Downstream crates (rhizz-dot, rhizz-mermaid, rhizz-cli, rhizz-gui) will
have compile errors until their migration tasks are completed.

### model.rs changes

**Add new types:**

- `PortId(usize)`, `ConnectionId(usize)` newtypes
- `PortRole` enum: `Provider`, `Consumer`, `Peer`
- `Port` struct: `label`, `description`, `protocol`, `role: PortRole`, `tags`,
  `owner: ComponentId`, `messages: Vec<MessageId>`
- `ConnectionEndpoint` struct: `component: ComponentId`, `port: Option<PortId>`
- `Connection` struct: `label`, `description`, `tags`, `level`,
  `from: ConnectionEndpoint`, `to: ConnectionEndpoint`,
  `encapsulates: Vec<ConnectionId>`
- `RawPort` struct: `description`, `protocol`, `role`, `tags`,
  `messages: Vec<Labeled<RawMessage>>`
- `RawConnection` struct: `description`, `tags`, `level`, `from`, `to`,
  `encapsulates`

**Remove:** `Interface`, `InterfaceId`, `Direction`, `RawInterface`

**Update:**

- `Component`: `interfaces: Vec<InterfaceId>` →
  `connections: Vec<ConnectionId>`, add `ports: Vec<PortId>`
- `System`: `interfaces: Vec<InterfaceId>` → `connections: Vec<ConnectionId>`
- `Model`: `interfaces: Vec<Interface>` → `connections: Vec<Connection>`, add
  `ports: Vec<Port>`
- `RawSystem`: `interfaces` → `connections: Vec<Labeled<RawConnection>>`
- `RawComponent`: `interfaces` → `connections`, add
  `ports: Vec<Labeled<RawPort>>`
- `lib.rs`: update public exports

### parse.rs changes

- Parse `port "label" { protocol, role, tags, message... }` inside `component`
  blocks
- Parse `connection "label" { from, to, tags, level, encapsulates }` instead of
  `interface`; no `direction`, `leaf`, or `message` children
- Messages are parsed inside `port`, not `connection`
- Update all parse unit tests

### examples/ changes

Rewrite all three example projects (drone, social-media, software-house) `.hcl`
files:

- `interface` blocks → `connection` blocks (remove `direction`, `leaf`; move
  messages out)
- Add `port` blocks on components with `protocol`, `role`, and relocated
  `message`/`field` blocks
- Use `comp:port` syntax in `connection` `from`/`to` where appropriate
- Keep some bare `from`/`to` references to exercise W007 (gradual specification)

### resolve.rs changes

- Parse `from`/`to` strings: split on `:` to get `(comp_label, port_label)` or
  treat as bare component label
- Build `ScopeIndex.ports: HashMap<(ComponentId, String), PortId>` during
  component registration
- Update `ScopeIndex.interfaces` → `ScopeIndex.connections`
- Resolve `ConnectionEndpoint` with optional `PortId`
- Error code changes:
  - E005: leaf component with child components **or connections** (was "or
    interfaces")
  - Remove E006 (leaf interface with messages) — no longer applicable
  - Remove E008 (invalid direction) — no longer applicable
  - Renumber: E007→E006 (undefined system in view), E009→E007 (field missing
    type), E010→E008 (duplicate project)
  - Add E009 (invalid `port.role`), E010 (`comp:port` port not found), E011
    (`comp:port` component not found)
- Update all resolution tests

### validate.rs changes

- Remove W002 (non-leaf interface with no messages)
- Renumber: W003→W002 (message no fields), W004→W003 (orphan component — check
  connections now), W005→W004 (missing description), W006→W005 (from==to same
  component), W007→W006 (level decreases)
- Add W007 (one side typed, other not), W008 (protocol mismatch between
  connected ports), W009 (incompatible port roles), W010 (unused port), W011
  (port has no messages)
- Update all validation tests

### score.rs changes

- Remove interface scoring
- Add port scoring: complete (≥1 message, all complete), partial, incomplete (no
  messages)
- Add connection scoring: complete (both sides typed, matching protocol),
  partial (one side typed), incomplete (both untyped)
- `ScoreReport`: add `ports` and `connections` categories, remove `interfaces`
- Leaf component with description and no ports → still Complete (1.0)
- Update all scoring tests

Run: `cargo test -p rhizz-core`, `cargo clippy -p rhizz-core -- -D warnings`,
`cargo fmt`

---

## Task 14 — File watcher + live recompile

Register a `notify` watcher on the project directory. Recompile and refresh all
panels on any `.hcl` change.

- Use the same `notify` + `mpsc` + debounce pattern as `rhizz-cli`'s `watch`
  command (200 ms debounce).
- Keep the last successfully resolved `Model` in memory. If the new compile has
  hard errors, show the new diagnostics but continue rendering the previous
  valid model everywhere else.
- A small status bar at the bottom shows either "OK" or "X errors, Y warnings"
  after each recompile.
- `cargo build`, `cargo clippy`, `cargo fmt` must all pass.

---

## Task 13 — Startup load + diagnostic pane

On launch, read all `.hcl` files from the project directory argument, call
`rhizz_core::compile`, and display results in the window.

- A scrollable bottom pane lists every diagnostic (`code`, `file`, `line`,
  `message`); errors in red, warnings in yellow.
- A left sidebar lists every system, component, and interface by name (flat list
  is fine).
- No watcher yet — compile once at startup and display the static result.
- `cargo build`, `cargo clippy`, `cargo fmt` must all pass.

---

## Task 12 — Scaffold `rhizz-gui` crate

Add `crates/rhizz-gui` to the Cargo workspace as a new binary crate.

- Add `rhizz-gui` to the `members` list in the root `Cargo.toml`.
- Create `crates/rhizz-gui/Cargo.toml` with dependencies: `eframe`, `egui`,
  `rhizz-core`, `rhizz-dot`, `notify`, `walkdir`, `anyhow`.
- `src/main.rs` accepts a single positional CLI argument — a path to a project
  directory — and opens a blank `eframe` window titled "rhizz" with the path
  shown in the title bar.
- No model logic yet; the window just needs to open without panicking.
- `cargo build`, `cargo clippy`, `cargo fmt` must all pass.

---

## Task 11 — `watch` command for rhizz-cli

Add a `rhizz watch <path>` command to `rhizz-cli` that behaves identically to
`rhizz build` but reruns the full build pipeline automatically whenever any
`.hcl` file in the project directory changes.

### Acceptance Criteria

- `rhizz watch <path>` performs the same pipeline as `rhizz build` (parse →
  validate → score → views) on startup, then sits in a loop waiting for
  file-system events.
- On any create, modify, or delete event for a `.hcl` file under `<path>`, the
  pipeline is rerun from scratch and the output is reprinted.
- Use the [`notify`](https://crates.io/crates/notify) crate (cross-platform;
  wraps `inotify` on Linux, `FSEvents` on macOS, `ReadDirectoryChangesW` on
  Windows) — **not** the `inotify` crate directly, so the feature works on macOS
  and Windows too.
- A short debounce period (e.g. 200 ms) prevents re-running the pipeline
  multiple times for a single logical save that produces several rapid events.
- The command can be interrupted cleanly with Ctrl-C (SIGINT); on exit it prints
  a short "Stopped watching." message and exits with code 0.
- All existing flags (`--strict`, `--json`, `--output-dir`, `--no-color`) are
  forwarded to the inner build pipeline exactly as they are for `rhizz build`.
- The `notify` dependency must be added only to `rhizz-cli/Cargo.toml`, not to
  `rhizz-core` or `rhizz-dot`.

### Implementation Notes

- Add `Watch` variant to the existing `Command` enum in `cli.rs`, with the same
  arguments as `Build`.
- Extract (or reuse) the existing `run_build` helper so both `build` and `watch`
  call it.
- The watch loop should live in a new function `run_watch` in `cli.rs` (or a new
  `watch.rs` module if you prefer).
- Use `notify::recommended_watcher` with a `std::sync::mpsc` channel; filter
  received events to `.hcl` extension before triggering a rebuild.
- Print a clear "Watching <path> for changes…" banner before the initial build
  so the user knows the watcher is active.

### Tests

- Integration test: spawn `rhizz watch` against one of the `examples/`
  directories, modify an `.hcl` file, and assert that the command prints the
  build output a second time. Use a timeout to avoid hanging CI.
- Unit test: verify the debounce logic does not trigger multiple rebuilds for
  events arriving within the debounce window.

---

## Task 10 — Migrate CLI into `rhizz-cli`

Move `cli.rs` and the `main.rs` entry point into `crates/rhizz-cli/src/`. Add
`rhizz-core` and `rhizz-dot` as path dependencies. The CLI crate must contain no
parsing, validation, scoring, or DOT-rendering logic of its own — all calls
delegate to the two library crates. Move integration tests (examples: drone,
social-media, software-house) to `crates/rhizz-cli/tests/`. Verify that the
`rhizz` binary behaviour is identical to before.

Then:

Delete the old `src/` directory at the repo root once all code has migrated. Run
`cargo test --all`, `cargo clippy --all-targets --all-features -- -D warnings`,
`cargo doc --all`, and `cargo build --all`. Fix any warnings or errors surfaced.
Run `cargo fmt --all`.

---

## Task 9 — Establish `rhizz-dot`

Move `dot.rs` into `crates/rhizz-dot/src/`. Expose
`fn render_view(model: &Model, view: &View) -> String`. Add `rhizz-core` as a
path dependency. No I/O. All pre-existing tests travel with the module.

---

## Task 8 — Establish `rhizz-core`

Move `model.rs`, `parse.rs`, `resolve.rs`, `validate.rs`, and `score.rs` from
`src/` into `crates/rhizz-core/src/`. Expose a clean public API:

- `Source { filename: String, content: String }`
- `CompileResult { model: Option<Model>, diagnostics: Vec<Diagnostic> }`
- `fn compile(sources: &[Source]) -> CompileResult`
- `fn score(model: &Model) -> ScoreReport`

All public types must derive `Clone`, `serde::Serialize`, and
`serde::Deserialize`. The crate must have **no** `std::fs`, `std::env`, or any
I/O dependency. All pre-existing unit tests travel with their modules; they must
pass under the new crate.

---

## Task 7 — Convert root to a Cargo workspace

Replace the root `Cargo.toml` `[package]` section with a `[workspace]` manifest
that lists `crates/rhizz-core`, `crates/rhizz-dot`, and `crates/rhizz-cli` as
members. Create the three `crates/` subdirectories, each with a skeleton
`Cargo.toml` and empty `src/lib.rs` (or `src/main.rs` for the CLI). Verify that
`cargo build` succeeds on the empty workspace.

---

## Task 6 — CLI

- Implement `clap` arg parser as specified in `SPEC/cli.md`: `check`, `score`,
  `views`, `build` subcommands; default to `build`
- Implement human-readable diagnostic output: `✗ E002  file.hcl:14  message` /
  `⚠ W001 ...`
- Implement `--json` output mode with the schema from `SPEC/cli.md`
- Implement `--strict` (warnings → errors), `--no-color`, `NO_COLOR` env var,
  non-TTY detection
- Wire exit codes: `0` on success, `1` on errors (or warnings under `--strict`)
- **Test:** run `rhizz build` on each example, assert exit code and stdout
  content

---

## Task 5 — Graphviz DOT Generation

- Implement `render_view(model: &Model, view: &View) -> String`
- Apply filter predicates: tag inclusion/exclusion, `max_level`, component
  whitelist, `show_messages`
- Emit `subgraph cluster_*` for non-leaf components, box nodes for leaf
  components
- Emit directed/undirected edges for interfaces; include message names in edge
  labels when `show_messages = true`
- Write rendered `.dot` files to `--output-dir`
- **Test:** render all views in each example; assert output contains expected
  node/edge identifiers

---

## Task 4 — Completion Scoring

- Implement `score(model: &Model) -> ScoreReport` with the per-entity
  0.0/0.5/1.0 logic from SPEC.md §5
- Produce per-category counts (components/interfaces/messages) and overall
  aggregate
- Implement `ScoreReport` display formatting matching the spec output format
- **Test:** assert score values for each example match hand-calculated
  expectations

---

## Task 3 — Validation and Warnings

- Implement a warning pass over the resolved `Model`, emitting W001–W007 as
  non-blocking `Diagnostic` values
- Implement `Diagnostic` type with fields: `code`, `file`, `line` (optional),
  `message`
- **Test:** assert that each example emits exactly the expected warning codes
  and none of the examples produce unexpected errors

---

## Task 2 — Resolution

- Define resolved model types and newtyped ID structs (`ComponentId`,
  `InterfaceId`, etc.) and the full `Model` arena as described in
  `SPEC/models.md`
- Implement
  `resolve(raw: RawFile) -> Result<(Model, Vec<Diagnostic>), Vec<Diagnostic>>`:
  - Walk raw tree depth-first, allocate IDs, populate arenas
  - Build `ScopeIndex` mapping `(Scope, label) → id` for components and
    interfaces
  - Resolve `from`/`to` and `encapsulates` references via scope lookup
  - Apply all defaults (`level` auto-increment, `leaf = false`, empty strings)
  - Emit errors E001–E010 as `Diagnostic` values; return `Err` if any errors
    present
- **Test:** resolve drone + social-media + software-house examples; assert
  resolved IDs, relationships, and that deliberate W001/W002/W005 triggers are
  present

---

## Task 1 — Foundation

- Add dependencies to `Cargo.toml`: `hcl-rs`, `clap` (derive feature),
  `owo-colors`, `walkdir`, `anyhow`
- Set up module structure: `parse`, `model`, `resolve`, `validate`, `score`,
  `dot`, `cli`
- Define raw model types: `RawFile`, `Labeled<T>`, `RawProject`, `RawSystem`,
  `RawComponent`, `RawInterface`, `RawMessage`, `RawField` — all optional
  fields, no logic
- Implement `parse_file(src: &str) -> Result<RawFile>` by walking `hcl::Body`,
  handling recursive component/interface nesting
- Implement file discovery: glob all `.hcl` files in a directory, parse each,
  merge into one `RawFile`; detect E010 (multiple `project` blocks) during merge
- **Test:** parse all three example projects without error and assert field
  values on at least one
