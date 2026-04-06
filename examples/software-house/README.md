# Software House

A software company modeled as a system — departments are components, business
processes are interfaces.

## What it demonstrates

- **rhizz beyond tech systems** — shows that rhizz can model any hierarchical
  system with interactions, not just hardware or software
- **Departments as components** — Engineering, Product, QA, Sales, and
  Operations, each decomposed into teams
- **Processes as interfaces** — sprint planning, bug reporting, release
  sign-off, and customer feedback are modeled as directed interfaces with
  message payloads (sprint backlogs, bug tickets, approval records)
- **Mixed completeness** — QA is fully decomposed; Sales is a leaf; Operations
  has no description or children (W001 + W005), representing a part of the org
  chart not yet modeled
- **Views** — three perspectives: org chart overview, engineering team
  internals, and cross-department process map

## Files

| File          | Contents                                                  |
| ------------- | --------------------------------------------------------- |
| `project.hcl` | Project metadata                                          |
| `system.hcl`  | The `acme-software` system with departments and processes |
| `views.hcl`   | Three view definitions at different scopes                |
