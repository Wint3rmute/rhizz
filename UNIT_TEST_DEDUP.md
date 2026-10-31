# Rust Unit Test Dedup

## Removal and consolidation log

22 tests removed, 5 table-driven replacements added (net −17, 564 → 547).
All replacements use a loop over an array of cases (no `rstest` in workspace).
No production code touched; assertions unchanged.

| Removed test | Crate / file | Replacement | Justification |
|---|---|---|---|
| `unknown_attr_on_component_is_error` | `rhizz-core/src/parse.rs` | `unknown_attr_on_any_block_is_error` | Same `assert_e000_with_key` helper and same E000 + key assertion; only HCL snippet Literal differs (`component` block) |
| `unknown_attr_on_system_is_error` | `rhizz-core/src/parse.rs` | `unknown_attr_on_any_block_is_error` | Same helper/assertion; only snippet differs (`system` block) |
| `unknown_attr_on_project_is_error` | `rhizz-core/src/parse.rs` | `unknown_attr_on_any_block_is_error` | Same helper/assertion; only snippet/key differs (`project { nam }`) |
| `unknown_attr_on_protocol_is_error` | `rhizz-core/src/parse.rs` | `unknown_attr_on_any_block_is_error` | Same helper/assertion; only snippet differs (`protocol` block) |
| `unknown_attr_on_port_is_error` | `rhizz-core/src/parse.rs` | `unknown_attr_on_any_block_is_error` | Same helper/assertion; only snippet differs (nested `port`) |
| `unknown_attr_on_connection_is_error` | `rhizz-core/src/parse.rs` | `unknown_attr_on_any_block_is_error` | Same helper/assertion; only snippet/key differs (`sorce`) |
| `unknown_attr_on_message_is_error` | `rhizz-core/src/parse.rs` | `unknown_attr_on_any_block_is_error` | Same helper/assertion; only snippet differs (nested `message`) |
| `unknown_attr_on_field_is_error` | `rhizz-core/src/parse.rs` | `unknown_attr_on_any_block_is_error` | Same helper/assertion; only snippet/key differs (`typ`) |
| `unknown_attr_next_to_new_protocol_attrs_is_error` | `rhizz-core/src/parse.rs` | `unknown_attr_on_any_block_is_error` | Same helper/assertion; only snippet/key differs (`encapsulate` typo next to `leaf`) |
| `unknown_attr_next_to_realized_by_is_error` | `rhizz-core/src/parse.rs` | `unknown_attr_on_any_block_is_error` | Same helper/assertion; only snippet/key differs (`realised_by` typo) |
| `connection_encapsulates_is_rejected_as_unknown` | `rhizz-core/src/parse.rs` | `unknown_attr_on_any_block_is_error` | Same helper/assertion (`assert_e000_with_key` with `encapsulates`); retired `connection.encapsulates` rejection, same path as unknown-field |
| `e003_from_requires_port_path` | `rhizz-core/src/resolve.rs` | `e003_requires_port_path` | Same E003 + `` `c` `` + side assertion; only bare side differs. Shared fixture exposes ports on both components; `from` case kept, `to` case folded in |
| `e003_to_requires_port_path` | `rhizz-core/src/resolve.rs` | `e003_requires_port_path` | Same as above, `to` side |
| `run_build_drone_exit_0` | `rhizz-cli/src/cli.rs` | `run_build_examples_exit_0` | Same `build` + exit 0 assertion; only example name literal differs (`drone`) |
| `run_build_social_media_exit_0` | `rhizz-cli/src/cli.rs` | `run_build_examples_exit_0` | Same assertion; only example name differs (`social-media`) |
| `run_build_software_house_exit_0` | `rhizz-cli/src/cli.rs` | `run_build_examples_exit_0` | Same assertion; only example name differs (`software-house`) |
| `build_drone_exits_0` | `rhizz-cli/tests/integration_test.rs` | `build_examples_exit_0` | Same `build` + exit 0 via binary entry point; only example name differs. Kept separate from `cli.rs` unit loop (lib vs binary harness) per cross-harness rule |
| `build_social_media_exits_0` | `rhizz-cli/tests/integration_test.rs` | `build_examples_exit_0` | Same as above (`social-media`) |
| `build_software_house_exits_0` | `rhizz-cli/tests/integration_test.rs` | `build_examples_exit_0` | Same as above (`software-house`) |
| `unknown_route_falls_back_to_spa_shell` | `rhizz-server/src/server.rs` | `client_routes_fall_back_to_spa_shell` | Same 200 + `text/html` assertion; only URI differs (`/nope`). Mirrors existing loop in `spa_shell_carries_document_policy_for_profiling` |
| `deep_client_route_falls_back_to_spa_shell` | `rhizz-server/src/server.rs` | `client_routes_fall_back_to_spa_shell` | Same assertion; only URI differs (`/projects/staging/diagrams`) |
| `client_route_with_dot_in_segment_falls_back_to_spa_shell` | `rhizz-server/src/server.rs` | `client_routes_fall_back_to_spa_shell` | Same assertion; only URI differs (dot in `main.hcl` segment). Comment preserving the dot-segment rationale kept on the table test |

Kept separate (not merged):
- `e003_both_require_port_paths` — asserts `count == 2`, different assertion from single-side cases.
- `root_serves_spa_shell` — extra non-empty body assertion beyond status + content-type.
- `protocol_leaf_must_be_bool`, `protocol_encapsulates_must_be_list`, `connection_realized_by_must_be_list` — wrong-type errors, not unknown-key errors (different E000 sub-path).
- `check_drone`, `strict`, `invalid_path` — different exit codes / flags, not same assertion.

## Flagged items

Ambiguous clusters examined but left in place:

- `score::tests::connection_{matching,mismatched,undefined}_protocol_*` — differ only by protocol literals, but assert different scoring arms (complete / partial / incomplete). Kept separate per “different match arms” rule.
- `format_error_no_color` vs `format_warning_no_color` — same shape, but error (`✗`) vs warning (`⚠`) branches. Kept separate.
- `validate_view::{zero,multiple,mismatch}_emits_e016` — same code E016 but distinct trigger arms (zero vs multiple vs label mismatch). Kept separate to preserve arm coverage.
- `storage::tests::save_rejects_*` (14 tests), `server::tests::put_vfs_rejects_*`, `mcp::tests::tools_call_read_file_refuses_*` — all `is_err()` shape but distinct validation variants (dangling parent, cycle, escape, hidden, fifo, over-limit, …). Kept separate per “different error variants / Err paths” rule.
- `sentry::tests::rejects_*` (6 tests) — share `envelope_with_dsn` helper but assert distinct `EnvelopeError` variants. Kept separate.
- `resolve::tests::e017_*` (4), `e018_*` (3), `e020_*` (3), `realized_by_*` success cases (5), `w019_*` (10), `w010/w018` matrices — same-code families with different trigger fixtures or different outcome arms. Left in place; merging would collapse distinct branches.
- `proptest_serialization` — property tests with generated models; no example-test duplication found that subsumes them. Untouched.
- `#[ignore]`, `#[should_panic]`, feature-gated tests: none found (`grep -rn "#\[ignore\|should_panic\|cfg(feature" crates/` empty).

## Coverage comparison

Tool: `RUSTC_BOOTSTRAP=1 cargo llvm-cov --workspace --all-features --exclude rhizz-wasm --ignore-filename-regex "crates/.*/tests/" --doctests` (project’s `just coverage` recipe, without the 80% gate for reporting).

| Metric | Before | After | Delta |
|---|---|---|---|
| Tests (`cargo test -- --list`) | 564 | 547 | −17 (22 removed, 5 added) |
| Lines | 94.03% (27687 total, 1653 missed) | 94.00% (27569 total, 1653 missed) | −0.03pp, missed unchanged |
| Branches (regions) | 91.56% (1789 total, 151 missed) | 91.47% (1771 total, 151 missed) | −0.09pp, missed unchanged |
| Functions | 94.38% (18771 total, 1054 missed) | 94.37% (18710 total, 1054 missed) | −0.01pp, missed unchanged |

Per-file total-line drops are test-code removal only (`src/` `#[cfg(test)]` modules are counted; `crates/*/tests/` are ignored by the recipe):
- `rhizz-cli/src/cli.rs`: 1053 → 1035 (−18, missed 236 unchanged)
- `rhizz-core/src/parse.rs`: 1450 → 1405 (−45, missed 60 unchanged)
- `rhizz-core/src/resolve.rs`: 3257 → 3245 (−12, missed 136 unchanged)
- `rhizz-server/src/server.rs`: 941 → 898 (−43, missed 45 unchanged)

No new uncovered lines, branches, or functions. `cargo llvm-cov` 80% line gate passes before and after.

## Summary

- Test count: 564 → 547 (`--list` output saved; removed names above match the diff).
- Runtime: `cargo test --workspace` green warm in ~30s (compile-dominated); `cargo test -p rhizz-core` ~0.3s, `-p rhizz-server` ~0.2s, `-p rhizz-cli` ~0.05s per binary. No timing regression attributable to the change (fewer tests, same fixtures).
- Verify: `cargo test --workspace` all ok (90 book + 30 cli + 5 integration + 294 core + 2 proptest + 126 server), `cargo clippy --workspace --all-targets --all-features -- -D warnings` clean, `cargo fmt --check` clean.
