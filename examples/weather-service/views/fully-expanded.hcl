view "fully-expanded" {
  full_name = "Weather app at the boundary level"
  system      = "app"

  filter {
    max_level     = 1
  }

  node "app/user" {
    x          = -100
    y          = 650
    width      = 100
    height     = 100
    text_align = "center"
  }

  node "app/weather-service" {
    x          = -590
    y          = 610
    width      = 390
    height     = 170
    text_align = "top-center"

    port "api" {
      side   = "right"
      offset = 0.5294117647058824
    }
  }

  node "app/weather-service/proxy" {
    x          = -580
    y          = 650
    width      = 260
    height     = 100
    text_align = "top-center"

    port "http" {
      side   = "right"
      offset = 0.5
    }
  }

  node "app/weather-service/proxy/listener" {
    x          = -570
    y          = 680
    width      = 120
    height     = 40
    text_align = "center"
  }

  annotation {
    x     = -600
    y     = 590
    text  = "# Fully Expanded!"
  }
}
