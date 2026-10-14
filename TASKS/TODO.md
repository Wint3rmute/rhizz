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

## Task <N> — Build the whole app (and its Docker image) via Nix

On branch `build/nix-npm-build`. Stage 1 is done: `packages.rhizz-wasm-pkg`
(`nix/wasm.nix`) builds the wasm package hermetically, and `just wasm` now
builds through it. This task finishes the pipeline so that the server binary —
and the Docker image around it — are produced by Nix:

```
rhizz-wasm-pkg → crates/rhizz-wasm/pkg   (done)
rhizz-web      → web/build                (buildNpmPackage)
rhizz          → bin/rhizz                (rustPlatform, embeds web/build)
docker-image   → OCI image                (dockerTools)
```

Each stage is its own `packages.<system>` attribute and its own commit; every
stage consumes the previous one's output. Keep `devShells` untouched and the
`just` recipes working throughout. **CI is deliberately out of scope** for this
task — do not touch `.github/workflows` (a follow-up is listed below).

### Decisions to settle first

- **npm dependency hashing**: `importNpmLock` (derives the FOD from
  `web/package-lock.json`, so Dependabot bumps need no hand-maintained hash) vs
  `buildNpmPackage`'s `npmDepsHash`. Prefer `importNpmLock`.
- **How `rhizz-server/build.rs` finds the frontend**: it hardcodes
  `../../web/build`. Either copy the `rhizz-web` output there in `preBuild` (no
  Rust change) or add a `RHIZZ_WEB_BUILD_DIR` env hook. Prefer the copy first.
- **Rust dependency vendoring**: stay with `cargoLock.lockFile` (as the wasm
  stage already does); reach for `crane` only if dep-rebuild caching proves too
  coarse.

### Steps

- [ ] **2. Frontend derivation (`packages.rhizz-web`).** `pkgs.buildNpmPackage`
  over `web/`, consuming `rhizz-wasm-pkg` as the
  `file:../crates/rhizz-wasm/pkg/` dependency (place the derivation output in
  the source tree before the install phase). Build with
  `VITE_RHIZZ_SERVER_URL=/`; leave Sentry unset so the tokenless "no source
  maps" path is taken. Respect `web/.npmrc` (`legacy-peer-deps=true`). Output
  `web/build` (`404.html` + `_app/`). Storybook is **not** part of this stage
  (it is only needed for VRT). Verify: `nix build .#rhizz-web`, load the SPA,
  and compare against `cd web && npm run build`.
- [ ] **3. Backend binary (`packages.rhizz`).** `rustPlatform.buildRustPackage`
  for `rhizz-cli`, embedding step 2's `web/build` (and with
  `crates/rhizz-wasm/pkg` present so the workspace manifest resolves). Vendored
  deps via `cargoLock.lockFile`; `SPEC/` and `examples/` must be in `src`
  because `rhizz-core`'s build script embeds them via `include_str!`. Verify:
  `nix build .#rhizz`; `rhizz web` serves the embedded UI.
- [ ] **4. Docker image (`packages.docker-image`).**
  `pkgs.dockerTools.buildLayeredImage`, preferably built from `scratch` rather
  than the Debian base (the Nix binary's RPATH lives in `/nix/store`, so the
  store closure is all it needs). Contents: the `rhizz` binary, `cacert`, and
  `/data` seeded from `examples/`. Config: `RHIZZ_ADDR=0.0.0.0:8080`,
  `RHIZZ_DATA_DIR=/data`, `CMD rhizz web`, expose `8080`. Verify: `docker load`
  + run, then compare behaviour against the current Dockerfile image.
- [ ] **5. (Deferred) CI + retire the Dockerfile.** Explicitly a follow-up:
  switch the `wasm`/new build jobs to `nix build`, add a binary cache for
  cross-run speed, point `docker.yml` at `.#docker-image`, and delete the
  Dockerfile once parity is confirmed. Listed so it is not forgotten.

### Definition of done

- `nix build .#rhizz-wasm-pkg .#rhizz-web .#rhizz .#docker-image` all succeed.
- The `.#rhizz` binary serves the same UI as `just build` +
  `cargo build --release -p rhizz-cli`.
- `.#docker-image` runs and serves the example projects from `/data`.
- `just test`, `just lint`, `just build` still pass — nothing in the dev
  workflow regressed.

---

## Task <N> — Re-baseline VRT after the formatting commit

`main` (`4bccef2`, formatting) fails 3 screenshots that passed before it:
`components-monacoeditor--markdown-unwrapped-overflows` (dark and light) and
`pages-code--default--light`. The formatting-only changes checked so far (float
literals, a collapsed call in `MonacoEditor.svelte`) are no-ops, so the cause
is not yet isolated. Do not accept new baselines until the gallery has been
reviewed. Then re-baseline on Linux or with `--update-snapshots` in CI.

---

## Task <N> — Palette e2e flake

Command-palette e2e tests fail intermittently (2 of 5 runs with the audit
overrides, 1 of 4 without). A different test fails each time, and each passes
when rerun alone. Find the timing dependency in the palette tests or component
and make them deterministic.

---


## Task <N> — Show and hide connections per view

Connections can be hidden per view, the same way component instances are shown
and hidden today. The Modeling connections sidebar lists only connections between
components that are shown in the diagram, each with a checkbox.

Definitions:

- A connection is **drawn** in a view when both endpoint components are placed
  in the view, belong to the view's system, and the connection is not hidden.
- Hidden is a per-view setting, stored in that view's `views/<label>.hcl`.

Requirements:

- **Storage:** new optional `hidden` boolean attribute on the view's
  `connection` block, e.g. `connection "fc-to-prop" { hidden = true }`. Omitted
  from the file when `false`. Add the field to `ViewConnection` in `rhizz-core`
  and round-trip it through parse and serialize. Add it to `StoredConnection`
  on the web side and round-trip it through `viewsToLayout` and `layoutToHcl`.
- **Sidebar:** lists every system connection whose two endpoints are both placed
  in the view. Each row has a checkbox; checked means shown. Hidden connections
  stay listed, unchecked, so they can be shown again. Connections with an
  unplaced endpoint are not listed.
- **Canvas:** hidden connections are not drawn. The sidebar and the canvas use
  one shared predicate, so they cannot disagree.
- **Read-only viewers** (Explore, embed, Inventory) also skip hidden connections.
- **Cascade:** `hidden` survives a component being unchecked and re-checked.
  Removing a component from the view does not clear the flag.
- **Undo:** toggling goes through the same save and undo path as component
  checkboxes.
- **Spec:** update the view section of `SPEC.md` / `SPEC/` to describe `hidden`.

A connection is identified by its name within a system. View `connection`
blocks are keyed by name, so one name must refer to one declaration.

- Each instance of a component gets its own copy of the connections declared in
  its definition (`resolve.rs:412`, `resolve.rs:391`). Copies of one declaration
  share a name and are one connection for hiding and for the sidebar.
- Reject a name used by two different declarations in one system with E001,
  reporting both locations. Examples: `data` in two component definitions, or a
  system-level `data` next to a component's `data`.
- Do not reject copies of the same declaration. The current per-scope check in
  `process_connections_in_scope` (`resolve.rs:602`) allows them, and so must the
  new whole-system check.
- Record which declaration each connection came from, so the check can tell
  copies from different declarations apart.
- Document the rule in the E001 SPEC page. Check `examples/` for names that
  break under the rule and rename them.

- Sidebar: a name is listed and checked if any of its copies is drawn. Hiding
  applies to all copies. Copies that are not drawn have no visible effect.

Steps (in order):

1. Fix the sidebar. Introduce the shared "drawn" predicate and use it for both
   the canvas edge list and `systemConnections`. No schema change.
2. Add the `hidden` attribute end to end: Rust model and serializer, web layout,
   sidebar checkbox, canvas and read-only filter.
3. Tests, red first:
   - Rust: round-trip for `hidden`, and it is omitted when `false`.
   - Vitest: unit tests for the shared predicate and for the layout round-trip.
   - Playwright: hiding a connection removes it from the canvas and unchecks it
     in the sidebar; the state survives reload; unchecking and re-checking an
     endpoint component keeps the connection hidden; the sidebar lists exactly
     the drawn-or-hidden connections.
   - Storybook or VRT only if the sidebar row look changes.
- **Validation:** `just test`, `just lint`, `just build`, `just format`.

---

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

## (For later brainstorming) Task <N> - pin existing nodes when auto-laying-out newly-added ones

Split out from Task 50 (now finished — see `FINISHED.md`) as the one
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

## Task <NUMBER> — Task template

- Task description here
- Requirements, spec, acceptance criteria as bullet points
- Keep on increasing the task ID when creating new tasks
- Don't remove this template, move it to the bottom instead

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
