view "power-paths" {
  full_name = "Power distribution only"
  system      = "quadcopter"

  filter {
    include_tags  = ["power"]
  }

  node "quadcopter/drone" {
    x          = 90
    y          = 760
    width      = 580
    height     = 150
    text_align = "top-center"
  }

  node "quadcopter/drone/battery" {
    x          = 100
    y          = 800
    width      = 100
    height     = 100
    text_align = "center"

    port "power-out" {
      side   = "right"
      offset = 0.8
    }
  }

  node "quadcopter/drone/esc" {
    x          = 300
    y          = 800
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
      side   = "left"
      offset = 0.8
    }
  }

  node "quadcopter/drone/flight-controller" {
    x          = 500
    y          = 800
    width      = 160
    height     = 100
    text_align = "center"

    port "motor-out" {
      side   = "left"
      offset = 0.8
    }

    port "power-in" {
      side   = "left"
      offset = 0.2
    }
  }
}
