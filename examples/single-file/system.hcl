project {
  name    = "home-monitor"
  version = "0.1.0"
  authors = ["rhizz-examples"]
}

# ── Protocols ─────────────────────────────

protocol "i2c" {
  description = "I2C sensor communication bus"
  roles       = ["provider", "consumer"]

  message "reading" {
    description = "Temperature and humidity measurement"
    field "celsius"  { type = "float32" }
    field "humidity" { type = "float32" }
  }
}

protocol "mqtt" {
  description = "MQTT telemetry protocol"
  roles       = ["provider", "consumer"]

  message "telemetry" {
    description = "Environmental telemetry payload"
    field "celsius"   { type = "float32" }
    field "humidity"  { type = "float32" }
    field "timestamp" { type = "uint64"  }
  }
}

# ── Top-level Reusable Components ─────────

# Reusable top-level component — imported into the system via source = "temp-sensor".
component "temp-sensor" {
  description = "BME280 I2C temperature and humidity sensor"
  icon        = "temperature-half"
  tags        = ["sensor", "data"]
  leaf        = true

  port "i2c" {
    description = "I2C data output"
    protocol    = "i2c"
    role        = "provider"
    external    = true
    tags        = ["data"]
  }
}

component "controller" {
  description = "ARM Cortex-M4 processing hub"
  icon        = "microchip"
  tags        = ["compute", "data"]
  leaf        = true

  port "i2c-in" {
    description = "I2C bus to sensor"
    protocol    = "i2c"
    role        = "consumer"
    external    = true
    tags        = ["data"]
  }

  port "mqtt-out" {
    description = "Outbound MQTT telemetry"
    protocol    = "mqtt"
    role        = "provider"
    external    = true
    tags        = ["data", "cloud"]
  }
}

component "broker" {
  description = "Cloud MQTT broker and time-series storage"
  icon        = "cloud"
  tags        = ["cloud", "data"]
  leaf        = true

  port "mqtt-in" {
    description = "Inbound MQTT telemetry"
    protocol    = "mqtt"
    role        = "consumer"
    external    = true
    tags        = ["data", "cloud"]
  }
}

# ── System Definition ─────────────────────

system "home-monitor" {
  description = "Smart home environmental monitoring node"
  tags        = ["iot", "data"]
  level       = 0

  instance "sensor" {
    source = "temp-sensor"
  }

  instance "controller" {
    source = "controller"
  }

  instance "broker" {
    source = "broker"
  }

  connection "read-sensor" {
    description = "I2C acquisition from sensor to controller"
    tags        = ["data"]
    from        = "sensor/i2c"
    to          = "controller/i2c-in"
  }

  connection "send-telemetry" {
    description = "MQTT upload from controller to cloud broker"
    tags        = ["data", "cloud"]
    from        = "controller/mqtt-out"
    to          = "broker/mqtt-in"
  }
}

view "overview" {
  description = "Full home-monitor system architecture"
  system      = "home-monitor"

  filter {
    max_level     = 2
    show_messages = true
  }
}

view "cloud-path" {
  description = "Cloud-facing data path only"
  system      = "home-monitor"

  filter {
    include_tags  = ["cloud"]
    show_messages = false
  }
}