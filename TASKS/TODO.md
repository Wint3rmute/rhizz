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

## Task — Line numbers for view-file diagnostics

Model diagnostics report the `file` and `line` of the block they are about (see
"Location" in `SPEC/diagnostics.md`). View diagnostics (`E004`/`E006`/`E016`
from `validate_view`, `W016`, `W017`, `W023`) still report the file only,
because view files go through a separate parser, `serialize::parse_views`, which
reads `hcl::Body` and so has no spans.

1. Move `parse_views` onto the same approach as `parse.rs`: walk the
   `hcl::edit` tree (spans) and convert each block body to `hcl::Body` for the
   serde attribute structs (`view_attrs`).
2. Record a `SourceLocation` on `ViewDefinition` and on each node, without
   affecting `PartialEq`/serialization (views are round-tripped and compared).
3. Point `E016`/`E004`/`E006` at the `view` block, `W016`/`W017` at the
   offending `node` block, and `W023` at the `filter` block.
4. Give `parse_views` errors (E000) a line, like `ParseError` does.

**Done when:** every view diagnostic in `validate_view` carries a line, with a
test per code asserting the exact line.

## Task — Renaming a component keeps its state in every view

Found while doing "Rename a connection from the Modeling editor".
`handleRenameSelectedComponent` (`web/src/routes/projects/[id]/modeling/ModelingPage.svelte`)
re-keys only the *open* view, and only the renamed node itself: `checked`,
`savedLayout` and `visiblePorts` under the old key move to the new key.

- Every other view file keeps `node "<old key>"` (and its `port` blocks), so
  the node silently drops out of those views (W016, unknown component path).
- Descendant keys (`<old key>/child/...`) are not re-keyed in any view, not even
  the open one, and neither are `portPositions`.
- The MCP `rename_component` tool does not touch view files at all.

Mirror what `rename_port` / `rename_connection` do: have `rename_component`
report the key prefix change in `MutationResult`, add a core helper
(`rename_components_in_views`) that rewrites `node` keys (the node and its
descendants) in one view file, call it from the web transaction for every
other view and from `mutate_project` in `crates/rhizome-server/src/storage.rs`,
and re-key the open view in memory. One undo step.

**Done when:** renaming a placed component (with placed children) keeps its
nodes, sizes and port spots in every view, open or not, from the inspector and
over MCP, and Ctrl+Z restores all of it.

---
