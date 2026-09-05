view "engineering-teams" {
  description = "Engineering department internal structure"
  system      = "acme-software"

  filter {
    max_level     = 3
    components    = ["engineering"]
  }
}

view "main" {
  system      = "acme-software"
}

view "org-chart" {
  description = "Full organizational overview"
  system      = "acme-software"

  filter {
    max_level     = 1
  }
}

view "processes-only" {
  description = "All cross-department processes"
  system      = "acme-software"

  filter {
    include_tags  = ["process"]
    show_messages = true
  }
}
