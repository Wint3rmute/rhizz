view "collapsed" {
  system      = "app"

  node "app/user" {
    x          = -100
    y          = 650
    width      = 100
    height     = 100
    text_align = "center"
  }

  node "app/weather-service" {
    x          = -370
    y          = 610
    width      = 170
    height     = 170
    text_align = "top-center"

    port "api" {
      side   = "right"
      offset = 0.5294117647058824
    }
  }

  annotation {
    x     = -600
    y     = 590
    text  = "# Completely collapsed!"
  }
}
