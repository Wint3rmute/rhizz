view "pgncs-guidance-navigation" {
  system      = "apollo-11"

  node "apollo-11/cm" {
    x          = -400
    y          = -800
    width      = 600
    height     = 390
    text_align = "top-center"
  }

  node "apollo-11/cm/agc" {
    x          = -150
    y          = -750
    width      = 100
    height     = 100
    text_align = "center"
  }

  node "apollo-11/cm/dsky" {
    x          = 30
    y          = -750
    width      = 100
    height     = 100
    text_align = "center"
  }

  node "apollo-11/cm/imu" {
    x          = -150
    y          = -540
    width      = 100
    height     = 100
    text_align = "center"
  }

  node "apollo-11/cm/optics" {
    x          = -330
    y          = -750
    width      = 100
    height     = 100
    text_align = "center"
  }

  node "apollo-11/lm-ascent" {
    x          = -400
    y          = -400
    width      = 600
    height     = 200
    text_align = "top-center"
  }

  node "apollo-11/lm-ascent/dsky" {
    x          = -350
    y          = -300
    width      = 100
    height     = 60
    text_align = "center"
  }

  node "apollo-11/lm-ascent/imu" {
    x          = 20
    y          = -300
    width      = 100
    height     = 60
    text_align = "center"
  }

  node "apollo-11/lm-ascent/lgc" {
    x          = -150
    y          = -300
    width      = 100
    height     = 60
    text_align = "center"
  }
}
