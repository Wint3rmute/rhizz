# Drone system model — a single file containing the complete architecture.
# Two systems: the quadcopter and the pilot ground control station.
# The "ground-control" system is deliberately less complete — shows
# in-progress modeling that still compiles cleanly (W001/W004 warnings only).

project {
  name    = "drone-system"
  version = "0.3.0"
  authors = ["rhizz-examples"]
}

# ── Protocols ─────────────────────────────

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

# ── Component definitions ─────────────────
# Reusable component definitions declared outside any system.
# Inside systems (and other definitions) they are referenced via `instance`.

component "flight-controller" {
  description = "Main flight computer"
  tags        = ["electronics", "compute"]
  leaf        = false

  port "motor-out" {
    description = "DShot600 motor control output"
    protocol    = "dshot600"
    role        = "provider"
    external    = true
    tags        = ["motor", "data"]
  }

  port "gps-serial" {
    description = "UART link for GPS data"
    protocol    = "uart"
    role        = "peer"
    external    = true
    tags        = ["data", "navigation"]
  }

  port "rc-in" {
    description = "CRSF serial: receiver → FC"
    protocol    = "crsf"
    role        = "consumer"
    external    = true
    tags        = ["rf", "control"]
  }

  instance "mcu" {
    source = "mcu"
  }

  instance "imu" {
    source = "imu"
  }

  instance "barometer" {
    source = "barometer"
  }

  connection "spi-imu" {
    description = "SPI bus: MCU ↔ IMU"
    tags        = ["data"]
    from        = "mcu/spi"
    to          = "imu/spi"
  }

  connection "i2c-baro" {
    description = "I2C bus: MCU ↔ barometer"
    tags        = ["data"]
    from        = "mcu"
    to          = "barometer"
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

component "barometer" {
  description = "BMP390 barometric pressure sensor"
  tags        = ["electronics", "sensor"]
  leaf        = true
}

component "esc" {
  description = "4-in-1 ESC board"
  tags        = ["electronics", "power", "motor"]
  leaf        = true

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

  port "bec-out" {
    description = "5V BEC regulated output"
    protocol    = "power-dc"
    role        = "provider"
    tags        = ["power"]
  }
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

component "transmitter" {
  description = "ELRS radio transmitter"
  tags        = ["electronics", "rf"]
  leaf        = true
}

component "goggles" {
  description = "FPV goggles with DVR"
  tags        = ["electronics", "video"]
  leaf        = true
}

# This component is non-leaf but has no children yet → W001
component "ground-station-pc" {
  tags = ["compute"]
  leaf = false
  # description intentionally missing → W004
  # children not yet modeled   → W001
}

# ── Systems ───────────────────────────────

system "quadcopter" {
  description = "Consumer quadcopter drone"
  tags        = ["hardware", "drone"]
  level       = 0

  # ── Component instances ────────────────────

  instance "flight-controller" {
    source = "flight-controller"
  }

  instance "esc" {
    source = "esc"
  }

  instance "gps" {
    source = "gps"
  }

  instance "battery" {
    source = "battery"
  }

  instance "radio-rx" {
    source = "radio-rx"
  }

  instance "vtx" {
    source = "vtx"
  }

  instance "camera" {
    source = "camera"
  }

  # ── Connections ────────────────────────────

  connection "motor-control" {
    description = "DShot600 motor signals"
    tags        = ["motor", "data"]
    from        = "flight-controller/motor-out"
    to          = "esc/motor-in"
  }

  connection "gps-serial" {
    description = "UART link: FC ↔ GPS"
    tags        = ["data", "navigation"]
    from        = "flight-controller/gps-serial"
    to          = "gps/serial"
  }

  connection "rc-link" {
    description = "CRSF serial: receiver → FC"
    tags        = ["rf", "control"]
    from        = "radio-rx/crsf"
    to          = "flight-controller/rc-in"
  }

  connection "power-main" {
    description = "Battery → ESC main power"
    tags        = ["power"]
    from        = "battery/power-out"
    to          = "esc/power-in"
  }

  connection "power-bec" {
    description = "ESC 5V BEC → flight controller"
    tags        = ["power"]
    from        = "esc/bec-out"
    to          = "flight-controller"
  }

  connection "video-feed" {
    description = "Analog video: camera → VTX"
    tags        = ["video"]
    from        = "camera/video-out"
    to          = "vtx/video-in"
  }
}

# ════════════════════════════════════════════
# Ground control — intentionally incomplete.
# Shows that a system can be a work-in-progress:
# non-leaf components without children trigger W001,
# missing descriptions trigger W004, but no errors.
# ════════════════════════════════════════════

system "ground-control" {
  description = "Pilot ground station"
  tags        = ["hardware", "ground"]
  level       = 0

  instance "transmitter" {
    source = "transmitter"
  }

  instance "goggles" {
    source = "goggles"
  }

  instance "ground-station-pc" {
    source = "ground-station-pc"
  }

  connection "rf-control" {
    description = "868MHz control link: TX → drone"
    tags        = ["rf", "control"]
    from        = "transmitter"
    to          = "ground-station-pc"
  }

  connection "video-downlink" {
    description = "5.8GHz analog video reception"
    tags        = ["video", "rf"]
    from        = "ground-station-pc"
    to          = "goggles"
  }
}