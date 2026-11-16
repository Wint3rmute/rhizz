view "partially-expanded" {
  system      = "app"

  node "app/user" {
    x          = -100
    y          = 650
    width      = 100
    height     = 100
    text_align = "center"
  }

  node "app/weather-service" {
    x          = -470
    y          = 610
    width      = 270
    height     = 170
    text_align = "top-center"

    port "api" {
      side   = "right"
      offset = 0.5294117647058824
    }
  }

  node "app/weather-service/proxy" {
    x          = -440
    y          = 650
    width      = 120
    height     = 100
    text_align = "top-center"

    port "http" {
      side   = "right"
      offset = 0.5
    }
  }

  annotation {
    x     = -600
    y     = 590
    text  = "# Partially Collapsed..."
  }
}
