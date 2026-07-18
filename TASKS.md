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


## (For later brainstorming) Task 48 - virtual filesystem hierarchy for frontend

High-level goal: make it possible to store multiple multi-file projects & diagrams,
with the web application pretending to have a virtual filesystem hierarchy.

## (For later brainstorming) Task 49 - visual regression testing

As we now have a virtual filesystem hierarchy for the frontend, we can create
end-to-end tests which load the project, render a diagram and verify that it
matches the expected output.

Vitest supports visual regression testing. The goal of this task is to implement
infrastructure for visual regression testing in the frontend, then ask the
developer to create diagrams, which can be saved as reference images for future
comparisons.


## (For later brainstorming) Task 50 - automatic layout via force simulation

The goal of this task is to implement automatic layout via force simulation, so
that nodes are automatically positioned to avoid overlap and minimize edge
crossings.

The functionality to trigger force simulation would be triggered by the user,
either via a button or a keyboard shortcut. The functionality shall allow to run
the force simulation and automatically position the nodes, either for all nodes
or for a selected subset of nodes.

Specific use-cases:

- Button on the bottom toolbar - "auto-layout"
- When new nodes are added to the diagram (although the force simulation should only run for new nodes)
- When exploring the system model in an interactive fashion

---

## Task <NUMBER> — Task template

- Task description here
- Requirements, spec, acceptance criteria as bullet points
- Keep on increasing the task ID when creating new tasks
- Don't remove this template, move it to the bottom instead
