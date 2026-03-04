view "org-chart" {
  description = "Full organizational overview"
  system      = "acme-software"

  filter {
    max_level = 1
  }

  output {
    filename = "org-chart.dot"
    rankdir  = "TB"
  }
}

view "engineering-teams" {
  description = "Engineering department internal structure"
  system      = "acme-software"

  filter {
    components = ["engineering"]
    max_level  = 3
  }

  output {
    filename = "engineering-teams.dot"
    rankdir  = "LR"
  }
}

view "processes-only" {
  description = "All cross-department processes"
  system      = "acme-software"

  filter {
    include_tags  = ["process"]
    show_messages = true
  }

  output {
    filename = "processes.dot"
    rankdir  = "LR"
  }
}
