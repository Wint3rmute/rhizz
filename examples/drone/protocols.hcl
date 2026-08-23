protocol "dshot600" {
  description = "DShot600 digital motor control"
  roles       = ["provider", "consumer"]

  message "throttle" {
    description = "Per-motor throttle command"
    tags        = ["control"]

    field "motor_id" {
      type        = "uint8"
      description = "Motor index 1-4"
    }
    field "value" {
      type        = "uint16"
      description = "Throttle 0-2047"
    }
  }
}

protocol "uart" {
  description = "UART serial bus"
  roles       = ["peer"]

  message "nav-pvt" {
    description = "Navigation position/velocity/time solution"
    tags        = ["navigation"]

    field "latitude" {
      type        = "int32"
      unit        = "deg*1e7"
      description = "Latitude"
    }
    field "longitude" {
      type        = "int32"
      unit        = "deg*1e7"
      description = "Longitude"
    }
    field "altitude" {
      type        = "int32"
      unit        = "mm"
      description = "Altitude above MSL"
    }
    field "fix_type" {
      type        = "uint8"
      description = "GNSS fix type"
    }
  }
}

protocol "crsf" {
  description = "CRSF serial protocol for RC input"
  roles       = ["provider", "consumer", "peer"]

  message "rc-channels" {
    description = "16 RC channel values"
    tags        = ["control"]

    field "channels" {
      type        = "uint16[16]"
      description = "Channel values 172-1811"
    }
  }
}

protocol "spi" {
  description = "Serial peripheral interface"
  roles       = ["provider", "consumer"]
}

protocol "power-dc" {
  description = "DC power delivery rail"
  roles       = ["provider", "consumer"]
}

protocol "analog-video" {
  description = "Analog composite video"
  roles       = ["provider", "consumer"]
}

protocol "i2c" {
  description = "I2C serial sensor bus"
  roles       = ["provider", "consumer"]
}
