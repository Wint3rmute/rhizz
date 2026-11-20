import type { DiagramLayout } from "../routes/projects/[id]/modeling/persistence";

// Shared story fixture: a small system with sibling and non-sibling
// cross-level connections, plus per-diagram layouts. Used by the
// DiagramViewer and Explore stories to seed deterministic projects.
export const CROSS_LEVEL_SYSTEM_HCL = `project {
  name    = "cross-level-demo"
  version = "0.1.0"
}

protocol "power" {
  full_name = "DC power delivery"
  roles       = ["provider", "consumer"]
}

protocol "spi" {
  full_name = "Serial peripheral interface"
  roles       = ["provider", "consumer"]
}

component "battery" {
  full_name = "Main power source"
  leaf        = true

  port "power-out" {
    protocol = "power"
    role     = "provider"
    external = true
  }
}

component "controller" {
  full_name = "Processing hub with internal MCU"
  leaf        = false

  port "power-in" {
    protocol = "power"
    role     = "consumer"
    external = true
  }

  instance "mcu" {
    source = "mcu"
  }
}

component "mcu" {
  full_name = "Microcontroller unit"
  leaf        = true

  port "spi" {
    protocol = "spi"
    role     = "provider"
    external = true
  }
}

component "sensor" {
  full_name = "External IMU sensor"
  leaf        = true

  port "spi" {
    protocol = "spi"
    role     = "consumer"
    external = true
  }
}

system "demo-system" {
  full_name = "System with sibling and non-sibling cross-level connections"

  instance "battery" {
    source = "battery"
  }

  instance "controller" {
    source = "controller"
  }

  instance "sensor" {
    source = "sensor"
  }

  connection "power-link" {
    full_name = "Power delivery"
    from        = "battery/power-out"
    to          = "controller/power-in"
  }

  connection "sensor-bus" {
    full_name = "Cross-level SPI bus"
    from        = "controller/mcu/spi"
    to          = "sensor/spi"
  }
}
`;

export const CROSS_LEVEL_SYSTEM_DIAGRAMS: Record<string, DiagramLayout> = {
  "overview.hcl": {
    checked: {
      "demo-system/battery": { x: 40, y: 80, width: 150, height: 90 },
      "demo-system/controller": {
        x: 250,
        y: 40,
        width: 230,
        height: 190,
        textAlign: "top-left",
      },
      "demo-system/controller/mcu": {
        x: 280,
        y: 100,
        width: 170,
        height: 90,
      },
      "demo-system/sensor": { x: 550, y: 90, width: 160, height: 90 },
    },
  },
  "controller.hcl": {
    checked: {
      "demo-system/controller": {
        x: 40,
        y: 40,
        width: 230,
        height: 190,
        textAlign: "top-left",
      },
      "demo-system/controller/mcu": {
        x: 70,
        y: 100,
        width: 170,
        height: 90,
      },
    },
  },
};
