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

## Task <N> — Palette commands: Open settings + Toggle theme

The Ctrl/Cmd-P palette (`web/src/commands/PaletteHost.svelte`) currently only
offers navigation (`commandItems` → `WORKSPACE_PAGES`, group `"Navigate"`)
plus files/views/entities. Settings lives behind the navbar gear button only
(`settingsOpen` local to `web/src/components/Navbar.svelte` →
`SettingsModal.svelte`), and theme switching lives inside that modal
(`ThemeState.svelte` / `theme.ts`). Add two palette commands so both are
reachable from the keyboard:

- **Open settings** — opens the settings modal.
- **Toggle theme** — flips light/dark via the existing `toggleTheme()`
  (pins the opposite of the currently resolved theme, leaving `auto`).

Design notes (follow existing patterns, don't invent new ones):

- **Settings signal:** `Navbar` (root layout) and `PaletteHost` (project
  layout) share no props, same as palette/tour. Add a tiny request store
  `web/src/commands/settingsRequest.svelte.ts` mirroring
  `paletteRequest.svelte.ts` / `tour/tourRequest.svelte.ts`
  (`requestSettings()` + `getSettingsRequest()`, generation counter).
  `Navbar` subscribes via `$effect` and sets `settingsOpen = true`.
  Settings is global, so the request needs no `projectId` — keep it a bare
generation bump. Alternative (lifting `settingsOpen` into shared state)
  is out of scope unless the request pattern proves awkward.
- **Command rows:** new builder next to `commandItems.ts` (e.g.
  `actionItems({ onOpenSettings, onToggleTheme })` or an extended
  `commandItems` signature — pick the smaller diff). Group `"Actions"`
  (new), ids `command:open-settings` / `command:toggle-theme`, labels
  `Open settings` / `Toggle theme`, `hint`s carrying search synonyms
  (`settings preferences`, `dark light mode appearance theme`). Icons via
  `resolveIcon` (`gear`, theme-appropriate) or emoji to match `WORKSPACE_PAGES`
  — one line decision at implementation time.
- **Wiring:** `PaletteHost` appends the action rows after `commandItems`
  (Navigate stays first per the `CommandsComeFirst` story) and before
  files/views/inventory. `handleSelect` already closes-then-acts, so no
  special close handling. Toggle calls `toggleTheme()` directly; settings
  calls `requestSettings()`.
- **Scope:** both commands are offered on every palette scope (modeling /
  explore / code / inventory) — like page commands, unlike files.

Definition of done:

1. `Ctrl/Cmd-P` → typing `settings` offers `Open settings`; Enter opens
   `SettingsModal` (same modal the gear button opens).
2. `Ctrl/Cmd-P` → typing `theme`/`dark`/`light` offers `Toggle theme`;
   Enter flips `<html data-theme>` light↔dark and persists `THEME` in
   localStorage (pinned value, per `nextSelectionOnToggle`).
3. Unit tests: action/command rows (distinct ids, labels, groups, hints
   searchable, actions invoke callbacks) — extend `commandItems.test.ts`
   or a new `*actionItems.test.ts`.
4. Stories: palette shows the new rows/groups on at least one scope;
   search-filtering for `theme`/`settings` (extend `PaletteHost.stories.ts`;
   new stories `no-vrt` where they would duplicate baselines).
5. E2E (`command-palette.spec.ts` and/or `settings-modal.spec.ts`): open
   settings via palette; toggle theme via palette flips theme + persists
   across reload.
6. `just test`, `just lint`, `just build` green; `just format` clean.

Out of scope: dedicated theme hotkey, tri-state auto→light→dark cycling,
deep-linking into a settings tab, per-project settings.

---

## Task <N> - more advanced connection routing on canvas

Currently, every connection is routed with a "double-knee" elbow
(horizontal-vertical-horizontal or vertical-horizontal-vertical jog — see
`elbowPath` in `web/src/routes/projects/[id]/modeling/geometry.ts`), always
with 2 turning points. This does not always work.

Design a smarter router. Cases it must cover:

- **1 vs. 2 knees:** smartly decide whether a single turning point suffices
  or two are needed, from the relative node positions and the sides the ends
  leave from — instead of always using two.
- **Port-anchored endpoints:** since the ports work, an edge end can sit
  anywhere on the outline (`DiagramEdge.fromPort`/`toPort` plus `PortSpot`),
  not just at a side midpoint. Same-side endpoints (both dots on e.g. the
  right edge) and facing edges currently produce awkward loops; the router
  must take the exact anchor points and their sides as inputs.
- **Out of scope here:** multiple connections between the same 2 components
  drawing over each other — that stays in the "routing multiple connections
  between 2 components" task below (PCB-style shared path with offset).

Think about existing well-thought solutions in diagram editors and propose
the smallest router covering the cases above. Geometry-level unit tests
(`geometry.test.ts`) and VRT stories for each case first, then the canvas
change.

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

## Task <NUMBER> — Task template

- Task description here
- Requirements, spec, acceptance criteria as bullet points
- Keep on increasing the task ID when creating new tasks
- Don't remove this template, move it to the bottom instead
