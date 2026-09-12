view "pgncs-guidance-navigation" {
  description = "Primary Guidance, Navigation, and Control System (PGNCS) loops on CM and LM"
  system      = "apollo-11"

  node "apollo-11/cm" {
    x          = -500
    y          = -980
    width      = 880
    height     = 510
    text_align = "top-center"
  }

  node "apollo-11/cm/agc" {
    x          = 240
    y          = -770
    width      = 100
    height     = 100
    text_align = "center"
  }

  node "apollo-11/cm/dsky" {
    x          = 240
    y          = -950
    width      = 100
    height     = 100
    text_align = "center"
  }

  node "apollo-11/cm/imu" {
    x          = -90
    y          = -660
    width      = 100
    height     = 100
    text_align = "center"
  }

  node "apollo-11/cm/optics" {
    x          = -400
    y          = -890
    width      = 120
    height     = 70
    text_align = "center"
  }

  node "apollo-11/lm-ascent" {
    x          = -500
    y          = -120
    width      = 650
    height     = 400
    text_align = "top-center"
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

  connection "lgc-to-dsky" {
    start_side = "top"
    end_side   = "bottom"
  }
}
