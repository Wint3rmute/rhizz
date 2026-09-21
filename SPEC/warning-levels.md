# Warning Levels

> **Impl:** the `WarningLevel` enum and the gating rule live in
> `crates/rhizz-core/src/diagnostics.rs`; the per-code level is declared in
> `SPEC/diagnostics/W*.md` and compiled into `DiagnosticCode` by `build.rs`.

A **warning level** describes how much detail a project is being specified at.
It selects how much feedback the compiler gives: a high-level specification
should not be nagged about leaf-level detail it has not written yet, while a
component-level specification should be.

Levels gate **warnings only**. Errors are always reported, and a model that
compiles at one level compiles at all of them — a level changes the feedback,
never the verdict.

## The three levels

| Level | Intent | Expected detail |
| ----- | ------ | --------------- |
| `business` | Business spec — super high-level | Systems and components, maybe connections. No ports, messages or fields yet. |
| `architectural` | Architectural spec — high-level overview | Decomposition into components, wiring between them, diagram layouts. |
| `component` | Component-level spec — low-level details | Ports, protocols, messages, fields, descriptions, typed connection endpoints. |

`component` is the most detailed level and the **default**, so compiling without
an explicit level reports every warning.

## Semantics

Levels are cumulative and totally ordered:

```text
business < architectural < component
```

Each warning declares the **least-detailed** level it belongs to
(`min_warning_level`). It is reported at that level and every more detailed one,
so `business`-level warnings are seen by everybody and `component`-level
warnings only by component-level specs. Formally, a warning is reported when

```text
selected_level >= warning.min_warning_level
```

with errors short-circuiting the comparison. Because the check is a single
threshold, adding a level later is a matter of inserting it in the ordering.

## Choice of level

The rule of thumb, which also drives the mapping below:

- **Contradictions, typos and dangling references** are worth flagging at any
  level of abstraction — the author wrote something down and got it wrong.
  → `business`
- **Incompleteness of the decomposition** (missing children, unwired or unused
  definitions, dangling view nodes) is what an architectural pass is for.
  → `architectural`
- **Missing detail on an individual entity** (no description, no fields, no
  messages, an untyped endpoint, an unconnected port) is exactly what a
  high-level spec legitimately has not written yet. → `component`

## Warning code mapping

Each warning's level is declared in its own file under
[`SPEC/diagnostics/`](diagnostics/), which is the source of truth; this table is
a generated-by-hand summary. Change the level in the diagnostic file.

| Code | Warning | Level |
| ---- | ------- | ----- |
| W000 | General frontend warning | `business` |
| W001 | Non-leaf component has no children | `architectural` |
| W002 | Message has no fields | `component` |
| W003 | Orphan component | `architectural` |
| W004 | Missing description | `component` |
| W005 | Self-connection | `business` |
| W006 | Level decreases relative to parent | `business` |
| W007 | Mixed typed and bare connection endpoints | `component` |
| W008 | Protocol mismatch | `business` |
| W009 | Incompatible port roles (not yet implemented) | `business` |
| W010 | Unused port | `component` |
| W011 | Protocol has no messages | `component` |
| W012 | Orphan top-level component or protocol | `architectural` |
| W013 | Port role not permitted by protocol (not yet implemented) | `business` |
| W014 | Undefined protocol reference | `business` |
| W015 | Unexpected block type ignored | `business` |
| W016 | View node references unknown component | `architectural` |
| W017 | View node outside the view's system | `architectural` |
| W018 | Component missing documentation | `component` |

`W000` is emitted by frontends rather than the compiler; its declared level is
therefore inert and exists only to satisfy the format.

## Frontends

- **CLI** — `--warning-level <business|architectural|component>` (default
  `component`), see [cli.md](cli.md). The JSON output echoes the active level.
- **Web application** — a "Warning level" selector in the navbar, persisted
  across reloads.
- **`rhizz-core`** — `compile_with_warning_level(&[Source], WarningLevel)`;
  plain `compile` reports every warning.

With `--strict`, warnings are escalated to a failing exit code — but only the
warnings the selected level reports, since filtering happens before the strict
check.
