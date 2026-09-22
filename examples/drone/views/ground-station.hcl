view "ground-station" {
  full_name = "Ground control overview"
  system      = "ground-control"

  filter {
    max_level     = 1
  }

  node "ground-control/goggles" {
    x          = 70
    y          = 1600
    width      = 100
    height     = 100
    text_align = "center"
  }

  node "ground-control/ground-station-pc" {
    x          = 70
    y          = 1420
    width      = 100
    height     = 100
    text_align = "center"
  }

  node "ground-control/transmitter" {
    x          = 70
    y          = 1240
    width      = 100
    height     = 100
    text_align = "center"
  }

  annotation {
    x    = -120
    y    = 1960
    text = "Ground station shown with optional goggles"
    scale = 1.5
  }
}
