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

## Task <N> — Finish the Deno → Node/npm migration (incremental plan)

The toolchain switch is in `refactor/remove-deno` (`web/package-lock.json`
replaces `deno.lock`; the Justfile, CI, Dockerfile, flake and AGENTS.md run
npm on Node 24). Remaining work is split into small tasks, smallest blast
radius first. Each is independently verifiable and lands as its own commit.

Baseline (rebased commit, CI): `rust` and `docs` pass; `frontend` `wasm` and
`lint` pass; `test` fails 2 of 1056 (`InventoryPage.stories.ts`:
"Detail Pane Stacks Below The Diagram", "Panes Open By Default"). `e2e` and
`visual-regressions` are not yet resolved and VRT is out of scope.

- [x] **1. Fix the two viewport-dependent Inventory play tests.** Result: the
  test browser is 1200px wide, not the ~414px the stories assumed (probed
  locally under `nix develop` and reproduced the CI failure exactly). Both
  stories now pin a named 414px `narrowPane` viewport via a shared
  `NARROW_VIEWPORT`. Inventory stories: 22/22 pass. Full storybook project:
  169/170; the one remaining failure is `Navbar > Project Open`, the known
  macOS `Ctrl+P` vs `⌘P` tooltip assertion, which passes on Linux CI.
- [x] **2. Remove the Node teardown error.** Result: not reproducible on the
  current tree. The combined run (`vitest run`, unit + storybook) exits 1 only
  because of the Navbar tooltip test, with no `closeBrowserProvider` line and
  no hang (13.9s). The error came from the pre-pin tree: the Deno lock pinned
  `@storybook/addon-vitest@10.5.10` (vitest 3.2.7), while npm resolved 10.6.2
  against vitest 5. Left the current pins alone since they run clean; re-check
  if the storybook project starts printing the error again.
- [x] **3. Make `e2e` green under npm.** Result: 127/127 pass locally
  (`nix develop`, `node node_modules/@playwright/test/cli.js test`, 1.1 min;
  was 7 pass / 120 fail). Fixed three things:
  - `webServer` ran bare `vite`, which is not on `PATH` under npm (exit 127).
    Now `npm run dev -- --port 5199`.
  - Tour button labels are `Skip` and `Next`, not `skip tour` / `next step`
    (19 + 1 call sites). Matches `OnboardingTour.svelte`.
  - `expectInViewport` read the card box once, right after the Navbar heading
    mounted, before the tour positioned it (y = -720 for ~150ms, then y = 83).
    It now polls until containment holds. A negative control confirmed an
    off-screen box still fails. This was a real test race, not a regression
    from `main`: `main`'s CI run passed on the first attempt, which is why it
    looked fine there. Skip VRT.
- [x] **4. Move the spike to FINISHED and close it out.** Done: the Node vs.
  Deno numbers are in `FINISHED.md`, and the spike section is removed from
  this file.
- [x] **5. Fix the 10 ESLint errors** in SvelteKit `+page.ts`/`+layout.ts`.
  Result: not reproducible, so no code change. `npm run lint` (sync, then
  eslint) and `npm run eslint` both exit 0 with 0 problems locally, and the
  `lint` job passes on the latest CI run. The errors came from stale generated
  state in the local tree, not from the code. Ruled out along the way: the
  TypeScript and typescript-eslint versions (they match the Deno lock), the
  `.eslintcache` (clean with and without it), and the `$types` include (adding
  it changed nothing, so it was reverted). If they return, run `npm run sync`
  first.
- [x] **6. Reintroduce formatting.** Result: Prettier 3 with the Svelte plugin,
  default settings. The reformat (210 files) landed as its own commit; a
  token-stream check confirmed the TS/JS changes are whitespace and punctuation
  only. `format:check` runs in the CI lint job (#396). Measured drift: 207
  files, not the ~130 estimated earlier, because `.svelte` files are included.
- [x] **7. Verify the Dockerfile build.** Result: the `docker` workflow on
  `main` (run 38578075822) builds the image. The frontend stage runs `npm ci`
  and `npm run build` on `node:24-bookworm`, and the image exports.
- [x] **8. Triage `npm audit`.** Result: 4 moderate findings, 0 after the
  fix. Two were real, two were stale metadata:
  - `dompurify@3.2.7` (under `monaco-editor`, runtime path): pinned to
    `3.4.17` via `overrides`. Monaco's own latest (`0.57.0`) still resolves to
    `3.4.15`, which is vulnerable, so a Monaco bump would not clear it.
  - `postcss-selector-parser@6.0.10` (under `@tailwindcss/typography`, build
    time only): pinned to `7.1.6` via `overrides`. The built CSS is identical
    (172 `.prose` rules, 183,129 bytes, same hash) with and without it.
  - `@tailwindcss/typography` itself was a false positive; its range came from
    the parser above. npm's suggested fix (`0.5.4`) would be a downgrade.
  - Verified: `npm run build`, unit 59/59. e2e is flaky on both trees: the
    command-palette tests failed in 2 of 5 runs with the overrides and 1 of 4
    without. Different palette tests each time, all passing when rerun alone,
    so this is a pre-existing timing flake, tracked as its own follow-up.
- [x] **9. Remove all non-idiomatic constructs in `package.json`** - all `override`
  options or very precise dependency pinning which was the part of this migration
  shall be removed. Result: the 41 exact pins are caret ranges (same resolved
  versions). The two `overrides` stay as audit fixes; see the note at the bottom
  of this file for when they can go.

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
