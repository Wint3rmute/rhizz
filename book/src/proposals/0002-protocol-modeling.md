# 0002: Protocol Modeling

- **Status:** implemented
- **Author:** @wint3rmute
- **Created:** 2026.10.18

## Motivation

Rhizz can describe connections between components and define reusable protocol
schemas, but it cannot express whether a connection has been modeled down to a
sufficiently concrete level.

Consider a business-level connection between two banks. It represents a
funds transfer, but its actual implementation uses HTTP, TLS, TCP, and IP.
Today, these can be modeled as separate connections, but there is no explicit
relationship saying that one connection realizes another, nor a way to validate
that the resulting chain is complete and consistent.

```hcl
protocol "fund-transfer" {
  message "request" {
    field "amount" { type = "decimal" }
  }
}

protocol "http" {}
protocol "tls"  {}
protocol "tcp"  {}
protocol "ip"   {}

system "banking" {
  connection "fund-transfer" {
    from = "bank-a/payment"
    to   = "bank-b/payment"
  }

  connection "http-request" {
    from = "bank-a/http"
    to   = "bank-b/http"
  }

  connection "tls-session" {
    from = "bank-a/tls"
    to   = "bank-b/tls"
  }

  # Additional TCP and IP connections may be declared here.
}
```

Nothing connects these declarations semantically. The compiler cannot determine
whether `fund-transfer` is fully modeled, whether `http-request` implements
it, or whether the protocol layers are compatible. The model's completion score
therefore cannot account for this missing information.

This proposal introduces explicit connection realization, protocol encapsulation
rules, and recursive completeness validation.

## Design

### 1. Protocol attributes

Add two attributes to the top-level `protocol` block:

| Attribute | Type | Required | Default | Description |
|---|---|---|---|---|
| `leaf` | bool | no | `false` | Whether the protocol is considered sufficiently concrete to require no further decomposition. |
| `encapsulates` | list(string) | no | `[]` | Protocols that this protocol can carry as payload. Each value references a top-level `protocol` label. |

`leaf` follows the same default convention as `component.leaf`. A protocol with
`leaf = true` needs no further realization. A non-leaf protocol must be realized
by one or more connections whose realization chains eventually terminate at
leaf protocols.

`encapsulates` expresses a compatibility rule between protocol types,
independently of any particular connection.

For example:

```hcl
protocol "fund-transfer" {
  leaf = false

  message "request" {
    field "amount" { type = "decimal" }
  }
}

protocol "http" {
  leaf         = false
  encapsulates = ["fund-transfer"]
}

protocol "tls" {
  leaf         = false
  encapsulates = ["http"]
}

protocol "tcp" {
  leaf         = false
  encapsulates = ["tls"]
}

protocol "ip" {
  leaf         = true
  encapsulates = ["tcp"]
}
```

Here, HTTP can carry a fund-transfer interaction, TLS can carry HTTP, TCP can
carry TLS, and IP is the terminal protocol for this model.

The list describes what a protocol can carry. The direction is payload nesting:
`http.encapsulates = ["fund-transfer"]` means HTTP can carry fund-transfer messages.

Only adjacent layers
in a realization chain need to satisfy the compatibility rule.

Each `encapsulates` entry must name a top-level `protocol`. An entry that does
not is reported as `W022`, mirroring how a port referencing an undefined
protocol is reported as `W014`: the protocol may simply not have been written
yet, so the model still compiles. The entry is ignored by the compatibility
check. The `encapsulates` relation between protocols must be acyclic, and a
protocol listing itself counts as a cycle. A cycle is an error (`E020`),
because it describes a protocol that has to carry itself.

### 2. Connection realization

Add a `realized_by` attribute to the `connection` block:

| Attribute | Type | Required | Default | Description |
|---|---|---|---|---|
| `realized_by` | list(string) | no | `[]` | Connections that realize this connection at the same or a lower level of abstraction. |

Each entry references another `connection`. References may point to connections
in any scope of the same system, using the same relative or absolute path
notation as `from` and `to` (see below). A bare label refers to a sibling
connection in the same scope.

#### Reference syntax

A `realized_by` entry is a UNIX-style path whose **last segment is always a
connection label**. The segments before it, if any, name a component (or the
system) and are resolved exactly like the component part of a `from`/`to`
endpoint, starting from the scope that declares the connection. Because the last
segment is always the connection, there is no port-versus-component ambiguity
as there is in endpoint paths.

| Entry | Resolves to |
|---|---|
| `"tls-session"` | Connection `tls-session` declared in the same scope (sibling). |
| `"bank-a/http-request"` | Connection `http-request` declared inside the child instance `bank-a` of this scope. Deeper nesting works: `"bank-a/stack/tcp-stream"`. |
| `"../uplink"` | Connection `uplink` declared in the parent scope. |
| `"./tls-session"` | Same as the bare label. |
| `"/banking/tls-session"` | Connection declared directly in system `banking`. |
| `"/banking/bank-a/http-request"` | Connection declared inside instance `bank-a` of system `banking`. |

Rules:

- Relative paths follow the existing `from`/`to` rules: `.` is the current
  scope, `..` goes one scope up, and `..` above a system or a top-level
  definition is an error.
- An absolute path starts with a system label. A path consisting only of a
  system label is not a connection reference.
- The target must belong to the same system, or to the same top-level
  definition tree, as the declaring connection. A reference into another system
  is unresolved.
- Every instance of a component gets its own copy of the connections declared in
  its definition. A relative reference declared inside the definition therefore
  resolves within each copy independently, which is the intended behavior.
  Paths through instances address one specific copy.
- A reference that cannot be resolved is `E017`. The message names the entry
  and the scope that was searched.
- Duplicate entries are harmless and collapse to one.
- Canonical output keeps a bare label when the target is declared in the same
  scope. Any other target is written as an absolute path, or as a
  definition-relative path for connections inside a top-level definition, the
  same way endpoints are written today. Entries are sorted, like the connection
  `encapsulates` list.

The relationship is **top-down**: the higher-level connection declares how
it is realized. A lower-level connection does not need to refer back to the
higher-level one.

For example, assuming the referenced ports exist:

```hcl
system "banking" {
  connection "fund-transfer" {
    from        = "bank-a/payment"
    to          = "bank-b/payment"
    realized_by = ["http-request"]
  }

  connection "http-request" {
    from        = "bank-a/http"
    to          = "bank-b/http"
    realized_by = ["tls-session"]
  }

  connection "tls-session" {
    from        = "bank-a/tls"
    to          = "bank-b/tls"
    realized_by = ["tcp-stream"]
  }

  connection "tcp-stream" {
    from        = "bank-a/tcp"
    to          = "bank-b/tcp"
    realized_by = ["ip-packet"]
  }

  connection "ip-packet" {
    from = "bank-a/ip"
    to   = "bank-b/ip"
  }
}
```

The protocol of each connection is derived from its endpoint ports, as in the
existing model. A fully typed connection requires its endpoints to agree on
a protocol.

### 3. Completeness

A connection is completely modeled when its protocol is a leaf protocol, or
when it is realized by one or more connections and **every realization branch is
itself complete**.

For a connection `c`, let `R(c)` denote the connections referenced by its
`realized_by` attribute. Then:

```text
complete(c) =
    leaf(protocol(c))
    OR (
        |R(c)| > 0
        AND every r in R(c) is complete
    )
```

This recursive definition requires every branch to terminate at a leaf protocol.

`protocol(c)` is derived from the endpoints, as in the existing model. It is
defined only when both endpoints name a port, both ports declare the same
non-empty protocol, and that protocol resolves to a top-level `protocol` block.
In every other case (a bare endpoint, a port without a protocol, differing
protocols already reported as `W008`, or an undefined protocol already reported
as `W014`), `protocol(c)` is undefined and `c` is incomplete.

The following rules apply:

- A leaf protocol does not require `realized_by`.
- A non-leaf protocol without `realized_by` is incomplete.
- A freeform or untyped protocol is always incomplete.
- A non-leaf connection with a complete realization chain is complete.
- Every referenced connection must be valid and complete for the parent connection to be complete.
- `W019` is reported on every incomplete connection, not only on the root cause. Its message names the first incomplete connection in the chain, when there is one.
- A connection whose protocol is declared `leaf = true` must not also declare `realized_by`; the two declarations express conflicting modeling intentions (`E019`).

An incomplete chain is not automatically a compilation error. It produces a
warning, allowing authors to model architecture incrementally. `--strict` can
promote the warning to a failing result.

### 4. Protocol compatibility

When connection `A` is realized by connection `B`, the protocol used by `B` must
declare that it can carry the protocol used by `A`.

Formally, if `protocol(A) = P` and `protocol(B) = Q`, then `Q.encapsulates` must contain `P`. A violation is reported as `W021`.

This rule applies between each directly related pair, rather than requiring a
lower-level protocol to list every protocol appearing earlier in the chain.
Compatibility can be checked when both connections have resolved, declared
protocols. Existing handling of untyped endpoints and undefined protocol
references remains applicable; an untyped or unresolved protocol cannot
establish a fully validated realization chain.

### 5. Hierarchy consistency

A realization must not introduce endpoints outside the hierarchy represented by
the higher-level connection.

For each realized connection:

- Its `from` endpoint must refer to the same component as the parent connection's `from` endpoint, or to a descendant of that component.
- Its `to` endpoint must refer to the same component as the parent connection's `to` endpoint, or to a descendant of that component.

Apply these checks recursively at every realization step.

This uses actual component containment rather than comparing the numeric `level`
attributes. The `level` attribute remains descriptive metadata and does not
determine whether a realization is valid. Hierarchy inconsistencies
initially produce a warning (`W020`), allowing the model author to review cases that may
need more expressive modeling rules in the future. For example, a realizing
connection that runs in the opposite direction to its parent is reported, because
the `from` and `to` checks are not swapped.

### 6. Cycles

The `realized_by` graph must be acyclic. Cycles make recursive completeness
undefined and are always errors.

References may cross scopes, so cycle detection must operate on the resolved
graph of connections rather than only on sibling declarations. A connection
that realizes itself, directly or through other connections, is a cycle
(`E018`).

The same rule applies to `protocol.encapsulates` (`E020`, see section 1).

## Diagnostics

Each code requires a matching file under `SPEC/diagnostics/`.

| Code | Level | Description |
|---|---|---|
| `E017` | Error | A `realized_by` entry references a connection that cannot be resolved. |
| `E018` | Error | Connections form a cycle through `realized_by` references. |
| `E019` | Error | A connection with a leaf protocol declares `realized_by`. |
| `E020` | Error | Protocols form a cycle through `encapsulates`, including a protocol listing itself. |
| `W019` | Architectural | A connection is incomplete because its protocol is undefined or non-leaf and it has no complete realization. |
| `W020` | Architectural | A realization refers to endpoints outside the corresponding component hierarchies of the higher-level connection. |
| `W021` | Architectural | A realization violates protocol `encapsulates` compatibility. |
| `W022` | Business | A protocol `encapsulates` entry references an undefined protocol. |

`W022` has the same level as `W014`, the equivalent check for ports. Incomplete
decomposition (`W019`), hierarchy inconsistency (`W020`) and incompatible layering
(`W021`) are architectural concerns.

Warnings follow the existing warning-level rules.

Existing diagnostics for connection endpoint resolution, protocol references,
protocol mismatch, and connection `encapsulates` cycles (`E003`, `E004`) remain in effect.

## Scoring and views

> [!NOTE]
>
> Defining precise scoring rules is **explicitly out of scope** for this
> proposal. Consider those scoring rules preliminary and don't focus on them.

The connection completeness criteria in §5 of `SPEC.md` should account for realization:

| Connection state | Score |
|---|---:|
| Both endpoints are typed and protocol-compatible, and the protocol is a leaf or every realization branch is complete | 1.0 |
| One endpoint is typed, or the endpoints are typed and compatible but the non-leaf realization is incomplete | 0.5 |
| Both endpoints are untyped | 0.0 |

Existing endpoint-typing requirements remain in place. A connection cannot score
as complete merely because its endpoints are typed if its protocol is non-leaf
and its realization chain is incomplete.

No new score category is introduced. Existing component, port, message, and
field scoring remains unchanged.

No view-file syntax or canonical view format changes. Rendering realization
chains in a view is outside the scope of this proposal.

## Compatibility

Existing `.hcl` files remain parseable. The new attributes are optional, and
default-valued attributes should be omitted from canonical output so that files
without the new syntax preserve their existing serialization.

However, validation and scoring behavior may change:

- Connections using protocols without an explicit `leaf = true` or a realization chain receive `W019`. This includes connections with untyped endpoints, because an untyped connection is always incomplete (section 3). Specs that stay at the component level will see `W019` at the `architectural` warning level and above, even though untyped endpoints are otherwise treated as component-level detail.
- Projects using `--strict` may begin to fail until these warnings are addressed.
- Existing `connection.encapsulates` declarations retain their current semantics and behavior in this proposal.
- Connection `encapsulates` and protocol `encapsulates` are different attributes on different blocks. They share a name, not a code path.
- New protocol compatibility checks apply to declared realizations, not retroactively to connections without `realized_by`.

Migration consists of explicitly marking terminal protocols with `leaf = true`,
or marking non-leaf protocols with `leaf = false` and adding the necessary
realization chains.

## Alternatives

>[!NOTE]
>
> Alternatives outlined below have been considered **and rejected**.
> Those do not document the result of the proposal!

### Use only `connection.encapsulates`

The existing connection-level `encapsulates` attribute already represents
connections that a connection can carry (higher-level protocols). Extending it
could avoid introducing another relationship.

However, its current semantics resolve sibling connection labels within the
same scope. It does not directly express top-down realization across scopes with
recursive completeness requirements. This proposal keeps its existing behavior
unchanged to isolate the new semantics.

Whether `connection.encapsulates` should eventually be deprecated or unified
with `realized_by` remains open.

### Use `refines` on the lower-level connection

A lower-level connection could point back to the higher-level connection it refines.

This reverses the desired declaration direction: the higher-level connection
should state how it is realized. It also makes the modeling relationship
harder to discover when starting from an abstraction and forces implementers to
maintain backlinks.

### Compare numeric `level` values only

A rule based solely on `level` attributes is simpler, but numeric levels can
be overridden and do not prove that endpoint components belong to the correct
subtrees. Hierarchy containment provides a stronger validation rule while
leaving `level` descriptive.

### Require every connection to be terminal

Treating every declared connection as complete avoids incomplete-chain
diagnostics, but it cannot distinguish an abstract business interaction from a
concrete transport link. It also prevents the completion score from reflecting
missing decomposition.
