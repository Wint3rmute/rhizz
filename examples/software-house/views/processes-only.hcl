view "processes-only" {
  description = "All cross-department processes"
  system      = "acme-software"

  filter {
    include_tags  = ["process"]
    show_messages = true
  }
}
