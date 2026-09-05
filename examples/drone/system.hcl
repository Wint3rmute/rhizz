project {
  name    = "drone-system"
  version = "0.3.0"
  authors = ["rhizz-examples"]
}

protocol "analog-video" {
  description = "Analog composite video"
  roles       = ["provider", "consumer"]
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

protocol "i2c" {
  description = "I2C serial sensor bus"
  roles       = ["provider", "consumer"]
}

protocol "power-dc" {
  description = "DC power delivery rail"
  roles       = ["provider", "consumer"]
}

protocol "spi" {
  description = "Serial peripheral interface"
  roles       = ["provider", "consumer"]
}

protocol "uart" {
  description = "UART serial bus"
  roles       = ["peer"]

  message "nav-pvt" {
    description = "Navigation position/velocity/time solution"
    tags        = ["navigation"]

    field "altitude" {
      type        = "int32"
      description = "Altitude above MSL"
      unit        = "mm"
    }

    field "fix_type" {
      type        = "uint8"
      description = "GNSS fix type"
    }

    field "latitude" {
      type        = "int32"
      description = "Latitude"
      unit        = "deg*1e7"
    }

    field "longitude" {
      type        = "int32"
      description = "Longitude"
      unit        = "deg*1e7"
    }
  }
}

component "barometer" {
  description = "BMP390 barometric pressure sensor"
  tags        = ["electronics", "sensor"]
  leaf        = true
}

component "battery" {
  description = "4S 1300mAh LiPo"
  tags        = ["power"]
  leaf        = true

  port "power-out" {
    description = "Main discharge output"
    protocol    = "power-dc"
    role        = "provider"
    tags        = ["power"]
  }
}

component "camera" {
  description = "FPV camera (analog)"
  tags        = ["electronics", "video"]
  leaf        = true

  port "video-out" {
    description = "Analog video output"
    protocol    = "analog-video"
    role        = "provider"
    tags        = ["video"]
  }
}

component "esc" {
  description = "4-in-1 ESC board"
  tags        = ["electronics", "power", "motor"]
  leaf        = true

  port "bec-out" {
    description = "5V BEC regulated output"
    protocol    = "power-dc"
    role        = "provider"
    tags        = ["power"]
  }

  port "motor-in" {
    description = "DShot600 motor control input"
    protocol    = "dshot600"
    role        = "consumer"
    tags        = ["motor", "data"]
  }

  port "power-in" {
    description = "Battery main power input"
    protocol    = "power-dc"
    role        = "consumer"
    tags        = ["power"]
  }
}

component "flight-controller" {
  description = "Main flight computer"
  tags        = ["electronics", "compute"]

  port "gps-serial" {
    description = "UART link for GPS data"
    protocol    = "uart"
    role        = "peer"
    tags        = ["data", "navigation"]
    external    = true
  }

  port "motor-out" {
    description = "DShot600 motor control output"
    protocol    = "dshot600"
    role        = "provider"
    tags        = ["motor", "data"]
    external    = true
  }

  port "rc-in" {
    description = "CRSF serial: receiver → FC"
    protocol    = "crsf"
    role        = "consumer"
    tags        = ["rf", "control"]
    external    = true
  }

  instance "barometer" { source = "barometer" }

  instance "imu" { source = "imu" }

  instance "mcu" { source = "mcu" }

  connection "i2c-baro" {
    description  = "I2C bus: MCU ↔ barometer"
    tags         = ["data"]
    from         = "mcu"
    to           = "barometer"
  }

  connection "spi-imu" {
    description  = "SPI bus: MCU ↔ IMU"
    tags         = ["data"]
    from         = "mcu/spi"
    to           = "imu/spi"
  }
}

component "goggles" {
  description = "FPV goggles with DVR"
  tags        = ["electronics", "video"]
  leaf        = true
}

component "gps" {
  description = "u-blox M10 GNSS receiver"
  color       = "success"
  border      = "dashed"
  font        = "italic"
  tags        = ["electronics", "sensor", "navigation"]
  leaf        = true

  port "serial" {
    description = "UART data port"
    protocol    = "uart"
    role        = "peer"
    tags        = ["data", "navigation"]
  }
}

component "ground-station-pc" {
  tags        = ["compute"]
}

component "imu" {
  description = "BMI270 6-axis IMU"
  tags        = ["electronics", "sensor"]
  leaf        = true

  port "spi" {
    description = "SPI slave interface"
    protocol    = "spi"
    role        = "consumer"
    tags        = ["data"]
  }
}

component "mcu" {
  description = "STM32H7 ARM Cortex-M7"
  tags        = ["electronics", "compute"]
  leaf        = true

  port "spi" {
    description = "SPI master bus"
    protocol    = "spi"
    role        = "provider"
    tags        = ["data"]
  }
}

component "radio-rx" {
  description = "ELRS 868MHz receiver"
  tags        = ["electronics", "rf"]
  leaf        = true

  port "crsf" {
    description = "CRSF serial output"
    protocol    = "crsf"
    role        = "provider"
    tags        = ["rf", "control"]
  }
}

component "transmitter" {
  description = "ELRS radio transmitter"
  tags        = ["electronics", "rf"]
  leaf        = true
}

component "vtx" {
  description = "5.8GHz video transmitter"
  tags        = ["electronics", "rf", "video"]
  leaf        = true

  port "video-in" {
    description = "Analog video input"
    protocol    = "analog-video"
    role        = "consumer"
    tags        = ["video"]
  }
}

system "ground-control" {
  description = "Pilot ground station"
  tags        = ["hardware", "ground"]

  instance "goggles" { source = "goggles" }

  instance "ground-station-pc" { source = "ground-station-pc" }

  instance "transmitter" { source = "transmitter" }

  connection "rf-control" {
    description  = "868MHz control link: TX → drone"
    tags         = ["rf", "control"]
    from         = "/ground-control/transmitter"
    to           = "/ground-control/ground-station-pc"
  }

  connection "video-downlink" {
    description  = "5.8GHz analog video reception"
    tags         = ["video", "rf"]
    from         = "/ground-control/ground-station-pc"
    to           = "/ground-control/goggles"
  }
}


system "quadcopter" {
  description = "Consumer quadcopter drone"
  tags        = ["hardware", "drone"]

  instance "battery" { source = "battery" }

  instance "camera" { source = "camera" }

  instance "esc" { source = "esc" }

  instance "flight-controller" { source = "flight-controller" }

  instance "gps" { source = "gps" }

  instance "radio-rx" { source = "radio-rx" }

  instance "vtx" { source = "vtx" }

  connection "gps-serial" {
    description  = "UART link: FC ↔ GPS"
    tags         = ["data", "navigation"]
    from         = "/quadcopter/flight-controller/gps-serial"
    to           = "/quadcopter/gps/serial"
  }

  connection "motor-control" {
    description  = "DShot600 motor signals"
    tags         = ["motor", "data"]
    from         = "/quadcopter/flight-controller/motor-out"
    to           = "/quadcopter/esc/motor-in"
  }

  connection "power-bec" {
    description  = "ESC 5V BEC → flight controller"
    tags         = ["power"]
    from         = "/quadcopter/esc/bec-out"
    to           = "/quadcopter/flight-controller"
  }

  connection "power-main" {
    description  = "Battery → ESC main power"
    tags         = ["power"]
    from         = "/quadcopter/battery/power-out"
    to           = "/quadcopter/esc/power-in"
  }

  connection "rc-link" {
    description  = "CRSF serial: receiver → FC"
    tags         = ["rf", "control"]
    from         = "/quadcopter/radio-rx/crsf"
    to           = "/quadcopter/flight-controller/rc-in"
  }

  connection "video-feed" {
    description  = "Analog video: camera → VTX"
    tags         = ["video"]
    from         = "/quadcopter/camera/video-out"
    to           = "/quadcopter/vtx/video-in"
  }
}
