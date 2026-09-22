view "cloud-path" {
  full_name = "Cloud-facing data path only"
  system      = "home-monitor"

  filter {
    include_tags  = ["cloud"]
  }
}
