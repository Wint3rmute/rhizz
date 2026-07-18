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

## (For later brainstorming) Task 48 - virtual filesystem hierarchy for frontend

High-level goal: make it possible to store multiple multi-file projects & diagrams,
with the web application pretending to have a virtual filesystem hierarchy.

---

## Task <NUMBER> — Task template

- Task description here
- Requirements, spec, acceptance criteria as bullet points
- Keep on increasing the task ID when creating new tasks
- Don't remove this template, move it to the bottom instead
