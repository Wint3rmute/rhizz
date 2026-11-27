view "ground-station" {
  full_name = "Ground control overview"
  system      = "ground-control"

  filter {
    max_level     = 1
  }

  node "ground-control/goggles" {
    x          = 500
    y          = 1200
    width      = 100
    height     = 100
    text_align = "center"

    port "video-in" {
      side   = "top"
      offset = 0.5
    }
  }

  node "ground-control/ground-station-pc" {
    x          = 450
    y          = 1000
    width      = 200
    height     = 100
    text_align = "center"

    port "control-in" {
      side   = "top"
      offset = 0.5
    }

    port "video-out" {
      side   = "bottom"
      offset = 0.5
    }
  }

  node "ground-control/transmitter" {
    x          = 500
    y          = 800
    width      = 100
    height     = 100
    text_align = "center"

    port "control-out" {
      side   = "bottom"
      offset = 0.5
    }
  }

  annotation {
    x     = 130
    y     = 960
    text  = "Ground station shown with optional goggles"
    scale = 1.5
  }
}
