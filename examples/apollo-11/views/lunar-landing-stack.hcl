view "lunar-landing-stack" {
  full_name = "Lunar Module descent, landing radar, and ascent guidance interfaces"
  system      = "apollo-11"

  node "apollo-11/lm-ascent" {
    x          = -500
    y          = -120
    width      = 650
    height     = 400
    text_align = "top-center"
  }

  node "apollo-11/lm-ascent/aps" {
    x          = -170
    y          = 0
    width      = 110
    height     = 60
    text_align = "center"
  }

  node "apollo-11/lm-ascent/aps-tanks" {
    x          = 30
    y          = -90
    width      = 110
    height     = 60
    text_align = "center"
  }

  node "apollo-11/lm-ascent/cabin" {
    x          = -400
    y          = 200
    width      = 120
    height     = 60
    text_align = "center"
  }

  node "apollo-11/lm-ascent/comms" {
    x          = -470
    y          = -70
    width      = 110
    height     = 60
    text_align = "center"
  }

  node "apollo-11/lm-ascent/dsky" {
    x          = -300
    y          = -30
    width      = 110
    height     = 60
    text_align = "center"
  }

  node "apollo-11/lm-ascent/imu" {
    x          = 20
    y          = 200
    width      = 110
    height     = 60
    text_align = "center"
  }

  node "apollo-11/lm-ascent/lgc" {
    x          = -180
    y          = 200
    width      = 110
    height     = 60
    text_align = "center"
  }

  node "apollo-11/lm-ascent/rcs" {
    x          = 30
    y          = 40
    width      = 110
    height     = 60
    text_align = "center"
  }

  node "apollo-11/lm-descent" {
    x          = -500
    y          = 320
    width      = 650
    height     = 260
    text_align = "top-center"
  }

  node "apollo-11/lm-descent/batteries" {
    x          = -420
    y          = 350
    width      = 110
    height     = 60
    text_align = "center"
  }

  node "apollo-11/lm-descent/dps" {
    x          = -460
    y          = 460
    width      = 160
    height     = 60
    text_align = "center"
  }

  node "apollo-11/lm-descent/dps-tanks" {
    x          = -120
    y          = 440
    width      = 220
    height     = 100
    text_align = "center"
  }

  node "apollo-11/lm-descent/landing-radar" {
    x          = -120
    y          = 350
    width      = 240
    height     = 60
    text_align = "center"
  }

  connection "lgc-to-dsky" {
    start_side = "top"
    end_side   = "bottom"
  }
}
