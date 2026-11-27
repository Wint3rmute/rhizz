view "drone-overview" {
  full_name = "Top-level drone architecture"
  system      = "quadcopter"

  node "quadcopter/drone" {
    x          = 80
    y          = 800
    width      = 770
    height     = 400
    text_align = "top-center"
  }

  node "quadcopter/drone/battery" {
    x          = 180
    y          = 1090
    width      = 100
    height     = 100
    text_align = "center"

    port "power-out" {
      side   = "left"
      offset = 0.2
    }
  }

  node "quadcopter/drone/camera" {
    x          = 730
    y          = 830
    width      = 100
    height     = 100
    text_align = "center"

    port "video-out" {
      side   = "bottom"
      offset = 0.5
    }
  }

  node "quadcopter/drone/esc" {
    x          = 100
    y          = 900
    width      = 100
    height     = 100
    text_align = "center"

    port "bec-out" {
      side   = "right"
      offset = 0.2
    }

    port "motor-in" {
      side   = "right"
      offset = 0.8
    }

    port "power-in" {
      side   = "bottom"
      offset = 0.3
    }
  }

  node "quadcopter/drone/flight-controller" {
    x          = 300
    y          = 900
    width      = 200
    height     = 100
    text_align = "center"

    port "gps-serial" {
      side   = "right"
      offset = 0.8
    }

    port "motor-out" {
      side   = "left"
      offset = 0.8
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

  node "quadcopter/drone/gps" {
    x          = 600
    y          = 1090
    width      = 100
    height     = 100
    text_align = "center"

    port "serial" {
      side   = "left"
      offset = 0.2
    }
  }

  node "quadcopter/drone/radio-rx" {
    x          = 600
    y          = 830
    width      = 100
    height     = 100
    text_align = "center"

    port "crsf" {
      side   = "left"
      offset = 0.5
    }
  }

  node "quadcopter/drone/vtx" {
    x          = 730
    y          = 1090
    width      = 100
    height     = 100
    text_align = "center"

    port "video-in" {
      side   = "top"
      offset = 0.5
    }
  }
}
