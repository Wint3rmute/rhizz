# Warnings & Errors

The Rhizz compiler produces 2 types of diagnostic messages:

- Warnings, which inform you about a non-critical issue
- Errors, which prevent the compiler from building the system model

Warnings do not stop the build. Example below reuses a top-level component via
`source = "sensor-hat"`, but its protocol defines no messages yet and two
entities are missing descriptions. The model still compiles and scores — the
warnings point at exactly what to finish.

```rhizz
protocol "serial" {
  # No messages are defined yet.
}

component "sensor-hat" {
  description = "Reusable sensor board"
  leaf        = true

  port "data" {
    protocol = "serial"
  }
}

component "controller" {
  leaf = true

  port "uart" {
    protocol = "serial"
  }
}

system "dev-rig" {
  description = "A rough first sketch"

  instance "controller" {
    source = "controller"
  }

  instance "sensor" {
    source = "sensor-hat"
  }

  connection "link" {
    from = "controller/uart"
    to   = "sensor/data"
  }
}
```

The completion score is still produced: `source` reuse works, connections
resolve, diagrams are drawn (just not in this example), the compiler just
outlines what is incomplete.

## Warning Levels

> [!NOTE]
> Warning levels are not yet implemented, only planned.

The Rhizz compiler can run at different strictness levels, each of them filtering out different warnings. Currently, 3 levels are defined:

### Business spec

Business spec is super high-level, allowing almost anyone to get a warning-free
build. This strictness level can be compared to a typical diagramming
application experience, like DrawIO or Excalidraw. It's great for
first sketches, preliminary designs, talking to business people.

### Architectural spec

Architectural requires more details, descriptions and documentation, focusing on
interfaces between large segments of the system.

### Component-level spec

The most strict mode is the component-level spec - it requires modeling all the
way down to leaf-level components, with all possible warnings enabled.
