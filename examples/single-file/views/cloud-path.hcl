view "cloud-path" {
  description = "Cloud-facing data path only"
  system      = "home-monitor"

  filter {
    include_tags  = ["cloud"]
  }
}
