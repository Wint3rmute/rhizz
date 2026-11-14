view "pgncs-guidance-navigation" {
  system      = "apollo-11"

  node "apollo-11/cm" {
    x          = -400
    y          = -800
    width      = 600
    height     = 390
    text_align = "top-center"

    port "cabin/docking-probe" {
      side   = "bottom"
      offset = 0.2833333333333333
    }
  }

  node "apollo-11/cm/agc" {
    x          = -150
    y          = -750
    width      = 100
    height     = 100
    text_align = "top-center"

    port "dsky-bus" {
      side   = "right"
      offset = 0.7
    }

    port "imu-bus" {
      side   = "bottom"
      offset = 0.5
    }

    port "optics-bus" {
      side   = "left"
      offset = 0.7
    }
  }

  node "apollo-11/cm/dsky" {
    x          = 30
    y          = -750
    width      = 100
    height     = 100
    text_align = "top-center"

    port "agc-interface" {
      side   = "left"
      offset = 0.7
    }
  }

  node "apollo-11/cm/imu" {
    x          = -150
    y          = -540
    width      = 100
    height     = 100
    text_align = "center"

    port "agc-coupling" {
      side   = "top"
      offset = 0.5
    }
  }

  node "apollo-11/cm/optics" {
    x          = -330
    y          = -750
    width      = 100
    height     = 100
    text_align = "top-center"

    port "agc-sighting" {
      side   = "right"
      offset = 0.7
    }
  }

  node "apollo-11/lm-ascent" {
    x          = -400
    y          = -340
    width      = 600
    height     = 200
    text_align = "top-center"

    port "cabin/docking-drogue" {
      side   = "top"
      offset = 0.2833333333333333
    }
  }

  node "apollo-11/lm-ascent/dsky" {
    x          = -350
    y          = -280
    width      = 100
    height     = 80
    text_align = "center"

    port "lgc-interface" {
      side   = "right"
      offset = 0.875
    }
  }

  node "apollo-11/lm-ascent/imu" {
    x          = 20
    y          = -280
    width      = 100
    height     = 80
    text_align = "center"

    port "lgc-coupling" {
      side   = "left"
      offset = 0.875
    }
  }

  node "apollo-11/lm-ascent/lgc" {
    x          = -150
    y          = -280
    width      = 100
    height     = 80
    text_align = "center"

    port "dsky-bus" {
      side   = "left"
      offset = 0.875
    }

    port "imu-bus" {
      side   = "right"
      offset = 0.875
    }
  }
}
