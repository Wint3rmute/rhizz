import { projectStore } from "./ProjectState.svelte";
import { openProjectFs } from "./vfs/fs";
import { DIAGRAM_LAYOUT_DIR, writeDiagramLayoutFile } from "./routes/projects/[id]/diagrams/persistence";
import type { DiagramLayout } from "./routes/projects/[id]/diagrams/persistence";

// Mirrors examples/single-file/project.hcl — used by the "help" button on
// the /editor route to let users try the app with a working example.
export const EXAMPLE_SYSTEM_HCL = `project {
  name    = "home-monitor"
  version = "0.1.0"
  authors = ["rhizz-examples"]
}

# Reusable top-level component — imported into the system via source = "temp-sensor".
component "temp-sensor" {
  description = "BME280 I2C temperature and humidity sensor"
  tags        = ["sensor", "data"]
  leaf        = true

  port "i2c" {
    description = "I2C data output"
    protocol    = "i2c"
    role        = "provider"
    tags        = ["data"]

    message "reading" {
      description = "Temperature and humidity measurement"
      field "celsius"  { type = "float32" }
      field "humidity" { type = "float32" }
    }
  }
}

system "home-monitor" {
  description = "Smart home environmental monitoring node"
  tags        = ["iot", "data"]
  level       = 0

  component "sensor" {
    source = "temp-sensor"
  }

  component "controller" {
    description = "ARM Cortex-M4 processing hub"
    tags        = ["compute", "data"]
    leaf        = false

    port "i2c-in" {
      description = "I2C bus to sensor"
      protocol    = "i2c"
      role        = "consumer"
      tags        = ["data"]

      message "reading" {
        description = "Raw sensor reading"
        field "celsius"  { type = "float32" }
        field "humidity" { type = "float32" }
      }
    }

    port "mqtt-out" {
      description = "Outbound MQTT telemetry"
      protocol    = "mqtt"
      role        = "provider"
      tags        = ["data", "cloud"]

      message "telemetry" {
        description = "Aggregated telemetry payload"
        field "celsius"   { type = "float32" }
        field "humidity"  { type = "float32" }
        field "timestamp" { type = "uint64"  }
      }
    }

    # ── Internal decomposition ──────────────
    component "mcu" {
      description = "STM32 ARM Cortex-M4 microcontroller"
      tags        = ["electronics", "compute"]
      leaf        = true

      port "power-in" {
        description = "Regulated 3.3V power input"
        protocol    = "power"
        role        = "consumer"
        tags        = ["power"]

        message "status" {
          description = "Power rail health"
          field "voltage" {
            type = "float32"
            unit = "V"
          }
        }
      }
    }

    component "power-supply" {
      description = "Buck converter regulating battery voltage to 3.3V"
      tags        = ["electronics", "power"]
      leaf        = true

      port "power-out" {
        description = "Regulated 3.3V power output"
        protocol    = "power"
        role        = "provider"
        tags        = ["power"]

        message "status" {
          description = "Power rail health"
          field "voltage" {
            type = "float32"
            unit = "V"
          }
        }
      }
    }

    connection "power-rail" {
      description = "Power delivery from supply to MCU"
      tags        = ["power"]
      from        = "power-supply:power-out"
      to          = "mcu:power-in"
    }
  }

  component "broker" {
    description = "Cloud MQTT broker and time-series storage"
    tags        = ["cloud", "data"]
    leaf        = true

    port "mqtt-in" {
      description = "Inbound MQTT telemetry"
      protocol    = "mqtt"
      role        = "consumer"
      tags        = ["data", "cloud"]

      message "telemetry" {
        description = "Device telemetry event"
        field "celsius"   { type = "float32" }
        field "humidity"  { type = "float32" }
        field "timestamp" { type = "uint64"  }
      }
    }
  }

  connection "read-sensor" {
    description = "I2C acquisition from sensor to controller"
    tags        = ["data"]
    from        = "sensor:i2c"
    to          = "controller:i2c-in"
  }

  connection "send-telemetry" {
    description = "MQTT upload from controller to cloud broker"
    tags        = ["data", "cloud"]
    from        = "controller:mqtt-out"
    to          = "broker:mqtt-in"
  }
}

view "overview" {
  description = "Full home-monitor system architecture"
  system      = "home-monitor"

  filter {
    max_level     = 2
    show_messages = true
  }

  output {
    filename = "overview.dot"
    rankdir  = "LR"
  }
}

view "cloud-path" {
  description = "Cloud-facing data path only"
  system      = "home-monitor"

  filter {
    include_tags  = ["cloud"]
    show_messages = false
  }

  output {
    filename = "cloud-path.dot"
    rankdir  = "LR"
  }
}
`;

export const EXAMPLE_SYSTEM_DIAGRAMS: Record<string, DiagramLayout> = {
  "overview.json": {
    checked: {
      "home-monitor/sensor": { x: 40, y: 60, width: 150, height: 90 },
      "home-monitor/controller": {
        x: 260,
        y: 40,
        width: 260,
        height: 240,
        textAlign: "top-left",
      },
      "home-monitor/controller/mcu": {
        x: 310,
        y: 95,
        width: 150,
        height: 90,
      },
      "home-monitor/controller/power-supply": {
        x: 300,
        y: 205,
        width: 180,
        height: 90,
      },
      "home-monitor/broker": { x: 620, y: 70, width: 180, height: 100 },
    },
    savedLayout: {
      "home-monitor/sensor": { x: 40, y: 60, width: 150, height: 90 },
      "home-monitor/controller": {
        x: 260,
        y: 40,
        width: 260,
        height: 240,
        textAlign: "top-left",
      },
      "home-monitor/controller/mcu": {
        x: 310,
        y: 95,
        width: 150,
        height: 90,
      },
      "home-monitor/controller/power-supply": {
        x: 300,
        y: 205,
        width: 180,
        height: 90,
      },
      "home-monitor/broker": { x: 620, y: 70, width: 180, height: 100 },
    },
  },
  "cloud-path.json": {
    checked: {
      "home-monitor/sensor": { x: 50, y: 80, width: 150, height: 90 },
      "home-monitor/controller": {
        x: 260,
        y: 40,
        width: 200,
        height: 170,
      },
      "home-monitor/broker": { x: 560, y: 80, width: 180, height: 100 },
    },
    savedLayout: {
      "home-monitor/sensor": { x: 50, y: 80, width: 150, height: 90 },
      "home-monitor/controller": {
        x: 260,
        y: 40,
        width: 200,
        height: 170,
      },
      "home-monitor/broker": { x: 560, y: 80, width: 180, height: 100 },
    },
  },
};

export async function seedExampleProjectDiagrams(projectId: string): Promise<void> {
  const fs = openProjectFs(projectStore, projectId);
  for (const [name, layout] of Object.entries(EXAMPLE_SYSTEM_DIAGRAMS)) {
    await writeDiagramLayoutFile(fs, `${DIAGRAM_LAYOUT_DIR}/${name}`, layout);
  }
}
