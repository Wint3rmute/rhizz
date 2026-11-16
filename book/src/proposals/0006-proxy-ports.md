# 0006: Proxy Ports and Delegation

- **Status:** draft
- **Author:** @wint3rmute
- **Created:** 2026.11.16

## Motivation

Rhizz can describe peer-to-peer connectivity (assembly) and can lift a
low-level connection into a high-level view (projection), but it cannot hide
internal complexity in the model itself. There is no encapsulation boundary:
a port is either a dead end or a leak.

Example: a `weather-service` exposes a REST API to a `user`, but is
itself decomposed into `reverse-proxy`, `auth-middleware`, and `database`.

```hcl
component "weather-service" {
  port "api" { protocol = "rest"; role = "provider"; external = true }

  instance "proxy" { source = "reverse-proxy" }
  instance "auth" { source = "auth-middleware" }
  instance "db" { source = "database" }
}

system "app" {
  instance "user" { source = "user" }
  instance "weather-service" { source = "weather-service" }

  connection "forecast" {
    from = "user/out"
    to   = "weather-service/api"
  }
}
```

Today the architect has two bad choices:

**A. Terminate on the outer port (encapsulation, no decomposition).**
`weather-service/api` is a dead end. A connection inside `weather-service`
can only wire its children to each other - it cannot wire "my own port to my
child's port", so the outer port and the internal chain dangle disconnected.
`external = true` marks the boundary for W010, but it carries no wiring
semantics.

**B. Terminate deep inside (decomposition, no encapsulation).**
```hcl
connection "forecast" {
  from = "user/out"
  to   = "weather-service/proxy/http"
}
```
The LCA rule (§2.7) forces this connection up to `system "app"`. Every reader
of `app` now sees `proxy/http`, even if they only care about `api`. The outer
`api` port goes unused (W010). Projection (§6) hides the depth in a
high-level *view*, but the *model* still names internals.

`realized_by` does not help here. It relates connection to connection
across abstraction levels with symmetric containment (W020), which fits
`bank-a → bank-b` realized by `bank-a/http → bank-b/http`, not asymmetric
encapsulation where one side stays outside and the other dives inside. Keeping
both a high-level and a low-level connection renders two edges (§6.7 item 4)
instead of one edge with two zoom levels.

This proposal introduces **proxy ports and delegation**: the outer port is an
alias for an inner port, connected by an ordinary `connection` whose one end is
the declaring scope itself. Type of the connection (assembly vs delegation) is
inferred from position, as in SysML/UML.

## Design

### 1. Proxy ports (inferred ports)

A **proxy port** is a `port` on a non-leaf component that declares a boundary
without declaring its own type:

```hcl
component "weather-service" {
  port "api" {
    external = true
    // no protocol, no role → inferred
  }
}
```

Rules:

- `external` / `required` stay declared. Only `protocol` and `role` are
  inherited from the delegation target (plus messages for scoring, direction
  for §6.1).
- Omission without delegation keeps today's meaning (undefined → incomplete,
  W019/W010 as before). Omission *with* a delegation edge means "inferred".
  This makes the feature opt-in and backward compatible.
- An inferred port MUST have `external = true`. An internal proxy is a
  contradiction.
- An inferred port MUST be on a non-leaf component (`leaf = false`). A leaf
  has no children to delegate to.
- For validation, scoring, direction inference (§6.1), and W008/W009, readers
  use the inherited values. The outer declaration itself is never checked for
  complementarity.

Explicit ports (with `protocol`/`role` written out) keep today's assembly
semantics untouched.

### 2. Delegation connections (ordinary connections, self endpoint)

A **delegation connection** is an ordinary `connection` block declared inside
the component that owns the outer port, with one endpoint naming the owner
itself:

```hcl
component "weather-service" {
  port "api" { external = true }

  instance "proxy" { source = "reverse-proxy" } // port "http"

  connection "api-delegation" {
    from = "./api"       // own port: "." + port
    to   = "proxy/http"  // child port
  }
}
```

Rules:

- Addressing reuses existing `./` / `../` machinery. `"./api"` means "port
  `api` on the declaring scope". No new syntax; single-segment `"api"` stays
  E003. `..` above a system or top-level definition stays an error, as today.
- The LCA of a delegation connection is the owner itself, so it MUST be
  declared inside the owning component. It can never leak to the top-level
  system. Encapsulation is local by construction.
- Either `from` or `to` may be the self endpoint. Direction has no meaning
  for delegation itself; §6.1 inference reads *through* it (see §5).
- A delegation connection MUST have exactly one self endpoint and one child
  endpoint. Self-to-self and child-to-child inside the same block are assembly,
  not delegation.

The system-level edge stays clean:

```hcl
system "app" {
  connection "forecast" {
    from = "user/out"
    to   = "weather-service/api"
  }
}
```

High-level view (`user`, `weather-service` placed): one edge
`user — weather-service`. Low-level view (box opened): `forecast` arrives at
the boundary dot `api`, delegation continues to `proxy/http`.

### 3. Transitive inference

Delegation chains resolve transitively. Each hop descends one hierarchy level,
so N-hop is just repeated 1-hop:

```hcl
// inside "reverse-proxy"
connection "http-delegation" {
  from = "./http"
  to   = "listener/http"
}
```

`weather-service:api` inherits from `proxy:http`, which inherits from
`proxy/listener:http`. The chain's type is the type of its terminal explicit
port. If the terminal port is freeform/undefined, the whole chain is
undefined (W019 as today, no special case).

- Resolution is bottom-up along the instance tree, iteratively (no recursion).
- The spec caps chains at **1024 hops**. A resolver MUST abort with an error
  past 1024. Each hop strictly increases tree depth, so cycles are
  structurally impossible and the cap never fires on a hand-written model; it
  exists as a termination + stack-safety guard for generated/pathological
  nesting.
- If any hop's target is missing (E003/E011), today's endpoint diagnostics
  apply; the outer port stays uninferred and is reported through the same
  path.

### 4. Exclusivity (no fan-out)

Proxy means equality, hence 1-to-1. Fan-out is rejected so inference stays
deterministic (which inner would the outer inherit from?).

- **D1 (outer):** an inferred port MUST appear as the self-endpoint in exactly
  one connection inside its owner. Zero → dangling proxy, no type to infer
  (error). More than one → fan-out (error).
- **D2 (inner):** a delegation target MUST NOT appear in any other connection
  inside the same owner. Otherwise it is double-driven (once via delegation,
  once via assembly).
- Fan-out with behavior (one outer fanning to two inners, e.g. a
  load-balancer) MUST be modeled explicitly: a Full Port with declared
  `protocol`/`role` plus ordinary internal assembly wiring. That case is not
  a proxy and must not use omission.

Deep bypass from outside (`to = "weather-service/proxy/http"` alongside the
clean `to = "weather-service/api"`) stays legal in this proposal for
migration. Closing it (forcing all outside traffic through the boundary) is
deferred.

### 5. Validation interactions

- **W010:** delegation satisfies both sides. `proxy/http` is wired from
  inside; `weather-service/api` is wired from outside via assembly. The chain
  as a whole is complete; neither end dangles.
- **W008/W009:** skipped *between* delegation ends (identity, not
  complementarity). Assembly edges touching the outer port from outside are
  checked normally, using inherited values.
- **W019/W020/W021, E017–E019 (`realized_by`):** unchanged. Delegation is not
  realization: it relates a port to a port within one component, while
  `realized_by` relates connection to connection across abstraction levels.
  A delegation edge MUST NOT appear in `realized_by` and MUST NOT declare
  `realized_by` itself (it has no protocol of its own to complete).
- **LCA (E015):** delegation lives in its owner by definition; placing it
  anywhere else is E015 as today.
- **Leaf (E012-family):** delegation inside `leaf = true` is an error (no
  children to delegate to).

### 6. Cycles

The `realized_by` graph must stay acyclic (E018) and `encapsulates` must stay
acyclic (E020). Delegation needs no separate cycle check: hops descend the
component tree monotonically, so a delegation-only cycle cannot be
constructed. The 1024-hop cap is the backstop.

## Diagnostics

Each code needs a matching file under `SPEC/diagnostics/`.

| Code | Level | Description |
|---|---|---|
| `E021` | Error | Delegation chain exceeds 1024 hops (or references an unresolvable hop). |
| `E022` | Error | Proxy-port exclusivity violated: inferred outer appears as self-endpoint in zero or more than one connection (D1), delegation target appears in another internal connection (D2), inferred port on a leaf component, or inferred port without `external = true`. |
| — | — | W010, W008/W009 (outer assembly only), W019, W020, W021, E003/E011/E015 apply as described in §5; no new warnings. |

`E022` intentionally bundles the small shape checks (leaf, `external`,
count) into one code so the happy path needs no new warnings. Message names
the offending port and the owner component.

## Scoring and views

Scoring is unchanged in shape. An inferred port scores via its inherited
protocol/messages exactly as if it had declared them. A delegation connection
scores as a connection (both ends typed by construction when inference succeeds;
incomplete only when the terminal port is undefined).

Views reuse existing blocks, no format change:

- Closed box (only the owner placed): the system-level assembly edge renders
  normally against the boundary dot. Delegation edges inside are not drawn —
  they belong to the unplaced interior.
- Open box (owner + children placed): the assembly edge arrives at the
  boundary dot, each delegation edge draws as one internal segment from the
  boundary dot to the child dot. No transitive collapsing: two hops draw two
  segments, preserving the hierarchy the architect opened.
- `node { port { side offset } }` pins the boundary dot as today; projected
  ports (§6.4) and delegation dots never collide because projected names
  always contain `/` (E004) while delegation dots use the plain outer label.
- `hidden` on the system connection applies to its assembly rendering only;
  delegation segments follow the interior visibility of their owner.

## Compatibility

Existing `.hcl` files still parse and produce identical canonical output,
validation, and scoring. All new behavior is additive and opt-in:

- `./port` self-reference is newly accepted; previously it failed endpoint
  resolution. No valid file used it.
- Omitting `protocol`/`role` without a delegation edge keeps today's
  undefined/incomplete meaning.
- No canonical-output change except round-tripping the `./port` endpoint as
  written. `realized_by`, LCA, projection, and warning levels are untouched —
  no migration needed.

## Alternatives

> [!NOTE]
>
> Alternatives outlined below have been considered **and rejected**.

### New `delegation` / `bind` block

A dedicated block (`delegation "api" { to = "proxy/http" }` or
`bind "api" = "proxy/http"`) would express intent explicitly. Rejected: it
adds a top-level concept for what position already disambiguates. One
`connection` with a self endpoint covers it; the compiler branches on
position, exactly as SysML infers assembly vs delegation from context.

### Explicit outer types (no inference)

Require the outer port to redeclare `protocol` + `role` and check equality
with the inner. Rejected: two sources of truth that drift (`rest` → `rest-v2`
updated inside, forgotten outside), plus false-positive W009 on
`provider — provider` identity edges. Inference keeps one truth at the
terminal explicit port.

### Reuse `realized_by` for encapsulation

Model `forecast` (outer) as realized by `forecast-inner` (deep). Rejected:
`realized_by` is connection-to-connection across levels with symmetric W020
containment; encapsulation is port-to-port within one component. Keeping both
connections also double-renders (§6.7 item 4) instead of one edge with two
zoom levels.

### Allow fan-out with merge/union types

Let one outer inherit from several inners (first-wins, union, or require
identical protocols). Rejected: ambiguous by construction, complicates
inference and diagnostics for a case that has behavior (balancing, routing)
and deserves an explicit Full Port + assembly wiring. Forbid it; model it.

### Transitive collapsing in views

Draw N-hop delegation as a single through-edge when the box is open.
Rejected: hides the hierarchy the user explicitly opened. Draw one segment
per hop; collapsing is what closed-box + projection already do.

## Open questions

- Syntax bikeshed: `"./api"` vs `"self/api"` vs bare `"api"` (currently E003).
  This proposal picks `"./api"` because `.` already means "current scope" in
  endpoint and `realized_by` paths. Confirm no parser ambiguity with
  definition-relative paths.
- Should deep bypass (`to = "weather-service/proxy/http"` when a proxy for
  it exists) become a warning or error in a follow-up, to enforce
  encapsulation? Left legal here for migration.
- Is 1024 the right cap, or should it match an existing nesting limit (if one
  is introduced for instance expansion)? Currently no such limit exists; 1024
  is chosen as "never hit by hand, always catches generators".
- Rendering detail: when the box is half-open (owner + some but not all
  interior placed), delegation segments to unplaced children are omitted like
  any undrawable edge — confirm this falls out of the existing
  draw-only-when-placed rule with no new omission code.
