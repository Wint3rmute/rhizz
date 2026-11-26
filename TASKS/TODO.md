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

## Task <N> — Rename the application from "Rhizz" to "Rhizome"

The product is now called **Rhizome** (the logo lockup and `logo/README.md`
brandbook already use the new name). Every "Rhizz" in the repository becomes
"Rhizome", in every casing and compound:

| Old | New | Examples |
| --- | --- | --- |
| `Rhizz` | `Rhizome` | UI text, docs, book, SPEC, navbar label |
| `rhizz` | `rhizome` | `rhizz-core` → `rhizome-core`, `rhizz_core`, the `rhizz` CLI binary, `rhizz-server`, `rhizz-wasm`, `x-rhizz-user` |
| `RHIZZ` | `RHIZOME` | `RHIZZ_ADDR`, `RHIZZ_DATA_DIR`, `RHIZZ_GIT_TAG`, `VITE_RHIZZ_*` |
| `RhizzX` | `RhizomeX` | `RhizzMcp` → `RhizomeMcp` |

"rhizz" isn't a substring of any other word in the codebase, so a
case-preserving replace is safe in content. Paths need `git mv`.

Scale (at the time of writing): ~1400 matching lines in ~205 files, mostly
`web/` (116 files), `crates/` (32), `book/` (16), `SPEC/`, `examples/`, `nix/`,
`.github/`, plus `Cargo.toml`, `Cargo.lock`, `flake.nix`, `Justfile`,
`fly.toml`, `README.md` and `AGENTS.md`.

### Steps

1. **Paths first.** Use `git mv` on the crate directories `crates/rhizz-*`
   (`book`, `cli`, `core`, `server`, `wasm`, …) and on any other file whose
   path contains `rhizz`: `book/css/rhizz.css`, `book/js/rhizz-embed.js`,
   `book/src/rhizz_landing.png`, and the rest from `git ls-files | grep -i rhizz`.
2. **Content.** Run the case-preserving replace above over every tracked text
   file (see the exceptions below).
3. **Rust.** Rename the crates (`name =` in each `Cargo.toml`) and the binary
   (`[[bin]] name = "rhizz"` → `"rhizome"`). Update the workspace members and
   every `use rhizz_core::…`, then regenerate `Cargo.lock` through `just build`.
   Check `build.rs`, `env!`/`option_env!` names and the WASM package name
   (`rhizz_wasm`, `rhizz_wasm_bg`, `rhizz-wasm-pkg`), which also appears in
   `web/` imports and in `nix/wasm.nix` / `nix/frontend.nix`.
4. **Nix / CI / deploy.** Update `flake.nix`, `nix/*.nix` (package and attribute
   names, `RHIZZ_VRT_FONTCONFIG_FILE`, …), `.github/workflows/*`, the Docker
   image names and the `Justfile`.
5. **Generated assets.** Run `just assets` (the landing hero is renamed to
   `rhizome_landing.png`) and `just vrt-accept`: the navbar and every page
   showing the product name change, so all VRT baselines that include text need
   re-accepting. Rebuild the book.
6. **Verify.** Run `just test`, `just lint`, `just build` and `just book`. Then
   `git grep -i rhizz` must return only the exceptions listed below.

### Exceptions and decisions (check with the maintainer before merging)

- **`CHANGELOG.md` keeps "Rhizz".** It's generated from commit messages by
  `cz changelog`, and CI fails if it differs, so old entries can't be
  rewritten. Commits from the rename onwards will say Rhizome.
- **External infrastructure isn't renamed by a commit.** Change these URLs only
  once the infrastructure behind them has been renamed:
  - GitHub repo `Wint3rmute/rhizz` (also GitHub Pages `wint3rmute.github.io/rhizz/book/`)
  - Fly app `rhizz` (`rhizz.fly.dev`, `app = 'rhizz'` in `fly.toml`)

  Until then, either keep those URLs and add them to the grep allow-list, or do
  the infrastructure rename first. Historical links to specific commits
  (`github.com/Wint3rmute/rhizz/commit/…`) keep working after a GitHub rename
  thanks to its redirect.
- **The Fly volume `source = 'rhizz_data'` must not be renamed blindly.** A new
  volume name means an empty volume, so stored projects would be lost. Keep
  the old name, or migrate the data first.
- **Browser storage keys change.** Renaming `rhizz-username`,
  `rhizz-pending-tour`, `rhizz-last-view` and any other localStorage keys
  resets those settings for existing users. Add a one-time migration that
  reads the old key, writes the new one and deletes the old one. Cover it with
  a unit test.
- **The `x-rhizz-user` header and `RHIZZ_*` env vars** are a clean break.
  Server and client deploy together, but any deployment config or secret
  setting `RHIZZ_*` (Fly secrets, CI secrets) must be renamed at the same time.
  List them in the PR description.
- **`TASKS/FINISHED.md` is historical.** Rename it too, so the grep check stays
  simple. It's only a log.

### Definition of done

- `git grep -i rhizz` returns only `CHANGELOG.md` and the agreed
  external-infrastructure exceptions.
- No path in `git ls-files` contains `rhizz`.
- The CLI binary is `rhizome`, and all tests, lints, builds, VRT and
  `assets-check` pass.
- The localStorage migration is tested, and the PR description lists every
  external rename the maintainer has to do (GitHub repo, Fly app and secrets,
  Pages URL).

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
