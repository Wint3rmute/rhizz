view "power-paths" {
  full_name = "Power distribution only"
  system      = "quadcopter"

  filter {
    include_tags  = ["power"]
  }

  node "quadcopter/drone" {
    x          = 288.21099495849603
    y          = 860.3813252319337
    width      = 100
    height     = 100
    text_align = "center"
  }

  node "quadcopter/drone/battery" {
    x          = 298.21099495849603
    y          = 888.3813252319337
    width      = 80
    height     = 62
    text_align = "center"

    port "power-out" {
      side   = "right"
      offset = 0.2
    }
  }

  node "quadcopter/drone/esc" {
    x          = 298.21099495849603
    y          = 888.3813252319337
    width      = 80
    height     = 62
    text_align = "center"

    port "bec-out" {
      side   = "right"
      offset = 0.3
    }

    port "motor-in" {
      side   = "right"
      offset = 0.8
    }

    port "power-in" {
      side   = "left"
      offset = 0.2
    }
  }

  node "quadcopter/drone/flight-controller" {
    x          = 298.21099495849603
    y          = 888.3813252319337
    width      = 80
    height     = 62
    text_align = "center"

    port "motor-out" {
      side   = "left"
      offset = 0.8
    }

    port "power-in" {
      side   = "left"
      offset = 0.3
    }
  }
}
