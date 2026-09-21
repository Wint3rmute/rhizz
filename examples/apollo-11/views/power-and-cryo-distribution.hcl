view "power-and-cryo-distribution" {
  system      = "apollo-11"

  node "apollo-11/lm-descent" {
    x          = -500
    y          = 190
    width      = 300
    height     = 110
    text_align = "top-center"
  }

  node "apollo-11/lm-descent/batteries" {
    x          = -400
    y          = 230
    width      = 110
    height     = 50
    text_align = "center"
  }

  node "apollo-11/sm" {
    x          = -500
    y          = 0
    width      = 300
    height     = 180
    text_align = "top-center"
  }

  node "apollo-11/sm/cryo-tanks" {
    x          = -310
    y          = 60
    width      = 80
    height     = 62
    text_align = "center"
  }

  node "apollo-11/sm/fuel-cells" {
    x          = -470
    y          = 60
    width      = 80
    height     = 62
    text_align = "center"
  }
}
