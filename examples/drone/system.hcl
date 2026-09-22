project {
  name    = "drone-system"
  version = "0.3.0"
  authors = ["rhizz-examples"]
}

protocol "analog-video" {
  full_name = "Analog composite video"
  roles       = ["provider", "consumer"]
}

protocol "crsf" {
  full_name = "CRSF serial protocol for RC input"
  roles       = ["provider", "consumer", "peer"]

  message "rc-channels" {
    full_name = "16 RC channel values"
    tags        = ["control"]

    field "channels" {
      type        = "uint16[16]"
      full_name = "Channel values 172-1811"
    }
  }
}

protocol "dshot600" {
  full_name = "DShot600 digital motor control"
  roles       = ["provider", "consumer"]

  message "throttle" {
    full_name = "Per-motor throttle command"
    tags        = ["control"]

    field "motor_id" {
      type        = "uint8"
      full_name = "Motor index 1-4"
    }

    field "value" {
      type        = "uint16"
      full_name = "Throttle 0-2047"
    }
  }
}

protocol "i2c" {
  full_name = "I2C serial sensor bus"
  roles       = ["provider", "consumer"]
}

protocol "power-dc" {
  full_name = "DC power delivery rail"
  roles       = ["provider", "consumer"]
}

protocol "spi" {
  full_name = "Serial peripheral interface"
  roles       = ["provider", "consumer"]
}

protocol "uart" {
  full_name = "UART serial bus"
  roles       = ["peer"]

  message "nav-pvt" {
    full_name = "Navigation position/velocity/time solution"
    tags        = ["navigation"]

    field "altitude" {
      type        = "int32"
      full_name = "Altitude above MSL"
      unit        = "mm"
    }

    field "fix_type" {
      type        = "uint8"
      full_name = "GNSS fix type"
    }

    field "latitude" {
      type        = "int32"
      full_name = "Latitude"
      unit        = "deg*1e7"
    }

    field "longitude" {
      type        = "int32"
      full_name = "Longitude"
      unit        = "deg*1e7"
    }
  }
}

component "barometer" {
  full_name = "BMP390 barometric pressure sensor"
  tags        = ["electronics", "sensor"]
  leaf        = true
}

component "battery" {
  full_name = "4S 1300mAh LiPo"
  tags        = ["power"]
  leaf        = true

  port "power-out" {
    full_name = "Main discharge output"
    protocol    = "power-dc"
    role        = "provider"
    tags        = ["power"]
  }
}

component "camera" {
  full_name = "FPV camera (analog)"
  tags        = ["electronics", "video"]
  leaf        = true

  port "video-out" {
    full_name = "Analog video output"
    protocol    = "analog-video"
    role        = "provider"
    tags        = ["video"]
  }
}

component "esc" {
  full_name = "4-in-1 ESC board"
  tags        = ["electronics", "power", "motor"]
  leaf        = true

  port "bec-out" {
    full_name = "5V BEC regulated output"
    protocol    = "power-dc"
    role        = "provider"
    tags        = ["power"]
  }

  port "motor-in" {
    full_name = "DShot600 motor control input"
    protocol    = "dshot600"
    role        = "consumer"
    tags        = ["motor", "data"]
  }

  port "power-in" {
    full_name = "Battery main power input"
    protocol    = "power-dc"
    role        = "consumer"
    tags        = ["power"]
  }
}

component "flight-controller" {
  full_name = "Main flight computer"
  tags        = ["electronics", "compute"]

  port "gps-serial" {
    full_name = "UART link for GPS data"
    protocol    = "uart"
    role        = "peer"
    tags        = ["data", "navigation"]
    external    = true
  }

  port "motor-out" {
    full_name = "DShot600 motor control output"
    protocol    = "dshot600"
    role        = "provider"
    tags        = ["motor", "data"]
    external    = true
  }

  port "rc-in" {
    full_name = "CRSF serial: receiver → FC"
    protocol    = "crsf"
    role        = "consumer"
    tags        = ["rf", "control"]
    external    = true
  }

  instance "barometer" { source = "barometer" }

  instance "imu" { source = "imu" }

  instance "mcu" { source = "mcu" }

  connection "i2c-baro" {
    full_name  = "I2C bus: MCU ↔ barometer"
    tags         = ["data"]
    from         = "mcu"
    to           = "barometer"
  }

  connection "spi-imu" {
    full_name  = "SPI bus: MCU ↔ IMU"
    tags         = ["data"]
    from         = "mcu/spi"
    to           = "imu/spi"
  }
}

component "goggles" {
  full_name = "FPV goggles with DVR"
  tags        = ["electronics", "video"]
  leaf        = true
}

component "gps" {
  full_name = "u-blox M10 GNSS receiver"
  color       = "success"
  border      = "dashed"
  font        = "italic"
  tags        = ["electronics", "sensor", "navigation"]
  leaf        = true

  port "serial" {
    full_name = "UART data port"
    protocol    = "uart"
    role        = "peer"
    tags        = ["data", "navigation"]
  }
}

component "ground-station-pc" {
  tags        = ["compute"]
}

component "imu" {
  full_name = "BMI270 6-axis IMU"
  tags        = ["electronics", "sensor"]
  leaf        = true

  port "spi" {
    full_name = "SPI slave interface"
    protocol    = "spi"
    role        = "consumer"
    tags        = ["data"]
  }
}

component "mcu" {
  full_name = "STM32H7 ARM Cortex-M7"
  tags        = ["electronics", "compute"]
  leaf        = true

  port "spi" {
    full_name = "SPI master bus"
    protocol    = "spi"
    role        = "provider"
    tags        = ["data"]
  }
}

component "radio-rx" {
  full_name = "ELRS 868MHz receiver"
  tags        = ["electronics", "rf"]
  leaf        = true

  port "crsf" {
    full_name = "CRSF serial output"
    protocol    = "crsf"
    role        = "provider"
    tags        = ["rf", "control"]
  }
}

component "transmitter" {
  full_name = "ELRS radio transmitter"
  tags        = ["electronics", "rf"]
  leaf        = true
}

component "vtx" {
  full_name = "5.8GHz video transmitter"
  tags        = ["electronics", "rf", "video"]
  leaf        = true

  port "video-in" {
    full_name = "Analog video input"
    protocol    = "analog-video"
    role        = "consumer"
    tags        = ["video"]
  }
}

system "ground-control" {
  full_name = "Pilot ground station"
  tags        = ["hardware", "ground"]

  instance "goggles" { source = "goggles" }

  instance "ground-station-pc" { source = "ground-station-pc" }

  instance "transmitter" { source = "transmitter" }

  connection "rf-control" {
    full_name  = "868MHz control link: TX → drone"
    tags         = ["rf", "control"]
    from         = "/ground-control/transmitter"
    to           = "/ground-control/ground-station-pc"
  }

  connection "video-downlink" {
    full_name  = "5.8GHz analog video reception"
    tags         = ["video", "rf"]
    from         = "/ground-control/ground-station-pc"
    to           = "/ground-control/goggles"
  }
}


system "quadcopter" {
  full_name = "Consumer quadcopter drone"
  tags        = ["hardware", "drone"]

  instance "battery" { source = "battery" }

  instance "camera" { source = "camera" }

  instance "esc" { source = "esc" }

  instance "flight-controller" { source = "flight-controller" }

  instance "gps" { source = "gps" }

  instance "radio-rx" { source = "radio-rx" }

  instance "vtx" { source = "vtx" }

  connection "gps-serial" {
    full_name  = "UART link: FC ↔ GPS"
    tags         = ["data", "navigation"]
    from         = "/quadcopter/flight-controller/gps-serial"
    to           = "/quadcopter/gps/serial"
  }

  connection "motor-control" {
    full_name  = "DShot600 motor signals"
    tags         = ["motor", "data"]
    from         = "/quadcopter/flight-controller/motor-out"
    to           = "/quadcopter/esc/motor-in"
  }

  connection "power-bec" {
    full_name  = "ESC 5V BEC → flight controller"
    tags         = ["power"]
    from         = "/quadcopter/esc/bec-out"
    to           = "/quadcopter/flight-controller"
  }

  connection "power-main" {
    full_name  = "Battery → ESC main power"
    tags         = ["power"]
    from         = "/quadcopter/battery/power-out"
    to           = "/quadcopter/esc/power-in"
  }

  connection "rc-link" {
    full_name  = "CRSF serial: receiver → FC"
    tags         = ["rf", "control"]
    from         = "/quadcopter/radio-rx/crsf"
    to           = "/quadcopter/flight-controller/rc-in"
  }

  connection "video-feed" {
    full_name  = "Analog video: camera → VTX"
    tags         = ["video"]
    from         = "/quadcopter/camera/video-out"
    to           = "/quadcopter/vtx/video-in"
  }
}
