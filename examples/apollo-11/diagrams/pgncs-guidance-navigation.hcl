view "pgncs-guidance-navigation" {
  description = "Primary Guidance, Navigation, and Control System (PGNCS) loops on CM and LM"
  system      = "apollo-11"

  filter {
    include_tags  = ["guidance", "avionics", "imu", "navigation", "ui"]
    show_messages = true
  }
}
