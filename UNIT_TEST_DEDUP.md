# Unit test dedup

Scope: `web/src/**/*.test.ts` (63 unit test files) via `cd web && npm run test`
(`vitest run --coverage`, 110 files including stories). Source under
`web/src` untouched; only test files changed.

## Removal and consolidation log

| Removed test | File | Replacement | Justification |
|---|---|---|---|
| `returns all definitions on the Components tab (definitions only)` | `web/src/routes/projects/[id]/inventory/inventory.test.ts` | Kept identical `returns all definitions on the Components tab` above it | Exact duplicate: same input and asserted output |
| `reports an endpoint with its port to clean up` | `web/src/routes/projects/[id]/modeling/deleteConnection.test.ts` | Kept `names both endpoints and every unused endpoint port` | Subset: same `LINKED` HCL; `from.port` + `removablePorts` implied by the fuller `from`/`to`/`removablePorts`/`keptPorts` assertion |
| 5 happy-path `projectSlug` cases | `web/src/vfs/slug.test.ts` | One `it.each` with 5 rows | Differ only by input value, same normalization assertion |
| 2 `reportVfsSizeBytes` cases | `web/src/vfs/metrics.test.ts` | One `it.each([12345, 0])` | Same gauge assertion; `0` case preserves falsy-`0` plumbing |
| 2 revision rejections | `web/src/vfs/types.test.ts` | One `it.each([1.5, -1])` | Same `int().nonnegative()` constraint, differ by value |
| 2 `descendantsOf` empty cases | `web/src/vfs/tree.test.ts` | One `it.each([file-imu, file-drone])` | Same `[]` assertion, differ by node |
| 3 `resolveNode` undefined cases | `web/src/vfs/tree.test.ts` | One `it.each` with 3 paths | Same `toBeUndefined`, differ by path shape (missing / bad intermediate / root) |
| 2 empty-project cases | `web/src/vfs/compile.test.ts` | One test covering both scenarios (second on a fresh store) | Same `[]` assertion; merged instead of deleted so both setups stay covered |
| 2 icon search cases | `web/src/components/IconAutocompleteInput.test.ts` | One `it.each` with exact-first flag | Differ by query; strictness preserved (`server` still asserts first result) |
| 8 `loadSelection` cases | `web/src/theme.test.ts` | One `it.each` with 10 rows | Multi-assert `it`s expanded to rows; all 10 scenarios kept, no assertion dropped |
| 6 `resolveViewToOpen` cases | `web/src/routes/projects/[id]/modeling/lastView.test.ts` | One `it.each` priority table, 6 rows | Differ only by which priority level applies |
| 3 `isConnectionDrawn` skip cases | `web/src/routes/projects/[id]/modeling/connectionVisibility.test.ts` | One `it.each` with 3 rows | Each flips one predicate, same `false` assertion; happy path kept separate |
| 3 annotation undo cases (edit/drag/scale) | `web/src/routes/projects/[id]/modeling/diagramSnapshot.test.ts` | One `it.each` with 3 rows (add/delete/alias kept as-is) | Same push-mutate-undo skeleton, vary only mutation + assertion |
| 2 rename `ENOENT` cases | `web/src/vfs/fs.test.ts` | One `it.each` | Same code, differ by missing side (source vs dest dir) |
| 2 rename `EEXIST` cases | `web/src/vfs/fs.test.ts` | One `it.each` | Same code, differ by sibling kind; untouched-side assertions preserved (including `b.hcl` content) |
| 2 `stat` kind cases | `web/src/vfs/fs.test.ts` | One `distinguishes files from directories` test | Same 4 assertions in one test |
| 4 sibling-collision cases | `web/src/vfs/store.contract.test.ts` | One `it.each` over existing/new kind | Same rejection, differ by file/directory combination (runs against all 3 backends as before) |

No test was deleted without a replacement covering the same input class
except the two rows marked duplicate/subset above. No assertions were
weakened; the `EEXIST`-directory case gained an extra untouched-side check.

## Flagged items (left in place)

- `pathTree` nesting vs multi-level vs root-level vs dirs-first sort:
  overlapping shapes but each pins a distinct invariant; merging would lose
  shape specificity.
- `types` `FsNodeSchema accepts both` vs member schema accepts: union-level
  vs member-level unit; kept.
- `compile` example-diagram unpack vs `fs` readdir/writeFile: end-to-end
  `populateProjectFiles` coverage; kept.
- `fs` `never leaves two nodes` vs `EEXIST`: readdir cardinality vs content
  untouched readback; kept.
- `fs` move keep-name vs move+rename: distinct branches; kept.
- Cross-project isolation in `store.contract` (6) vs `tree` scoping (2) vs
  `vfsStore` colliding ids: same theme at different layers; kept.
- `slug` case-fold collision vs contract duplicate-address: unit vs
  integration; kept.
- `history`/`TransactionManager`/`WorkspaceHarness` undo and WASM-backed
  `modelView`/`applyMutation`: same mechanics, different units; kept.
- `markdownRenderer` link variants, `commandPalette` Fuse ranking,
  `example_system` fixture shape: framework-adjacent; deleting needs a
  product decision.
- `DiagramEmbedView` `viewNameFromPath` vs `persistence`
  `viewPathFromName`: inverses, not duplicates; kept.

## Coverage comparison

`cd web && npm run test` (`vitest run --coverage`), full suite.

| Metric | Before (`main`) | After (this branch) |
|---|---|---|
| Statements | 78.06% (8391/10749) | 78.06% (8391/10749) |
| Branches | 63.90% (3538/5536) | 63.90% (3538/5536) |
| Functions | 79.63% (2077/2608) | 79.63% (2077/2608) |
| Lines | 77.31% (6115/7909) | 77.31% (6115/7909) |

No drop. Note: a single earlier run on pristine `main` reported
78.08/63.96/79.60/77.34; a re-run on the same commit produced the table
above, identical to this branch (the delta is run-to-run variance in
timing-sensitive `TransactionManager` lines 131–133, not this change).

## Summary

- Test files changed: 14 (unit tests only; no `web/src` source changes).
- Suite: 110 files passed before and after.
- Test count: 1233 before → 1231 after (−2: the exact-duplicate
  Components-tab test and the implied deleteConnection subset).
- `it.each` cases count as tests, so table conversions keep case counts;
  only the two rows above reduce the total.
- Run time: ~52s before vs ~54s after (worker noise; no meaningful change).
- Commits: `d2a81a6f` (12 files: slug/metrics/types/tree/compile,
  connectionVisibility/deleteConnection/diagramSnapshot/lastView,
  inventory/theme/IconAutocompleteInput), `0a825ffa` (fs rename/stat,
  store.contract collisions), plus lint fixups (unnecessary assertions,
  void-expression braces, `Annotation` typing) and this report.

Validation: `npx vitest run --coverage` green (110/1231),
targeted file runs green, `eslint`/`svelte-check` clean (see below).
Rust untouched (`cargo test`/`clippy` unaffected).
