import type { BookPayloadFile } from "./payload";

// Fallback project shown when the route carries no `#p=` payload and no
// `?example=` name. Kept tiny but complete (protocol + definitions +
// instances + connection + placed diagram + annotation) so every tab has
// something to show, and pinned by `demo.test.ts` to always compile clean.
export const DEMO_FILES: BookPayloadFile[] = [
  {
    path: "system.hcl",
    content: `project {
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
`,
  },
  {
    path: "diagrams/main.hcl",
    content: `view "main" {
  system = "demo"

  node "demo/sensor" {
    x          = 80
    y          = 120
    width      = 140
    height     = 90
    text_align = "center"
  }

  node "demo/hub" {
    x          = 360
    y          = 120
    width      = 140
    height     = 90
    text_align = "center"
  }

  annotation {
    x    = 80
    y    = 40
    text = "Book demo: two components, one connection"
  }
}
`,
  },
];
