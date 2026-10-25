# Tasks

How to work on this file:

- Read the next task from this file
- Get extra context from recently finished tasks - read the first 50 lines of
  `TASKS/FINISHED.md`
- If on `main`, switch to a new feature branch
- Implement the task, use red/green TDD
- Run tests & linters (`just test`, `just lint`, `just build`)
  until it's all working
- Once all linters/builds/tests pass, run `cargo fmt`
- Move the completed task to `FINISHED.md` and report that you're finished
- Commit using conventional commits
- Push your feature branch. **Never push directly to main**

---

## Task <N> — MCP: connection, port and protocol mutation tools, plus the proposal update

The core has ops that proposal 0003's table does not list. Decide and expose them,
and bring the proposal up to date.

- **Ops to expose** (all exist in `ModelOp`): `connect_components`,
  `update_connection`, `add_protocol`, `update_protocol`, `delete_protocol`.
- **Decide** whether `connect_components` replaces `add_connection` as the
  documented connection path for AI clients (it creates the ports too, one
  atomic op). Record the decision in 0003.
- **Proposal:** update 0003's step 2 table to match the full `ModelOp` set and
  close the open question on connections and ports (it is answered by
  `connect_components`). Keep the "new `ModelOp` gets a tool in the same change"
  rule, and check the core's op set against the table with a test so it cannot
  silently drift.
- **Tests (red first):** through `/mcp`: `connect_components` creates the
  connection and its ports in one call and one persisted write; a refused
  `delete_protocol` (still referenced by a port) leaves the file unchanged; an
  op-set drift test fails if a `ModelOp` variant has no MCP tool.
- **Out of scope:** locking (0004) and docs edits (step 3).

Definition of done: `just test`, `just lint`, `just build` pass, and 0003 states
the final op set.

---

## Task <N> — MCP: `edit_documentation` tool for `docs/**.md`

Step 3 of [0003](book/src/proposals/0003-mcp-introduction.md), editing only.
Add an `edit_documentation` tool to the `/mcp` router in
`crates/rhizz-server/src/mcp.rs`. It replaces one exact span of text in an
existing Markdown doc. Docs are not HCL, so this does not go through `ModelOp`.

- **Parameters:** `project`, `path` (a doc path under `docs/`, `.md` only),
  `old_text`, `new_text`, and `version`, the value `read_file` returned for the
  file the client last read.
- **Matching:** `old_text` must occur exactly once in the file. Zero matches
  and several matches are both refused as tool errors, and the file is left
  untouched. An empty `old_text` is refused.
- **Version guard (compare-and-swap):** refuse when `version` differs from
  `storage::file_version` of the file on disk, with a message telling the client
  to re-read. Read, check, and write happen under one held lock inside the
  blocking task, so two calls in the same process cannot both pass the check.
- **Paths:** reuse `resolve_project` and `resolve_confined_path` from step 1.
  The path must be under `docs/` and end in `.md`. Otherwise refuse, using the
  same confinement as `read_file` (hidden entries and symlinks excluded). A
  missing file is a tool error, since creating docs is a separate tool.
- **Write:** through the existing atomic write (`write_atomic` in
  `storage.rs`, made `pub(crate)` if needed), so a failed write never leaves a
  partial file. Do not write `system.hcl`, views, or anything outside `docs/`.
- **Result:** the new `version` and `totalLines`, so the client can chain
  another edit without re-reading.
- **Locking and identity:** 0004 is not implemented, so this is compare-and-swap
  only, with no project lock and no `AI` identity. Say so in the tool
  description and in 0003's step 3 notes.
- **Tests (red first), through `/mcp` RPC:** a single exact match is replaced and
  the file content is the expected text; zero matches, two matches and an empty
  `old_text` are refused with the file byte-identical; a stale `version` is
  refused and the file is unchanged, and the same edit with the fresh version
  succeeds; a path outside `docs/`, a `.hcl` path, a `..` path, and a hidden or
  symlinked doc are each refused; a missing doc is refused; a concurrent-edit
  test shows that two edits sent with the same version cannot both apply.
- **Out of scope:** `create_doc` (a separate task), locking (0004), and any
  `system.hcl` change.

Definition of done: `just test`, `just lint`, `just build` pass, and 0003's
step 3 table names the tool it ships as.

---

## Task <N> - Animatd connection line in "new connection" popup

Currently, the "new connection" popup displays a minimal visualisation of the
connection to be added between components.

Add a minimal animation which would make the dashed and moving, slowly "flowing"
from the connection origin to the target. If possible, build this CSS-only

## Task <N> - During view transitions, connection arrows don't fade out

It appears that connection arrows don't fade out when the component to which the
arrow points to is not supposed to exist in the target view. They stay fully
visible until the transition completes, then disappear abruptly.

## Task <N> - Changing project name does not respect lower/uppercase

Steps to reproduce:

1. Create a new project "test"
2. Go back to projects list, click on rename and enter "Test" as the project name, click "ok"
3. Notice that the project's name changed to "Test" - that's correct
4. Refresh the page
5. Project's name is back to "test"

I believe that the project name should live in the `project` metadata,
filesystem-based name should only be used when a project does not have a name
set under `project`. Think about how GitLab/GitHub handle this - there's a
separate project name and project **path**. Right now, the path is used for
everything and it also appears that it does not respect upper/lowercase.

## Task <N> - more advanced connection routing on canvas

Currently, the connections are always routed using a "double-knee" approach,
with 2 turning points on each connection. This does not always work.

Think about existing well-thought solutions to structuring connections in such
diagram editors and suggest a more flexible option, which will smartly figure
out whether to use connections with 2 turning points or just a single turning
point.

## Task <N> — Detect isolated component trees in systems

It is possible to define a system with 2 completely independent component trees,
You can verify that empirically. This is not a correct behavior, since it means
that the user has effectively defined 2 separate systems and shoved them into one.
While this is not an error, it should emit a warning.

Definition of done:

1. Add a new warning "Multiple isolated component trees found in system <name>".
2. Use some graph algorithm to walk the system model and detect "isolated trees".
3. Write tests for this feature.

Extra: Can you find any human-readable way to inform the user where they should
look to find the isolated system subtree? Just bare "multiple component trees"
detected is not very informative, although at this point I've no idea how to
point the user towards resolving their issue.



---

## Task <N> — Modular multi-pane workspace with shared reactive context

Refactor the web architecture from isolated page routes to a unified, dockable multi-pane workspace where multiple synchronized views (Editor, Diagrams, Explore, Diagnostics) operate concurrently on a shared reactive data model.

- **Strategy**
  - Hoist project file and compiled model state into a shared reactive context (`ProjectWorkspaceContext.svelte.ts`) at the project layout root.
  - Decouple view pages into standalone, embeddable pane components (`<EditorPane />`, `<DiagramPane />`, `<ExplorePane />`, `<DiagnosticsPane />`).
  - Introduce a configurable split/tiling layout container supporting resizable horizontal and vertical panes.
- **Implementation Scope**
  - **Shared Reactive State:** Single source of truth for VFS `sources`, WASM compilation outputs, diagnostics, and transaction history. Edits in any pane immediately update the reactive model and notify all sibling panes.
  - **Pane Components:** Extract view logic from `routes/projects/[id]/*` into standalone modular components.
  - **Layout Manager:** Implement a dockable/splittable window layout container (supporting tabs, 2-column split, 3-column split, grid) with persistent layout configuration in localStorage.
- **Acceptance Criteria**
  - User can display the Code Editor and Diagram Canvas side-by-side simultaneously.
  - Editing HCL text in the Editor pane updates the rendered diagram in real-time.
  - Creating/moving components in the Diagram pane updates the text in the open Editor pane without cursor jump or desynchronization.
  - Panes can be resized, split horizontally/vertically, and closed.
  - Layout configuration persists across page reloads.
  - Validated with `just test`, `just lint`, and `just build`.

---

## (For around November) Task <N> - Migrate to Typescript 7

TypeScript 7.0 (the native Go port) went GA on July 8, 2026 34. But
svelte-check, svelte2tsx, and the Svelte language server don't just shell out to
tsc — they import TypeScript's programmatic compiler API and drive the compiler
directly. TypeScript 7.0 shipped without a stable programmatic API; that's
deferred to 7.1, currently targeted for around October 2026 582.

Definition of done:

1. Check if Typescript 7 works with svelte now
2. If it does not - halt the execution immediately and inform the user that it cannot be done
3. If it does - migrate the project to Typescript 7:
  - Update dependencies and Typescript configuration
  - Remove all leftovers of Typescript 6, with zero thoughts about backward compatibility
  - Verify the migration by usual instructions from AGENTS.md
  - Commit that state
  - Do a comprehensive check of the current typescript configuration, focusing on whether something can be slimmed down after the update
  - If you made changes - verify again and commit the updated configuration


## (For later brainstorming) Task <N> - routing multiple connections between 2 components

When 2 components have more than one connection between them, connection routing
rules cause connections to be drawn over each other. Instead, a better routing algorithm should be implemented.
I'm thinking about a PCB-style routing that lines up multiple connections along a shared path, but with some extra
offset to avoid overlapping.

---

## (For later) Task <N> — Allow for panning & zooming in the Explore view

Currently, only the Diagrams page allows panning & zooming. I want to extract
this feature and make it possible to pan & zoom in other pages:

- Explore
- Inventory
- Embedded diagrams viewer

Definition of done:

- Panning & zooming is clearly extracted, ideally as a reusable system
- Panning & zooming now works in Explore/Inventory/Embedded diagrams viewer

--

## (For later) Task <N> — Multi-file workspace tabs and project import/export

Add a unified workspace view that lets users inspect the generated `system.hcl` and `views.hcl` files side-by-side with the visual canvas, and import/export projects.

- Tabbed workspace switcher:
  - "Canvas" (interactive visual modeler, default)
  - "system.hcl" (live code viewer / editor for the core architectural model)
  - "views.hcl" (live code viewer / editor for layout coordinates and view filters)
- File Import / Export:
  - "Export Project" downloads `system.hcl` and `views.hcl`.
  - "Open / Import" loads existing `.hcl` files into the GUI and auto-populates the visual model.
- Validate with `deno task check`, `deno task test`, `deno task build`.

---

## Task <N> - exploring diagrams in embed mode

When browsing system diagrams in Embed mode (/modeling/embed/), it's not
possible to navigate defined system views, as it is possible in the explore/
view. Please make it possible to navigate back and forth through linked views.

---


## Note — Remove the audit `overrides` when upstream is fixed

The `overrides` in `web/package.json` pin two transitive dependencies to fixed
versions. `npm audit fix` cannot replace them: without `--force` it moves
`dompurify` down to the vulnerable 3.2.7, and with `--force` it only offers
`monaco-editor@0.57.0`, which still resolves the vulnerable `dompurify@3.4.15`.

- **`dompurify` (under `monaco-editor`, runtime path):** remove the override
  once a Monaco release resolves `dompurify` to 3.4.17 or later. Check with
  `npm view monaco-editor@<version> dependencies.dompurify`.
- **`postcss-selector-parser` (under `@tailwindcss/typography`, build time):**
  remove the override once `@tailwindcss/typography` depends on a parser
  version outside the advisory range (below 7.1.6). Check with
  `npm view @tailwindcss/typography@<version> dependencies`.

After removing an override, run `npm audit` and confirm the finding stays clear.

---

## Task <N> — Replace the Justfile with Nix-managed scripts

Replace `Justfile` recipes with scripts defined in `flake.nix` and put them on
the devshell `PATH`, so they run as `lint-rust`, `lint-commit`, etc.

- Decide the script language: bash (`pkgs.writeShellApplication`) or nushell
  (`pkgs.writers.writeNuBin`). Confirm the chosen writer exists in the pinned
  nixpkgs before committing to it.
- Start with `lint-rust`, `lint-frontend`, and `lint-commit`. Add them to
  `devShells.default` `packages`, and keep the devshell env vars (`LLVM_COV`,
  `PLAYWRIGHT_BROWSERS_PATH`, `RHIZZ_VRT_FONTCONFIG_FILE`) working inside them.
- Port the remaining recipes (`format`, `test`, `build`, `coverage`, `wasm`,
  `web-build`, `book`, `vrt`, `serve`, `changelog`, `bump`), with a script
  `cd`ing to the repo root via `git rev-parse --show-toplevel`.
- Point CI at the scripts: `nix develop --command <script>` in
  `.github/workflows/*.yml`, including `commitizen.yml`'s `commit-check` and
  `changelog` calls.
- Remove `Justfile` and update `AGENTS.md` and docs that mention `just`.
- Remove the stub `builder.sh` package from the devshell in `flake.nix`.

Definition of done:

- `lint` runs `lint-rust`, `lint-frontend`, and `lint-commit` and passes.
- Every former `just` recipe has a devshell equivalent.
- CI passes with no `just` invocations left in `.github/`.

---


## Task <NUMBER> — Task template

- Task description here
- Requirements, spec, acceptance criteria as bullet points
- Keep on increasing the task ID when creating new tasks
- Don't remove this template, move it to the bottom instead
