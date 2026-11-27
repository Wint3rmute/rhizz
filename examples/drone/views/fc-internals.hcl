view "fc-internals" {
  system      = "quadcopter"

  node "quadcopter/drone/flight-controller" {
    x          = 300
    y          = 900
    width      = 300
    height     = 200
    text_align = "top-center"

    port "gps-serial" {
      side   = "right"
      offset = 0.8
    }

    port "motor-out" {
      side   = "left"
      offset = 0.7
    }

    port "power-in" {
      side   = "left"
      offset = 0.2
    }

    port "rc-in" {
      side   = "right"
      offset = 0.2
    }
  }

  node "quadcopter/drone/flight-controller/barometer" {
    x          = 480
    y          = 1020
    width      = 100
    height     = 62
    text_align = "center"

    port "i2c" {
      side   = "left"
      offset = 0.3225806451612903
    }
  }

  node "quadcopter/drone/flight-controller/imu" {
    x          = 480
    y          = 930
    width      = 100
    height     = 62
    text_align = "center"
  }

  node "quadcopter/drone/flight-controller/mcu" {
    x          = 310
    y          = 980
    width      = 100
    height     = 62
    text_align = "center"

    port "i2c" {
      side   = "right"
      offset = 0.6451612903225806
    }

    port "spi" {
      side   = "right"
      offset = 0.3225806451612903
    }
  }
}
