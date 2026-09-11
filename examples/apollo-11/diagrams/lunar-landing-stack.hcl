view "lunar-landing-stack" {
  description = "Lunar Module descent, landing radar, and ascent guidance interfaces"
  system      = "apollo-11"

  filter {
    include_tags  = ["lm", "landing", "radar", "docking"]
    show_messages = true
  }
}
