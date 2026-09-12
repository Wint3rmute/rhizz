view "rf-telemetry-network" {
  description = "Unified S-band Earth ground network and inter-spacecraft VHF ranging"
  system      = "apollo-11"

  node "apollo-11/sm" {
    x          = -500
    y          = -450
    width      = 720
    height     = 310
    text_align = "top-center"
  }

  node "apollo-11/sm/hga" {
    x          = -470
    y          = -400
    width      = 110
    height     = 60
    text_align = "center"
  }

  node "apollo-11/lm-ascent" {
    x          = -500
    y          = -120
    width      = 650
    height     = 400
    text_align = "top-center"
  }

  node "apollo-11/lm-ascent/comms" {
    x          = -470
    y          = -70
    width      = 110
    height     = 60
    text_align = "center"
  }

  node "apollo-11/mcc" {
    x          = -760
    y          = -190
    width      = 120
    height     = 60
    text_align = "center"
  }
}
