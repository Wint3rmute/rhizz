view "main" {
  system      = "ground-control"

  node "ground-control/goggles" {
    x          = 70
    y          = 1600
    width      = 100
    height     = 100
    text_align = "center"
  }

  node "ground-control/ground-station-pc" {
    x          = 70
    y          = 1420
    width      = 100
    height     = 100
    text_align = "center"
  }

  node "ground-control/transmitter" {
    x          = 70
    y          = 1240
    width      = 100
    height     = 100
    text_align = "center"
  }

  node "quadcopter/battery" {
    x          = 397.5886850211688
    y          = 1581.2642298997941
    width      = 100
    height     = 100
    text_align = "center"
  }

  node "quadcopter/camera" {
    x          = 619.9859400106056
    y          = 1258.5786443151217
    width      = 100
    height     = 100
    text_align = "center"
  }

  node "quadcopter/esc" {
    x          = 397.71855206835744
    y          = 1399.8429204804868
    width      = 100
    height     = 100
    text_align = "center"
  }

  node "quadcopter/flight-controller" {
    x          = 148.23905854287835
    y          = 810.8032335276948
    width      = 599.0845184326172
    height     = 358.4466247558594
    text_align = "top-center"
  }

  node "quadcopter/flight-controller/barometer" {
    x          = 427.9488330060247
    y          = 1057.4383389761429
    width      = 186.22536630050203
    height     = 101.76402374223119
    text_align = "center"
  }

  node "quadcopter/flight-controller/imu" {
    x          = 426.49380493555094
    y          = 838.8032335276948
    width      = 186.22536630050203
    height     = 101.76402374223119
    text_align = "center"
  }

  node "quadcopter/flight-controller/mcu" {
    x          = 201.18830745393797
    y          = 938.429447512161
    width      = 186.22536630050203
    height     = 101.76402374223119
    text_align = "center"
  }

  node "quadcopter/gps" {
    x          = -60.738178048735534
    y          = 907.431951986069
    width      = 100
    height     = 100
    text_align = "center"
  }

  node "quadcopter/radio-rx" {
    x          = 856.2831615881456
    y          = 907.1756565957492
    width      = 100
    height     = 100
    text_align = "center"
  }

  node "quadcopter/vtx" {
    x          = 620
    y          = 1440
    width      = 100
    height     = 100
    text_align = "center"
  }

  annotation {
    x    = 400
    y    = 480
    text = "GPS feed is noisy — see issue #42"
  }

  annotation {
    x    = -120
    y    = 1960
    text = "Ground station shown with optional goggles"
    scale = 1.5
  }
}
