view "drone-overview" {
  description = "Top-level drone architecture"
  system      = "quadcopter"

  filter {
    max_level = 1
  }

  output {
    filename = "drone-overview.dot"
    rankdir  = "TB"
  }
}

view "power-paths" {
  description = "Power distribution only"
  system      = "quadcopter"

  filter {
    include_tags  = ["power"]
    show_messages = false
  }

  output {
    filename = "power-paths.dot"
    rankdir  = "LR"
  }
}

view "fc-internals" {
  description = "Flight controller internal breakdown"
  system      = "quadcopter"

  filter {
    components = ["flight-controller"]
    max_level  = 3
  }

  output {
    filename = "fc-internals.dot"
    rankdir  = "LR"
  }
}

view "ground-station" {
  description = "Ground control overview"
  system      = "ground-control"

  filter {
    max_level = 1
  }

  output {
    filename = "ground-station.dot"
    rankdir  = "LR"
  }
}
