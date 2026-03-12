# Rhizz — MBSE as Code

**Rhizz models complex systems in plain-text HCL files.** Think Terraform, but instead of infrastructure you're describing system architectures — components, ports, protocols, messages, and their interconnections. Everything lives in version control, diffs cleanly, and passes through CI.

---

## A 60-second example

```hcl
component "imu" {
  description = "6-axis inertial measurement unit"
  tags        = ["sensors", "navigation"]

  port "data_out" {
    protocol = "SPI"
    role     = "provider"

    message "imu_reading" {
      field "accel_x" { type = "float32" unit = "m/s²" }
      field "accel_y" { type = "float32" unit = "m/s²" }
      field "gyro_z"  { type = "float32" unit = "rad/s" }
    }
  }
}

system "drone" {
  component "sensor" { source = "imu" }
  component "fc"     { description = "Flight controller" }

  connection "imu_link" {
    from = "sensor:data_out"
    to   = "fc:spi_in"
  }
}
```

That's the entire language surface. Components nest arbitrarily deep, `source` gives you reuse without copy-paste, and connections wire sibling components together. Ports carry role semantics (`provider`, `consumer`, `peer`) so **connection direction is inferred, not declared**.

## What the compiler gives you

All `.hcl` files in a directory tree are merged into one model. From there, `rhizz-core` produces:

- **Validation** — dangling refs, protocol mismatches, circular source chains → clear error codes.
- **Completion scoring** — every component, port, connection, and message gets a score (0 / 0.5 / 1.0) based on how fully it's been specified. The aggregate tells you exactly how mature your model is.
- **Graphviz views** — filtered by tags, depth, or component whitelist. A `view` block is just another top-level declaration:

```hcl
view "nav_subsystem" {
  system   = "drone"
  tags     = ["navigation"]
  max_depth = 2
}
```

## Why this needs a visual frontend

The compiler already produces a structured, validated, scored graph. Right now the only way to explore it is `dot` files and terminal output. What's missing is an **interactive frontend** that lets you:

- **Browse the component tree** — expand/collapse nested hierarchies, click into port and message definitions.
- **Visualise connections** — render the system graph with layout that respects nesting depth, colour-code by completion score or tags.
- **Explore incrementally** — filter by subsystem, tag, protocol, or completion status. The `view` blocks already define useful slices; the frontend just needs to make them navigable.
- **Surface model health** — completion scores per subtree, warnings on protocol mismatches, unconnected ports highlighted visually.

The architecture is designed for this. `rhizz-core` compiles to a clean intermediate representation (component graph + diagnostics + scores). There's already a `rhizz-wasm` target, so the entire compiler runs in the browser — no backend needed. The frontend's job is purely **presentation and interaction** on top of a fully resolved model.

## The pitch

Systems engineers already think in hierarchical block diagrams with typed interfaces. Rhizz captures that thinking in reviewable text. A visual frontend closes the loop — it turns the model back into the diagram, but one that's always consistent with the source of truth, always up to date, and queryable in ways a Visio file never will be.

The compiler does the hard work. The frontend gets to be the fun part.
