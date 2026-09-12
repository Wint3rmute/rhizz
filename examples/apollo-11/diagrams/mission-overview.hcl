view "mission-overview" {
  description = "Complete Apollo 11 trans-lunar architecture overview"
  system      = "apollo-11"

  node "apollo-11/cm" {
    x          = -500
    y          = -980
    width      = 880
    height     = 510
    text_align = "top-center"
  }

  node "apollo-11/lm-ascent" {
    x          = -500
    y          = -120
    width      = 650
    height     = 400
    text_align = "top-center"
  }

  node "apollo-11/lm-descent" {
    x          = -500
    y          = 320
    width      = 650
    height     = 260
    text_align = "top-center"
  }

  node "apollo-11/mcc" {
    x          = -760
    y          = -190
    width      = 120
    height     = 60
    text_align = "center"
  }

  node "apollo-11/saturn-v" {
    x          = -500
    y          = 600
    width      = 880
    height     = 250
    text_align = "top-center"
  }

  node "apollo-11/sm" {
    x          = -500
    y          = -450
    width      = 720
    height     = 310
    text_align = "top-center"
  }
}
