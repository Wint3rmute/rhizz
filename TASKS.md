# Implementation Tasks

How to work on this file:

- Read the next task from this file
- Get extra context from recently finished tasks - read the first 50 lines of
  `FINISHED_TASKS.md`
- Implement the task, use red/green TDD
- Run tests & linters (`cargo test`, `cargo clippy`, `cargo doc`, `cargo build`)
  until it's all working
- Once all linters/builds/tests pass, run `cargo fmt`
- Move the completed task to `FINISHED_TASKS.md` and report that you're finished

---

## Task 31 — Fix `score_component` leaf scoring to match spec

**Spec reference**: `SPEC.md` §5 "Completion Scoring" — Per-Entity Completeness
table (lines 400–409).

**What the spec says**:

| Condition | Score |
|-----------|-------|
| Leaf — no description | **Incomplete (0.0)** |
| Leaf — has description, ≥1 port incomplete | **Partial (0.5)** |
| Leaf — has description, all defined ports complete (or no ports) | **Complete (1.0)** |

The spec also explicitly notes: "A leaf component with a description and no ports
scores Complete (1.0) — ports are optional detail."

**What the code does** (`crates/rhizz-core/src/score.rs`, `score_component`, lines
12–19):

```rust
if comp.leaf {
    if comp.description.is_empty() {
        0.5   // ← should be 0.0 (Incomplete)
    } else {
        1.0   // ← ignores port completeness entirely
    }
}
```

Two mismatches:

1. A leaf with **no description** returns `0.5` (Partial) but the spec requires
   `0.0` (Incomplete).
2. A leaf with a description but **at least one incomplete port** returns `1.0`
   (Complete) but the spec requires `0.5` (Partial).

**Acceptance criteria**:

- `score_component` for a `leaf = true` component with an empty description must
  return `0.0`.
- `score_component` for a `leaf = true` component that has a description and one
  or more ports where `score_port` < 1.0 must return `0.5`.
- `score_component` for a `leaf = true` component that has a description and either
  no ports or all ports scoring 1.0 must return `1.0`.
- Update (or add) unit tests in `score.rs` that cover all three branches for leaf
  components, including the "leaf with description and no ports → 1.0" case called
  out in the spec note.
- All existing tests continue to pass (note: the existing
  `leaf_component_with_description_scores_1` test currently expects `partial: 1`
  for a leaf with no description — that assertion must be updated to `incomplete: 1`).

---

## Task 29 — Reconcile `rhizz-wasm` public JS API with spec

**Spec reference**: `SPEC/architecture.md` — **Wasm-specific notes** (lines 129–132,
139–140) and **§ `rhizz-wasm` › Public API (JavaScript)** (lines 149–162).

**What the spec says**:

- The crate exposes a **single free-standing function** named `compile_sources`,
  callable from JS as:
  ```ts
  import init, { compile_sources } from "./rhizz_wasm.js";
  const result = compile_sources([{ filename, content }, …]);
  // result: { model: Model | null, diagnostics: Diagnostic[] }
  ```
- The return value is a **plain JS object** (serialised via `serde-wasm-bindgen`);
  the spec notes "callers … receive the compiled result back as a plain JS object."

**What the code does** (`crates/rhizz-wasm/src/lib.rs`):

- Exposes a **static method** `CompileResultJS::compile(sources)` on a typed
  `#[wasm_bindgen]` class — not a free function.
- Returns a `CompileResultJS` instance (a typed wasm-bindgen class) whose members
  are accessed via method calls (`result.diagnostics()`, `result.model()`), not as
  plain object properties.
- The JS import would be `import { CompileResultJS } from "./rhizz_wasm.js"`, not
  `{ compile_sources }`.

**Acceptance criteria**:

- Either update the spec (`SPEC/architecture.md`) to reflect the current typed-class
  API design (preferred if the typed API is intentional), **or** add a free-standing
  `#[wasm_bindgen]` `compile_sources` function that returns a serialised plain JS
  object and adjust the class-based API accordingly.
- The chosen approach must be consistent across both the **Wasm-specific notes**
  bullet (line 129–132) and the **Public API (JavaScript)** code sample (lines
  153–161).
- At least one `wasm_bindgen_test` must exercise the final JS-visible entry point
  using the name and calling convention documented in the spec.

---

## Task 30 — Fix `show_messages` default: should be `true`, not `false`

**Spec reference**: `SPEC.md` §2.8 `view` Block — `filter` sub-block attribute
table (line 342).

**What the spec says**:

> | `show_messages` | bool | no | `true` | Whether to list messages … |

The default value for `show_messages` when the attribute is omitted is **`true`**.

**What the code does** (`crates/rhizz-core/src/resolve.rs`, line 833):

```rust
show_messages: f.show_messages.unwrap_or(false),
```

The fallback is `false`, so any view that omits `show_messages` silently suppresses
message labels on edges — the opposite of what the spec requires.

**Acceptance criteria**:

- Change `unwrap_or(false)` to `unwrap_or(true)` in `resolve_view` in
  `crates/rhizz-core/src/resolve.rs`.
- Add or update a unit/integration test that verifies a view with no explicit
  `show_messages` attribute does show message labels on edges in the rendered DOT
  output (i.e. the rendered edge label contains message names).
- All existing tests continue to pass.

---

## Task 32 — Fix `field.required` default: should be `true`, not `false`

**Spec reference**: `SPEC.md` §2.7 `field` Block — attribute table (line 302).

**What the spec says**:

> | `required` | bool | no | `true` | Whether the field is mandatory in the message |

The default value for `required` when the attribute is omitted is **`true`**.

**What the code does** (`crates/rhizz-core/src/resolve.rs`, line 790):

```rust
required: lf.inner.required.unwrap_or(false),
```

The fallback is `false`, so any field that omits `required` is silently treated
as optional — the opposite of what the spec requires.

**Acceptance criteria**:

- Change `unwrap_or(false)` to `unwrap_or(true)` at the `required` field
  assignment in `resolve_field` / `resolve_message` in
  `crates/rhizz-core/src/resolve.rs`.
- Add or update a unit test that parses a `field` block with no explicit
  `required` attribute and asserts the resolved `Field::required` is `true`.
- Add a complementary test that parses a `field` block with `required = false`
  and asserts the resolved value is `false`, confirming explicit overrides still
  work.
- All existing tests continue to pass.

---

## Task 33 — Reconcile `SPEC/frontend.md` `CompileResultJS` interface with implementation

**Spec reference**: `SPEC/frontend.md` — **Typed bindings via wrapper structs** (lines 95–106).

**What the spec says**:

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

**What the code does** (`crates/rhizz-wasm/src/lib.rs`):

The implementation diverged from this interface. `CompileResultJS` does **not** expose
`has_model()`, `components()`, or `score()`. Instead it exposes `model() -> Option<ModelJS>`,
and `components()` / `score()` live on the `ModelJS` struct. The frontend
(`web/src/rhizz_wasm_wrapper.ts`, `web/src/routes/overview/+page.svelte`,
`web/src/components/ModelComponentsOutline.svelte`) already calls the implementation's
API — so `SPEC/frontend.md` is stale.

| Method | Spec | Impl |
|---|---|---|
| `has_model() -> bool` | present | absent |
| `components() -> Vec<ComponentJS>` | on `CompileResultJS` | on `ModelJS` |
| `score() -> Option<ScoreReportJS>` | on `CompileResultJS` | on `ModelJS` |
| `model() -> Option<ModelJS>` | absent | present |

**Acceptance criteria**:

- Update `SPEC/frontend.md` "Typed bindings via wrapper structs" to reflect the
  current two-level API: `CompileResultJS` for diagnostics/counts plus
  `model() -> Option<ModelJS>`, and `ModelJS` for `components()`, `score()`, etc.
- The updated spec code block for `CompileResultJS` must list exactly the methods
  that exist in `crates/rhizz-wasm/src/lib.rs`.
- Add a matching code block in the spec documenting the `ModelJS` public API
  (`project()`, `components()`, `component_by_name()`, `score()`).
- The table mapping `rhizz-core types → rhizz-wasm wrappers → TS classes` (lines
  84–90) must include `ModelJS` and remove any stale entries.
- No code changes required — spec update only (unless the code itself needs to
  align to the spec, which is an architectural decision for the team).

---

## Task 34 — Reconcile `RawConnection.from`/`to` and `RawField.type` optionality with SPEC/models.md

**Spec reference**: `SPEC/models.md` — Raw Models §Block structs (lines 92–114).

**What the spec says**:

```rust
struct RawConnection {
    // …
    from: String,              // required — no Option wrapper
    to: String,                // required — no Option wrapper
    // …
}

struct RawField {
    r#type: String,            // required — no Option wrapper
    // …
}
```

The spec explicitly marks `from`, `to`, and `type` as bare `String` (required) — the surrounding prose states "All fields `Option` **or defaulted**" but singles out these three as non-optional.

**What the code does** (`crates/rhizz-core/src/parse.rs`, lines 114–119, 136–138):

```rust
pub struct RawConnection {
    pub from: Option<String>,   // ← Option, not String
    pub to: Option<String>,     // ← Option, not String
    // …
}

pub struct RawField {
    pub field_type: Option<String>,  // ← Option, not String (renamed too)
    // …
}
```

The `None` cases are handled in `resolve.rs` (`resolve_endpoint` lines 562–573, `resolve_fields` lines 770–782), where a missing `from`/`to` emits E002 and a missing `type` emits E007. This defers the error from parse time to resolution time, which is arguably more user-friendly (error messages include the connection/field label), but it diverges from the spec's raw-type contract.

| Field | Spec type | Impl type | Error emitted on absent |
|---|---|---|---|
| `RawConnection.from` | `String` | `Option<String>` | E002 in resolver |
| `RawConnection.to` | `String` | `Option<String>` | E002 in resolver |
| `RawField.type` | `String` | `Option<String>` | E007 in resolver |

**Acceptance criteria** (choose one approach, agreed by the team):

**Option A — update spec to match implementation** (preferred if deferred validation is intentional):
- Update `SPEC/models.md` §Block structs to declare `from`, `to`, and `type` as `Option<String>` with a note that their absence is caught by the resolver (E002 / E007).
- Add a sentence to the HCL deserialization strategy section noting that required-attribute validation is deferred to the resolution pass for richer error messages.
- No code changes required.

**Option B — update implementation to match spec** (parse-time enforcement):
- Change `RawConnection.from` / `to` to `String` (non-optional) in `parse.rs`.
- Change `RawField.field_type` to `String` (non-optional) in `parse.rs`.
- Update `parse_connection` and `parse_field` to return an `Err` when these attributes are absent, using `anyhow::bail!`.
- Update `resolve_endpoint` and the field-resolution path to remove the `None` branch (it becomes unreachable).
- Ensure the parse-level errors still carry enough context (connection/field label) so error messages remain useful.
- All existing tests continue to pass.

---

## Task 35 — Implement previous-valid-model fallback on recompile failure

**Spec reference**: `SPEC/gui.md` § File Watching and Live Recompile (line 13–15).

**What the spec says**:

> The last successfully resolved `Model` is kept in memory as a fallback. If the
> current edit produces hard errors, the UI continues to display the previous
> valid state while showing the new diagnostics.

**What the code does** (`crates/rhizz-gui/src/main.rs`, lines 666–674):

```rust
if changed {
    let (model, diagnostics) = load_and_compile(&self.path);
    let view_count = model.as_ref().map_or(0, |m| m.views.len());
    self.model = model;          // ← unconditionally overwrites, even when None
    self.diagnostics = diagnostics;
    self.view_layouts = vec![None; view_count];
    …
}
```

When `load_and_compile` returns `(None, errors)` (a compile with hard errors),
`self.model` is clobbered to `None`. The previous valid model is lost and the
central panel switches to "(no model loaded)", which is the opposite of what the
spec requires.

**Acceptance criteria**:

- On a recompile triggered by a file-watcher event, only update `self.model` if
  the new compile result contains `Some(model)`. When the result is `None`, keep
  `self.model` unchanged (fallback to the last valid model).
- `self.diagnostics` is always replaced with the new diagnostics regardless of
  whether a new model was produced.
- `self.view_layouts` must only be invalidated when `self.model` actually changes
  (i.e. when a fresh `Some(model)` is returned). When falling back to the
  previous model, layouts should remain cached so the graph view stays visible.
- Add a unit test (or integration note) that verifies: given a first successful
  compile followed by a compile that returns `None`, `self.model` still holds the
  first model's value.
- All existing tests continue to pass.

---

## Task 36 — Add interactive zoom to the graph view

**Spec reference**: `SPEC/gui.md` § View Rendering (line 35).

**What the spec says**:

> The resulting node positions and edges are drawn directly onto an
> `egui::Painter` inside a `ScrollArea`, giving the user **free pan and zoom**.

**What the code does** (`crates/rhizz-gui/src/main.rs`, lines 836–861):

The view is wrapped in `egui::ScrollArea::both()` (providing pan via
scrolling), but the scale factor is computed once as an auto-fit ratio:

```rust
let scale = (avail.x / canvas.x).min(avail.y / canvas.y).min(1.0);
```

There is no interactive zoom — the user cannot zoom in or out with the mouse
wheel, pinch gesture, or buttons. The scale is read-only and fixed to
"fit in available space, max 1:1".

**Acceptance criteria**:

- Add a per-view zoom level (`f32`) to `RhizzApp` (or `GraphLayout`), defaulting
  to the current auto-fit value.
- Detect `egui::InputState::scroll_delta` (or `zoom_delta`) inside the graph
  `ScrollArea` response and update the zoom level accordingly (e.g. Ctrl+scroll
  or pinch to zoom).
- Apply the per-view zoom level as the `scale` argument to `draw_graph_layout`
  so the drawn canvas grows/shrinks interactively.
- The `ScrollArea` continues to provide panning; when zoomed in beyond the
  available area the user must be able to scroll to see all parts of the graph.
- Add reset-to-fit behaviour (e.g. double-click or a "Fit" button) that
  restores the scale to the auto-fit value.
- All existing tests continue to pass.

---

## Task 37 — Add missing `Deserialize` to `rhizz-core` public diagnostic types

**Spec reference**: `SPEC/architecture.md` — `rhizz-core` § Invariants

**What the spec says**:

> **`serde` on all public types** — `Model`, `Diagnostic`, `ScoreReport`, and
> all related structs derive `Serialize` and `Deserialize` so frontends can
> serialise results (JSON output, IPC, storage) without extra conversion.

**What the code does**:

Three public types in `crates/rhizz-core/src/diagnostics.rs` and `lib.rs` are
missing `Deserialize` (or both `Serialize` and `Deserialize`):

| Type | File | Current derives | Missing |
|------|------|-----------------|---------|
| `Level` | `diagnostics.rs:9` | `Debug, Clone, Copy, PartialEq, Eq, Hash` | `Serialize, Deserialize` |
| `DiagnosticCode` | `diagnostics.rs:37` | `Debug, Clone, Copy, PartialEq, Eq, Hash` | `Serialize, Deserialize` |
| `Diagnostic` | `diagnostics.rs:216` | `Debug, Clone, Serialize` | `Deserialize` |
| `CompileResult` | `lib.rs` | `Debug, Clone, Serialize` | `Deserialize` |

`Model`, `ScoreReport`, and their sub-types already derive both correctly.

**Acceptance criteria**:

- `Level` derives `serde::Serialize` and `serde::Deserialize`.
- `DiagnosticCode` derives `serde::Serialize` and `serde::Deserialize`.
  Note: `DiagnosticCode.code` is a `&'static str`; serialisation should emit it
  as a plain string, deserialisation may require `#[serde(borrow)]` or a
  `String`-based intermediate — choose whichever avoids lifetime complications.
- `Diagnostic` derives `serde::Deserialize` (it already derives `Serialize`).
- `CompileResult` derives `serde::Deserialize` (it already derives `Serialize`).
- A round-trip test (serialize then deserialize) passes for at least one
  `CompileResult` value with both `model: Some(…)` and `model: None`.
- All existing tests continue to pass (`cargo test -p rhizz-core`).

---

## Task 38 — Fix `project.name` default: should be directory name, not empty string

**Spec reference:** SPEC.md §2.1 (`project` Block — `name` attribute, Default: `directory name`).

**Problem:** The spec states that when the `project` block is absent or `name` is not
set, the project name should default to the **name of the project directory**. The
implementation in `crates/rhizz-core/src/resolve.rs` uses
`p.name.unwrap_or_default()` which produces an empty string `""` instead.

The `RawFile` struct already carries a `project_source: Option<PathBuf>` field
(set to the path of the `project.hcl` file when one is found, `None` otherwise).
The directory name can be derived from that path, or from the root directory passed
to `parse_dir`.

**Acceptance criteria:**

- When a `project` block with an explicit `name` is present, use that name as-is
  (no change to existing behaviour).
- When `name` is absent (or the `project` block itself is absent), the resolved
  `Project::name` equals the base name of the project directory (e.g. `"drone"`
  for a project rooted at `/path/to/drone/`).
- The directory name must be made available to `resolve()`. Options include:
  - Derive it from `raw.project_source` (parent of the `project.hcl` file), or
  - Add a `root_dir: Option<PathBuf>` field to `RawFile` populated by `parse_dir`.
- `Project::name` is never an empty string after resolution (fall back to `"."` or
  `"unknown"` if the directory name cannot be determined).
- Unit test: parse an HCL string with no `project` block (via `parse_file` with a
  path like `/some/project-dir/test.hcl`) and assert `model.project.name == "project-dir"`.
- All existing tests continue to pass.

---

## Task 28 — Task template

- Task description here
- Requirements, spec, acceptance criteria as bullet points
- Keep on increasing the task ID when creating new tasks
- Don't remove this template, move it to the bottom instead
