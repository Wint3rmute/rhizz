# 0005: Projected Connections

- **Status:** in progress
- **Author:** @wint3rmute
- **Created:** 2026.11.06

## Motivation

Showing a low-level connection in a high-level view currently requires
artificial connections and port hierarchies at intermediate component levels.
This creates model complexity and naming churn for what is purely a
presentation need.

Concrete pain: a system wires two nested components, but a view wants to show
only their parents.

```hcl
component "A" {
  instance "B" { source = "B-def" }
}

component "B-def" {
  port "input" { protocol = "sig"; role = "consumer" }
}

component "C" {
  instance "D" { source = "D-def" }
}

component "D-def" {
  port "output" { protocol = "sig"; role = "provider" }
}

system "sys" {
  instance "A" { source = "A" }
  instance "C" { source = "C" }

  # Actual connectivity lives two levels down.
  connection "low-link" {
    from = "A/B/input"
    to   = "C/D/output"
  }
}
```

A view placing only `sys/A` and `sys/C` has no way to draw `low-link` without
first declaring a fake `A/link` ↔ `C/link` connection plus forwarding ports on
`A` and `C`. Those fakes then need validation, scoring, and naming, even
though the architecture has exactly one connection.

This proposal introduces projection as a view-level feature: the view derives
how an existing connection appears between visible ancestors, without touching
the system model. Implemented in `SPEC.md` §6.2–§6.8 (plus §2.10, §3–§5 notes)
and `SPEC/models.md` / `SPEC/frontend.md`.

## Design

### 1. Projected connection

A **projected connection** is the visual representation of an existing system
connection whose endpoints are mapped to visible ancestor components in a
view. Projection creates no new system connection; it only changes how the
connection is represented in that view. The projected edge retains the
original connection's name and identity.

Example hierarchy:

```text
A
└── B
    └── port "input"

C
└── D
    └── port "output"
```

Actual: `B/input ───────── D/output`. View places only `A` and `C` →
renderer draws `A ───────── C` under the original name. No intermediate
connections, no forwarding ports, no hierarchy change.

### 2. Endpoint resolution

For each system connection considered in a view:

1. Resolve the actual source/destination ports and owning components from the
   resolved system graph.
2. For each endpoint, find the **nearest visible ancestor**: walk from the
   owning component up through parent links (inclusive) to the first component
   placed as a `node` in the view. A directly placed owner needs no projection.
3. Represent the endpoint with that ancestor plus a projected port (§3); direct
   endpoints keep their original port.
4. Render the original connection between the resulting endpoints.

Visibility is `node` placement in the same view and system. The derivation
uses only hierarchy + visibility — never explicit intermediates or forwarding
ports. Mixed direct/projected endpoints are allowed. The view's `connection`
block (`start_side` / `end_side` / `hidden`, keyed by system connection name)
applies to the projected rendering unchanged.

If either endpoint has no suitable visible ancestor, the connection is
**omitted** from that view. A connection is also omitted when projection would
render it as a self-edge: both endpoints resolve to the same visible component
but at least one endpoint was projected. Direct self-connections still render.
No contextual-node fallback: this generalizes the existing rule (draw only when
both ends resolve to placed components) without a new mechanism.

### 3. Projected ports

A projected endpoint appears as a **projected port** on the visible ancestor.
Name, view-local only:

```text
<relative-component-path>/<original-port-name>
```

```text
A └── B └── port "input"      →  visible A, hidden B  →  `B/input`
A └── B └── C └── port "input" →  visible A            →  `B/C/input`
```

The full relative path is mandatory (`B1/data` vs `B2/data` stay distinct) and
is always relative to the ancestor that actually renders the endpoint; placing
an intermediate component re-derives a shorter name via the nearest-ancestor
rule.

Projected ports inherit protocol, role, and other technical attributes from
the original port. Direction inference, protocol checks, and validation all
read the originals. They are not system ports: they cannot appear in
`connection.from` / `to`, `realized_by`, or any other system reference, add no
score entities, and participate in no validation on their own.

### 4. View-level customization

Customization belongs to the view, per-view, without modifying the original
port or system connectivity. Identity and naming stay derived; only placement
changes. It reuses existing view HCL — no separate mechanism:

```hcl
view "overview" {
  system = "sys"

  node "sys/A" {
    x = 20
    y = 50

    # Projected port B/input shown on A.
    port "B/input" {
      side   = "right"
      offset = 0.25
    }
  }

  node "sys/C" {
    x = 200
    y = 50

    port "D/output" {
      side   = "left"
      offset = 0.5
    }
  }
}
```

Same `side` / `offset` semantics as direct ports; missing blocks fall back to
the role default. If the hierarchy changes so a customized projected port no
longer resolves (renamed/removed descendant or port, or a different nearest
ancestor), that `port` block is ignored for rendering — like a stale `node`
path (W016). Non-blocking, no system diagnostic, renderer falls back to the
role default.

### 5. Identity and semantics

A projected connection retains the original name and identity. Projection must
not create a new system connection, modify endpoints, change protocol
compatibility, alter direction/semantics, participate in `realized_by`
resolution, affect completeness scoring, or require extra ports/connections at
intermediate levels. Validation, scoring, `realized_by`, and direction
inference all operate on the system connection and its original ports.

### 6. Edge cases

1. **Multiple connections between the same visible pair:** preserve each one
   with its own name and `connection`-block customization. Never silently
   merge, even when routes overlap.
2. **Both ends resolve to one component via projection:** omit. Projected
   self-edges are not rendered — when at least one endpoint was projected and
   both resolve to the same ancestor, the view draws nothing (avoids ambiguous
   duplicate-name loops such as `f1/inner` + `f2/inner` under one placed `A`;
   place the descendants to see internals). Direct self-connections still render
   under W005 as before.
3. **Identical descendant port names:** full relative paths distinguish them;
   leaf-only names are never used.
4. **Explicit high-level plus low-level onto the same visible pair:** render
   both (e.g. declared `A/p1 ─── C/p1` plus projected `B/input ─── D/output`).
   Never discard; each keeps name and independent routing/visibility.
5. **Nested paths:** always relative to the rendering ancestor; nearest-ancestor
   rule yields the shortest correct path for the current view.
6. **Stale customization:** ignore the unresolvable `port` block, keep the view
   compilable, fall back to the default. The underlying system edit validates
   normally.

### 7. Architectural principle

| Concept | Responsibility |
| --- | --- |
| System connection | Defines actual connectivity |
| System port | Defines an actual component interface |
| `realized_by` | Defines implementation relationships between abstraction levels |
| Projected connection | Represents an existing connection at a higher visual level |
| Projected port | Represents an existing descendant port on a visible ancestor |
| View customization | Controls visual placement and presentation |

The system model is the source of truth; views derive projections from the
resolved graph. `realized_by` is unchanged: it relates system connections,
while projection relates one system connection to its per-view rendering.

## Diagnostics

No new codes.

- Omission when unresolvable — or when projection would yield a self-edge —
  needs no diagnostic; it follows the existing draw-only-when-placed rule.
- Stale projected-port `port` blocks are ignored like stale `node` paths
  (W016 conventions), without a dedicated code.
- Projected self-edges never render, so they cannot emit W005; W005 covers
  system-declared self-connections only.
- W010, W019, W020, W021, E017–E019 operate on the system graph only and are
  unaffected by projection; missing intermediates are not errors.

## Scoring and views

Scoring is unchanged: projected connections/ports add no entities and iterate
over system-model data only.

View format reuses existing blocks — `node { port { side offset } }` for
projected-port dots (label = projected name, view-local) and `connection {
start_side end_side hidden }` for the projected edge under its original name.
No separate configuration mechanism and no canonical-output change except that
a used projected-port block round-trips like any other `port` layout.

## Compatibility

Existing `.hcl` files still parse and produce the same canonical output and
the same validation/scoring results. All new syntax is additive and optional;
views without projected-port blocks render as before (role defaults, omission
rule). `realized_by` semantics, LCA placement, and reference syntax are
untouched — no migration needed.

## Alternatives

- **Artificial intermediate connections + forwarding ports:** rejected. Exactly
  the naming churn and fake validation/scoring surface this proposal removes.
- **Reusing `realized_by` for visual lifting:** rejected. `realized_by` relates
  system connections across abstraction levels with hierarchy/encapsulates
  checks; projection is per-view presentation of a single connection and must
  not affect completeness or protocol rules.
- **Contextual / auto-created nodes for unresolvable ends:** rejected. The view
  model has no such mechanism; omission preserves current draw-only-when-placed
  behavior.
- **Merging parallel projections into one edge:** rejected. Silently discards
  architectural information; each connection keeps identity and independent
  routing/visibility.
- **Separate projected-port config block:** rejected. The existing
  `node { port { … } }` convention already carries `side`/`offset` and keeps
  customization view-local with minimal new syntax.

## Open questions

None. Omission-vs-contextual-nodes, naming via full relative path, per-view
`port`-block customization, and stale-entry handling were decided during
design (see above) and are specified in `SPEC.md` §6.
