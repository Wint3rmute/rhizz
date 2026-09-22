project {
  name    = "home-monitor"
  version = "0.1.0"
  authors = ["rhizz-examples"]
}

protocol "i2c" {
  full_name = "I2C sensor communication bus"
  roles       = ["provider", "consumer"]

  message "reading" {
    full_name = "Temperature and humidity measurement"

    field "celsius" {
      type        = "float32"
    }

    field "humidity" {
      type        = "float32"
    }
  }
}

protocol "mqtt" {
  full_name = "MQTT telemetry protocol"
  roles       = ["provider", "consumer"]

  message "telemetry" {
    full_name = "Environmental telemetry payload"

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
  full_name = "Cloud MQTT broker and time-series storage"
  icon        = "cloud"
  tags        = ["cloud", "data"]
  leaf        = true

  port "mqtt-in" {
    full_name = "Inbound MQTT telemetry"
    protocol    = "mqtt"
    role        = "consumer"
    tags        = ["data", "cloud"]
    external    = true
  }
}

component "controller" {
  full_name = "ARM Cortex-M4 processing hub"
  icon        = "microchip"
  tags        = ["compute", "data"]
  leaf        = true

  port "i2c-in" {
    full_name = "I2C bus to sensor"
    protocol    = "i2c"
    role        = "consumer"
    tags        = ["data"]
    external    = true
  }

  port "mqtt-out" {
    full_name = "Outbound MQTT telemetry"
    protocol    = "mqtt"
    role        = "provider"
    tags        = ["data", "cloud"]
    external    = true
  }
}

component "temp-sensor" {
  full_name = "BME280 I2C temperature and humidity sensor"
  icon        = "temperature-half"
  tags        = ["sensor", "data"]
  leaf        = true

  port "i2c" {
    full_name = "I2C data output"
    protocol    = "i2c"
    role        = "provider"
    tags        = ["data"]
    external    = true
  }
}

system "home-monitor" {
  full_name = "Smart home environmental monitoring node"
  tags        = ["iot", "data"]

  instance "broker" { source = "broker" }

  instance "controller" { source = "controller" }

  instance "sensor" { source = "temp-sensor" }

  connection "read-sensor" {
    full_name  = "I2C acquisition from sensor to controller"
    tags         = ["data"]
    from         = "/home-monitor/sensor/i2c"
    to           = "/home-monitor/controller/i2c-in"
  }

  connection "send-telemetry" {
    full_name  = "MQTT upload from controller to cloud broker"
    tags         = ["data", "cloud"]
    from         = "/home-monitor/controller/mqtt-out"
    to           = "/home-monitor/broker/mqtt-in"
  }
}
