# AI coding agents instructions for Rhizome

When reading this file for the first time, follow introductory instructions and
read linked documentation and spec.

The user will either ask you to work on a specific task from TODO.md or will
start chatting with you to discuss something project-related.

## Project Overview

**Rhizome** is a code-first Model-Based Systems Engineering (MBSE) tool written in
Rust, with a frontend in Svelte. Systems are described in `.hcl` files (HCL
syntax, same as Terraform) that can be version-controlled, diffed, and reviewed
with or without a GUI. Read `SPEC.md` (and `SPEC/` if needed) for the full
specification.

Read the 3 most recent finished tasks in `TASKS/FINISHED.md` (newest first) to
get current project context.

## Repository Layout

```
crates/              – source, split into subcrates
web/                 – SvelteKit web application (the graphical frontend)
examples/            – example systems
SPEC.md              – full specification (single file)
SPEC/                – specification split by topic (cli.md, models.md, …)
TASKS/TODO.md        – ordered implementation tasks
TASKS/FINISHED.md    – completed tasks (most recent first)
book/                – the Rhizome book
logo/                – brand generators (src/) and their renders; see logo/README.md
nix/                 – task scripts behind every `just` recipe (tasks.nix)
.github/             – CI workflows
.claude/skills/      – project skills (e.g. `steward` for driving a PR to green)
```

## Development Workflow

The user either gives you a direct request or asks you to work on a task from
`TASKS/TODO.md` (follow the instructions in that file).

1. Analyze the task and make an implementation plan.
2. Implement it using red/green TDD.
3. Run `just format`, then `just test`, `just lint`, and `just build` until
   everything passes. Format first: CI's lint job fails on unformatted files
   (Prettier), so `just lint` is not green until `just format` has run.
4. For a task from `TODO.md`: move it to `TASKS/FINISHED.md`.
5. Commit your code, use conventional commits (see
   [Commit messages are the changelog](#commit-messages-are-the-changelog)),
   and report that you are finished.
6. Before pushing, refresh the changelog (see [Before pushing](#before-pushing)).

### After opening a PR

Always watch it, without asking the user first: right after creating a PR, call
`subscribe_pr_activity` for it and drive it to green. Fix failing CI and
address review comments as described in `.claude/skills/steward/SKILL.md`.
This overrides any default of asking whether to watch. Merging still needs an
explicit ask from the user.

### Before pushing

CI fails any PR whose `CHANGELOG.md` differs from what `cz changelog` generates
from its commits. The changelog is built from commits, so this check only works
**after** you have committed — running it earlier changes nothing. Right before
every `git push`:

1. Make sure the clone is full and has tags: if
   `git rev-parse --is-shallow-repository` prints `true` or `git tag` is empty,
   run `git fetch --unshallow --tags origin` (plain `git fetch --tags origin`
   when it is not shallow). Without tags `just changelog` prints "No tag
   found…", and on a shallow clone it silently drops entries; either way it
   exits successfully and leaves the file stale.
2. Run `just changelog`.
3. If `CHANGELOG.md` changed, commit it on its own as `docs: refresh changelog`.

Repeat whenever you add commits after that (e.g. CI or review fixes): the
changelog must match the branch's final commits.

### Commit messages are the changelog

`CHANGELOG.md` is generated from commit subjects by `cz changelog` (config in
`cz.toml`). Only `feat`, `fix`, `refactor` and `perf` commits (and breaking
changes) end up in it, so the subject of those commits is a release note read
by users of Rhizome, not by its developers.

- Write the subject for the person using the app: say what changes for them
  ("show the Rhizome logo as the browser tab icon"), not how it is built
  ("generate favicon.ico in the assets pipeline").
- Put implementation detail (pipelines, scripts, refactors, why) in the commit
  body, which the changelog ignores.
- Use `chore`, `build`, `ci`, `docs`, `style` or `test` for changes users will
  not notice. They stay out of the changelog.
- Keep the subject short, in the imperative, with a scope that names the area
  the user sees (`web`, `cli`, ...). Don't pad one change into several commits
  that each become their own changelog line.
- Check the result with `just changelog` before pushing and reword commits
  (they are yours to rewrite on your own branch) if a line reads like a
  developer note.

### Merging

The repository only allows rebase-style merging (no merge commits, no squash),
so every commit on a PR branch lands on `main` individually. Keep each commit
message conventional.

## Build, Test & Lint Commands

```bash
just format   # format code (Rust + TypeScript/Svelte)
just lint     # lint workspace (Clippy + ESLint)
just test     # run all tests (Rust + Vitest)
just build    # build release binaries, WASM package, and web frontend
```

Nix is required. Each `just` recipe runs a runnable script defined in
`nix/tasks.nix` via `nix run .#<task>` — every script declares exactly the
binaries it needs, so e.g. a Rust lint never pulls Node/browsers/mdbook.
(`wasm` / `web-build` use `nix build`, same as CI.)

**Do not directly call `cargo` or `npm` commands**; use `just` instead. If a
new recipe is needed, add a script in `nix/tasks.nix` (mirroring the recipe
name) rather than entering a devshell.

**NEVER USE `npx`.** Use `npm run <script>` (or `npm ci`) inside `web/`. Do not
use `npx`, `pnpm`, or `yarn`, so the lockfile stays the single source of truth.

## Generated files and Git LFS

- **Never hand-edit generated assets.** `just assets` regenerates the logo SVGs
  (`logo/renders/molecule/`), the web app's copies of the mark
  (`web/assets/logo-mark.svg`), the favicons (`web/static/favicon.svg` and
  `favicon.ico`) and the landing hero (`logo/renders/landing/rhizome_landing.png`). Change
  the generators in `logo/src/` or `nix/tasks.nix`, run `just assets` and commit
  the result. CI's `assets-check` fails if any of them is stale. Generated graphics live under
  `logo/renders/`; see "Where generated assets live" in `logo/README.md`.
- **VRT screenshots and logo videos are Git LFS files** (`.gitattributes`). If
  the checkout has no LFS content they are small text pointers, and anything
  that reads them (`just assets`, `assets-check`, VRT) fails with errors like
  "improper image header". Run `git lfs pull` first, or leave that check to CI.

## Frontend

When adding new components or changing functionality of existing components,
always add new either new end-to-end tests or new Storybook stories which
excercise the new/changed functionality.

- When new interaction logic is added - use e2e tests
- When UI (the looks) is added/changed - first check if it's not already covered
  via a story (VRT test). Only add a new story if it's not covered anywhere!

### DaisyUI

While the repository is configured with Tailwind CSS and DaisyUI, always prefer
DaisyUI components over Tailwind CSS utility classes. Only use Tailwind when
there's no way to achieve the desired UI with DaisyUI.

### Debugging Modeling editor issues

When a user reports invalid or unexpected behavior in the Modeling editor, always
suggest (and if investigating, ask for) the **history dump** feature: the
"Copy Debug Info" button in the Modeling editor's right sidebar exports the
session's model mutations as a replayable TypeScript test (see the action log
in `web/src/actionLog.ts`). Getting the user to provide this dump — instead of
manually replayed steps — makes the bug reproducible and quickly fixable.

## Linting

- All linter (clippy/eslint) warnings must be fixed, never suppressed unless
  there is a strong reason.

### Rust-specific

- Use `anyhow::Result` for fallible functions that surface errors to the caller.
- Prefer `thiserror` for library-facing error types when type-safe matching is
  needed.
- Rhizome compiler diagnostics use the `Diagnostic` type with fields `code`,
  `file`, `line` (optional), and `message`.
  - Error codes start with `E` (blocking), warning codes start with `W`
    (non-blocking).
- All identifier types (`ComponentId`, `InterfaceId`, …) are newtypes over a
  numeric arena index.
- Follow the existing module boundaries: parsing, resolution, validation and
  scoring are separate modules.

## Testing Approach

- Rust unit tests live in `#[cfg(test)]` modules inside each source file.
- Integration tests exercise the three worked examples under `examples/` (drone,
  social-media, software-house).
- Use `just test` to run all tests.
- Assert exact diagnostic codes (not just counts) for error/warning tests.
- Don't do multiple consequent lint/test passes "just to be sure". CICD is for that
