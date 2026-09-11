project {
  name = "book-demo"
}

protocol "temp-bus" {
  description = "Temperature sensor bus"
  roles       = ["provider", "consumer"]

  message "reading" {
    description = "A single temperature reading"

    field "celsius" {
      type        = "f32"
      description = "Temperature in Celsius"
    }
  }
}

component "sensor" {
  description = "Temperature sensor"
  leaf        = true

  port "out" {
    description = "Reading output"
    protocol    = "temp-bus"
    role        = "provider"
  }
}

component "hub" {
  description = "Reading collector"
  leaf        = true

  port "in" {
    description = "Reading input"
    protocol    = "temp-bus"
    role        = "consumer"
  }
}

system "demo" {
  description = "Minimal book example"

  instance "sensor" { source = "sensor" }
  instance "hub" { source = "hub" }

  connection "reading" {
    description = "Delivers readings to the hub"
    from        = "sensor/out"
    to          = "hub/in"
  }
}
