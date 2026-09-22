# Warnings & Errors

The Rhizz compiler produces 2 types of diagnostic messages:

- Warnings, which inform you about a non-critical issue
- Errors, which prevent the compiler from building the system model

Warnings do not stop the build. Example below reuses a top-level component via
`source = "sensor-hat"`, but its protocol defines no messages yet and two
entities are missing full names. The model still compiles and scores — the
warnings point at exactly what to finish.

```rhizz
protocol "serial" {
  # No messages are defined yet.
}

component "sensor-hat" {
  full_name = "Reusable sensor board"
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
  full_name = "A rough first sketch"

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

The Rhizz compiler can run at different strictness levels, each of them filtering out different warnings. Currently, 3 levels are defined:

### Business spec

Business spec is super high-level, allowing almost anyone to get a warning-free
build. This strictness level can be compared to a typical diagramming
application experience, like DrawIO or Excalidraw. It's great for
first sketches, preliminary designs, talking to business people.

### Architectural spec

Architectural requires more details, full names and documentation, focusing on
interfaces between large segments of the system.

### Component-level spec

The most strict mode is the component-level spec - it requires modeling all the
way down to leaf-level components, with all possible warnings enabled.

## Per-example strictness in this book

Every live example below carries a **Strictness** badge showing the level it
was compiled at — the same verdict the compiler produced when this page was
built. Tutorial snippets often run at `architectural` so you are not nagged
about leaf-level detail (like missing `docs/` files) before the concepts are
introduced; warning demos run at `component` so nothing is hidden.

Authors pick the level per fence: append `,level=architectural` to a rhizz
code fence, or `level="architectural"` to a full-project embed directive.
An unknown level fails the book build loudly, so a typo can never silently
change a verdict.
