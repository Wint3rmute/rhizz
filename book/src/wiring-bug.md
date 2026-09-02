# Compilation errors

Errors abort the build and no completion score is produced. Here the
connection points at `sender/outgoing`, a port that does not exist — the
compiler lists the failing reference, plus whatever warnings it could still
recover.

```rhizz
project {
  name = "wiring-bug"
}

protocol "greeting" {
  description = "A simple greeting"

  message "hello" {
    description = "The greeting payload"
    field "text" { type = "string" }
  }
}

system "app" {
  description = "Two components with a broken connection"

  component "sender" {
    description = "Sends a greeting"
    leaf        = true

    port "out" {
      protocol = "greeting"
    }
  }

  component "receiver" {
    description = "Receives a greeting"
    leaf        = true

    port "in" {
      protocol = "greeting"
    }
  }

  connection "greet" {
    from = "sender/outgoing" // typo: this port does not exist
    to   = "receiver/in"
  }
}
```

Notice how the missing `description` on the connection shows up as a warning
even while the broken reference is an error: when compilation fails, warnings
and errors are reported together, but the model is not scored.