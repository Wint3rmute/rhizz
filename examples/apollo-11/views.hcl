view "lunar-landing-stack" {
  description = "Lunar Module descent, landing radar, and ascent guidance interfaces"
  system      = "apollo-11"

  filter {
    include_tags  = ["lm", "landing", "radar", "docking"]
    show_messages = true
  }
}

view "main" {
  system      = "apollo-11"
}

view "mission-overview" {
  description = "Complete Apollo 11 trans-lunar architecture overview"
  system      = "apollo-11"

  filter {
    max_level     = 3
    show_messages = true
  }
}

view "pgncs-guidance-navigation" {
  description = "Primary Guidance, Navigation, and Control System (PGNCS) loops on CM and LM"
  system      = "apollo-11"

  filter {
    include_tags  = ["guidance", "avionics", "imu", "navigation", "ui"]
    show_messages = true
  }
}

view "power-and-cryo-distribution" {
  description = "Cryogenic reactant storage, SM fuel cells, and 28V DC power distribution"
  system      = "apollo-11"

  filter {
    include_tags  = ["power", "cryo"]
  }
}

view "rf-telemetry-network" {
  description = "Unified S-band Earth ground network and inter-spacecraft VHF ranging"
  system      = "apollo-11"

  filter {
    include_tags  = ["rf", "telemetry", "ranging"]
    show_messages = true
  }
}
