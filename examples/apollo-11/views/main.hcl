view "main" {
  system      = "apollo-11"

  node "apollo-11/cm" {
    x          = -500
    y          = -980
    width      = 880
    height     = 510
    text_align = "top-center"
  }

  node "apollo-11/cm/agc" {
    x          = 240
    y          = -770
    width      = 100
    height     = 100
    text_align = "center"
  }

  node "apollo-11/cm/cabin" {
    x          = -400
    y          = -780
    width      = 120
    height     = 120
    text_align = "center"
  }

  node "apollo-11/cm/dsky" {
    x          = 240
    y          = -950
    width      = 100
    height     = 100
    text_align = "center"
  }

  node "apollo-11/cm/imu" {
    x          = -90
    y          = -660
    width      = 100
    height     = 100
    text_align = "center"
  }

  node "apollo-11/cm/optics" {
    x          = -400
    y          = -890
    width      = 120
    height     = 70
    text_align = "center"
  }

  node "apollo-11/cm/rcs" {
    x          = 0
    y          = -930
    width      = 100
    height     = 100
    text_align = "center"
  }

  node "apollo-11/lm-ascent" {
    x          = -500
    y          = -120
    width      = 650
    height     = 400
    text_align = "top-center"
  }

  node "apollo-11/lm-ascent/aps" {
    x          = -170
    y          = 0
    width      = 110
    height     = 60
    text_align = "center"
  }

  node "apollo-11/lm-ascent/aps-tanks" {
    x          = 30
    y          = -90
    width      = 110
    height     = 60
    text_align = "center"
  }

  node "apollo-11/lm-ascent/cabin" {
    x          = -400
    y          = 200
    width      = 120
    height     = 60
    text_align = "center"
  }

  node "apollo-11/lm-ascent/comms" {
    x          = -470
    y          = -70
    width      = 110
    height     = 60
    text_align = "center"
  }

  node "apollo-11/lm-ascent/dsky" {
    x          = -300
    y          = -30
    width      = 110
    height     = 60
    text_align = "center"
  }

  node "apollo-11/lm-ascent/imu" {
    x          = 20
    y          = 200
    width      = 110
    height     = 60
    text_align = "center"
  }

  node "apollo-11/lm-ascent/lgc" {
    x          = -180
    y          = 200
    width      = 110
    height     = 60
    text_align = "center"
  }

  node "apollo-11/lm-ascent/rcs" {
    x          = 30
    y          = 40
    width      = 110
    height     = 60
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

  node "apollo-11/lm-descent/dps" {
    x          = -460
    y          = 460
    width      = 160
    height     = 60
    text_align = "center"
  }

  node "apollo-11/lm-descent/dps-tanks" {
    x          = -120
    y          = 440
    width      = 220
    height     = 100
    text_align = "center"
  }

  node "apollo-11/lm-descent/landing-radar" {
    x          = -120
    y          = 350
    width      = 240
    height     = 60
    text_align = "center"
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

  node "apollo-11/saturn-v/iu" {
    x          = 240
    y          = 700
    width      = 100
    height     = 110
    text_align = "center"
  }

  node "apollo-11/saturn-v/s-ic" {
    x          = -450
    y          = 700
    width      = 110
    height     = 110
    text_align = "center"
  }

  node "apollo-11/saturn-v/s-ii" {
    x          = -220
    y          = 700
    width      = 140
    height     = 110
    text_align = "center"
  }

  node "apollo-11/saturn-v/s-ivb" {
    x          = 20
    y          = 700
    width      = 110
    height     = 110
    text_align = "center"
  }

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

  node "apollo-11/sm/hga" {
    x          = -470
    y          = -400
    width      = 110
    height     = 60
    text_align = "center"
  }

  node "apollo-11/sm/rcs-quads" {
    x          = 70
    y          = -410
    width      = 80
    height     = 62
    text_align = "center"
  }

  node "apollo-11/sm/sps" {
    x          = -70
    y          = -252
    width      = 80
    height     = 62
    text_align = "center"
  }

  node "apollo-11/sm/sps-tanks" {
    x          = -70
    y          = -410
    width      = 80
    height     = 62
    text_align = "center"
  }

  connection "lgc-to-dsky" {
    start_side = "top"
    end_side   = "bottom"
  }
}
