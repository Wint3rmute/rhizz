view "rf-telemetry-network" {
  system      = "apollo-11"

  node "apollo-11/lm-ascent" {
    x          = -500
    y          = -130
    width      = 200
    height     = 130
    text_align = "top-center"
  }

  node "apollo-11/lm-ascent/comms" {
    x          = -460
    y          = -90
    width      = 120
    height     = 60
    text_align = "center"
  }

  node "apollo-11/mcc" {
    x          = -300
    y          = 100
    width      = 100
    height     = 60
    text_align = "center"
  }

  node "apollo-11/sm" {
    x          = -200
    y          = -130
    width      = 200
    height     = 130
    text_align = "top-center"
  }

  node "apollo-11/sm/hga" {
    x          = -160
    y          = -90
    width      = 120
    height     = 60
    text_align = "center"
  }
}
