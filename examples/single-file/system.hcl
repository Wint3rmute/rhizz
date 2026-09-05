project {
  name    = "home-monitor"
  version = "0.1.0"
  authors = ["rhizz-examples"]
}

protocol "i2c" {
  description = "I2C sensor communication bus"
  roles       = ["provider", "consumer"]

  message "reading" {
    description = "Temperature and humidity measurement"

    field "celsius" {
      type        = "float32"
    }

    field "humidity" {
      type        = "float32"
    }
  }
}

protocol "mqtt" {
  description = "MQTT telemetry protocol"
  roles       = ["provider", "consumer"]

  message "telemetry" {
    description = "Environmental telemetry payload"

    field "celsius" {
      type        = "float32"
    }

    field "humidity" {
      type        = "float32"
    }

    field "timestamp" {
      type        = "uint64"
    }
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
    tags        = ["data", "cloud"]
    external    = true
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
    tags        = ["data"]
    external    = true
  }

  port "mqtt-out" {
    description = "Outbound MQTT telemetry"
    protocol    = "mqtt"
    role        = "provider"
    tags        = ["data", "cloud"]
    external    = true
  }
}

component "temp-sensor" {
  description = "BME280 I2C temperature and humidity sensor"
  icon        = "temperature-half"
  tags        = ["sensor", "data"]
  leaf        = true

  port "i2c" {
    description = "I2C data output"
    protocol    = "i2c"
    role        = "provider"
    tags        = ["data"]
    external    = true
  }
}

system "home-monitor" {
  description = "Smart home environmental monitoring node"
  tags        = ["iot", "data"]

  instance "broker" { source = "broker" }

  instance "controller" { source = "controller" }

  instance "sensor" { source = "temp-sensor" }

  connection "read-sensor" {
    description  = "I2C acquisition from sensor to controller"
    tags         = ["data"]
    from         = "/home-monitor/sensor/i2c"
    to           = "/home-monitor/controller/i2c-in"
  }

  connection "send-telemetry" {
    description  = "MQTT upload from controller to cloud broker"
    tags         = ["data", "cloud"]
    from         = "/home-monitor/controller/mqtt-out"
    to           = "/home-monitor/broker/mqtt-in"
  }
}
