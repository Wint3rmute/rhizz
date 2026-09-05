view "cloud-path" {
  description = "Cloud-facing data path only"
  system      = "home-monitor"

  filter {
    include_tags  = ["cloud"]
  }
}

view "overview" {
  description = "Full home-monitor system architecture"
  system      = "home-monitor"

  filter {
    max_level     = 2
    show_messages = true
  }
}
