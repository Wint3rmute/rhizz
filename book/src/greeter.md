# A complete model

The smallest model that satisfies the compiler: a project, one protocol with a
message, and a system with two leaf components connected through typed ports.

```rhizz
project {
  name = "greeter"
}

protocol "greeting" {
  description = "A simple greeting"

  message "hello" {
    description = "The greeting payload"
    field "text" { type = "string" }
  }
}

system "app" {
  description = "A minimal two-component model"

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
    description = "Carries the greeting"
    from        = "sender/out"
    to          = "receiver/in"
  }
}
```

Every entity has a `description`, every port names a real protocol, and the
connection references ports that actually exist — so the compiler has nothing
to complain about. The panel below shows its verdict and the completion score.