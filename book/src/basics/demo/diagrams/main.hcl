view "main" {
  system = "bicycle"

  node "bicycle/frame" {
    x          = 0
    y          = 0
    width      = 100
    height     = 60
    text_align = "center"
  }

  node "bicycle/fork" {
    x          = 200
    y          = 0
    width      = 100
    height     = 60
    text_align = "center"
  }

  node "bicycle/rear-wheel" {
    x          = 0
    y          = 120
    width      = 100
    height     = 70
    text_align = "top-center"
  }

  node "bicycle/rear-wheel/tire" {
    x          = 25
    y          = 150
    width      = 50
    height     = 30
    text_align = "center"
  }

  node "bicycle/front-wheel" {
    x          = 200
    y          = 120
    width      = 100
    height     = 70
    text_align = "top-center"
  }

  node "bicycle/front-wheel/tire" {
    x          = 225
    y          = 150
    width      = 50
    height     = 30
    text_align = "center"
  }
}
