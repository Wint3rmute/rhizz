# Two systems in one project: the drone itself and the ground control station.
# Interfaces at the top level of each system connect sibling components.
# The "ground-control" system is deliberately less complete — shows
# in-progress modeling that still compiles cleanly (W001/W005 warnings only).

system "quadcopter" {
  description = "Consumer quadcopter drone"
  tags        = ["hardware", "drone"]
  level       = 0

  # ── Components ────────────────────────────

  component "flight-controller" {
    description = "Main flight computer"
    tags        = ["electronics", "compute"]
    leaf        = false

    component "mcu" {
      description = "STM32H7 ARM Cortex-M7"
      tags        = ["electronics", "compute"]
      leaf        = true
    }

    component "imu" {
      description = "BMI270 6-axis IMU"
      tags        = ["electronics", "sensor"]
      leaf        = true
    }

    component "barometer" {
      description = "BMP390 barometric pressure sensor"
      tags        = ["electronics", "sensor"]
      leaf        = true
    }

    interface "spi-imu" {
      description = "SPI bus: MCU ↔ IMU"
      from        = "mcu"
      to          = "imu"
      direction   = "bidirectional"
      tags        = ["data"]
      leaf        = true
    }

    interface "i2c-baro" {
      description = "I2C bus: MCU ↔ barometer"
      from        = "mcu"
      to          = "barometer"
      direction   = "bidirectional"
      tags        = ["data"]
      leaf        = true
    }
  }

  component "esc" {
    description = "4-in-1 ESC board"
    tags        = ["electronics", "power", "motor"]
    leaf        = true
  }

  component "gps" {
    description = "u-blox M10 GNSS receiver"
    tags        = ["electronics", "sensor", "navigation"]
    leaf        = true
  }

  component "battery" {
    description = "4S 1300mAh LiPo"
    tags        = ["power"]
    leaf        = true
  }

  component "radio-rx" {
    description = "ELRS 868MHz receiver"
    tags        = ["electronics", "rf"]
    leaf        = true
  }

  component "vtx" {
    description = "5.8GHz video transmitter"
    tags        = ["electronics", "rf", "video"]
    leaf        = true
  }

  component "camera" {
    description = "FPV camera (analog)"
    tags        = ["electronics", "video"]
    leaf        = true
  }

  # ── Interfaces ────────────────────────────

  interface "motor-control" {
    description = "DShot600 motor signals"
    tags        = ["motor", "data"]
    from        = "flight-controller"
    to          = "esc"
    direction   = "unidirectional"
    leaf        = false

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

  interface "gps-serial" {
    description = "UART link: FC ↔ GPS"
    tags        = ["data", "navigation"]
    from        = "flight-controller"
    to          = "gps"
    direction   = "bidirectional"
    leaf        = false

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

  interface "rc-link" {
    description = "CRSF serial: receiver → FC"
    tags        = ["rf", "control"]
    from        = "radio-rx"
    to          = "flight-controller"
    direction   = "bidirectional"
    leaf        = false

    message "rc-channels" {
      description = "16 RC channel values"
      tags        = ["control"]

      field "channels" {
        type        = "uint16[16]"
        description = "Channel values 172-1811"
      }
    }
  }

  interface "power-main" {
    description = "Battery → ESC main power"
    tags        = ["power"]
    from        = "battery"
    to          = "esc"
    direction   = "unidirectional"
    leaf        = true
  }

  interface "power-bec" {
    description = "ESC 5V BEC → flight controller"
    tags        = ["power"]
    from        = "esc"
    to          = "flight-controller"
    direction   = "unidirectional"
    leaf        = true
  }

  interface "video-feed" {
    description = "Analog video: camera → VTX"
    tags        = ["video"]
    from        = "camera"
    to          = "vtx"
    direction   = "unidirectional"
    leaf        = true
  }
}

# ════════════════════════════════════════════
# Ground control — intentionally incomplete.
# Shows that a system can be a work-in-progress:
# non-leaf components without children trigger W001,
# missing descriptions trigger W005, but no errors.
# ════════════════════════════════════════════

system "ground-control" {
  description = "Pilot ground station"
  tags        = ["hardware", "ground"]
  level       = 0

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
    # description intentionally missing → W005
    # children not yet modeled   → W001
  }

  interface "rf-control" {
    description = "868MHz control link: TX → drone"
    tags        = ["rf", "control"]
    from        = "transmitter"
    to          = "ground-station-pc"
    direction   = "unidirectional"
    leaf        = true
  }

  interface "video-downlink" {
    description = "5.8GHz analog video reception"
    tags        = ["video", "rf"]
    from        = "ground-station-pc"
    to          = "goggles"
    direction   = "unidirectional"
    leaf        = true
  }
}
