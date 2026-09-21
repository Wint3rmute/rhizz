view "mission-overview" {
  system      = "apollo-11"

  node "apollo-11/cm" {
    x          = -450
    y          = -1000
    width      = 100
    height     = 100
    text_align = "center"
  }

  node "apollo-11/lm-ascent" {
    x          = -500
    y          = -800
    width      = 200
    height     = 100
    text_align = "center"
  }

  node "apollo-11/lm-descent" {
    x          = -500
    y          = -700
    width      = 200
    height     = 100
    text_align = "center"
  }

  node "apollo-11/mcc" {
    x          = -700
    y          = -800
    width      = 100
    height     = 100
    text_align = "center"
  }

  node "apollo-11/saturn-v" {
    x          = -600
    y          = -600
    width      = 400
    height     = 100
    text_align = "center"
  }

  node "apollo-11/sm" {
    x          = -480
    y          = -900
    width      = 160
    height     = 100
    text_align = "center"
  }
}
