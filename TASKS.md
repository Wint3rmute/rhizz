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

## Task 56 — `ProjectStore` interface + localStorage-backed implementation (no new dependencies)

Second of a five-task sequence (55–59; Task 55 — VFS domain types & pure
tree helpers, in `web/src/vfs/types.ts`/`tree.ts` — is finished, see
`FINISHED_TASKS.md`) building a virtual filesystem hierarchy for the
frontend, so it can store multiple multi-file projects & diagrams in the
browser. Explicitly a **local-first, single-editor** workflow — no
real-time collaboration, no CRDT, no concurrent-edit merging. A future
file-locking mechanism is a plausible follow-up once there's a backend,
but out of scope here; don't design around concurrent writers.

Builds on Task 55's types. Introduces the actual storage engine behind a
storage-agnostic interface, so a future backend-backed implementation is a
drop-in replacement with zero call-site changes — without adding any new
library. Given the working assumptions (only small projects, only a handful
of them, browsers are fast), this is deliberately the simplest thing that
works: **the entire VFS lives in one JSON blob under one `localStorage`
key**, following the exact same shape as the existing `Persisted.svelte.ts`
helper — no IndexedDB, no per-record keys, no manual indexes.

- Add `web/src/vfs/store.ts` defining the `ProjectStore` interface:
  - `listProjects()`, `createProject(name)`, `deleteProject(id)`
  - `listNodes(projectId)`
  - `createFile(projectId, parentId, name, contentType, content)`
  - `createDirectory(projectId, parentId, name)`
  - `updateFileContent(fileId, content)` — bumps `revision` and `updatedAt`
  - `renameNode(nodeId, name)`
  - `moveNode(nodeId, newParentId)` — rejects with an error if
    `wouldCreateCycle` says yes
  - `deleteNode(nodeId)` — recursive for directories, using `descendantsOf`
  - All methods return `Promise`s, even though the implementation below is
    fully synchronous — keeps the interface shape identical to what a future
    network-backed implementation will need, without requiring any real
    asynchrony (or a real backend) today.
- Add `web/src/vfs/localStorageStore.ts` implementing `LocalStorageProjectStore`:
  - One `localStorage` key (e.g. `"rhizz:vfs:v1"`) holding
    `{ version: 1, projects: Project[], nodes: FsNode[] }` as a single JSON
    document.
  - Every method: read the blob, `JSON.parse` + validate with a zod schema
    (drop individually-malformed projects/nodes rather than discarding the
    whole blob on one bad entry — same forgiving-parse philosophy as
    `sanitizeStoredRecord` in `diagrams/persistence.ts`), mutate the
    in-memory arrays with plain `Array` methods (`.filter()`/`.map()` —
    no indexing structures; fine at the stated scale), `JSON.stringify` and
    write the whole blob back.
  - Constructor takes an optional `Storage`-shaped object (`{ getItem,
    setItem, removeItem }`), defaulting to `globalThis.localStorage`. This
    is purely so tests can inject a plain in-memory object instead of
    depending on a DOM environment (the project's Vitest setup has no
    jsdom/happy-dom yet — see Task 36's notes — and this avoids needing to
    add one just for this).
  - `version` field exists from day one so a future schema change has
    somewhere to hang a migration, even though no migration logic is needed
    yet.
- Implement `InMemoryProjectStore` in `web/src/vfs/inMemoryStore.ts` (a
  plain array-backed implementation with no storage dependency at all) as
  the fast default test double.
- Add a single shared contract test suite (e.g.
  `web/src/vfs/store.contract.test.ts` exporting a
  `runProjectStoreContractTests(makeStore: () => ProjectStore)` helper) run
  against both implementations, covering: project CRUD, file/directory CRUD,
  rename, move (including the cycle-rejection case), recursive delete, and
  that `revision`/`updatedAt` change on `updateFileContent`.
- **No new npm/deno dependencies.** Everything here uses `localStorage`,
  `JSON`, `crypto.randomUUID()`, and `zod` (already a dependency).
- Explicitly deferred, only worth revisiting if it's ever actually a
  problem: if project data outgrows `localStorage`'s ~5–10MB per-origin
  quota, a `LocalStorageProjectStore` can be swapped for one backed by the
  browser's native `indexedDB.open`/`IDBTransaction` API (still no wrapper
  library) behind the same `ProjectStore` interface, with no UI changes.
  Not needed at the current scale — don't build it preemptively.
- No UI changes in this task.
- Validate with `deno task check`, `deno task build`, `deno task test`.

## Task 57 — `/projects` route, `ProjectState`, and legacy-data migration

- Add `web/src/routes/projects/+page.svelte` — list existing projects
  (name + updated-at), create a new (empty or example-seeded) project,
  rename, delete. Becomes the new landing page linked from the navbar.
- Add `web/src/ProjectState.svelte.ts` (same pattern as `ThemeState.svelte`/
  `KeyboardState.svelte`) holding the current project id as reactive `$state`,
  backed by a module-level `LocalStorageProjectStore` instance.
- Existing `/editor`, `/diagrams`, `/overview` routes move under
  `/projects/[id]/...`, reading/writing through `ProjectState` instead of the
  global `persisted("SYSTEM_INPUT_BOX", ...)` singleton.
- One-time migration: on app startup, if the legacy `SYSTEM_INPUT_BOX`
  localStorage key exists, create a project named e.g. "Migrated project"
  seeded with a single `all.hcl` file containing that content, then remove
  the legacy key. Existing users keep their data with no manual steps.
- `example_system.ts` becomes a "create from example" option on
  `/projects` rather than a button on `/editor`.
- Update `Navbar.svelte` to show the current project name/version (already
  has `project` prop support) and link back to `/projects`.
- Validate with `deno task check`, `deno task build`, `deno task test`.

## Task 58 — File-tree sidebar in the editor, wired to `ProjectStore`

- Add a file-tree sidebar to `/projects/[id]/editor` (using `buildTree` from
  Task 55) showing the active project's `FsNode`s, with `.hcl` files and
  directories distinguished visually.
- Clicking a file loads its content into the existing `MonacoEditor`;
  edits call `ProjectStore.updateFileContent` (debounced, matching the
  current `persisted()` write-on-change pattern).
- Context menu / toolbar actions for create file, create directory, rename,
  move (drag-and-drop is a nice-to-have, not required), and delete — all
  calling straight into `ProjectStore`.
- Compilation always merges *all* `.hcl` files in the project via
  `projectSources()`, independent of which file is currently open — matches
  `rhizz-core`'s "flat merge of all files in a directory" semantics. Replace
  the hardcoded `[{ filename: "all.hcl", content: input.value }]` call in
  `editor/+page.svelte` and `overview/+page.svelte` accordingly.
- Diagnostics' `file` field now reflects real per-file paths (via `pathOf`)
  instead of the always-`all.hcl` placeholder.
- Validate with `deno task check`, `deno task build`, `deno task test`.

## Task 59 — Move diagram layout persistence into the VFS

- Replace `diagrams/persistence.ts`'s direct `localStorage` reads/writes
  with `contentType: "diagram-layout"` files in the active project's VFS
  (e.g. one file per saved view/diagram), so diagram layouts are
  project-scoped instead of global, and get carried along with the rest of
  the project's data.
  - Keep `StoredBoxSchema`/`sanitizeStoredRecord` as the validation layer for
    the JSON stored inside the file's `content` — just change *where* that
    JSON is read from/written to.
- Migrate any existing global diagram-layout localStorage data into the
  first/migrated project created in Task 57 (extend that migration step).
- No behavior change from the user's point of view beyond "diagrams now
  belong to a project" — same drag/resize/pin/undo interactions as before.
- Validate with `deno task check`, `deno task build`, `deno task test`
  (existing `persistence.test.ts`/`history.test.ts`/`geometry.test.ts`
  suites should be unaffected apart from the storage plumbing).

## (For later brainstorming) Task <N> - visual regression testing

Now that Tasks 55–59 give us a real virtual filesystem hierarchy for the
frontend, we can create end-to-end tests which load a project, render a
diagram and verify that it matches the expected output.

Vitest supports visual regression testing. The goal of this task is to implement
infrastructure for visual regression testing in the frontend, then ask the
developer to create diagrams, which can be saved as reference images for future
comparisons.

## (For later brainstorming) Task <N> - use UNIX-style paths for component references

Currently, when defining connections between components, path are specified using label + colon notation (e.g. `foo:bar`). While this is convenient for simple cases, it should be replaced with a more standard UNIX-style path notation (e.g. `/foo/bar`).

Both relative and absolute paths should be supported.

Definition of done:

- All documentation (SPEC.md and other markdown documents) are updated to reflect the new approach
- The rhizz-core module is updated
- Code is checked for presence of unit tests which check that both relative and absolute paths are supported. Existing tests are updated to reflect the new approach.
- Example models in `examples/` are updated to reflect the new approach. Each example model is checked after changes using the Rhizz CLI.
- Example model hardcoded in the frontend application is updated to use the new approach

## (For later brainstorming) Task <N> - relax requirements regarding adding new connections

This is not well understood by me at this point, but interactive experimentation with rhizz shows that it's kinda hard to "just add a new connection and have it show up on the diagram". Lots of boilerplate must be written before the Rhizz compiler accepts a model without errors. This is against `SPEC.md`, which describes a gradual validation system, which detects incomplete definitions, emits warnings to the user, but **still allows to build the system**.

I suggest starting out this task with writing a new example in `examples/` that demonstrates all possible incomplete definitions and how the compiler handles them,
showcasing the compiler's flexibility in gradual validation.

It should later be expanded into unit tests, but that is only after the core idea is implemented and checked by the user.

## (For later brainstorming) Task <N> - pin existing nodes when auto-laying-out newly-added ones

Split out from Task 50 (now finished — see `FINISHED_TASKS.md`) as the one
remaining concrete piece of its original scope. `forceLayout.ts` already
supports pinning a node in place via `fixed: true` on a `LayoutNode` (sets
d3-force's `fx`/`fy`, ignored by all forces) — added specifically for this
case, but nothing calls it that way yet.

- When a component is checked onto the canvas (the sidebar checkbox's
  "check" branch), instead of just placing it at a default/remembered
  position, run a force-layout pass where every *other* currently-placed
  sibling is `fixed: true` and only the newly-checked node is free to
  move — so it settles into whatever gap is available near its
  connections, without visibly disturbing anything else already placed.
- Needs a concrete trigger decision: should this replace the current
  "restore remembered position, or default to (100, 100)" behavior
  unconditionally, or only when there's no remembered position to
  restore (i.e. first-time placement only, not re-checking something
  that was previously positioned)? Lean towards the latter — respecting
  a remembered position take priority over auto-placing.
- Validate with `deno task check`, `deno task build`, `deno task test`.


## Task <NUMBER> — Task template

- Task description here
- Requirements, spec, acceptance criteria as bullet points
- Keep on increasing the task ID when creating new tasks
- Don't remove this template, move it to the bottom instead
