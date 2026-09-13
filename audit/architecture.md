# rhizz — Architecture & Maintainability Audit

Read-only audit of the whole repository (Rust workspace under `crates/`,
SvelteKit frontend under `web/`, mdBook tooling, SPEC, TASKS). No source was
modified. Findings are ordered by impact within each section; the final
section lists the highest-value items.

Scope covered: `rhizz-core` (parse/resolve/validate/score/serialize),
`rhizz-cli`, `rhizz-wasm`, `rhizz-server`, `rhizz-book`, the `web/` frontend
(routes, `DocumentStore`, VFS layer, diagram editor, testing harness), the
`SPEC*` documents, `TASKS/`, `Justfile`, and the test suites of each layer.

Overall assessment: the Rust core is well-factored and the crate boundaries
(core / cli / wasm / server / book) are clean and match the documented
frontend contract. The significant problems are concentrated on the
**TypeScript ⇄ Rust boundary in the web editor**: the frontend has grown its
own second implementation of the model (an HCL emitter, a model tree, a scoring
rule, a view-layout store) next to the Rust one that is already compiled into
the page via WASM. Most of the findings below are facets of that one theme.

---

## Findings

### 1. The frontend has a second HCL serializer next to `rhizz_core::serialize_model`

**Impact:** High

**Confidence:** High

**Locations:**
- `web/src/DocumentStore.svelte.ts` — `systemHcl` (`$derived`, ~line 231),
  `serializeComponentDef`, `serializeProtocol`, `serializePort`,
  `serializeMessage`, `serializeField`, `serializeConnection`,
  `escapeHclString`, `formatStringList`
- `crates/rhizz-core/src/serialize.rs` — `serialize_model`,
  `serialize_system`, `serialize_component_def`, `serialize_port`,
  `serialize_protocol`, `serialize_message`, `serialize_field`,
  `serialize_connection`, `escape_string`, `format_string_list`
- `crates/rhizz-wasm/src/lib.rs` — `ModelJS::to_hcl`, `serialize_model`
  (exported to JS, unused by the app)
- `crates/rhizz-cli/src/cli.rs` — `run_fmt` / `format_project` (uses the Rust
  serializer)
- `SPEC/architecture.md` — "Frontend Contract → Do not duplicate logic"

**Problem**

`DocumentStore.systemHcl` is a complete, hand-written HCL emitter for the
system model (project, protocols, definitions, systems, instances, ports,
messages, fields, connections). `rhizz-core` already ships a canonical
serializer with documented determinism and round-trip guarantees, and it is
already exported through WASM (`ModelJS.to_hcl()` / `serialize_model`). The
only production consumer of the Rust serializer on the web side is the test
harness (`WorkspaceHarness.ts`); every actual user edit on the diagram canvas
is written to disk through the TypeScript emitter.

**Why it looks reasonable locally**

`DocumentStore` holds a mutable TypeScript tree; emitting HCL directly from
that tree is the shortest path to "write the file". The alternative — pushing
the mutation through WASM and getting HCL back — required the Rust side to
expose mutation operations it does not have, so the store grew its own
emitter incrementally as the editor gained features.

**Why it is problematic globally**

Two independent implementations of the same canonical format are already
diverging, so a project edited in the GUI is not `rhizz fmt`-clean and vice
versa:

- Instances: Rust emits `instance "x" { source = "y" }` on one line
  (`serialize.rs` `serialize_system` / `serialize_component_def`); TS emits a
  three-line block (`systemHcl` and `serializeComponentDef`).
- Ordering: Rust sorts siblings with byte-wise `cmp`; TS uses
  `localeCompare`, which orders case and punctuation differently.
- Escaping: Rust `escape_string` implements HCL escapes; TS
  `escapeHclString` is `JSON.stringify`, which additionally escapes
  `\u2028`/`\u2029` and control characters as `\uXXXX` and does not match
  the Rust output for the same input.
- Defaulting rules (`level != 1`, `required == false`, `border != solid`,
  `version != "0.0.0"`) are re-encoded in both places and must be kept in
  step by hand each time the schema changes (the recent "remove system
  `level`" and `deny_unknown_fields` tasks each touched both).

Every schema change (new attribute, new block) now costs three edits: Rust
parse structs, Rust serializer, TS emitter — plus the mirrors in finding 3.
The spec's own frontend contract ("if behaviour needed by a frontend is
missing from `rhizz-core`, add it there") is not being followed for the
highest-traffic write path in the product.

**Potential simplification**

Own serialization in Rust only. Two plausible shapes:

1. Minimal: keep TS mutations, but derive the written text as
   `compile(tsDraft).model().to_hcl()` instead of `systemHcl`, so the on-disk
   form is always the Rust canonical form. The TS emitter becomes an internal
   draft encoder whose exact formatting no longer matters (and could be
   reduced to the simplest correct encoding).
2. Structural: expose model mutations on `ModelJS` (add instance, add
   definition, add connection, rename, reparent, update attrs, …) and return
   `to_hcl()`; delete the TS emitter and the TS model tree entirely (see
   finding 2).

**Evidence**

- `DocumentStore.svelte.ts` lines ~231–330 (`systemHcl`) and ~349–560 (the
  `serialize*` helpers) mirror `serialize.rs` lines 43–560 function-for-
  function.
- `grep to_hcl|serialize_model web/src` → only `rhizz_wasm_wrapper.ts`
  (re-export) and `testing/WorkspaceHarness.ts`.
- All 12 write sites in `routes/projects/[id]/diagrams/+page.svelte`
  (`fs.writeFile(targetPath, doc.systemHcl)`) use the TS emitter.
- `cli.rs` `format_project` uses `serialize_model` — so `rhizz fmt --check`
  on a GUI-edited project will report differences.

---

### 2. Model mutations round-trip through a full re-parse into a hand-built TS model tree, per handler, with no failure gating

**Impact:** High

**Confidence:** High

**Locations:**
- `web/src/routes/projects/[id]/diagrams/+page.svelte` — `readMainContent`,
  `getPrimaryHclPath`, and the handlers at ~1128 (`executeReparent`), 1149
  (`handleAddSystem`), 1255 (`handleModalCreateComponent`), 1330
  (`docStore` derived), 1365 (`handleUpdateSelectedComponent`), 1384
  (`handleRenameSelectedComponent`), 1411 (`handleDeleteSelectedComponent`),
  1510 (`handleCreateConnection`), 2140 (…)
- `web/src/DocumentStore.svelte.ts` — `loadFromRawModel`,
  `loadFromSources`, `loadFromHcl`, `findContainer`, `RawModelPayload`
- `web/src/testing/WorkspaceHarness.ts` — `editableComponentKeys` (comment
  on multi-file limitation), `primaryHclFile`

**Problem**

Every canvas mutation runs the same pipeline, copy-pasted into each handler:

```
read primary .hcl → new DocumentStore() → loadFromHcl()
  → compile_system() [WASM]  → model.to_js()
  → loadFromRawModel(): rebuild a nested TS tree from the arena
  → mutate the TS tree → doc.systemHcl (TS emitter, finding 1)
  → fs.writeFile → readProjectSources → compile_system() again
```

`loadFromRawModel` is a second, TypeScript implementation of "turn the
resolved arena into a hierarchy" (parent maps, root-system lookup, absolute
→ scope-relative endpoint paths), i.e. it re-derives what the Rust
`Resolver` already knows and what `serialize.rs::endpoint_path` /
`component_path` already compute.

The pipeline has no failure gate: `loadFromSources` swallows a failed
compile (`console.warn(...); return;`), leaving the store empty, and every
handler then continues to mutate and **write `doc.systemHcl` back to the
primary file**. If the primary file currently has a hard error (a typo the
user is fixing in the Editor pane, a reference to a definition in another
file → E014), one drag on the canvas rewrites the file with a near-empty
model. The harness acknowledges the related multi-file limitation
(`editableComponentKeys`: "Multi-file projects … require source-aware
editing … generated visual edits are limited to fixtures the current UI
writer can safely round-trip").

The handlers also bypass the store's own API where convenient:
`handleRenameSelectedComponent` sets `comp.label = newLabel` directly instead
of calling `DocumentStore.renameComponent`, so renames skip the sibling-
collision check and never reach the mutation observer — the "Copy Debug Info"
replay script (which AGENTS.md tells maintainers to rely on) silently omits
renames.

**Why it looks reasonable locally**

Each handler is self-contained and obviously correct in isolation: load,
mutate, save. Building a fresh `DocumentStore` per handler avoids stale state
and reactivity pitfalls. The module-level mutation observer was added
precisely to avoid touching the already-large page.

**Why it is problematic globally**

- The model exists in four representations at once on every edit: HCL text,
  Rust `Model` (in WASM), `to_js()` raw payload, TS `ComponentData` tree —
  then back to HCL via a different emitter. Each hop is a place for
  semantics to drift (see the `updateComponent` special-case that redirects
  instance edits to their definition because the TS tree stores clones).
- Two compiles per mutation plus a third for `docStore`; not a performance
  finding per se, but a sign the boundary is in the wrong place.
- Write path correctness depends on the *previous* compile succeeding, which
  the code does not check — a data-loss hazard rooted in the architecture
  rather than in any one handler.
- The `TASKS/TODO.md` "Unified command-based transaction history" and
  "Modular multi-pane workspace" tasks both presuppose a single mutation
  dispatcher; today there is none, so those tasks will have to first
  consolidate the 12 copies.

**Potential simplification**

One mutation entry point (`applyModelMutation(op)`) that: reads the sources
once, refuses to proceed when the current compile has blocking errors,
applies the op, writes canonical HCL (Rust serializer), and triggers a single
recompile. Whether the op is applied in TS or in Rust (finding 1, option 2)
is secondary; the important part is one path, one gate. Route
`handleRenameSelectedComponent` through `renameComponent`.

**Evidence**

- `DocumentStore.svelte.ts` `loadFromSources` (~1279–1291): on `!model` →
  `console.warn` + `return`; callers at the page lines above never check and
  proceed to `fs.writeFile(targetPath, doc.systemHcl)`.
- `+page.svelte` ~1384–1405: `comp.label = newLabel` vs
  `DocumentStore.renameComponent` (~line 764) which exists, validates, and
  calls `notifyMutations`.
- `loadFromRawModel` (~1094–1275): `parentOfComp`, `rootSystemOfComp`,
  `compPath`, `buildConn.rel` duplicate `serialize.rs::component_path` /
  `endpoint_path` and `model.rs::component_key`.

---

### 3. The Rust `Model` shape is hand-mirrored in TypeScript three times, alongside a partially-used typed wrapper API

**Impact:** High

**Confidence:** High

**Locations:**
- `web/src/DocumentStore.svelte.ts` — `RawModelPayload` (~156–230)
- `web/src/routes/projects/[id]/inventory/Inventory.svelte` — `RawComponent`,
  `RawPort`, `RawConnection`, `RawModel` (~39–75; comment: "mirrors
  RawModelPayload … duplicated here")
- `web/src/rhizz_wasm_wrapper.ts` — `NodeLayout`, `ConnectionLayout`,
  `Annotation`, `ViewFilterDefinition`, `ViewDefinition`, `ExampleProject`
  (hand-typed mirrors of `model.rs` / `examples.rs`)
- `crates/rhizz-wasm/src/lib.rs` — `ComponentJS`, `PortJS`, `ProtocolJS`,
  `ConnectionJS`, `SystemJS`, `ProjectJS`, `ModelJS::{to_js, from_js,
  to_json, from_json, component_by_name, component_by_id, ports, protocols}`
- `crates/rhizz-core/src/model.rs` — the serde source of truth

**Problem**

There are two parallel ways to read the model from JS, and the frontend uses
both:

1. Typed wrapper classes (`ComponentJS` …) with per-field getters that clone
   on every access. These omit hierarchy (`children`, `ports`,
   `connections` indices) and `definitions`, so any consumer that needs the
   tree cannot use them.
2. `ModelJS.to_js()` — the raw serde payload, typed on the TS side by
   hand-written interfaces that must track `model.rs` (including serde
   details such as the `{ Component: n } | { System: n }` parent encoding
   and `field_type` naming).

The hand-typed mirrors exist in two files with a comment admitting the
duplication, and the view-model types in `rhizz_wasm_wrapper.ts` are a third
mirror. None are generated or checked against the Rust definitions.

Roughly half of the typed wrapper surface is unused by the application:
`ModelJS.ports()`, `protocols()`, `component_by_name`, `component_by_id`,
`from_json`, `to_json`, `from_js`, `PortJS.owner_component_index` — they
exist only to satisfy `crates/rhizz-wasm/tests`.

**Why it looks reasonable locally**

`SPEC/frontend.md` documents the typed-wrapper approach as the design
("expose only what the frontend needs; more accessors are added as the
frontend grows"). `to_js()` was a pragmatic escape hatch when hierarchy was
needed and the wrappers were not extended. Each mirror interface was written
where it was needed.

**Why it is problematic globally**

- A change to `model.rs` (rename a field, change parent encoding) breaks the
  frontend at runtime, not at compile time, in three different files.
- The wrapper layer's promise ("full autocompletion, no manual `.d.ts`") is
  only half true: the hierarchical parts of the model — exactly what the
  diagram editor, Inventory, and `DocumentStore` need — go through untyped
  JSON with manual casts (`model.to_js() as RawModel`).
- Maintaining two access paths means every new model field must be added to
  the wrapper getter *and* the TS mirrors.

**Potential simplification**

Pick one boundary encoding. Either (a) drop the getter classes for model
entities and generate TS types from the serde structs (e.g. `tsify` /
`ts-rs`) so `to_js()` is the single typed path; or (b) complete the typed
wrappers (children/ports/connections/definitions indices) and delete
`to_js()`-based consumers. Remove wrapper methods with no application caller.

**Evidence**

- `grep -rn "RawModel" web/src` → `DocumentStore.svelte.ts:156`,
  `Inventory.svelte:39,70`.
- `Inventory.svelte:9–11`: "taken from the compiled model's raw payload
  (`model.to_js()`), which — unlike the typed wasm wrappers — exposes
  children/ports/parent indices".
- Application usage counts (non-test): `.ports()` 0, `.protocols()` 0,
  `component_by_name` 0, `component_by_id` 0, `from_json`/`to_json`/`from_js`
  0, `owner_component_index` 0.

---

### 4. Two view-layout models in the frontend; one of them is unreachable from the UI

**Impact:** Medium

**Confidence:** High

**Locations:**
- `web/src/DocumentStore.svelte.ts` — `views`, `viewsHcl`, `getView`,
  `addView`, `updateNodeLayout`, `loadFromRawModel(…, viewsHcl?)`
- `web/src/routes/projects/[id]/diagrams/persistence.ts` — `DiagramLayout`,
  `StoredBox`, `StoredConnection`, `layoutToHcl`, `viewsToLayout`,
  `mapLayoutToBoxes`, `readDiagramLayoutFile`, `writeDiagramLayoutFile`
- `web/src/actionLog.ts` — `add_view`, `update_node_layout` ops and their
  codegen
- `web/src/routes/projects/[id]/inventory/Inventory.svelte` — `previewBoxes`
  (inline copy of `mapLayoutToBoxes`)

**Problem**

The diagram canvas persists layout through `persistence.ts`
(`DiagramLayout` ⇄ `ViewDefinition` ⇄ HCL via WASM `serialize_views` /
`parse_views`). `DocumentStore` independently carries `views:
ViewDefinition[]`, a derived `viewsHcl`, and mutation methods
(`addView`, `updateNodeLayout`) with their own action-log ops. No UI code
calls those methods (`grep updateNodeLayout|addView|viewsHcl` → only
`actionLog.ts` codegen). Consequently the action log's layout ops never
fire, and a "Copy Debug Info" dump never contains node moves even though the
op types exist for them. `Inventory.svelte` additionally re-implements
`mapLayoutToBoxes` inline instead of importing it.

**Why it looks reasonable locally**

`DocumentStore` was designed as "the" document (model + views); the canvas
page predates or evolved separately with its own `checked`/`savedLayout`
records that map directly onto SVG state. Each piece is internally coherent.

**Why it is problematic globally**

Two TypeScript shapes for the same `diagrams/*.hcl` content (`ViewDefinition`
and `DiagramLayout`) plus conversion functions between them, and a dead
mutation surface that still has to be kept compiling and tested. The
planned unified undo/redo (TODO) will have to choose one; today's code makes
it look as though `DocumentStore.views` is the layout owner when it is not.

**Potential simplification**

Delete `DocumentStore.views/viewsHcl/addView/updateNodeLayout/getView` and
the corresponding `ModelAction` variants (or, conversely, route
`writeDiagramLayoutFile` through them so the action log is complete). Reuse
`mapLayoutToBoxes` in Inventory.

**Evidence**

- `grep -rn "updateNodeLayout\|addView\|viewsHcl" web/src` (non-test) →
  `actionLog.ts` only.
- `+page.svelte` writes via `writeDiagramLayoutFile` (lines ~365, 462, 489).
- `Inventory.svelte` ~245–258 duplicates `persistence.ts::mapLayoutToBoxes`
  (~79–100) line for line.

---

### 5. Completion scoring and report/diagnostic projections are re-declared per frontend, and the three copies of the scoring rule disagree with the spec

**Impact:** Medium

**Confidence:** High

**Locations:**
- `crates/rhizz-core/src/score.rs` — `score_component`, `ScoreReport`,
  `CategoryScore` (already `Serialize`)
- `web/src/routes/projects/[id]/inventory/inventory.ts` — `completionScore`,
  `completionBadge` ("exactly like `score_component`")
- `SPEC.md` §5 "Per-Entity Completeness" table
- `crates/rhizz-cli/src/cli.rs` — `JsonScore`, `JsonCategoryScore`,
  `JsonOverallScore`, `JsonDiagnostic`, `format_diagnostic`
- `crates/rhizz-book/src/compile.rs` — `score_json` ("same shape as
  `rhizz --json build`"), `to_normalized`; `normalize.rs::NormDiagnostic`
- `crates/rhizz-wasm/src/lib.rs` — `ScoreReportJS`, `CategoryScoreJS`,
  `DiagnosticJS`
- `web/src/routes/book-example/BookExampleView.svelte` — `VerdictStats`;
  `web/src/ProjectState.svelte` — `{ overall_percentage }`

**Problem**

*Scoring rule.* `inventory.ts::completionScore` re-implements the component
scoring rule in TypeScript because "rhizz-wasm only exposes aggregate
category scores". There are now three statements of the rule: SPEC §5 says a
leaf **without** a description is *Incomplete (0.0)*; `score.rs` and
`inventory.ts` both return **0.5**. The spec and both implementations
already disagree; a future fix must be applied in two languages.

*Report/diagnostic shapes.* `ScoreReport` derives `Serialize`, yet the CLI
defines a separate `JsonScore` family, the book crate builds a `serde_json`
object by hand to match the CLI, and the WASM crate defines a third class
hierarchy. `Diagnostic` likewise has `JsonDiagnostic` (CLI), `NormDiagnostic`
(book), and `DiagnosticJS` (WASM) — the last of which drops `file` and
`line`, so the web UI cannot show a diagnostic's file even for the view
diagnostics that do carry one. The web layer then re-derives severity from
strings in three different ways (`d.level === "Error"`,
`code.startsWith("E")`, and `error_count()`).

**Why it looks reasonable locally**

Each frontend wants a stable, medium-specific output shape (the CLI's JSON
is a documented contract in `SPEC/cli.md`; `book.lock` needs a
Python-compatible sort order). A per-definition badge in Inventory is a UI
detail that seemed too small to push into Rust.

**Why it is problematic globally**

Business rules (scoring) are supposed to live in one tested place; the
Inventory badge is a second implementation that will drift on the next
scoring change (the SPEC/impl mismatch shows it already happens). The
projection structs are not a rule violation individually, but four
hand-maintained shapes for the same two records mean any new field (e.g. a
"fields" category, or a diagnostic `span`) is a four-place change.

**Potential simplification**

- Expose per-component scores from core (e.g. `Model::component_scores()`
  or a `score` field on `ComponentJS`) and delete `inventory.ts::
  completionScore`. Reconcile SPEC §5 with `score_component` in whichever
  direction is intended.
- Let `rhizz-core` own one serializable report/diagnostic projection (it
  already derives `Serialize`); have the CLI JSON, book lock, and WASM reuse
  it, keeping only genuinely medium-specific transforms (book sort order).
- Include `file`/`line` in `DiagnosticJS`.

**Evidence**

- `score.rs:14–21` (`if comp.description.is_empty() { 0.5 } else { 1.0 }`)
  vs `inventory.ts:89–92` (`description.trim().length > 0 ? 1 : 0.5`) vs
  `SPEC.md` §5 table row "Component (leaf) … Incomplete (0.0): No
  description".
- `compile.rs:105–135` builds `score_json` field by field with a comment
  pointing at the CLI shape defined in `cli.rs:244–279`.
- `DiagnosticJS` (`rhizz-wasm/src/lib.rs:10–50`) has `code`, `message`,
  `level` only; `Diagnostic` (`diagnostics.rs`) has `file`, `line`.

---

### 6. Two SVG diagram renderers: the interactive canvas and `DiagramElements`

**Impact:** Medium

**Confidence:** High

**Locations:**
- `web/src/routes/projects/[id]/diagrams/+page.svelte` (3,542 lines; inline
  `<rect>`/`<path>`/`<text>` node, connection, port, and annotation markup,
  ~lines 3100–3400)
- `web/src/routes/projects/[id]/diagrams/DiagramElements.svelte` (used by
  `DiagramStaticView.svelte`, `DiagramEmbedView.svelte`, and through them by
  Explore, Inventory, the embed route, and the book example)
- shared helpers: `geometry.ts` (`elbowPath`, `textPosition`,
  `computeVisibleConnections`, `computeRenderOrder`), `visuals.ts`,
  `iconHelper.ts`

**Problem**

Node boxes, labels, icons, border/font styling, connection elbows and
arrowheads, and annotations are rendered twice: once in the interactive
page's template and once in `DiagramElements.svelte`. Both call the same
geometry/visual helpers, but the SVG structure, class names, and the
per-element attribute sets are separately maintained.

**Why it looks reasonable locally**

The interactive canvas needs handles, marquee selection, hover targets, drag
state, and inline editing that a static renderer does not; extracting a
read-only `DiagramElements` for the other five consumers was the right move
for them without disturbing the editor.

**Why it is problematic globally**

Any visual change (a new border style, label alignment option, connection
side marker, annotation scale) must be made in both templates and verified
in both; the Storybook stories cover `DiagramElements` but the editor's
rendering is only exercised through the page. Divergence between "what I
edited" and "what Explore/embed/book show" is a class of bug the structure
invites.

**Potential simplification**

Render the static layer of the editor with `DiagramElements` (it already
accepts `selected`, `linked`, and click/hover callbacks) and overlay only the
interaction chrome (handles, marquee, port hit targets) in the page.

**Evidence**

- Element sites: 32 `<rect|<path|<text|{@html` in `+page.svelte` vs 12 in
  `DiagramElements.svelte`; `elbowPath(` at `+page.svelte:3186,3192,3320` and
  `DiagramElements.svelte:252`.
- `+page.svelte` imports none of `DiagramElements`, `DiagramStaticView`,
  `DiagramViewport` for its own rendering.

---

### 7. Each route independently loads, compiles, and indexes the project

**Impact:** Medium (already targeted by a TODO task)

**Confidence:** High

**Locations:**
- `web/src/routes/projects/[id]/diagrams/+page.svelte`,
  `…/diagrams/embed/[...diagram]/+page.svelte`, `…/explore/Explore.svelte`,
  `…/inventory/Inventory.svelte`, `…/overview/+page.svelte`,
  `…/editor/+page.svelte`, `web/src/routes/book-example/BookExampleView.svelte`
- `web/src/ProjectState.svelte` — `setCurrentScore`/`setCurrentDiagnostics`
  side channel for the navbar

**Problem**

Seven components each contain the same block: `sources = $state([])`,
`$effect(readProjectSources(fs))`, `output = $derived(compile_system(…))`,
`model = output.model()`, `componentKeys = model.component_keys()`,
`keyToIndex = new SvelteMap(...)`. The diagrams page additionally builds a
`docStore` from the same model. Cross-page facts (score, error counts) are
pushed into `ProjectState` by whichever page is mounted.

**Why it looks reasonable locally**

SvelteKit routes are naturally isolated; fetching what a page needs where it
needs it is idiomatic, and `ProjectState.svelte` deliberately avoids caching
nodes "so a page's own edits are never at risk of being shadowed".

**Why it is problematic globally**

This is the root cause the "Modular multi-pane workspace with shared
reactive context" task in `TASKS/TODO.md` is meant to fix; it is listed here
for completeness because findings 1–4 should be resolved in the same
consolidation (a single reactive `compileResult` is the natural place for a
single mutation gate). No further action is proposed beyond the existing
task.

**Evidence**

- `grep -rn "readProjectSources\|compile_system" web/src/routes` — seven
  independent call sites listed above.
- `keyToIndex` `SvelteMap` construction repeated in `+page.svelte:186`,
  `Explore.svelte:230`, `Inventory.svelte:241`, `embed/+page.svelte:95`,
  `BookExampleView.svelte:195`.

---

### 8. Example diagram layouts are duplicated in TypeScript and overwrite the embedded HCL examples

**Impact:** Low–Medium

**Confidence:** High

**Locations:**
- `web/src/example_system.ts` — `EXAMPLE_SYSTEM_DIAGRAMS`,
  `seedExampleProjectDiagrams`
- `web/src/components/ProjectsPage.svelte` — `selectExample` (~84–86)
- `examples/single-file/diagrams/overview.hcl`, `cloud-path.hcl`
- `crates/rhizz-core/build.rs` (`generate_example_projects`),
  `crates/rhizz-core/src/examples.rs`, `crates/rhizz-wasm/src/lib.rs`
  (`get_example_projects`)

**Problem**

`examples/` is embedded into the binary/WASM as the "single source of
truth" and written into a new project by `createProjectWithFiles`. For the
`single-file` example only, `selectExample` then calls
`seedExampleProjectDiagrams`, which overwrites the just-written
`diagrams/overview.hcl` and `diagrams/cloud-path.hcl` with layouts hard-coded
in TypeScript. The two sources disagree: the HCL files carry `description`
and a `filter` block but no `node`s; the TS version carries `node`s (with
float coordinates such as `57.934548314051284`) but no description/filter.

**Why it looks reasonable locally**

When the examples were embedded, the single-file example's diagrams had no
node coordinates, so a seed step was added to make the demo look good on
first open.

**Why it is problematic globally**

The documented single source of truth is not the source of truth for the
demo users see first; `rhizz check`/`rhizz-book` compile one set of
diagrams, the web app shows another. Updating the example requires editing
both and remembering the override exists.

**Potential simplification**

Move the node coordinates into `examples/single-file/diagrams/*.hcl` and
delete `EXAMPLE_SYSTEM_DIAGRAMS` / `seedExampleProjectDiagrams` and the
special case in `selectExample`.

**Evidence**

- `ProjectsPage.svelte:84–86`: `if (example.id === "single-file") await
  seedExampleProjectDiagrams(project.id);` immediately after
  `createProjectWithFiles(name, example.files)`.
- `examples/single-file/diagrams/overview.hcl` contains no `node` blocks.

---

### 9. "Primary model file" has four different definitions

**Impact:** Low–Medium

**Confidence:** High

**Locations:**
- `web/src/routes/projects/[id]/diagrams/+page.svelte` — `getPrimaryHclPath`
  (`["system.hcl","systems.hcl","main.hcl","project.hcl"]`, fallback
  `hclFiles[0]`, fallback `"main.hcl"`)
- `web/src/testing/WorkspaceHarness.ts` — `primaryHclFile` (same list, copy)
- `web/src/ProjectState.svelte` — `createProjectWithMainFile` seeds
  `main.hcl`
- `web/src/DocumentStore.svelte.ts` — always compiles the draft as
  `"system.hcl"`
- `crates/rhizz-cli/src/cli.rs` — `run_fmt` reads/writes `system.hcl` only
- `crates/rhizz-core/src/lib.rs` — `validate_single_system_model` (any
  filename; error if >1 file has `system` blocks); `SPEC.md` §1 (`system.hcl`
  or `main.hcl`)

**Problem**

The GUI creates `main.hcl`, the CLI formatter only knows `system.hcl`, the
editor's mutation path guesses among four names, and the compiler has no
notion of a primary file at all. A project created in the GUI and exported
to disk cannot be `rhizz fmt`-ed (the formatter would create a second
`system.hcl` beside `main.hcl` → E000 "multiple files define system
blocks" on the next check).

**Why it looks reasonable locally**

Each layer picked the name that its author needed at the time; the spec
allows both.

**Why it is problematic globally**

The concept is business logic ("which file holds the system model") that
lives in the frontends rather than in core, and the frontends disagree.

**Potential simplification**

Let `rhizz-core` report the model file (e.g. `CompileResult.model_source`)
or standardize on one name in both frontends; have `rhizz fmt` write back to
the file the system block came from.

**Evidence**

- `+page.svelte:1100–1103` and `WorkspaceHarness.ts:329–332` are identical
  lists.
- `cli.rs` `run_fmt`: `let model_path = path.join("system.hcl");`.
- `ProjectState.svelte:89–101`: seeds `"main.hcl"`.

---

### 10. Component path/key computation is implemented three times in Rust and twice in TypeScript

**Impact:** Low

**Confidence:** High

**Locations:**
- `crates/rhizz-core/src/model.rs` — `Model::component_key`
- `crates/rhizz-core/src/serialize.rs` — `component_path`, `endpoint_path`
- `web/src/DocumentStore.svelte.ts` — `compPath`, `buildConn.rel`
- `web/src/routes/projects/[id]/diagrams/geometry.ts` — `computeLcaConnection`
  (the inverse: splits keys and derives scope-relative endpoints)

**Problem**

Walking `parent` up to the owning system and joining labels with `/` is
written separately for keys, for definition labels, and for connection
endpoints, each with its own handling of the "no placement parent"
(definition-rooted) case. The TS side repeats the walk from the raw payload.

**Why it looks reasonable locally**

Each function needed a slightly different suffix/prefix rule (leading `/`
for endpoints, port label appended, root system included or not).

**Why it is problematic globally**

The diagram key space (W016 validation, layout persistence) and the
serialized endpoint syntax must agree by construction; they do today only
because the three walks happen to match. A change to path syntax (e.g. the
"isolated component trees" or annotation tasks in TODO) touches all five.

**Potential simplification**

One `Model::path_segments(id) -> (Vec<String>, Rooting)` in core with thin
formatters for key/endpoint/definition-label, exposed to JS so
`DocumentStore` does not recompute it.

**Evidence**

- `model.rs:223–253`, `serialize.rs:294–330`, `serialize.rs:554–605` share
  the same `match component.parent { Component → recurse, System → push
  label, None → stop }` loop.

---

### 11. Views are parsed by a second mini-framework inside `serialize.rs`

**Impact:** Low

**Confidence:** High

**Locations:**
- `crates/rhizz-core/src/parse.rs` — `attrs`, `first_label`, `ParseError`
  (typed codes), W015 emission for unknown child blocks
- `crates/rhizz-core/src/serialize.rs` — `parse_views`, `view_attrs`,
  `Raw*Attrs`, `parse_connection_side`
- `crates/rhizz-core/src/lib.rs` — `compile` maps `parse_views` errors to a
  generic E000 with a different message shape

**Problem**

View blocks are parsed in the serialization module with `anyhow` errors and
its own attribute-extraction helper (`view_attrs`, byte-for-byte the same as
`parse.rs::attrs` minus the error type). Unknown child blocks inside a
`view` are silently ignored (`_ => {}`), whereas the model parser emits
W015. The two parsers therefore give different feedback for the same class
of author mistake, and view parse failures lose the typed-code path that
`ParseError` was introduced to provide.

**Why it looks reasonable locally**

`parse_views` began life as the inverse of `serialize_views` for round-trip
tests, so it lived next to it; the model parser's `RawFile`/merge machinery
was not needed for a single-view file.

**Why it is problematic globally**

Two places to update for any HCL-level behaviour (unknown-attribute policy,
label rules, diagnostics), and a module named `serialize` that owns parsing.

**Potential simplification**

Move `parse_views` and its raw attrs into `parse.rs`, reuse `attrs`/
`first_label`/`ParseError`, and emit W015 for unknown blocks in views.

**Evidence**

- `serialize.rs:821–827` vs `parse.rs:392–395`: identical body.
- `serialize.rs:~920` `_ => {}` vs `parse.rs:536,605` W015 push.

---

### 12. Dead or vestigial surface

**Impact:** Low

**Confidence:** High

**Locations & items:**
- `web/src/vfs/tree.ts` — `buildTree`, `TreeNode`: no production caller
  (superseded by `vfs/pathTree.ts::buildPathTree`; only `tree.test.ts` uses
  it).
- `crates/rhizz-core/src/diagnostics.rs` — `Level::Note`, `Level::Help`
  never constructed; `Diagnostic::error` and `Diagnostic::warning` have
  identical bodies (severity comes from the code, so one constructor
  suffices).
- `crates/rhizz-core/src/diagnostics.rs` — `Diagnostic.line` is never set
  anywhere in core (`grep "line: Some"` → none), yet the CLI's
  `format_diagnostic`, `JsonDiagnostic`, the book's `NormDiagnostic` sort
  key, and the `SPEC.md` §7 example (`system.hcl:14`) all carry/format it.
  Either populate it from `hcl-rs` spans or drop it from the projections.
- `crates/rhizz-wasm/src/lib.rs` — accessors listed in finding 3 with zero
  application callers.
- `.hcl` discovery (`WalkDir` → `Vec<Source>`) written five times:
  `cli.rs::load_sources` (production), `rhizz-book/project.rs::collect_hcl`
  (production, different skip rules), and three test-only copies in
  `rhizz-core` (`parse.rs::parse_dir`, `lib.rs` tests `compile_dir`,
  `serialize.rs` tests `compile_dir`).

**Why it looks reasonable locally / Why it is problematic globally**

Each is small; together they are the residue of finished refactors that
remain compiled, linted, and tested. The `line` field is the notable one:
it advertises a capability (source locations) that no layer delivers, so
frontends and the spec are shaped around a field that is always `None`.

**Potential simplification**

Remove the dead helpers; either wire `line` from `hcl-rs` spans in `parse.rs`
or remove it from the projections and the SPEC example until it exists.

---

### 13. Specification documents describe a different frontend and API than the code

**Impact:** Low (but AGENTS.md directs every task to read SPEC first)

**Confidence:** High

**Locations:**
- `SPEC.md` §10 — names a desktop GUI crate `rhizz-gui` (does not exist)
- `SPEC/architecture.md` — WASM API `compile_sources(...)` (actual:
  `CompileResultJS.compile`), link to `gui.md` (missing file)
- `SPEC/frontend.md` — Three.js `SVGRenderer`, "Read-only", "Hardcoded
  examples", "No backend", `deno task build` (actual: Svelte SVG, full
  editor, VFS + `rhizz-server`, `npx vite build` via `just`)
- `SPEC.md` §7 / `SPEC/cli.md` — no mention of `rhizz fmt` or `rhizz watch`,
  both implemented in `cli.rs`
- `TASKS/TODO.md` — several tasks validate with `deno task check/build/test`
  while `Justfile` is the documented entry point

**Problem**

The repository's own instructions make SPEC the first thing an engineer or
agent reads; several sections describe an earlier architecture. Because SPEC
is also the input to `build.rs` for diagnostics, it is partly load-bearing,
which makes the stale parts easy to mistake for authoritative.

**Potential simplification**

Prune §10/architecture.md/frontend.md to the current crate list and the
actual WASM API; document `fmt`/`watch`; point tasks at `just`.

---

## Highest-value findings

1. **Frontend HCL emitter duplicates `rhizz_core::serialize_model` (Finding 1)** — already diverging (instance formatting, sort order, escaping); breaks `rhizz fmt` interoperability; every schema change is a three-place edit.
2. **Per-handler load→compile→TS-tree→emit→write pipeline with no failure gate (Finding 2)** — 12 copies, a data-loss path when the primary file does not compile, and a rename that bypasses the store's API and the debug action log.
3. **Hand-mirrored Rust model shapes in TS plus a half-used typed wrapper API (Finding 3)** — three untyped mirrors of `model.rs`, two parallel WASM access paths, unused accessors.
4. **Dead view-layout surface in `DocumentStore` next to the live `persistence.ts` layout model (Finding 4)** — action log never records layout changes; two shapes for `diagrams/*.hcl`.
5. **Scoring rule and report/diagnostic projections re-declared per frontend, with SPEC/impl disagreement (Finding 5)** — TS `completionScore` vs `score_component` vs SPEC §5; four score/diagnostic shapes; `DiagnosticJS` drops `file`/`line`.
6. **Two SVG renderers for the same diagram (Finding 6)** — editor markup vs `DiagramElements`; visual changes made twice.
7. **Example diagrams overridden by TS constants (Finding 8)** — embedded examples are not the source of truth the docs claim.
8. **"Primary model file" defined differently in GUI, CLI, harness and spec (Finding 9)** — GUI `main.hcl` vs `rhizz fmt` `system.hcl`.
9. **Seven independent load/compile/index blocks across routes (Finding 7)** — already the subject of a TODO task; resolve together with 1–4.

Findings 10–13 are low-cost clean-ups that reduce the number of places a
schema, path-syntax, or documentation change must touch.
