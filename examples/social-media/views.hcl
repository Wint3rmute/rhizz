view "full-platform" {
  description = "Complete BuzzVid platform overview"
  system      = "buzzvid"

  filter {
    max_level = 1
  }
}

view "backend-services" {
  description = "Backend service decomposition"
  system      = "buzzvid"

  filter {
    components = ["backend"]
    max_level  = 3
  }
}

view "video-pipeline" {
  description = "Video data flow: upload → storage → CDN → playback"
  system      = "buzzvid"

  filter {
    include_tags  = ["video"]
    show_messages = false
  }
}
