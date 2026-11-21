view "main" {
  system      = "quadcopter"

  node "quadcopter/drone/battery" {
    x          = 100
    y          = 1260
    width      = 100
    height     = 100
    text_align = "center"

    port "power-out" {
      side   = "right"
      offset = 0.2
    }
  }

  node "quadcopter/drone/camera" {
    x          = 650
    y          = 850
    width      = 100
    height     = 100
    text_align = "center"

    port "video-out" {
      side   = "bottom"
      offset = 0.5001405998939435
    }
  }

  node "quadcopter/drone/esc" {
    x          = 300
    y          = 1200
    width      = 100
    height     = 100
    text_align = "center"

    port "bec-out" {
      side   = "left"
      offset = 0.2
    }

    port "motor-in" {
      side   = "right"
      offset = 0.2
    }

    port "power-in" {
      side   = "left"
      offset = 0.8
    }
  }

  node "quadcopter/drone/flight-controller" {
    x          = 100
    y          = 800
    width      = 500
    height     = 360
    text_align = "top-center"

    port "gps-serial" {
      side   = "left"
      offset = 0.22318525123367694
    }

    port "motor-out" {
      side   = "bottom"
      offset = 0.8
    }

    port "power-in" {
      side   = "bottom"
      offset = 0.2003056268487051
    }

    port "rc-in" {
      side   = "left"
      offset = 0.7777777777777778
    }
  }

  node "quadcopter/drone/flight-controller/barometer" {
    x          = 380
    y          = 850
    width      = 130
    height     = 100
    text_align = "center"
  }

  node "quadcopter/drone/flight-controller/imu" {
    x          = 380
    y          = 1010
    width      = 130
    height     = 100
    text_align = "center"
  }

  node "quadcopter/drone/flight-controller/mcu" {
    x          = 160
    y          = 930
    width      = 130
    height     = 100
    text_align = "center"
  }

  node "quadcopter/drone/gps" {
    x          = -100
    y          = 800
    width      = 100
    height     = 100
    text_align = "center"

    port "serial" {
      side   = "right"
      offset = 0.8
    }
  }

  node "quadcopter/drone/radio-rx" {
    x          = -100
    y          = 1000
    width      = 100
    height     = 100
    text_align = "center"

    port "crsf" {
      side   = "right"
      offset = 0.8
    }
  }

  node "quadcopter/drone/vtx" {
    x          = 650
    y          = 1050
    width      = 100
    height     = 100
    text_align = "center"

    port "video-in" {
      side   = "top"
      offset = 0.5
    }
  }

  annotation {
    x     = -160
    y     = 780
    text  = "GPS feed is noisy — see issue #42"
  }
}
