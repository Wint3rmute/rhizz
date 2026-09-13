# `rhizz` Specification v0.5

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
containing the system architecture model. View definition files live under `diagrams/*.hcl`. Component documentation
lives under `docs/*.md`, with each Markdown file corresponding to a component (e.g. `component "plane"` -> `docs/plane.md`).

```
project/
├── system.hcl      # system model
├── docs/*.md       # component documentation
└── diagrams/*.hcl  # system views
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
  description = "Consumer quadcopter drone"
  tags        = ["product", "drone", "v1"]

  instance "flight-controller" { /* ... */ }
  instance "propulsion"        { /* ... */ }

  connection "fc-to-prop" { /* ... */ }
}
```

| Attribute     | Type         | Required | Default | Description                |
| ------------- | ------------ | -------- | ------- | -------------------------- |
| _label_       | string       | **yes**  | —       | Unique system identifier   |
| `description` | string       | no       | `""`    | Human-readable description |
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
  description = "Central flight management unit"
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
| `description` | string       | no       | `""`             | Human-readable description                                                 |
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
  description = "Main flight computer"
  tags        = ["electronics", "compute"]
  leaf        = false

  port "motor-out" { protocol = "dshot600"; role = "provider" }
  component "mcu"  { /* ... */ }
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
- Nested `source` is supported: a top-level component may itself contain
  children with `source` references to other top-level components.
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
  description = "Serial Peripheral Interface"
  tags        = ["electronics", "serial", "bus"]
  roles       = ["provider", "consumer"]

  message "transaction" {
    description = "SPI transfer frame"
    field "cs"   { type = "uint8";  description = "Chip select line" }
    field "data" { type = "bytes";  description = "Payload"          }
  }
}
```

| Attribute     | Type         | Required | Default                             | Description                                      |
| ------------- | ------------ | -------- | ----------------------------------- | ------------------------------------------------ |
| _label_       | string       | **yes**  | —                                   | Unique protocol identifier across the project    |
| `description` | string       | no       | `""`                                | Human-readable description                       |
| `tags`        | list(string) | no       | `[]`                                | Filtering tags                                   |
| `roles`       | list(string) | no       | `[]`                                | Valid port roles permitted by this protocol (empty = any) |

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
  description = "SPI master interface"
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
| `description` | string       | no       | `""`     | Human-readable description                                                      |
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

The `from` and `to` fields accept UNIX-style path references evaluated relative
to the block declaring the connection (e.g. `mcu/spi`, `sensors/imu/spi`,
`../sibling/port`, `/system/comp/port`). When a port is named, protocol and role
compatibility is validated at resolution time. The connection carries no
messages and no direction — both are derived from the connected ports.

```hcl
system "drone" {
  component "flight-controller" {
    component "mcu" {
      port "spi" { protocol = "spi"; role = "provider"; external = true }
    }
  }

  component "imu" {
    port "spi" { protocol = "spi"; role = "consumer"; external = true }
  }

  # Declared in system "drone" (the Lowest Common Ancestor of 'mcu' and 'imu')
  connection "spi-bus" {
    description  = "SPI link between MCU and IMU across hierarchy levels"
    tags         = ["electronics", "data"]
    level        = 2
    from         = "flight-controller/mcu/spi"
    to           = "imu/spi"
    encapsulates = []
  }
}
```

| Attribute      | Type         | Required | Default          | Description                                                    |
| -------------- | ------------ | -------- | ---------------- | -------------------------------------------------------------- |
| _label_        | string       | **yes**  | —                | Unique identifier within parent scope                          |
| `from`         | string       | **yes**  | —                | `"comp"`, `"comp/port"`, or relative path from declaring scope |
| `to`           | string       | **yes**  | —                | `"comp"`, `"comp/port"`, or relative path from declaring scope |
| `description`  | string       | no       | `""`             | Human-readable description                                     |
| `tags`         | list(string) | no       | `[]`             | Filtering tags                                                 |
| `level`        | integer      | no       | parent level + 1 | Abstraction level                                              |
| `encapsulates` | list(string) | no       | `[]`             | Labels of sibling connections this one runs on top of          |

**No `direction` attribute** — direction is inferred from the `role` values of
the connected ports (see §6).

**No child blocks** — messages belong exclusively to `protocol` blocks, not connections or ports.

---

### 2.8 `message` Block

Defined inside a `protocol` block. Represents a discrete unit of information
exchanged over that protocol.

```hcl
message "position-report" {
  description = "Periodic GPS position update"
  tags        = ["telemetry", "gps"]
  level       = 1

  field "latitude"  { type = "float64"; unit = "deg"; description = "WGS84 latitude"  }
  field "longitude" { type = "float64"; unit = "deg"; description = "WGS84 longitude" }
  field "altitude"  { type = "float64"; unit = "m";   description = "Altitude MSL"    }
  field "timestamp" { type = "uint64";  unit = "ms";  description = "Unix timestamp"  }
}
```

| Attribute     | Type         | Required | Default      | Description                                      |
| ------------- | ------------ | -------- | ------------ | ------------------------------------------------ |
| _label_       | string       | **yes**  | —            | Unique identifier within the parent protocol     |
| `description` | string       | no       | `""`         | Human-readable description                       |
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
  description = "Altitude above mean sea level"
  required    = true
}
```

| Attribute     | Type   | Required | Default | Description                                                                   |
| ------------- | ------ | -------- | ------- | ----------------------------------------------------------------------------- |
| _label_       | string | **yes**  | —       | Unique field name within parent message                                       |
| `type`        | string | **yes**  | —       | Free-form type string (e.g. `"uint8"`, `"string"`, `"bool"`, `"enum(A,B,C)"`) |
| `description` | string | no       | `""`    | Human-readable description                                                    |
| `unit`        | string | no       | `""`    | Physical unit (e.g. `"m"`, `"Hz"`, `"V"`)                                     |
| `required`    | bool   | no       | `true`  | Whether the field is mandatory in the message                                 |

---

### 2.10 `view` Block

Top-level block defined in files under `diagrams/`.
Defines a visual perspective on a system: which components are placed on the
canvas and where. Each file under `diagrams/` holds exactly one `view` block
whose label matches the filename (`diagrams/overview.hcl` -> `view "overview"`).
Every `node` path is resolved against the model (see §3); dangling paths emit a
warning (W016).

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

Optional `filter` sub-block (selection predicate) — **not implemented yet**:
parsed and round-tripped, but no renderer applies it. See §9.

| Attribute       | Type         | Required | Default          | Description                                                               |
| --------------- | ------------ | -------- | ---------------- | ------------------------------------------------------------------------- |
| `include_tags`  | list(string) | no       | `[]` (match all) | Only include entities having ≥1 of these tags                             |
| `exclude_tags`  | list(string) | no       | `[]`             | Exclude entities having any of these tags                                 |
| `max_level`     | integer      | no       | `∞`              | Maximum abstraction level to display                                      |
| `components`    | list(string) | no       | `[]` (all)       | Whitelist of component labels to include                                  |
| `show_messages` | bool         | no       | `true`           | Whether to list messages (from connected ports) as connection edge labels |

---

### 2.11 `docs/` Folder

Markdown files under `docs/` document components (`docs/plane.md` ↔ `component "plane"`, matched by label). They are frontend-only — ignored by the compiler — authored in the Editor and rendered as hover popups in Explore and embedded diagrams.

---

## 3. Reference Resolution

> **Impl:** see [Scope lookup helper](SPEC/models.md#scope-lookup-helper) and
> [Resolution pass](SPEC/models.md#resolution-pass) in models.md.

All references use **name-based or UNIX-style path notation**:

| Context                                           | Reference resolves to                                                  |
| ------------------------------------------------- | ---------------------------------------------------------------------- |
| `port.protocol`                                   | Top-level `protocol` label (or freeform protocol name if undefined)    |
| `connection.from` / `connection.to` (bare label)  | Component path evaluated relative to declaring scope                   |
| `connection.from` / `connection.to` (`comp/port`) | Component path + named `port` on target component                      |
| `connection.from` / `connection.to` (nested path) | Relative (`../sibling/port`, `a/b/port`) or absolute path from scope   |
| `encapsulates`                                    | Sibling `connection` labels in the same parent scope                   |
| `component.source`                                | Top-level `component` label                                            |
| `view.system`                                     | Top-level `system` label                                               |

---

## 4. Validation Rules

> **Impl:** validation operates on the
> [resolved `Model`](SPEC/models.md#core-resolved-structs). Errors/warnings are
> collected as `Diagnostic` values during the
> [resolution pass](SPEC/models.md#resolution-pass).

Each diagnostic code is documented in its own file under
[`SPEC/diagnostics/`](SPEC/diagnostics/) (e.g. `E001.md`, `W003.md`). Error
codes (`Exxx`) halt compilation; warning codes (`Wxxx`) are non-blocking.

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

---

## 5. Completion Scoring

> **Impl:** scoring iterates over `Model.components`, `Model.ports`,
> `Model.connections`, and `Model.messages`, see
> [resolved models](SPEC/models.md#core-resolved-structs). The `leaf`,
> `children`, `ports`, `messages`, and `fields` fields on those structs provide
> all inputs needed.

The completion score quantifies how fully the system has been decomposed and
specified to leaf-level entities. Each entity is scored individually, then
aggregated.

### Per-Entity Completeness

| Entity                   | Complete (1.0)                                          | Partial (0.5)                                 | Incomplete (0.0)    |
| ------------------------ | ------------------------------------------------------- | --------------------------------------------- | ------------------- |
| **Component** (leaf)     | Has description AND all defined ports complete          | Has description but ≥1 port incomplete        | No description      |
| **Component** (non-leaf) | ≥1 child component, all children complete               | ≥1 child component, not all children complete | No child components |
| **Port**                 | Bound protocol has ≥1 message, all messages complete    | Bound protocol has ≥1 message, not all complete | No bound protocol or protocol has no messages |
| **Connection**           | Both sides typed (`comp/port`) with matching `protocol` | One side typed                                | Both sides untyped  |
| **Message**              | ≥1 field (defined inside a protocol)                    | —                                             | No fields           |

A leaf component with a description and no ports scores Complete (1.0) — ports
are optional detail. A port referencing a `protocol` block inherits that
protocol's messages for completeness scoring. Top-level protocol messages are
scored under the Messages category.

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
> parsed from `diagrams/*.hcl` and validated against the resolved `Model`
> (E016/E006/W016); all visual rendering is owned by the web application.

Connection direction is inferred from the `role` values of the connected ports:

| `from` role         | `to` role                | Inferred direction             |
| ------------------- | ------------------------ | ------------------------------ |
| `provider`          | `consumer`               | unidirectional (`from` → `to`) |
| `consumer`          | `provider`               | unidirectional (`to` → `from`) |
| `peer`              | `peer`                   | bidirectional                  |
| either side untyped | —                        | unknown                        |
| `provider`          | `provider`               | ambiguous → W009               |
| `consumer`          | `consumer`               | ambiguous → W009               |
| `peer`              | `provider` or `consumer` | ambiguous → W009               |

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

### Example Session

```bash
$ rhizz build ./drone-project/

  Parsing 2 files...
  ✓ Parsed: system.hcl, diagrams/overview.hcl

  Validation:
  ✗ E002  system.hcl:14  connection "uart-link" references undefined component "gps-module"
  ⚠ W001  system.hcl:31  component "power-regulator" has no child components (leaf=false)
  ⚠ W004  system.hcl:82  component "motor" is missing a description

  1 error, 2 warnings — aborting (fix errors to continue)
```

```bash
$ rhizz build ./drone-project/   # after fix

  Parsing 2 files... ✓

  Validation:
  ⚠ W001  system.hcl:31  component "power-regulator" has no child components (leaf=false)
  ⚠ W004  system.hcl:82  component "motor" is missing a description
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

A minimal but complete drone project defined in `system.hcl` and `diagrams/overview.hcl`:

### `system.hcl`

```hcl
project {
  name    = "mini-drone"
  version = "0.1.0"
}

# ── Protocols ─────────────────────────────

protocol "dshot600" {
  description = "DShot600 digital motor protocol"
  roles       = ["provider", "consumer"]

  message "throttle-command" {
    description = "Per-motor throttle value"
    tags        = ["motor", "control"]
    field "motor_id" { type = "uint8";  description = "Motor index 1-4" }
    field "value"    { type = "uint16"; description = "Throttle 0-2047" }
  }
}

protocol "crsf" {
  description = "Crossfire serial link for RC input and telemetry"
  roles       = ["peer"]

  message "rc-channels" {
    description = "16-channel RC input values"
    field "channels" { type = "uint16[16]"; description = "Channel values 172-1811" }
  }

  message "telemetry-frame" {
    description = "Telemetry sent back to transmitter"
    field "rssi"    { type = "uint8";   unit = "dBm"; description = "Signal strength" }
    field "battery" { type = "float32"; unit = "V";   description = "Battery voltage"  }
  }
}

protocol "spi" {
  description = "SPI bus interface"
  roles       = ["provider", "consumer"]

  message "transaction" {
    description = "SPI transfer frame"
    field "cs"   { type = "uint8"; description = "Chip select line" }
    field "data" { type = "bytes"; description = "Payload"          }
  }
}

protocol "power-dc" {
  description = "DC power delivery rail"
  roles       = ["provider", "consumer"]
}

# ── System ────────────────────────────────

system "mini-drone" {
  description = "Minimal quadcopter drone"
  tags        = ["product", "drone"]

  # ── Components ────────────────────────────

  component "flight-controller" {
    description = "Central flight management unit"
    tags        = ["electronics", "compute"]
    leaf        = false

    port "dshot" {
      description = "DShot600 motor control output"
      protocol    = "dshot600"
      role        = "provider"
      external    = true
      tags        = ["electronics", "motor", "data"]
    }

    port "crsf" {
      description = "CRSF serial link for RC input and telemetry"
      protocol    = "crsf"
      role        = "peer"
      external    = true
      tags        = ["rf", "control", "data"]
    }

    component "mcu" {
      description = "STM32H7 ARM Cortex-M7"
      tags        = ["electronics", "compute"]
      leaf        = true

      port "spi" {
        description = "SPI master bus"
        protocol    = "spi"
        role        = "provider"
        external    = true
        tags        = ["electronics", "data"]
      }
    }

    component "imu" {
      description = "ICM-42688 6-axis IMU"
      tags        = ["electronics", "sensor"]
      leaf        = true
      # no ports defined yet — W007 fires for the spi-bus connection below
    }

    connection "spi-bus" {
      description = "SPI link between MCU and IMU"
      tags        = ["electronics", "data"]
      level       = 2
      from        = "mcu/spi"
      to          = "imu"     # untyped — W007
    }
  }

  component "esc" {
    description = "4-in-1 electronic speed controller"
    tags        = ["electronics", "power", "motor"]
    leaf        = true

    port "dshot" {
      description = "DShot600 motor control input"
      protocol    = "dshot600"
      role        = "consumer"
      external    = true
      tags        = ["electronics", "motor", "data"]
    }

    port "power-in" {
      description = "Main battery power input"
      protocol    = "power-dc"
      role        = "consumer"
      external    = true
      tags        = ["power"]
    }

    port "bec-out" {
      description = "5V BEC regulated output"
      protocol    = "power-dc"
      role        = "provider"
      external    = true
      tags        = ["power"]
    }
  }

  component "battery" {
    description = "4S 1500mAh LiPo"
    tags        = ["power"]
    leaf        = true

    port "power-out" {
      description = "Main discharge output"
      protocol    = "power-dc"
      role        = "provider"
      external    = true
      tags        = ["power"]
    }
  }

  component "radio-rx" {
    description = "ELRS 2.4GHz receiver"
    tags        = ["electronics", "rf", "control"]
    leaf        = true

    port "crsf" {
      description = "CRSF serial link to flight controller"
      protocol    = "crsf"
      role        = "peer"
      external    = true
      tags        = ["rf", "control", "data"]
    }
  }

  # ── Connections ────────────────────────────

  connection "dshot-bus" {
    description = "DShot600 motor control signal"
    tags        = ["electronics", "motor", "data"]
    from        = "flight-controller/dshot"
    to          = "esc/dshot"
  }

  connection "power-main" {
    description = "Main battery power rail"
    tags        = ["power"]
    from        = "battery/power-out"
    to          = "esc/power-in"
  }

  connection "power-bec" {
    description = "5V BEC output to flight controller"
    tags        = ["power"]
    from        = "esc/bec-out"
    to          = "flight-controller"   # untyped — W007
  }

  connection "crsf-link" {
    description = "Crossfire serial protocol for RC input"
    tags        = ["rf", "control", "data"]
    from        = "radio-rx/crsf"
    to          = "flight-controller/crsf"
  }
}
```

### `diagrams/overview.hcl`

```hcl
view "overview" {
  system = "mini-drone"
  node "mini-drone/flight-controller" {
    x          = 20
    y          = 50
    width      = 100
    height     = 50
  }

  node "mini-drone/battery" {
    x          = 20
    y          = 150
    width      = 100
    height     = 50
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
| Ports are optional (`comp/port` syntax is additive)             | Supports gradual specification — bare component refs compile with warnings, ports add typed detail incrementally                                                                                                        |
| Messages live exclusively on protocols, not components or ports | Messages represent communication exchanged between components across protocols; keeping schemas on protocols prevents duplication and makes components purely structural                                                 |
| Top-level components + `source` label reference                 | Keeps all files as valid, parseable rhizz files (no bare-body format). Reuses the existing flat-merge pipeline — `source` is resolved by label, no file I/O during resolution. Components can be reused across systems. |
| Direction inferred from port roles, not declared on connections | Eliminates a redundant field and makes role mismatches automatically detectable                                                                                                                                         |
| `type` on fields is a free-form string                          | Supports gradual specification — no type system to fight during early design                                                                                                                                            |
| `level` auto-increments from parent                             | Reduces boilerplate; explicit override still available                                                                                                                                                                  |
| Views are top-level blocks                                      | A view can reference any system; decoupled from the model itself                                                                                                                                                        |
| `encapsulates` is a name-based reference                        | Captures protocol layering (HTTP → TCP → Ethernet) without deep nesting                                                                                                                                                 |
| Multiple frontends share one compiler core                      | Keeps all model semantics in one tested place; frontends own only I/O and presentation                                                                                                                                  |

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

`rhizz` is available as a **command-line tool** (`rhizz-cli`), a **desktop GUI
application** (`rhizz-gui`), and a **WebAssembly module** (`rhizz-wasm`). All
frontends share the same underlying model compiler and produce identical
results; the choice of frontend is purely a matter of workflow preference.

### `rhizz-wasm`

A WebAssembly frontend that exposes the same compile pipeline to JavaScript
environments (browsers, Deno, Node.js). Callers supply HCL source content as
strings and receive back a compiled model and diagnostics — identical in
structure to what the CLI and GUI produce.

> **Impl:** see [SPEC/architecture.md](SPEC/architecture.md) for build
> instructions, JS API, and crate details.
