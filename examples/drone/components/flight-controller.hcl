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
