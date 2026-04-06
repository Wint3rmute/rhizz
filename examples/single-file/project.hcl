project {
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
    leaf        = true

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
