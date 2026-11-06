# `rhizz` Specification v0.8

Rhizz is a code-first system architecture modeling tool. It combines:

- Architecture modeling
- Model-based Systems Engineering (MBSE)
- Code-first approach
- Gradual compilation (or rather validation) of your model

The goal of Rhizz is to make Software Architecture something more than drawing
diagrams and writing lengthy design documents. It provides a formalized modeling
language for defining system architectures at various levels of abstraction.

## 1. Project Structure

A project consists of a single system model file (`system.hcl` or `main.hcl`)
containing the system architecture model. View definition files live under `views/*.hcl`. Component documentation
lives under `docs/*.md`, with each Markdown file corresponding to a component (e.g. `component "plane"` -> `docs/plane.md`).

```
project/
├── system.hcl      # system model
├── docs/*.md       # component documentation
└── views/*.hcl  # system views
```

All system model entities (`project`, `system`, `component`, `protocol`, `port`,
`connection`, `message`, `field`) are maintained in the system model file. This
single-file model structure enables bidirectional translation: visual editing in
the UI deterministically serializes the complete model back to HCL without
cross-file resolution ambiguity.

---

## 2. HCL Schema

> **Impl:** see [SPEC/models.md](SPEC/models.md) — raw deserialization structs,
> HCL parsing strategy, and resolved model types.

### 2.1 `project` Block (Optional)

```hcl
project {
  name    = "military-drone"
  version = "0.1.0"
  authors = ["Alice", "Bob"]
}
```

| Attribute | Type         | Required | Default        | Description                 |
| --------- | ------------ | -------- | -------------- | --------------------------- |
| `name`    | string       | no       | directory name | Human-readable project name |
| `version` | string       | no       | `"0.0.0"`      | Semantic version            |
| `authors` | list(string) | no       | `[]`           | List of authors             |

---

### 2.2 `system` Block

Top-level block. One or more per project. One possible realization of your
project, be it a final product, one of your product variants, a prototype or a
testing setup.

```hcl
system "consumer-drone" {
  full_name = "Consumer quadcopter drone"
  tags        = ["product", "drone", "v1"]

  instance "flight-controller" { /* ... */ }
  instance "propulsion"        { /* ... */ }

  connection "fc-to-prop" { /* ... */ }
}
```

| Attribute     | Type         | Required | Default | Description                |
| ------------- | ------------ | -------- | ------- | -------------------------- |
| _label_       | string       | **yes**  | —       | Unique system identifier   |
| `full_name` | string       | no       | `""`    | Full official name, expanding abbreviations |
| `icon`        | string       | no       | `""`    | Optional FontAwesome icon name (e.g. `"microchip"`, `"server"`, `"wifi"`) |
| `tags`        | list(string) | no       | `[]`    | Filtering tags             |

**Children:** `instance`, `connection`

---

### 2.3 `component` Block

Represents a reusable physical or logical building block. Defined at the top
level, instantiated inside a system or parent component using the `instance`
block. Components declare their external interface via `port` blocks; ports are
allowed on both leaf and non-leaf components.

```hcl
component "flight-controller" {
  full_name = "Central flight management unit"
  tags        = ["electronics", "compute"]
  level       = 1
  leaf        = false

  port "dshot" {
    protocol = "dshot600"
    role     = "provider"
    /* ... */
  }

  instance "mcu" { /* ... */ }
  instance "imu" { /* ... */ }

  connection "spi-bus" { /* ... */ }
}
```

#### Attributes

| Attribute     | Type         | Required | Default          | Description                                                                |
| ------------- | ------------ | -------- | ---------------- | ---------------------------------------------------------------------------|
| _label_       | string       | **yes**  | —                | Unique identifier within parent scope (or unique top-level label)          |
| `full_name` | string       | no       | `""`             | Full official name, expanding abbreviations                                                 |
| `icon`        | string       | no       | `""`             | Optional FontAwesome icon name (e.g. `"microchip"`, `"server"`, `"wifi"`) |
| `color`       | string       | no       | `""`             | Optional border color for diagram rendering (e.g. `"#ff0000"`, `"red"`) |
| `border`      | string       | no       | `"solid"`        | Optional border style for diagrams: `"solid"`, `"dashed"`, or `"dotted"` |
| `font`        | string       | no       | `"unstyled"`     | Optional single-word font style for diagram labels: `"bold"`, `"italic"`, `"underline"` |
| `tags`        | list(string) | no       | `[]`             | Filtering tags                                                             |
| `level`       | integer      | no       | parent level + 1 | Abstraction level                                                          |
| `leaf`        | bool         | no       | `false`          | If `true`, component is atomic — may not contain child `instance`s        |

**Children:** `port` (any), `instance` (if not leaf), `connection` (if not
leaf, between child instances)

---

### 2.4 `instance` Block

`component` definitions can be pulled into a system or parent component via the
`instance` block.

```hcl
# system.hcl - top-level component definition
component "flight-controller" {
  full_name = "Main flight computer"
  tags        = ["electronics", "compute"]
  leaf        = false

  port "motor-out" { protocol = "dshot600"; role = "provider" }
  instance "mcu" { /* ... */ }
  connection "spi-bus" { /* ... */ }
}
```

Inside a system (or parent component), reference it by label:

```hcl
system "quadcopter" {
  # Instantiate the top-level component by label.
  # The label at the usage site ("fc") becomes the component's name in this system.
  instance "fc" {
    source = "flight-controller"
  }

  # Or keep the same name:
  instance "flight-controller" {
    source = "flight-controller"
  }
}
```

| Attribute | Type   | Required | Default | Description                                              |
| --------- | ------ | -------- | ------- | -------------------------------------------------------- |
| _label_   | string | **yes**  | —       | Unique identifier within the parent scope                |
| `source`  | string | **yes**  | —       | Label of the top-level `component` to instantiate        |

**Children:** None — an `instance` block carries only `source`.

**Rules:**

- `source` is a **label reference** to a top-level `component`, not a file path.
  Resolution happens during the resolution pass.
- A top-level component can itself contain child instances with `source`
  references to other top-level components.
- Circular `source` chains are detected and produce error E013.
- `source` references an undefined top-level component → error E014.
- No keys other than `source` are allowed in an `instance` block → error E012.
- **Top-level components may not contain `connection` blocks that reference
  siblings outside their own tree.** Connections inside a top-level component
  wire its own children — they cannot reference components from the system that
  sources them. (Connections at the system level wire sourced components
  together.)
- Top-level components that are not referenced by any `source` in any system
  produce warning W012 (orphan top-level component).
- Duplicate top-level component labels across files are an error (E001 — same
  scope, same block type).
- Top-level components are **not** included in scoring or view rendering unless
  they are sourced into a system.

---

### 2.5 `protocol` Block

Top-level block in the system model file. Defines a protocol schema that can be
referenced by multiple ports across components.

```hcl
protocol "spi" {
  full_name = "Serial Peripheral Interface"
  tags        = ["electronics", "serial", "bus"]
  roles       = ["provider", "consumer"]

  message "transaction" {
    full_name = "SPI transfer frame"
    field "cs"   { type = "uint8";  full_name = "Chip select line" }
    field "data" { type = "bytes";  full_name = "Payload"          }
  }
}
```

| Attribute     | Type         | Required | Default                             | Description                                      |
| ------------- | ------------ | -------- | ----------------------------------- | ------------------------------------------------ |
| _label_       | string       | **yes**  | —                                   | Unique protocol identifier across the project    |
| `full_name` | string       | no       | `""`                                | Full official name, expanding abbreviations                       |
| `tags`        | list(string) | no       | `[]`                                | Filtering tags                                   |
| `roles`       | list(string) | no       | `[]`                                | Valid port roles permitted by this protocol (empty = any) |
| `leaf`        | bool         | no       | `false`                             | Whether the protocol is concrete enough to need no further realization (like `component.leaf`) |
| `encapsulates` | list(string) | no      | `[]`                                | Labels of top-level protocols this protocol can carry as payload (e.g. `http` carries `fund-transfer`) |

`encapsulates` states a compatibility rule between protocol types,
independently of any connection. Entries must name top-level `protocol`
blocks, and the relation must be acyclic. Both rules, and the use of `leaf`
for completeness, are described in
[proposal 0002](book/src/proposals/0002-protocol-modeling.md).

```hcl
protocol "http" {
  leaf         = false
  encapsulates = ["fund-transfer"]
}
```

**Children:** `message`

---

### 2.6 `port` Block

Defined inside a `component`. Declares a typed connection point exposed by that
component. A port binds to a protocol via its `protocol` attribute (referencing
a top-level `protocol` block or specifying a freeform protocol name).

Ports carry only port-specific realization metadata (`protocol`, `role`,
`external`, `required`). All message and interface payload definitions belong
strictly inside `protocol` blocks.

```hcl
port "spi" {
  full_name = "SPI master interface"
  protocol    = "spi"      # references top-level protocol "spi"
  role        = "master"   # must match one of the roles declared on protocol "spi"
  external    = true       # public boundary port (expected to connect outside this component)
  required    = true       # mandatory to be connected when instantiated in a system
  tags        = ["electronics", "data"]
}
```

| Attribute     | Type         | Required | Default  | Description                                                                     |
| ------------- | ------------ | -------- | -------- | ------------------------------------------------------------------------------- |
| _label_       | string       | **yes**  | —        | Unique identifier within the parent component                                   |
| `protocol`    | string       | no       | `""`     | Reference to a top-level `protocol` label, or a free-form protocol name         |
| `role`        | string       | no       | —        | Role string; validated against referenced protocol's `roles` if specified       |
| `external`    | bool         | no       | `false`  | Whether this port is an external interface point intended for outside wiring    |
| `required`    | bool         | no       | `true`   | Whether this port must be connected when instantiated inside an outer system    |
| `full_name` | string       | no       | `""`     | Full official name, expanding abbreviations                                                      |
| `tags`        | list(string) | no       | `[]`     | Filtering tags                                                                  |

**Children:** None

---

### 2.7 `connection` Block

Defined inside a `system` or `component`. Wires components and ports together
across any hierarchy level.

#### Connection Placement Rule

A `connection` block belongs to the enclosing scope that orchestrates the
communication between endpoints. It must be specified in the **Lowest Common
Ancestor (LCA)** component or `system` enclosing both endpoints (or an ancestor
above it). A connection cannot be placed inside a child component referencing a
sibling or outside component.

#### Addressing & Resolution

The `from` and `to` fields accept UNIX-style port path references evaluated relative
to the block declaring the connection (e.g. `mcu/spi`, `sensors/imu/spi`,
`../sibling/port`, `/system/comp/port`). Protocol and role
compatibility is validated at resolution time. The connection carries no
messages and no direction — both are derived from the connected ports.

```hcl
component "flight-controller" {
  instance "mcu" {
    source = "mcu"
  }
}

component "mcu" {
  port "spi" { protocol = "spi"; role = "provider"; external = true }
}

component "imu" {
  port "spi" { protocol = "spi"; role = "consumer"; external = true }
}

system "drone" {
  instance "flight-controller" {
    source = "flight-controller"
  }

  instance "imu" {
    source = "imu"
  }

  # Declared in system "drone" (the Lowest Common Ancestor of 'mcu' and 'imu')
  connection "spi-bus" {
    full_name  = "SPI link between MCU and IMU across hierarchy levels"
    tags         = ["electronics", "data"]
    level        = 2
    from         = "flight-controller/mcu/spi"
    to           = "imu/spi"
  }
}
```

| Attribute      | Type         | Required | Default          | Description                                                    |
| -------------- | ------------ | -------- | ---------------- | -------------------------------------------------------------- |
| _label_        | string       | **yes**  | —                | Unique identifier within parent scope                          |
| `from`         | string       | **yes**  | —                | `"comp/port"` or relative path from declaring scope ending in a port |
| `to`           | string       | **yes**  | —                | `"comp/port"` or relative path from declaring scope ending in a port |
| `full_name`  | string       | no       | `""`             | Full official name, expanding abbreviations                                     |
| `tags`         | list(string) | no       | `[]`             | Filtering tags                                                 |
| `level`        | integer      | no       | parent level + 1 | Abstraction level                                              |

| `realized_by`  | list(string) | no       | `[]`             | Paths to connections that realize this connection at the same or a lower level of abstraction (see §3) |

`realized_by` is top-down (the higher-level connection declares how it is
realized) and may point into other scopes of the same system.

```hcl
system "banking" {
  connection "fund-transfer" {
    from        = "bank-a/payment"
    to          = "bank-b/payment"
    realized_by = ["http-request"]
  }

  connection "http-request" {
    from = "bank-a/http"
    to   = "bank-b/http"
  }
}
```

**No `direction` attribute** — direction is inferred from the `role` values of
the connected ports (see §6).

**No child blocks** — messages belong exclusively to `protocol` blocks, not connections or ports.

---

### 2.8 `message` Block

Defined inside a `protocol` block. Represents a discrete unit of information
exchanged over that protocol.

```hcl
message "position-report" {
  full_name = "Periodic GPS position update"
  tags        = ["telemetry", "gps"]
  level       = 1

  field "latitude"  { type = "float64"; unit = "deg"; full_name = "WGS84 latitude"  }
  field "longitude" { type = "float64"; unit = "deg"; full_name = "WGS84 longitude" }
  field "altitude"  { type = "float64"; unit = "m";   full_name = "Altitude MSL"    }
  field "timestamp" { type = "uint64";  unit = "ms";  full_name = "Unix timestamp"  }
}
```

| Attribute     | Type         | Required | Default      | Description                                      |
| ------------- | ------------ | -------- | ------------ | ------------------------------------------------ |
| _label_       | string       | **yes**  | —            | Unique identifier within the parent protocol     |
| `full_name` | string       | no       | `""`         | Full official name, expanding abbreviations                       |
| `tags`        | list(string) | no       | `[]`         | Filtering tags                                   |
| `level`       | integer      | no       | parent level | Abstraction level                                |

**Children:** `field`

---

### 2.9 `field` Block

Defined inside a `message`. Describes a single data element.

```hcl
field "altitude" {
  type        = "float64"
  unit        = "m"
  full_name = "Altitude above mean sea level"
  required    = true
}
```

| Attribute     | Type   | Required | Default | Description                                                                   |
| ------------- | ------ | -------- | ------- | ----------------------------------------------------------------------------- |
| _label_       | string | **yes**  | —       | Unique field name within parent message                                       |
| `type`        | string | **yes**  | —       | Free-form type string (e.g. `"uint8"`, `"string"`, `"bool"`, `"enum(A,B,C)"`) |
| `full_name` | string | no       | `""`    | Full official name, expanding abbreviations                                                    |
| `unit`        | string | no       | `""`    | Physical unit (e.g. `"m"`, `"Hz"`, `"V"`)                                     |
| `required`    | bool   | no       | `true`  | Whether the field is mandatory in the message                                 |

---

### 2.10 `view` Block

Top-level block defined in files under `views/`.
Defines a visual perspective on a system: which components are placed on the
canvas and where. Each file under `views/` holds exactly one `view` block
whose label matches the filename (`views/overview.hcl` -> `view "overview"`).
Every `node` path is resolved against the model (see §3); dangling paths emit a
warning (W016). `annotation` blocks are used to add additional comments to the view.

```hcl
view "overview" {
  system = "mini-drone"

  node "mini-drone/flight-controller" {
    x      = 20
    y      = 50
    width  = 100
    height = 50
  }

  node "mini-drone/battery" {
    x      = 20
    y      = 150
    width  = 100
    height = 50
  }

  annotation {
    x    = 20
    y    = 100
    text = "Some comment about the view"
  }
}
```

**`node` sub-block (one per placed component):**

| Attribute    | Type   | Required | Default | Description                               |
| ------------ | ------ | -------- | ------- | ----------------------------------------- |
| `x`          | number | yes      | —       | X coordinate on canvas                    |
| `y`          | number | yes      | —       | Y coordinate on canvas                    |
| `width`      | number | no       | —       | Box width in world units                  |
| `height`     | number | no       | —       | Box height in world units                 |
| `text_align` | string | no       | —       | Label placement (`center`, `top-center`)  |

A `node` may carry nested `port` blocks (zero or more) pinning a port dot to
an exact outline spot in this view. Ports without a block fall back to the
role default (consumers left, providers right, peers bottom).

```hcl
node "mini-drone/flight-controller" {
  x      = 20
  y      = 50
  width  = 100
  height = 50

  port "dshot" {
    side   = "right"
    offset = 0.75
  }
}
```

| Attribute | Type   | Required | Default | Description                                             |
| --------- | ------ | -------- | ------- | ------------------------------------------------------- |
| `side`    | string | no       | —       | Outline side (`top`, `bottom`, `left`, `right`)         |
| `offset`  | number | no       | `0.5`   | Position along the side, 0..1 (clamped; 0 = top/left end) |

A `port` block inside a `node` may also customize a *projected port* (see
§6.4). The port label is then the view-local projected name
`<relative-component-path>/<original-port-name>` — for example `B/input` or
`B/C/input` inside `node "sys/A"` — resolved against that node's component in
that view only. It carries the same `side`/`offset` semantics and does not
declare a system port:

```hcl
node "sys/A" {
  x = 20
  y = 50

  # Projected port: descendant B's port "input", shown on ancestor A.
  port "B/input" {
    side   = "right"
    offset = 0.25
  }
}
```

Projected-port customization is per-view presentation metadata, like
`annotation` blocks: it never modifies the original port and never affects
system connectivity. A stale entry whose projected port no longer resolves
(renamed or removed descendant or port) is ignored, like a stale `node` path
(W016). See §6.5 for the full rules.

Optional `filter` sub-block (selection predicate) — **not implemented yet**:
parsed and round-tripped, but no renderer applies it. See §9.

| Attribute       | Type         | Required | Default          | Description                                                               |
| --------------- | ------------ | -------- | ---------------- | ------------------------------------------------------------------------- |
| `include_tags`  | list(string) | no       | `[]` (match all) | Only include entities having ≥1 of these tags                             |
| `exclude_tags`  | list(string) | no       | `[]`             | Exclude entities having any of these tags                                 |
| `max_level`     | integer      | no       | `∞`              | Maximum abstraction level to display                                      |
| `components`    | list(string) | no       | `[]` (all)       | Whitelist of component labels to include                                  |
| `show_messages` | bool         | no       | `true`           | Whether to list messages (from connected ports) as connection edge labels |

**`connection` sub-block (zero or more per view):**

Per-view routing and visibility for one system connection, keyed by the
connection's name within its system. A connection is drawn when both
endpoint components are placed in the view, belong to the view's system,
and the connection is not hidden. Copies of one declaration (each instance
clones its definition's connections) share a name and hide together; two
different declarations sharing a name in one system are rejected (E001).
The same block also controls *projected connections* (see §6.2): when the
actual endpoints are hidden but their nearest visible ancestors are placed,
the connection is drawn between those ancestors under its original name, and
`start_side`/`end_side`/`hidden` apply to that projected rendering.

| Attribute    | Type   | Required | Default | Description                                              |
| ------------ | ------ | -------- | ------- | -------------------------------------------------------- |
| `start_side` | string | no       | —       | Border side the edge leaves (`top`, `bottom`, `left`, `right`) |
| `end_side`   | string | no       | —       | Border side the edge arrives at (same values)            |
| `hidden`     | bool   | no       | `false` | When `true`, the connection is not drawn in this view    |

- `hidden` is omitted from canonical output when `false`.
- Hiding is per-view and survives an endpoint component being removed from
  the view and placed again.
- Unknown attributes are rejected (E000), as in every other block.

**`annotation` sub-block (zero or more per view):**

A free-standing text note placed at an absolute position on the canvas. Unlike
`node`, an `annotation` block has **no label** and holds no reference into the
model — it is pure view-level metadata, persisted in `views/*.hcl` and never
written to the system model. Because it references nothing, it is not resolved
or validated and emits no diagnostics.

| Attribute | Type   | Required | Default | Description                                        |
| --------- | ------ | -------- | ------- | -------------------------------------------------- |
| `x`       | number | no       | `0`     | X coordinate on canvas (absolute, world units)     |
| `y`       | number | no       | `0`     | Y coordinate on canvas (absolute, world units)     |
| `text`    | string | no       | `""`    | Note text; may contain `\n` for a multi-line label |
| `scale`   | number | no       | `1.0`   | Font size multiplier (`1.0` = 100%)                |

- `x`/`y` are **absolute** canvas coordinates, not offsets relative to any
  component; annotations do not move when the components near them move.
- `scale` is omitted from canonical output when it equals the `1.0` default.
- Annotations are emitted sorted by `text`, keeping canonical output stable.
- Unknown attributes are rejected (E000), as in every other block.

---

### 2.11 `docs/` Folder

Markdown files under `docs/` document components (`docs/plane.md` ↔ `component "plane"`, matched by label). They are authored in the Editor and rendered as hover popups in Explore and embedded diagrams. The compiler checks their presence: a definition without a matching doc file emits a `W018` warning (see `SPEC/diagnostics/W018.md`). Doc content itself is never parsed — only the filename matters.

---

## 3. Reference Resolution

> **Impl:** see [Resolution pass](SPEC/models.md#resolution-pass) in models.md.

All references use **name-based or UNIX-style path notation**:

| Context                                           | Reference resolves to                                                  |
| ------------------------------------------------- | ---------------------------------------------------------------------- |
| `port.protocol`                                   | Top-level `protocol` label (or freeform protocol name if undefined)    |
| `connection.from` / `connection.to` (`comp/port`) | Component path + named `port` on target component                      |
| `connection.from` / `connection.to` (nested path) | Relative (`../sibling/port`, `a/b/port`) or absolute port path from scope |

| `encapsulates` (protocol)                         | Top-level `protocol` labels                                            |
| `connection.realized_by`                          | `connection` path; the last segment is always a connection label       |
| `instance.source`                                | Top-level `component` label                                            |
| `view.system`                                     | Top-level `system` label                                               |

Projected port names (`<relative-component-path>/<original-port-name>`, see
§6.4) are view-local only. They are resolved against a visible ancestor in a
specific view for rendering purposes and are never valid as `connection.from` /
`connection.to` endpoints, `realized_by` entries, or any other system-model
reference. Only ports declared in `component` blocks exist in the system model.

### `realized_by` reference syntax

A `realized_by` entry is a UNIX-style path whose **last segment is always a
connection label**. The segments before it, if any, name a component (or the
system) and are resolved exactly like the component part of a `from`/`to`
endpoint, starting from the scope that declares the connection. Because the
last segment is always the connection, there is no port-versus-component
ambiguity as in endpoint paths.

| Entry                            | Resolves to                                                                 |
| -------------------------------- | --------------------------------------------------------------------------- |
| `"tls-session"`                  | Connection declared in the same scope (sibling).                            |
| `"bank-a/http-request"`          | Connection declared inside the child instance `bank-a`. Deeper nesting works: `"bank-a/stack/tcp-stream"`. |
| `"../uplink"`                    | Connection declared in the parent scope.                                    |
| `"./tls-session"`                | Same as the bare label.                                                     |
| `"/banking/tls-session"`         | Connection declared directly in system `banking`.                           |
| `"/banking/bank-a/http-request"` | Connection declared inside instance `bank-a` of system `banking`.           |

- `.` is the current scope and `..` goes one scope up; `..` above a system or a
  top-level definition is an error.
- An absolute path starts with a system label. A path of only a system label is
  not a connection reference.
- The target must belong to the same system, or to the same top-level
  definition tree, as the declaring connection.
- Every instance gets its own copy of the connections declared in its
  definition, so a relative reference inside a definition resolves within each
  copy independently.
- An unresolvable entry is `E017`. Duplicates collapse to one. The
  `realized_by` graph must be acyclic (`E018`).
- Canonical output keeps a bare label when the target is declared in the same
  scope; other targets are written as absolute (or definition-relative) paths.
  Entries are sorted.

> **Status:** the attributes parse, are stored on the model and serialize.
> Resolution of `realized_by` is implemented (`E017`–`E019`), and so are the
> realization warnings `W019`, `W020` and `W021` (see §4). The canonical
> rewriting of entries in serialized output is not yet implemented; until then
> entries are written as declared.

---

## 4. Validation Rules

> **Impl:** validation operates on the
> [resolved `Model`](SPEC/models.md#resolved-model). Errors/warnings are
> collected as `Diagnostic` values during the
> [resolution pass](SPEC/models.md#resolution-pass).

Each diagnostic code is documented in its own file under
[`SPEC/diagnostics/`](SPEC/diagnostics/) (e.g. `E001.md`, `W003.md`). Error
codes (`Exxx`) halt compilation; warning codes (`Wxxx`) are non-blocking.

### Warning Levels

> **Impl:** see [warning levels](SPEC/warning-levels.md) — the `WarningLevel`
> ordering, the per-code mapping, and the gating rule.

Every warning declares the least-detailed spec level it belongs to —
`business`, `architectural`, or `component`. The selected warning level gates
which warnings are reported: `business`-level warnings appear everywhere and
`component`-level warnings only in component-level specs. Errors are never
gated, so an incomplete spec still compiles at every level.

### Locality of Component Verification

Rhizz supports verifying components in isolation (e.g. library components or
unit-level checks) vs. verifying a fully instantiated system:

1. **Component in Isolation:**
   - Unconnected ports with `external = true` are **expected** to be open (they form the component's public interface). No unused port warning (W010) is emitted for them.
   - Unconnected ports with `external = false` (internal ports) that are not wired between subcomponents emit W010.
2. **System Instantiation:**
   - When a component is instantiated inside a `system` or parent composite component, any port with `external = true` and `required = true` **must** be connected by the enclosing system/ancestor.
   - Unconnected required external ports emit warning W010 (or error in strict mode).

### Connection Placement Validation
- A connection must be declared within the Lowest Common Ancestor (LCA) enclosing both `from` and `to` endpoints, or an ancestor above it.
- Declaring a connection inside a child component that references sibling or external components is an error (E011/E015).

### Connection Endpoint Typing
- A connection `from`/`to` value names a port path such as `comp/port`. Resolution reports E003 when an endpoint names a component without naming one of its ports. Protocol and role checks (W008/W009), completeness (W019), and direction inference (§6) read the named ports.

### Realization Validation

Checked for every connection `A` and each connection `B` in its resolved
`realized_by` list (`B` realizes `A`). These checks do not apply to connections
without `realized_by`.

- **Hierarchy (`W020`, architectural):** the `from` endpoint of `B` must be the
  `from` component of `A` or one of its component descendants, and likewise for
  `to`. Containment is checked through component parent links, not `level`, and
  the direction is not swapped. One `W020` is reported per pair, naming each
  endpoint that falls outside.
- **Protocol compatibility (`W021`, architectural):** if `A` has protocol `P` and
  `B` has protocol `Q` (see `Model::connection_protocol`), then `Q.encapsulates`
  must contain `P`. The check is skipped when either protocol is undefined.

Both warnings are reported at the architectural warning level and above.

### Completeness Validation

Checked for every connection `c` (`W019`, architectural). A connection is
**complete** when its protocol is a leaf protocol, or when it has `realized_by`
entries and every one of them is complete:

- A connection whose protocol is undefined is always incomplete. This covers
  endpoints with differing protocols and an undefined protocol.
- A non-leaf protocol without `realized_by` is incomplete.
- `W019` is reported on every incomplete connection, including the connections
  in a realization chain. Its message names the first incomplete connection in
  the chain (the root cause) when there is one.

The computation is `rhizz_core::validate::connection_completeness`, which
returns a `Completeness` value per connection. Consumers such as the web
inspector read that result rather than reimplementing the rule.

A connection on a leaf protocol that also declares `realized_by` is `E019`, not
`W019`.

The completeness check is a warning like the realization checks: an incomplete
chain does not stop compilation.

### Projection Has No Validation Effect

Validation operates on the system graph only. Projected connections and
projected ports (see §6) are view-level derivations and:

- introduce no new validation obligations,
- do not satisfy unconnected-port (W010) obligations at intermediate levels,
- do not participate in `realized_by` resolution (E017/E018/E019) or in the
  realization warnings (W019/W020/W021).

In particular, showing a low-level connection in a high-level view via
projection never requires artificial intermediate connections or forwarding
ports, and the absence of such intermediates is not a validation error.

---

## 5. Completion Scoring

> **Impl:** scoring iterates over `Model.components`, `Model.ports`,
> `Model.connections`, and `Model.messages`, see
> [resolved models](SPEC/models.md#resolved-model). The `leaf`,
> `children`, `ports`, `messages`, and `fields` fields on those structs provide
> all inputs needed.

The completion score quantifies how fully the system has been decomposed and
specified to leaf-level entities. Each entity is scored individually, then
aggregated.

### Per-Entity Completeness

| Entity                   | Complete (1.0)                                          | Partial (0.5)                                 | Incomplete (0.0)    |
| ------------------------ | ------------------------------------------------------- | --------------------------------------------- | ------------------- |
| **Component** (leaf)     | Has full_name AND all defined ports complete          | Has full_name but ≥1 port incomplete        | No full_name      |
| **Component** (non-leaf) | ≥1 child component, all children complete               | ≥1 child component, not all children complete | No child components |
| **Port**                 | Bound protocol has ≥1 message, all messages complete    | Bound protocol has ≥1 message, not all complete | No bound protocol or protocol has no messages |
| **Connection**           | Both sides name ports with matching `protocol` | Both sides name ports with differing `protocol` | Both sides name ports with undefined `protocol` |
| **Message**              | ≥1 field (defined inside a protocol)                    | —                                             | No fields           |

A leaf component with a full_name and no ports scores Complete (1.0) — ports
are optional detail. A port referencing a `protocol` block inherits that
protocol's messages for completeness scoring. Top-level protocol messages are
scored under the Messages category.

Projected connections and projected ports (see §6) do not affect scoring.
Scoring iterates over system-model entities only; a projected rendering adds
no component, port, connection, or message to the score.

### Aggregate Score

$$\text{Score} = \frac{\sum_{i=1}^{N} s_i}{N} \times 100\%$$

Where $s_i$ is the per-entity completeness (0.0, 0.5, or 1.0) and $N$ is the
total number of components, ports, connections, and messages. Fields and the
system block itself are excluded from scoring.

### Output Format

```
Completion Report — consumer-drone
───────────────────────────────────
Components:   8/12 complete  (66.7%)
Ports:        4/8  complete  (50.0%)
Connections:  3/7  complete  (42.9%)
Messages:     5/10 complete  (50.0%)
───────────────────────────────────
Overall:      20/37           54.1%
```

---

## 6. View Rendering (Web Application)

> **Impl:** the `ViewDefinition`, `ViewFilterDefinition`, and `NodeLayout`
> structs are defined in [view models](SPEC/models.md#view-models). Views are
> parsed from `views/*.hcl` and validated against the resolved `Model`
> (E016/E006/W016); all visual rendering is owned by the web application.

Views operate on the resolved system graph. They never modify the system
model: a view selects which components are visible (via `node` blocks) and
derives how system connections appear between those visible components,
including via projection (§6.2–§6.8).

### 6.1 Connection direction

Connection direction is inferred from the `role` values of the connected ports.
For projected connections the roles of the original ports apply unchanged:

| `from` role         | `to` role                | Inferred direction             |
| ------------------- | ------------------------ | ------------------------------ |
| `provider`          | `consumer`               | unidirectional (`from` → `to`) |
| `consumer`          | `provider`               | unidirectional (`to` → `from`) |
| `peer`              | `peer`                   | bidirectional                  |
| `provider`          | `provider`               | ambiguous → W009               |
| `consumer`          | `consumer`               | ambiguous → W009               |
| `peer`              | `provider` or `consumer` | ambiguous → W009               |

### 6.2 Projected connections

Showing a low-level connection in a high-level view must not require
artificial connections or port hierarchies at intermediate component levels.
Instead, a view may display a connection between components that are visible
in that view even when the actual connection exists between their descendants.

A **projected connection** is the visual representation of an existing system
connection whose endpoints are mapped to visible ancestor components in a
view. Projection creates no new connection in the system model; it changes
only how an existing connection is represented in a particular view. The
projected connection retains the original connection's name and identity.

Example hierarchy:

```text
A
└── B
    └── port "input"

C
└── D
    └── port "output"
```

The actual system connection is `B/input ───────── D/output`. When a view
places only `A` and `C`, the renderer automatically projects the connection:

```text
A ───────── C
```

No intermediate connections, no forwarding ports, and no changes to the
system hierarchy are required. The edge is still the original connection,
shown at a higher visual level.

### 6.3 Endpoint resolution

For each system connection considered for rendering in a view:

1. Resolve the connection's actual source and destination ports and their
   owning components from the resolved system graph.
2. For each endpoint, find the **nearest visible ancestor**: starting from the
   owning component and walking up through component parent links (inclusive),
   the first component placed as a `node` in the view. If the owning component
   itself is placed, no projection is needed for that endpoint.
3. Represent the endpoint using that visible component and a projected port
   (see §6.4). A directly visible endpoint uses its original port; a projected
   endpoint uses the derived projected port.
4. Render the original connection between the resulting endpoints.

Visibility means placement as a `node` in the same view and system. The
projection is derived from the existing component hierarchy and view
visibility. It never requires explicit intermediate connections or manually
declared forwarding ports.

If either endpoint has no suitable visible ancestor, the connection is
**omitted** from that view by default. There is no contextual-node fallback:
the existing view model draws a connection only when both ends resolve to
placed components, and projection generalizes that rule without adding a new
mechanism. The `hidden` flag on the view's `connection` block still applies
per original connection name, whether the rendering is direct or projected.
Mixed cases are allowed: one endpoint may be direct while the other is
projected.

### 6.4 Projected ports

When a connection endpoint is projected onto a visible ancestor, the view
represents the underlying descendant port as a **projected port** on that
ancestor.

Projected port names are derived from the relative component path between the
visible ancestor and the component that owns the original port:

```text
<relative-component-path>/<original-port-name>
```

Examples:

```text
A
└── B
    └── port "input"
```

When `A` is visible and `B` is hidden, the projected port on `A` is named
`B/input`.

```text
A
└── B
    └── C
        └── port "input"
```

The projected port name is `B/C/input`.

The complete relative path is always used, so multiple descendants exposing
ports with identical names remain distinguishable (for example `B1/data` vs
`B2/data` on the same ancestor). Names are always derived relative to the
visible ancestor that actually renders the endpoint; if the view later places
an intermediate component, resolution re-derives a shorter name via the
nearest-visible-ancestor rule (§6.3).

Projected ports inherit their technical properties from the original port,
including protocol, role, and other relevant attributes. Identity and
technical semantics remain tied to the original port: protocol compatibility,
role-based direction inference (§6.1), and validation all read the original
ports.

Projected ports are not actual ports in the system model:

- They cannot be used as connection endpoints in system definitions
  (`connection.from` / `connection.to`) and do not participate independently
  in system validation (see §4).
- They add no score entities (see §5).
- They exist only as view-level representations of descendant ports.

### 6.5 View-level customization

Although projected ports exist only as view-level representations, they are
customizable in the view definition. At minimum, their visual position is
adjustable, exactly like other view elements:

- Visual customization belongs to the view, not the system model.
- Position and layout can be customized independently for each view.
- Customization does not modify the original port or its technical properties.
- Projected port identity and naming remain derived from the original port.
- The view can customize presentation without changing system connectivity.

Customization reuses the existing view HCL conventions — no separate
mechanism. Inside the visible ancestor's `node` block, a nested `port` block
named with the projected port name pins that dot (see §2.10):

```hcl
view "overview" {
  system = "sys"

  node "sys/A" {
    x = 20
    y = 50

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

The same `side`/`offset` semantics apply as for direct ports; ports without a
block fall back to the role default. Connection-level `connection` blocks
(`start_side`/`end_side`/`hidden`) apply to the projected rendering under the
original connection name, exactly as for direct renderings.

If the underlying hierarchy changes so a previously customized projected port
can no longer be resolved (renamed or removed descendant component or port,
or the ancestor is no longer the nearest visible ancestor), that `port` block
is ignored for rendering, like a stale `node` path (W016). It is non-blocking,
emits no system-model diagnostic beyond the existing view-path conventions,
and never alters system connectivity. The renderer falls back to the role
default when the customization cannot be applied.

### 6.6 Connection identity and semantics

A projected connection retains the original connection's name and identity.
Projection must not:

- Create a new system connection.
- Modify the original connection's endpoints.
- Change protocol compatibility.
- Alter connection direction or semantics.
- Participate in `realized_by` resolution.
- Affect system completeness scoring.
- Require additional ports or connections at intermediate hierarchy levels.

The projected connection is purely a view-level representation of the
original. Validation (§4), scoring (§5), `realized_by` semantics (§3), and
direction inference (§6.1) all operate on the system-model connection and its
original ports.

### 6.7 Edge cases

1. **Multiple connections between the same visible components:** preserve
   individual connections by default. Each retains its name, endpoints
   (projected as needed), and independent `connection`-block customization.
   The renderer must not silently merge them, even when their projected routes
   overlap.
2. **Both endpoints project onto the same visible component:** represent the
   result as a self-connection (self-edge) on that visible component, under
   the original connection name and direction. This creates no system-model
   self-connection and does not by itself emit W005, which applies to
   system-declared self-connections only.
3. **Multiple descendant ports with identical names:** relative component paths
   distinguish projected ports (for example `B1/data` vs `B2/data`). The full
   relative path is mandatory, never just the leaf port name.
4. **Explicit high-level and low-level connections projecting onto the same
   visible endpoints:** render both. For example, a declared `A/p1 ─── C/p1`
   and a low-level `B/input ─── D/output` projecting to `A ─── C` appear as
   two edges. The renderer must not silently discard either; each keeps its
   own name and independent visibility/routing. This preserves architectural
   information across abstraction levels.
5. **Nested component paths:** always derive projected port names relative to
   the visible ancestor that renders the endpoint (§6.4). The nearest-visible-
   ancestor rule guarantees the shortest correct relative path for the current
   view.
6. **Stale port customization:** when the hierarchy changes and a customized
   projected port no longer resolves, ignore that `port` block for rendering
   (see §6.5). The view remains compilable; only presentation falls back. The
   underlying system change itself is validated normally.

### 6.8 Architectural principle

| Concept               | Responsibility                                                    |
| --------------------- | ----------------------------------------------------------------- |
| System connection     | Defines actual connectivity                                       |
| System port           | Defines an actual component interface                             |
| `realized_by`         | Defines implementation relationships between abstraction levels   |
| Projected connection  | Represents an existing connection at a higher visual level        |
| Projected port        | Represents an existing descendant port on a visible ancestor      |
| View customization    | Controls visual placement and presentation                        |

The system model remains the source of truth for architecture and
connectivity. Views operate on the resolved system graph and derive projected
connections and ports from it. `realized_by` is unchanged: it relates system
connections across abstraction levels, while projection relates a single
system connection to its visual representation in a particular view.

---

## 7. CLI Interface

> **Impl:** see [SPEC/cli.md](SPEC/cli.md) — `clap` struct layout, JSON output
> schema, pipeline stages, and error formatting.

The CLI is implemented in the `rhizz-cli` crate, which is a thin frontend over
`rhizz-core`. It is responsible for file discovery, output formatting, and exit
codes. All model compilation,
validation, and scoring logic lives in `rhizz-core` — `rhizz-cli` contains no model logic of its own.

```
rhizz <command> [options] [path]
```

| Command              | Description                                                            |
| -------------------- | ---------------------------------------------------------------------- |
| `rhizz check <path>` | Parse, validate, and report errors/warnings. Exit code 0 if no errors. |
| `rhizz score <path>` | Run `check`, then print the completion report.                         |
| `rhizz build <path>` | Run `check` + `score` in sequence (default command).                   |

### Options

| Flag       | Description                           |
| ---------- | ------------------------------------- |
| `--strict`   | Treat warnings as errors              |
| `--json`     | Output report in JSON format (for CI/CD integration) |
| `--no-color` | Disable colored terminal output       |
| `--warning-level <LEVEL>` | Least-detailed warning level to report: `business`, `architectural`, or `component` (default `component`). See §4. |

### Example Session

```bash
$ rhizz build ./drone-project/

  Parsing 2 files...
  ✓ Parsed: system.hcl, views/overview.hcl

  Validation:
  ✗ E002  system.hcl:14  connection "uart-link" references undefined component "gps-module"
  ⚠ W001  system.hcl:31  component "power-regulator" has no child components (leaf=false)
  ⚠ W004  system.hcl:82  component "motor" is missing a full_name

  1 error, 2 warnings — aborting (fix errors to continue)
```

```bash
$ rhizz build ./drone-project/   # after fix

  Parsing 2 files... ✓

  Validation:
  ⚠ W001  system.hcl:31  component "power-regulator" has no child components (leaf=false)
  ⚠ W004  system.hcl:82  component "motor" is missing a full_name
  0 errors, 2 warnings

  Completion Report — mini-drone
  ───────────────────────────────────
  Components:   8/12 complete  (66.7%)
  Ports:        4/8  complete  (50.0%)
  Connections:  3/7  complete  (42.9%)
  Messages:     5/10 complete  (50.0%)
  ───────────────────────────────────
  Overall:      20/37           54.1%

  Done.
```

---

## 8. Full Example

The preceding sections describe each block in isolation; here is how they fit
together. The canonical small example is
[`examples/single-file/system.hcl`](./examples/single-file/system.hcl)
(home-monitor — 2 protocols, 3 leaf components, 1 system with 3 instances and
2 connections), whose system block is reproduced below as it shows the
instance pattern in one place:

```hcl
system "home-monitor" {
  full_name = "Smart home environmental monitoring node"
  tags        = ["iot", "data"]

  instance "broker" { source = "broker" }
  instance "controller" { source = "controller" }
  instance "sensor" { source = "temp-sensor" }

  connection "read-sensor" {
    full_name = "I2C acquisition from sensor to controller"
    from        = "/home-monitor/sensor/i2c"
    to          = "/home-monitor/controller/i2c-in"
  }

  connection "send-telemetry" {
    full_name = "MQTT upload from controller to cloud broker"
    from        = "/home-monitor/controller/mqtt-out"
    to          = "/home-monitor/broker/mqtt-in"
  }
}
```

---

## 9. Design Decisions & Future Considerations

| Decision                                                        | Rationale                                                                                                                                                                                                               |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Connections declared in Lowest Common Ancestor (LCA) or higher  | Connects components across any hierarchy level cleanly while ensuring the connection belongs to the orchestrating ancestor, not either endpoint                                                                         |
| Reusable top-level `protocol` blocks                            | Extracts message and field schemas from individual components, enabling protocol reuse across ports and components                                                                                                      |
| Port `external` and `required` attributes                       | Enables locality of verification: components can be checked in isolation as reusable units without false unused-port warnings, while ensuring required interfaces are bound when instantiated in a system             |
| Connections name port paths (`comp/port`)                   | Port paths make protocol, role, and direction inference possible                                                                                                                                                  |
| Messages live exclusively on protocols, not components or ports | Messages represent communication exchanged between components across protocols; keeping schemas on protocols prevents duplication and makes components purely structural                                                 |
| Top-level components + `source` label reference                 | Keeps all files as valid, parseable rhizz files (no bare-body format). Reuses the existing flat-merge pipeline — `source` is resolved by label, no file I/O during resolution. Components can be reused across systems. |
| Direction inferred from port roles, not declared on connections | Eliminates a redundant field and makes role mismatches automatically detectable                                                                                                                                         |
| `type` on fields is a free-form string                          | Supports gradual specification — no type system to fight during early design                                                                                                                                            |
| `level` auto-increments from parent                             | Reduces boilerplate; explicit override still available                                                                                                                                                                  |
| Views are top-level blocks                                      | A view can reference any system; decoupled from the model itself                                                                                                                                                        |
| Protocol `encapsulates` is a name-based reference               | Captures protocol layering (Ethernet encapsulates TCP, TCP encapsulates HTTP) without deep nesting                                                                                                                     |
| Multiple frontends share one compiler core                      | Keeps all model semantics in one tested place; frontends own only I/O and presentation                                                                                                                                  |
| Projected connections/ports are view-level derivations         | Shows low-level connections in high-level views without artificial intermediate connections or forwarding ports; preserves system model as source of truth, `realized_by` unchanged                                         |

**Out of scope for v1, currently non-goals. Candidates for v2:**

- Cross-system references and shared component libraries (cross-project imports)
- Component templates with attribute overriding at instantiation sites
- Constraint / requirement blocks linked to components
- Temporal / sequence diagrams (message ordering)
- Per-message direction on bidirectional ports
- Type-checked fields with a schema language
- Diffing / changelog between model versions
- View `filter` predicates (`include_tags`, `exclude_tags`, `max_level`,
  `components`, `show_messages`) — parsed but not applied by any renderer yet

---

## 10. Frontends

`rhizz` is available as a **command-line tool** (`rhizz-cli`), a **web
application** (`web/`) for graphical modeling, and a **WebAssembly module**
(`rhizz-wasm`). All frontends share the same underlying model compiler and
produce identical results; the choice of frontend is purely a matter of
workflow preference.

> **Impl:** the web application in [SPEC/frontend.md](SPEC/frontend.md); the
> WebAssembly module in [SPEC/architecture.md](SPEC/architecture.md) for build
> instructions, JS API, and crate details.

### `rhizz-wasm`

A WebAssembly frontend that exposes the same compile pipeline to JavaScript
environments (browsers, Node.js). Callers supply HCL source content as
strings and receive back a compiled model and diagnostics — identical in
structure to what the CLI and the web application produce.
