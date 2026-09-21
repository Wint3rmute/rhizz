view "pc-build" {
  system = "computer-setup"
  node "computer-setup/computer" {
    x          = 0
    y          = 0
    width      = 340
    height     = 120
    text_align = "top-center"
  }

  node "computer-setup/computer/gpu" {
    x          = 20
    y          = 50
    width      = 100
    height     = 50
  }

  node "computer-setup/computer/cpu" {
    x          = 220
    y          = 50
    width      = 100
    height     = 50
  }
}
