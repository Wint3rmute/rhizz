# Warnings, not errors

Warnings do not stop the build. This sketch reuses a top-level component via
`source = "sensor-hat"`, but its protocol defines no messages yet and two
entities are missing descriptions. The model still compiles and scores — the
warnings point at exactly what to finish.

```rhizz
project {
  name = "sketch"
}

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

system "dev-rig" {
  description = "A rough first sketch"

  component "controller" {
    leaf = true

    port "uart" {
      protocol = "serial"
    }
  }

  component "sensor" {
    source = "sensor-hat"
  }

  connection "link" {
    from = "controller/uart"
    to   = "sensor/data"
  }
}
```

The completion score is still produced: `source` reuse works, connections
resolve, and the compiler just records what is incomplete.