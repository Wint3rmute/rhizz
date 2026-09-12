view "power-and-cryo-distribution" {
  description = "Cryogenic reactant storage, SM fuel cells, and 28V DC power distribution"
  system      = "apollo-11"

  node "apollo-11/sm" {
    x          = -500
    y          = -450
    width      = 720
    height     = 310
    text_align = "top-center"
  }

  node "apollo-11/sm/cryo-tanks" {
    x          = -240
    y          = -260
    width      = 80
    height     = 62
    text_align = "center"
  }

  node "apollo-11/sm/fuel-cells" {
    x          = -240
    y          = -410
    width      = 80
    height     = 62
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
}
