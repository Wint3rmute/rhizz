view "power-paths" {
  description = "Power distribution only"
  system      = "quadcopter"

  filter {
    include_tags  = ["power"]
  }
}
