# Implementation Tasks

How to work on this file:

- Read the next task from this file
- Get extra context from recently finished tasks - read the first 50 lines of
  `FINISHED_TASKS.md`
- Implement the task, use red/green TDD
- Run tests & linters (`cargo test`, `cargo clippy`, `cargo doc`, `cargo build`)
  until it's all working
- Once all linters/builds/tests pass, run `cargo fmt`
- Move the completed task to `FINISHED_TASKS.md` and report that you're finished

---





## Task 45 — Extend containment clamping to grandchildren (multi-level nesting)

Small/polish item from the architecture review. Mirrors the scope note
from the previously-postponed containment-polish task, re-added here for
visibility.

Containment clamping only considers a node's *direct* parent. If
`A ⊃ B ⊃ C` are all placed on canvas, `C` clamps to `B` but not
transitively to `A`.

- Decide and implement how deep the clamping should cascade (likely:
  transitively clamp through the whole ancestor chain, not just the
  direct parent).
- Validate with `deno task check` and `deno task build`.

**Implementation plan:** The fix belongs in `reclampChildren(parentIndex)`
— today it clamps only `parentIndex`'s *direct* children against
`parentIndex`'s box. Make it recurse: after clamping each direct child,
call `reclampChildren(childIndex)` again so grandchildren (and deeper) get
re-clamped against their own just-updated parent, cascading all the way
down. Since `reclampChildren` already bails out early for any component
not currently placed on canvas, the recursion is naturally bounded by
what's actually on-screen — no separate depth limit needed.

`activeParentBox` and the per-node clamp during a drag/single resize
(which only clamp a node against its *immediate* active parent) don't
need to change — that's still correct on its own, since a node should
always stay within its direct parent regardless of nesting depth. The
transitive part is entirely handled by `reclampChildren`'s cascade once a
middle ancestor's box changes, so this task is essentially a one-function
fix plus verification.

This is UI-interaction-driven and not easily covered by the existing pure
geometry unit tests, so validate manually in the browser: place a 3-level
`A ⊃ B ⊃ C` hierarchy, drag `A` far enough that `B` has to clamp, and
confirm `C` is re-clamped to follow. Validate with `deno task check` and
`deno task build`, and update `reclampChildren`'s doc comment (which
currently says "direct child") to describe the new transitive behavior.

---

## Task 46 — Enforce containment during group-resize

Small/polish item from the architecture review.

Group-resize (proportional scaling of a multi-selection) does not enforce
parent containment at all, unlike single-node resize. This is a known,
documented gap from when group-resize was implemented.

- Decide on a reasonable behavior when a group-resize would push a
  constrained child outside its parent (e.g. cap the group scale factor to
  the most restrictive member, or clamp each affected child individually
  after the scale is applied).
- Validate with `deno task check` and `deno task build`.

**Implementation plan:** Clamp each affected child individually after the
group scale is applied, rather than solving for one "safe" group scale
factor upfront (which would need a constraint-solving pass over every
constrained member — unnecessary complexity at this project's stage).
Concretely: in `applyGroupScale`'s loop, after computing each node's
scaled `next` box as it does today, check `activeParentBox(index)`; if
present, clamp `next` through `clampWithin(next, parentBox,
CHILD_CONTAINMENT_MARGIN)` (the same helper `applyGroupDelta` already uses)
before calling `setNodeBox`. Nodes without an active parent are
unaffected.

This brings resize in line with the containment guarantee drag already
provides, at the cost of the group occasionally no longer looking like a
perfectly uniform scale when some members are constrained and others
aren't — an accepted trade-off, mirroring the one `applyGroupDelta`
already documents ("the group may not move perfectly rigidly, but no node
is ever allowed to escape its parent's box"). Once both `applyGroupDelta`
and `applyGroupScale` do the same "compute proposed box, then clamp
against own active parent if present" step, consider factoring that check
into one small shared helper.

Validate with `deno task check` and `deno task build`, and manually verify
by nesting a component, selecting a group that includes it alongside
other nodes, and resizing the group.

---

## Task <NUMBER> — Task template

- Task description here
- Requirements, spec, acceptance criteria as bullet points
- Keep on increasing the task ID when creating new tasks
- Don't remove this template, move it to the bottom instead
