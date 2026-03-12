# Flight controller — defined as a top-level component for reuse.
# Referenced via `source = "flight-controller"` in systems.hcl.

component "flight-controller" {
  description = "Main flight computer"
  tags        = ["electronics", "compute"]
  leaf        = false

  port "motor-out" {
    description = "DShot600 motor control output"
    protocol    = "dshot600"
    role        = "provider"
    tags        = ["motor", "data"]

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

  port "gps-serial" {
    description = "UART link for GPS data"
    protocol    = "uart"
    role        = "peer"
    tags        = ["data", "navigation"]

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

  port "rc-in" {
    description = "CRSF serial: receiver → FC"
    protocol    = "crsf"
    role        = "consumer"
    tags        = ["rf", "control"]

    message "rc-channels" {
      description = "16 RC channel values"
      tags        = ["control"]

      field "channels" {
        type        = "uint16[16]"
        description = "Channel values 172-1811"
      }
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

  connection "spi-imu" {
    description = "SPI bus: MCU ↔ IMU"
    tags        = ["data"]
    from        = "mcu:spi"
    to          = "imu:spi"
  }

  connection "i2c-baro" {
    description = "I2C bus: MCU ↔ barometer"
    tags        = ["data"]
    from        = "mcu"
    to          = "barometer"
  }
}
