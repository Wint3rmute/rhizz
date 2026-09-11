view "rf-telemetry-network" {
  description = "Unified S-band Earth ground network and inter-spacecraft VHF ranging"
  system      = "apollo-11"

  filter {
    include_tags  = ["rf", "telemetry", "ranging"]
    show_messages = true
  }
}
