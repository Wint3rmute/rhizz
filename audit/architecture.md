# Architecture & Maintainability Audit — rhizz

Read-only audit of the `rhizz` repository (Rust workspace + Svelte/TypeScript
frontend). It is based on reading the documentation (`AGENTS.md`, `README.md`,
`SPEC.md`, `SPEC/`), the Rust crates (`rhizz-core`, `rhizz-cli`, `rhizz-server`,
`rhizz-wasm`, `rhizz-book`), the web frontend (`web/src`), the tests, the
Justfile, the CI workflows, and the Dockerfile.

The repository is generally well-factored: `rhizz-core` is a clean, I/O-free
compiler with a strict parse/resolve/validate/score pipeline; the frontend VFS
(`web/src/vfs`) has a clear id-based store layer, a path-based facade, and a
shared contract test; the diagram rendering is split into testable pure modules
(`geometry.ts`, `grid.ts`, `forceLayout.ts`, `visuals.ts`). The findings below
concentrate on system-level duplication that only becomes visible when looking
at the whole repository, particularly across the Rust/TypeScript boundary.

---

## 1. Two independent HCL writers for the system model

**Impact:** High

**Confidence:** High

**Locations:**

- `web/src/DocumentStore.svelte.ts` — `systemHcl` derived value and the
  `serializeComponentDef` / `serializeProtocol` / `serializePort` /
  `serializeMessage` / `serializeField` / `serializeConnection` helpers
  (`~L218–L590`).
- `crates/rhizz-core/src/serialize.rs` — `serialize_model` (`L43`) plus the
  per-block writers it calls.
- `crates/rhizz-wasm/src/lib.rs` — `ModelJS::to_hcl` (`L668`) and
  `serialize_model` (`L722`).
- `web/src/rhizz_wasm_wrapper.ts` — exports `serialize_model` (`L56`) but
  `DocumentStore.svelte.ts` imports only `compile_system`, `parse_views`, and
  `serialize_views` (`L5–L13`).
- `crates/rhizz-cli/src/cli.rs` — `format_project` (`L478`) uses
  `rhizz_core::serialize_model` for `rhizz fmt`.
- `web/src/testing/WorkspaceHarness.ts` (`L4`, `L271`) *does* use the Rust
  serializer.

**Problem**

There are two implementations of "resolved model → canonical HCL": the Rust
`serialize_model` (with a large test suite and a proptest round-trip harness)
and the hand-written TypeScript emitter in `DocumentStore.systemHcl`. The
frontend never uses the Rust writer for model writes, even though
`ModelJS.to_hcl()` / `serialize_model()` are exposed through WASM and the
`rhizz_wasm_wrapper.ts` already re-exports `serialize_model`. Only the test
harness (`WorkspaceHarness`) uses the Rust serializer; the real UI always
writes with the TypeScript emitter.

Both writers must agree on every defaulting/omission rule so that a project
edited in the browser and then formatted by `rhizz fmt` (or by the book
preprocessor / CLI) does not churn. These rules are duplicated by hand on the
TS side, e.g.:

- project block is only emitted if a field is non-default
  (`version !== "0.0.0"`, empty author list omitted) — `DocumentStore L224–L240`;
- `component.level` is omitted when equal to `1`, and `connection.level` when
  equal to `parentLevel + 1` — `L407`, `L581`;
- `border === "solid"`, `required === true`, `required === false` are
  conditionally emitted — `L399`, `L499`, `L503`;
- sibling ordering by `label.localeCompare` versus Rust's `label.cmp` (which
  sorts differently for non-ASCII labels).

None of these rules is verified against `serialize_model`. The Rust proptest
only proves `serialize_model ∘ compile ∘ serialize_model` idempotence for Rust;
the frontend tests assert the TS emitter's own expected strings. There is no
test that compiles a model, serializes it with both writers, and compares the
text.

**Why it looks reasonable locally**

`DocumentStore` holds an *editable, partially-resolved* tree
(`definitions`/`systems`/`components` with `source` references, transient
fields, and defaults not yet applied). Feeding that directly to
`serialize_model`, which consumes a fully resolved `Model`, is not a drop-in
call. Writing the emitter next to the editor also keeps the mutable model shape
and its HCL projection in one file.

**Why it is problematic globally**

`rhizz fmt`, `rhizz-cli`, the book preprocessor, `ModelJS.to_hcl`, and the
browser workbench all conceptually produce "the canonical system.hcl". Two of
those writers exist, so the canonical form is under-defined and can drift
silently. Drift is not hypothetical: the recent removal of `level` from
`system` blocks required two separate commits/paths
(`291284b refactor(core): drop level from system blocks` and
`8393a86 refactor(web): drop system level from DocumentStore`), i.e. the same
semantic change touched both writers. The `WorkspaceHarness`'s canonical
snapshot comes from Rust `serialize_model`, so the simulation invariants do not
observe the TS emitter's output at all — the emitter is effectively unverified
in the integration path.

**Potential simplification**

Make `rhizz-core` own the single model→HCL writer and have the frontend call
it. Either (a) route edits through a `DocumentStore`-shaped input that
`serialize_model` can consume from WASM (e.g. serialize the compiled
`Model`/`to_js()` payload instead of the editable tree), or (b) if the editable
tree must be serialized before compilation, extract the emitter into one shared
place and add a cross-check test that runs the same source through both writers
and asserts byte equality. Removing the TS emitter entirely is the simplest
architectural change.

**Evidence**

- `web/src/DocumentStore.svelte.ts:218` (`systemHcl`) and its six `private
  serialize*` helpers.
- `crates/rhizz-core/src/serialize.rs:43` (`serialize_model`).
- `crates/rhizz-wasm/src/lib.rs:668,722` (`to_hcl`, `serialize_model`).
- `web/src/rhizz_wasm_wrapper.ts:56,60` — `serialize_model` exported; the only
  non-test importer is `web/src/testing/WorkspaceHarness.ts:4`.
- `crates/rhizz-cli/src/cli.rs:478` — `rhizz fmt` writes `system.hcl` from the
  Rust serializer.
- `crates/rhizz-core/tests/proptest_serialization.rs` — round-trip only over
  the Rust writer.

---

## 2. The frontend reimplements core model semantics (scoring and reference resolution)

**Impact:** High

**Confidence:** High

**Locations:**

- `web/src/routes/projects/[id]/inventory/inventory.ts` —
  `completionScore` / `completionBadge` (`L70–L90`).
- `crates/rhizz-core/src/score.rs` — `score_component` (`L11`).
- `web/src/DocumentStore.svelte.ts` — `findContainer` (`~L600`),
  `loadFromRawModel`'s `parentOfComp` / `rootSystemOfComp` / `compPath` /
  `buildConn` (`~L1104–L1180`).
- `crates/rhizz-core/src/model.rs` — `component_keys` / `component_key`
  (`L223–L253`).
- `crates/rhizz-core/src/resolve.rs` — the authoritative reference-resolution
  pass (SPEC.md §3).

**Problem**

Two pieces of `rhizz-core` business logic are re-implemented in TypeScript:

1. **Component completion scoring.** `inventory.ts` computes a per-definition
   badge with its own recursive `completionScore`, whose comment openly states
   it "mirror[s] `rhizz-core`'s documented `score_component` semantics …
   `rhizz-wasm` only exposes aggregate category scores, so this is computed
   locally". That re-implementation also differs in scope: it scores only
   definition subtrees, while `score_component` runs over definitions *and*
   placed instances, so a per-card badge can disagree with the aggregate
   percentages shown elsewhere.
2. **Component path / reference resolution.** `DocumentStore.loadFromRawModel`
   rebuilds a parent index and a `/`-joined path for every component
   (`parentOfComp`, `compPath`) to re-emit connection endpoints as
   scope-relative paths, and `findContainer` resolves `/`-separated component
   paths against the editable tree. Rust already owns exactly this concept:
   `Model::component_keys` produces the same path shape (and is the key space
   the view validator W016 checks), and `resolve.rs` owns SPEC §3 reference
   resolution.

**Why it looks reasonable locally**

The Inventory page has only the raw JSON payload and the typed aggregate score,
so computing a per-card badge locally is the path of least resistance. The
editor needs scope-relative endpoint strings (`from`/`to`) that are not part of
the `Model` API, so it derives them from the arena payload it already has.

**Why it is problematic globally**

The whole point of the frontend contract in `SPEC/architecture.md`
("Do not duplicate logic — if behaviour needed by a frontend is missing from
`rhizz-core`, add it there instead of implementing it in the frontend") is that
model semantics have exactly one tested implementation. Here the semantics live
in two languages and two test suites. Scoring is especially risky because it is
user-visible as a percentage/badge and any rule change (e.g. how ports affect
leaf completeness, or how instances are counted) now requires a coordinated
Rust + TypeScript change with no cross-language test. Path derivation is risky
because it is the key space diagrams persist: if the TS derivation ever
disagrees with `component_keys`, saved node positions silently detach from the
wrong components.

**Potential simplification**

Expose the missing derived data through `rhizz-wasm` instead of recomputing it:
a `component score` accessor on `ModelJS`/`ComponentJS`, and the per-component
key as a getter on `ComponentJS` (or return `{ key, index }` pairs). Then
delete `completionScore` and `compPath`/`findContainer`'s path logic and let the
frontend consume core-derived values.

**Evidence**

- `web/src/routes/projects/[id]/inventory/inventory.ts:70` — explicit comment
  that the function mirrors `score_component`.
- `crates/rhizz-core/src/score.rs:11` — the original rule.
- `web/src/DocumentStore.svelte.ts:1104–1180` — `parentOfComp`, `compPath`,
  `buildConn`.
- `crates/rhizz-core/src/model.rs:223` — `component_keys`, described as "the
  key space the view validator checks (W016)".
- `SPEC/architecture.md` "Frontend Contract", point 4.

---

## 3. Two overlapping representations of the compiled model cross the WASM boundary, and the JSON one is hand-mirrored (and copied again)

**Impact:** Medium-High

**Confidence:** High

**Locations:**

- `crates/rhizz-wasm/src/lib.rs` — typed `*JS` wrapper structs
  (`ComponentJS`, `PortJS`, `ConnectionJS`, `ProtocolJS`, `SystemJS`) with
  getters, and `ModelJS::to_js` / `from_js` / `to_json` (`~L700–L720`).
- `web/src/DocumentStore.svelte.ts` — `RawModelPayload` (`L156–L217`) and
  `loadFromRawModel` (`L1094`), fed by `model.to_js() as RawModelPayload`
  (`L1289`).
- `web/src/routes/projects/[id]/inventory/Inventory.svelte` —
  `RawComponent` / `RawPort` / `RawConnection` / `RawModel` (`L38–L60`), with
  the comment "mirrors `RawModelPayload` in DocumentStore.svelte.ts; duplicated
  here so Inventory does not instantiate a mutable DocumentStore", fed by
  `model.to_js() as RawModel` (`L116`).
- `web/src/rhizz_wasm_wrapper.ts` — hand-written `NodeLayout`,
  `ConnectionLayout`, `Annotation`, `ViewFilterDefinition`, `ViewDefinition`
  (`L9–L46`); the generated `pkg/rhizz_wasm.d.ts` declares
  `parse_views(hcl: string): any` and `serialize_views(views: any): string`, so
  these types are not generated from Rust at all.

**Problem**

A compiled model reaches the frontend in two forms:

1. **Typed WASM wrappers** (`ModelJS.components()`, `.connections()`,
   `.ports()`, `.score()`, `.component_keys()`), used for rendering.
2. **The raw serde JSON payload** (`model.to_js()`), used whenever the frontend
   needs structural information the wrappers omit — `ComponentJS` has no
   `children`, `ports`, or `connections` arrays, and no per-entity score, so
   `DocumentStore.loadFromRawModel` and the Inventory page fall back to
   `to_js()`.

The raw payload's schema is then transcribed by hand in TypeScript, twice
(`RawModelPayload` and Inventory's `RawModel`), including serde-specific details
such as `kind?: string`, `field_type?: string`, and
`parent?: { Component?: number; System?: number }`. The *view* DTOs
(`ViewDefinition` et al.) are likewise hand-declared because the generated
bindings for `parse_views`/`serialize_views` are `any`.

**Why it looks reasonable locally**

`to_js()` is already available and is a one-line escape hatch that exposes the
entire Rust model shape without adding new WASM getters. Re-declaring the
needed subset locally in Inventory avoids importing the mutable `DocumentStore`
just for a type. Hand-declaring view types is necessary because
`serde_wasm_bindgen` returns `any`.

**Why it is problematic globally**

There are now three ways to describe a component to the frontend (typed getter,
`RawModelPayload`, Inventory's `RawModel`), and two ways to describe a view
(hand-written TS + Rust `ViewDefinition`). Every Rust field rename or new field
must be reflected manually in up to three TS declarations, with no
compiler-enforced link. Because the typed wrappers are incomplete, the "typed
binding" abstraction does not actually serve its purpose for the editor and
Inventory: those consumers bypass it, so the two APIs can drift (the typed API
can gain/lose fields without the raw payload following). The generated `any`
types for views make the view round-trip (`parse_views` → edit →
`serialize_views`) entirely unchecked at the type level.

**Potential simplification**

Complete the typed wrapper API (`children`/`ports`/`connections` index arrays,
`CategoryScore.total`, per-component key/score) so the frontend never needs
`to_js()`, and generate TS types for the view DTOs (e.g. `ts-rs`/`typeshare`, or
`serde_wasm_bindgen` per-struct wrappers as was done for the model). Then delete
`RawModelPayload` and Inventory's copy.

**Evidence**

- `crates/rhizz-wasm/src/lib.rs:582–640` (`ComponentJS` fields, no
  children/ports/connections).
- `crates/rhizz-wasm/src/lib.rs:712–720` (`to_js`/`from_js`).
- `web/src/DocumentStore.svelte.ts:156,1289`.
- `web/src/routes/projects/[id]/inventory/Inventory.svelte:39,116`.
- `crates/rhizz-wasm/pkg/rhizz_wasm.d.ts:412,417` — `any` return types for the
  view functions.

---

## 4. Every route reads and compiles the whole project independently (and re-derives the same stats)

**Impact:** Medium

**Confidence:** High

**Locations:**

- `web/src/routes/projects/[id]/diagrams/+page.svelte:157`
- `web/src/routes/projects/[id]/diagrams/embed/[...diagram]/+page.svelte:46`
- `web/src/routes/projects/[id]/explore/Explore.svelte:177`
- `web/src/routes/projects/[id]/inventory/Inventory.svelte:95`
- `web/src/routes/projects/[id]/overview/+page.svelte:18`
- `web/src/routes/projects/[id]/editor/+page.svelte:98`
- `web/src/routes/book-example/BookExampleView.svelte:41–62`
- Derived-stats copies: `web/src/routes/projects/[id]/overview/+page.svelte:38–71`
  (`catTotal`, `catPct`, `toCat`, `lastModel` stale handling),
  `web/src/routes/projects/[id]/editor/+page.svelte` (same helpers),
  `web/src/components/CompletionBreakdown.svelte:121`,
  `web/src/routes/book-example/BookExampleView.svelte:105`.

**Problem**

Six route components (plus the book-example view) each independently implement
the same pipeline: `readProjectSources(fs)` → `compile_system(sources)` →
`model()` / `diagnostics()` / `score()`, with their own `$effect` bodies,
cancellation flags, and error handling. The derived-data helpers around this
pipeline are also duplicated: category totals
(`complete + partial + incomplete`), "overall complete" counts, leaf/composite
counts, and the "keep the last successfully compiled model so stats survive
syntax errors" logic appear in both `overview` and `editor` (with slightly
different implementations), and the per-category total is recomputed again in
`CompletionBreakdown.svelte`, `BookExampleView.svelte`, and `overview`.

**Why it looks reasonable locally**

Each page is an independent Svelte route that should stand alone, and the
compile call is a one-liner over a WASM function. Copying the small loader
effect is less work than designing a shared reactive context, and pages that
need different behaviour (the editor patches in live editor content for the
open file; the embed page tolerates compile crashes) legitimately diverge.

**Why it is problematic globally**

The project source set is a single logical input, but it is re-read, re-parsed,
re-resolved, re-validated, and re-scored once per route, and each copy has its
own race/cancellation and stale-model handling — one of which (`lastModel`)
exists on only some pages. This is exactly the kind of "locally sensible,
globally redundant" duplication that makes changes expensive: a change to how
sources are gathered or how compile failures are surfaced must be replicated
across seven call sites, and any missed site behaves subtly differently. It also
means cross-view consistency (the same diagnostics/score in every pane) is an
accident rather than a guarantee.

**Potential simplification**

Hoist `sources` + `compile_system` output + derived stats into one reactive
project context (a single `.svelte.ts` module or a layout-level context), and
have each route consume it. Keep the per-route specifics (live-content patching
in the editor, crash tolerance in the embed) as small, explicit inputs to that
one pipeline. This is also the direction the repo's own `TASKS/TODO.md`
"Modular multi-pane workspace with shared reactive context" task points at.

**Evidence**

- `grep -n "readProjectSources(" web/src` → 13 call sites; five of them are
  route loaders, one is repeated nine times inside the diagrams page.
- `overview/+page.svelte:38–71` vs `editor/+page.svelte` — duplicate
  `catTotal`/`toCat`/`leafCount`/`compositeCount`/`lastModel`.
- `BookExampleView.svelte:105` and `CompletionBreakdown.svelte:121` recompute
  category totals that Rust already computes in `CategoryScore::total`.

---

## 5. Model and layout edits are ad-hoc read-modify-write transactions, tracked by three separate mutation mechanisms

**Impact:** Medium-High

**Confidence:** High

**Locations:**

- `web/src/routes/projects/[id]/diagrams/+page.svelte` — nine repetitions of
  `readMainContent()` → `new DocumentStore()` → `loadFromHcl()` → mutate →
  `fs.writeFile(path, doc.systemHcl)` → `sources = await readProjectSources(fs)`
  (e.g. `L1126–1137`, `L1147–1155`, `L1253–1292`, `L1328–1371`, `L1364–1393`,
  `L1383–1418`, `L1410–1418`, `L1509–1527`, `L2139–2168`).
- `web/src/testing/WorkspaceHarness.ts:274–289` — the same transaction
  re-implemented for the test harness.
- Undo/redo: `web/src/routes/projects/[id]/diagrams/history.ts` and
  `+page.svelte:780–847` (`diagramHistory`, `recordUndoPoint`).
- Debug log: `web/src/actionLog.ts`, subscribed through
  `DocumentStore.subscribeToMutations` (`DocumentStore.svelte.ts:30–48`,
  wired at `+page.svelte:112`).
- Save-race guard: `diagramEditStamp` / `noteDiagramEdited` in `+page.svelte`
  (`L393–399`).

**Problem**

There is no single persistence/transaction boundary. Each editing handler
re-implements the same "load → mutate → serialize → write → recompile" cycle
inline, so error handling, re-entrancy, and post-write state refresh are
copy-pasted rather than centralized. Alongside it, three different mechanisms
observe overlapping-but-not-identical sets of edits:

- `diagramHistory` snapshots only `checked`, `savedLayout`, and
  `savedConnections` — notably **not** `annotations`;
- `actionLog` records `DocumentStore` mutations via a module-level observer, so
  it captures model mutations but only the layout writes that go through
  `DocumentStore`;
- `diagramEditStamp` tracks "any edit" for a load-race guard.

Because the three trackers use different keys and different scopes, they can —
and already do — disagree. For example, adding/deleting an annotation calls
`noteDiagramEdited()` but not `recordUndoPoint()`, so `Ctrl+Z` does not restore
annotation changes, while the action log and the race guard do see them.

**Why it looks reasonable locally**

Each handler needs a slightly different mutation (reparent, add system, create
component, edit port, delete connection), and a five-line inline transaction is
easier to read than a generic dispatcher. The three observers were each added
for a specific local need: undo for canvas gestures, the action log for the
"Copy Debug Info" reproduction feature, and the stamp for a specific
async-load race.

**Why it is problematic globally**

Model and layout state are one document from the user's perspective, but the
repository has no single place that owns "how an edit is applied and recorded".
Consequently: (a) each new mutation type must re-derive the transaction
boilerplate and remember to call all three tracking hooks (easy to miss, as the
annotation case shows); (b) the same logical edit is described in three
incompatible vocabularies (`DiagramSnapshot`, `ModelAction`, `diagramEditStamp`)
that can drift; (c) `WorkspaceHarness` re-implements the transaction, so the
simulation tests exercise a parallel copy rather than the production path.

**Potential simplification**

Introduce one command/transaction layer that owns a mutation as a single unit —
apply it to the in-memory model, derive the canonical HCL, persist, and record
one history entry usable for undo *and* for the debug log (they can share one
action description). Have all page handlers dispatch through it. This is the
"Unified command-based transaction history" task already queued in
`TASKS/TODO.md`, and the current duplication is the concrete evidence for it.

**Evidence**

- Nine identical read-modify-write blocks in `+page.svelte` (line numbers
  above).
- `snapshotDiagram()` at `+page.svelte:783` omits `annotations`; annotation
  handlers (`+page.svelte:739–758`) never call `recordUndoPoint()`.
- `DocumentStore.svelte.ts:30–48` mutation observer + `+page.svelte:112`
  subscription → `actionLog`.
- `WorkspaceHarness.ts:274–289` duplicating `handleUpdateSelectedComponent`.

---

## 6. The CLI JSON report and the book's `score_json` implement the same JSON contract twice

**Impact:** Medium

**Confidence:** High

**Locations:**

- `crates/rhizz-cli/src/cli.rs:252–292` (`JsonCategoryScore`, `JsonOverallScore`,
  `JsonScore`) and the construction at `L353–385`.
- `crates/rhizz-book/src/compile.rs:100–130` (`score_json`).

**Problem**

The `rhizz --json build` report shape (nested `complete`/`total` per category,
`overall.complete/total/percent`, one-decimal rounding of `percent`, and the
`system` key) is built twice: once from the `JsonScore` serde structs in the
CLI and once by hand with `serde_json::json!` in the book preprocessor. The
book's doc comment even says it builds "the same shape as `rhizz --json build`
(keys inserted alphabetically, matching the historical lock writer)". The
`book.lock` verification depends on the book's copy staying in sync with
whatever consumers expect from the CLI.

**Why it looks reasonable locally**

The CLI wants typed serde structs; the book wants a `serde_json::Value` to write
into its lock file, and the historical lock writer inserted alphabetically. The
two live in different crates with no shared "report JSON" module.

**Why it is problematic globally**

The JSON report is a published contract (`--json` is documented as "for CI/CD
integration"). Two independent constructors mean a change to the report (a new
category, a different rounding rule, dropping `system`) must be made in two
places; a missed one silently produces two different JSON shapes from the same
tool. Because `book.lock` is generated from the book's copy, a divergence could
even be accepted into the lock without the CLI agreeing.

**Potential simplification**

Move a single `ScoreReport → serde_json::Value` (or a `#[derive(Serialize)]`
`JsonScore`) into `rhizz-core` next to `ScoreReport`, and have both the CLI and
the book call it.

**Evidence**

- `crates/rhizz-cli/src/cli.rs:252–292,353–385`.
- `crates/rhizz-book/src/compile.rs:100–130` (the "same shape as `rhizz --json
  build`" comment and the duplicated rounding `(x * 10.0).round() / 10.0`).
- `crates/rhizz-book/src/compile.rs` tests assert the expected JSON literally.

---

## 7. Diagram-layout projections, view-name helpers, and primary-file selection are each implemented several times

**Impact:** Medium

**Confidence:** High

**Locations:**

- Layout → canvas boxes (three copies):
  `web/src/routes/projects/[id]/diagrams/persistence.ts:66`
  (`mapLayoutToBoxes`),
  `web/src/routes/projects/[id]/inventory/Inventory.svelte:218–233`
  (`previewBoxes`),
  `web/src/routes/projects/[id]/explore/Explore.svelte:313–330` (`boxes`).
- View / diagram name derivation (four copies):
  `persistence.ts:103` (`viewNameFromPath`),
  `web/src/routes/projects/[id]/explore/navigation.ts:3–25`
  (`withoutHclSuffix`, `diagramTitle`),
  `web/src/routes/projects/[id]/inventory/inventory.ts:11`
  (`defaultDiagramPath`),
  `web/src/routes/projects/[id]/diagrams/embed/[...diagram]/+page.svelte:25–28`
  (extension normalization).
- Primary model-file selection (two copies):
  `web/src/routes/projects/[id]/diagrams/+page.svelte:1089`
  (`getPrimaryHclPath`, preferred list
  `["system.hcl","systems.hcl","main.hcl","project.hcl"]`),
  `web/src/testing/WorkspaceHarness.ts:291` (`primaryHclFile`, identical list).
- Path-segment validation (two copies):
  `web/src/routes/projects/[id]/editor/+page.svelte`
  (`sanitizeSegmentName` / `joinPath`),
  `web/src/routes/projects/[id]/diagrams/+page.svelte`
  (`sanitizeDiagramSegmentName` / `joinDiagramPath`).

**Problem**

The same small projections are re-derived per consumer instead of being owned by
one module: `DiagramLayout.checked` (key → `StoredBox`) is converted to
arena-indexed boxes in three places; a VFS diagram filename is reduced to a view
name / title in four; and "which file holds the model" is computed twice from
an identical priority list.

**Why it looks reasonable locally**

Each page has only the slice of data it needs and does not want to depend on the
persistence module (Inventory explicitly avoids importing `DocumentStore`).
Extracting a shared helper for two lines of mapping can feel like
over-abstraction, and each page's `defaultWidth`/`defaultHeight` may differ.

**Why it is problematic globally**

These mappings encode cross-cutting conventions — which `DiagramLayout` field
means what, how a diagram file maps to a view label, and which file is the
project's primary model file. Duplicating them means a change to the persisted
layout representation or to the file-naming convention has to be found and
updated in every copy, and the copies can silently drift (the box mappers
already differ in the defaults they hardcode). The primary-file duplication is
concrete evidence that drift is a live risk: the `WorkspaceHarness` copy must be
updated in lockstep with the page's copy or the simulation tests would read a
different file than the UI writes.

**Potential simplification**

Export the box projection and the name/path helpers from
`diagrams/persistence.ts` (or a small `project/paths.ts`) and have all consumers
call them. `mapLayoutToBoxes` already exists and is already imported by
`BookExampleView`; Inventory and Explore just do not use it.

**Evidence**

- `persistence.ts:66` vs `Inventory.svelte:218` vs `Explore.svelte:313`.
- `+page.svelte:1089` vs `WorkspaceHarness.ts:291` — identical preferred-file
  lists.
- `persistence.ts:103`, `navigation.ts:3`, `inventory.ts:11`, embed page `L25`.

---

## 8. Long-lived documentation describes an architecture the code no longer has

**Impact:** Medium

**Confidence:** High

**Locations:**

- `SPEC/architecture.md` — workspace layout lists only `rhizz-core`,
  `rhizz-cli`, `rhizz-wasm` and "additional frontends (LSP, …)"; there is no
  `rhizz-server` or `rhizz-book`. It links to a non-existent `gui.md`, and
  documents the wasm API as `compile_sources(sources: JsValue) -> JsValue`.
- `SPEC/frontend.md` — describes a "Prototype", "Read-only — no editing
  capabilities", "No backend — everything runs client-side", "No file I/O",
  a Three.js `SVGRenderer`, and a `web/dist/` build output.
- `SPEC.md:700` — "available as … a desktop GUI application (`rhizz-gui`)".
- `SPEC/architecture.md` "Frontend Contract", point 4 — "Do not duplicate
  logic".

**Problem**

The specification documentation is treated as the source of truth
(`AGENTS.md` instructs agents to read `SPEC.md` and `SPEC/`), but central
architectural documents are stale: they describe a read-only prototype with no
backend and a Three.js renderer, list a workspace that is missing two of the
five crates, reference a `gui.md` that does not exist, and document a WASM entry
point (`compile_sources`) that has been replaced by `CompileResultJS` + typed
wrapper structs. At the same time the "Frontend Contract" rule forbids exactly
the duplication that findings 1–3 document.

**Why it looks reasonable locally**

`SPEC.md` is the stable bird's-eye spec; `SPEC/*.md` were written for an earlier
prototype and were not revisited as the frontend grew an editor, a server, and a
compiler-driven workbench. Nothing in CI checks that the docs reflect the
crates.

**Why it is problematic globally**

The repository explicitly directs both humans and AI agents to the spec before
making changes. A stale spec is therefore not cosmetic: it causes contributors
to reintroduce removed concepts (three.js, `rhizz-gui`, `compile_sources`),
under-specifies the actual frontend/server boundary, and makes the documented
"frontend contract" look self-contradictory (the docs forbid duplication while
the code contains it). This is a maintenance cost that grows with every
architectural change that is not mirrored into the docs.

**Potential simplification**

Either regenerate/trim `SPEC/frontend.md` and `SPEC/architecture.md` to describe
the current crates and WASM API (or delete the stale sections and point at
`README.md`/code), and either fix or drop the `rhizz-gui` mention in `SPEC.md`.
Adding a lightweight CI check that the documented crate list matches the
workspace members would prevent recurrence.

**Evidence**

- `SPEC/architecture.md` crate list and `gui.md` link; `compile_sources`
  signature section.
- `SPEC/frontend.md` "Current Scope (Prototype)" and "Rendering Pipeline"
  (Three.js).
- `SPEC.md:700` (`rhizz-gui`).
- `Cargo.toml` workspace members (five crates, no `rhizz-gui`);
  `crates/rhizz-wasm/src/lib.rs` (the real API).

---

## 9. The simulation harness and Storybook coverage exercise parallel implementations, not the production paths

**Impact:** Medium

**Confidence:** Medium

**Locations:**

- `web/src/testing/WorkspaceHarness.ts` — `dispatch` handles `select-component`,
  `set-node-visuals`, `move-node`, `add-diagram-view` (`L134–169`);
  `move-node` only writes `this.#layout` (`L161–166`), `add-diagram-view` only
  writes `this.#diagrams` (`L167–169`).
- `web/src/testing/simulation.test.ts` — the 500-sequence property test.
- `web/src/routes/projects/[id]/diagrams/+page.svelte` — the real handlers for
  the same operations.

**Problem**

The "deterministic workspace simulation" only routes `set-node-visuals` through
the production code (`DocumentStore.updateComponent` + `fs.writeFile` +
`recompile`). Node moves and diagram creation are modeled as writes to harness-
local `Map`/`Set` fields with no persistence, serialization, or compilation
step. The harness's `assertInvariants` compares Rust `serialize_model` output to
Rust `serialize_model` output after recompilation (`roundTripSnapshot`), so the
diagram-layout persistence path — the part of the product with the most
read-modify-write complexity (finding 5) — is not exercised at all. Layout
persistence goes through the TypeScript HCL emitter (finding 1), which the
harness never checks.

**Why it looks reasonable locally**

Building a headless harness that can drive a full Svelte route is expensive;
modeling the workspace state directly gives fast, deterministic property tests
over the model-edit invariants that were the original goal (visual mutation
isolation, referential integrity, round-trip fidelity).

**Why it is problematic globally**

A test harness that re-implements workspace semantics is a second
implementation of the system under test. It gives confidence about the harness's
own simplified model, not about the editor: a regression in the page's
move/persist path, in the TS HCL emitter, or in the layout load/save race guard
would not be caught by the simulation. Combined with finding 5 (nine inline
transactions, three trackers), the harness is the place where the divergence
would be most useful to detect, but it bypasses it.

**Potential simplification**

Drive the real mutation/persistence layer from the harness (extract the
transaction layer from finding 5 into a headless module that both the page and
the harness call), and assert on the persisted HCL text (which would also
cross-check the Rust and TS writers). Alternatively, scope the harness explicitly
to what it does test and drop the parts that only simulate.

**Evidence**

- `WorkspaceHarness.ts:161–169` — `move-node` / `add-diagram-view` write only
  harness-local state.
- `WorkspaceHarness.ts:243–263` — `assertInvariants` uses
  `roundTripSnapshot`, which feeds `serialize_model` output back into
  `compile`/`serialize_model`; the on-disk TS-emitted HCL is never compared.
- `simulation.test.ts:77–110` — the only persisted path is `set-node-visuals`.

---

## Highest-value findings

Ordered by expected impact:

1. **Two independent HCL writers for the system model** (finding 1) — the
   canonical output of the product is defined twice, in Rust and TypeScript,
   with no cross-check; already caused coordinated dual edits.
2. **Frontend reimplements core model semantics** (finding 2) — scoring and
   component-path resolution are duplicated across the WASM boundary, in direct
   contradiction of the documented frontend contract.
3. **Ad-hoc read-modify-write transactions plus three competing mutation
   trackers** (finding 5) — the highest-churn area of the codebase (the diagram
   editor) has no single transaction/history owner, and the trackers already
   disagree (annotations vs undo).
4. **Two overlapping model representations across WASM, with hand-mirrored
   DTOs** (finding 3) — every Rust model-field change ripples into hand-written
   TypeScript, and the typed wrapper API is incomplete enough to be bypassed.
5. **Per-route read+compile+derive duplication** (finding 4) — the same project
   pipeline and stats are copied across seven components with divergent
   staleness/error handling.
6. **Duplicated CLI/book JSON report contract** (finding 6) — a published
   `--json`/`book.lock` shape is constructed twice.
7. **Repeated layout/path/primary-file projections** (finding 7) — small but
   cross-cutting conventions cloned per consumer.
8. **Stale architectural documentation treated as source of truth** (finding 8)
   — actively misleads contributors and agents about the crate list, the WASM
   API, and the frontend's capabilities.
9. **Simulation harness exercises a parallel implementation** (finding 9) —
   reduces the value of the repository's most sophisticated test as a guard for
   findings 1 and 5.

No findings are reported for purely stylistic preferences, naming, line counts,
or speculative performance work. The VFS/store abstraction, the pure
diagram-geometry modules, the `rhizz-core` pipeline, and the diagnostic
single-sourcing (generated from `SPEC/diagnostics/*.md`) were reviewed and are
not considered problematic.
