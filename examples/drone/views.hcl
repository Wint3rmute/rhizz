view "drone-overview" {
  description = "Top-level drone architecture"
  system      = "quadcopter"

  filter {
    max_level     = 1
  }
}

view "fc-internals" {
  description = "Flight controller internal breakdown"
  system      = "quadcopter"

  filter {
    max_level     = 3
    components    = ["flight-controller"]
  }
}

view "ground-station" {
  description = "Ground control overview"
  system      = "ground-control"

  filter {
    max_level     = 1
  }
}

view "main" {
  system      = "ground-control"
}

view "power-paths" {
  description = "Power distribution only"
  system      = "quadcopter"

  filter {
    include_tags  = ["power"]
  }
}
