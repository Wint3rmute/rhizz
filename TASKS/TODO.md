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

## Task — Examples declare their own name and description

The name and description of every example project are hard-coded twice:

- `crates/rhizome-core/build.rs` (`generate_example_projects`) has a `match`
  on the directory name that supplies `ExampleProject::name` and
  `ExampleProject::description` for the web app's example picker. A new
  example falls through to `"Example architecture project"`.
- `examples/README.md` keeps its own table of the same examples (domain and
  what each one shows).

Make each example the single source of truth for its own metadata, and derive
both from it:

1. Decide where an example declares it. The language already has a `project`
   block (`Project` in `crates/rhizome-core/src/model.rs`: name, version,
   authors). Either extend it with a `description`, or use a small
   example-only file. Prefer the `project` block if it fits the SPEC, since
   it also helps real projects.
2. `build.rs` reads the name and description from each example instead of the
   `match`. A missing declaration should fail the build, not fall back.
3. Generate the README table (or replace it with a pointer to the picker /
   each example's declaration), with a check in CI that fails on drift, like
   `assets-check`.
4. Update SPEC (`project` block attributes) if the language changes.

**Done when:** adding a directory under `examples/` with its declaration is
enough for it to show up correctly in the picker, the README and the example
build test (`crates/rhizome-cli/tests/integration_test.rs`), with no other
hand edits.
