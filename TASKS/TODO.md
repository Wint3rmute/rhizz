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
- [ ] **2. Remove the Node teardown error.** The storybook project prints
  `browser.closeBrowserProvider is not a function` on exit. Find the mismatched
  `@vitest/browser-playwright` / `vitest` pin and align it. Verify: the
  storybook run exits 0 with no `closeBrowserProvider` line.
- [ ] **3. Make `e2e` green under npm.** Run `npm run test:e2e` in CI and
  locally; fix any failure caused by the toolchain (paths, `webServer` command
  resolution, `.deno` references). Skip VRT.
- [ ] **4. Move the spike to FINISHED and close it out.** Record the Node vs.
  Deno numbers from the spike in `FINISHED.md` (this section is the source).
- [ ] **5. Fix the 10 ESLint errors** in SvelteKit `+page.ts`/`+layout.ts`
  (`no-unsafe-member-access` on `any`). Likely a stale `.svelte-kit` tsconfig
  or `$types` resolution; verify with `npm run sync && npm run eslint`.
- [ ] **6. Reintroduce formatting.** `deno fmt` has no replacement. Choose a
  formatter, measure the drift (Prettier defaults flag ~130 files), and land
  the reformat as its own commit with no other changes.
- [ ] **7. Verify the Dockerfile build.** The frontend stage now copies Node 24
  from `node:24-bookworm`. Build the image on a machine with Docker and confirm
  `npm run build` succeeds inside it.
- [ ] **8. Triage `npm audit`.** Four moderate findings predate the switch.
  Review and fix or document each.

---

## (Experimental) Task <N> — Spike a Node/npm test toolchain to replace Deno for the web frontend

Frontend unit and Storybook tests run via `deno run test` in `web/`. On macOS
the combined run (unit + Storybook projects) never exits cleanly: Deno's Node
`child_process` shim drops the Vitest worker IPC channel, and the process
hangs or exits 1 with "something prevents 2 Vite servers from exiting". Each
project passes on its own. Plain Node Vitest avoids the IPC error, but it
still fails 14 `WorkspaceHarness` tests, because the WASM glue calls
`fetch(new URL(...))` on a `file:` URL, which Node's `fetch` rejects.

This task is a time-boxed experiment to answer one question: does a Node/npm
toolchain run the whole web test suite cleanly, and is it worth the cost of
changing the project's conventions? Nothing is merged to `main` from this task.
The result is a go/no-go write-up.

Requirements:

- Work in a throwaway copy of `web/` (or a scratch branch that is never merged),
  not in the main tree. `AGENTS.md`, `Justfile`, `flake.nix`, and CI stay
  unchanged, because `AGENTS.md` mandates Deno and forbids `npm`/`npx`.
- Timebox: stop after one working attempt. If the suite is not clean after the
  WASM and teardown fixes below, report what blocked it and stop.
- Fix the WASM init so Node reads the bytes from disk, e.g. `initSync` with
  `readFileSync` on `rhizz_wasm_bg.wasm`, instead of `fetch(file: URL)`.
- Run `vitest run` under Node with the `unit_tests` and `storybook` projects.
  The Storybook project needs the nix shell (`nix develop`) so Playwright finds
  the Nix-provided browsers via `PLAYWRIGHT_BROWSERS_PATH`.
- Compare against the Deno baseline from the same commit: pass/fail counts,
  wall-clock time, and whether the process exits 0.

Definition of done:

1. A written result: exit code, test counts, and runtime for Node vs. Deno, on
   the same commit, with the exact commands used.
2. Every failure or hang that remains, with the error text and a suspected cause.
3. A recommendation: migrate, keep Deno, or migrate partially (e.g. only the
   test runner). Include the cost: changes needed to `AGENTS.md`, `Justfile`,
   `flake.nix`, CI, and `deno.lock`.
4. If the recommendation is to migrate, a separate follow-up task is drafted in
   this file. The experiment itself does not change project conventions.

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
