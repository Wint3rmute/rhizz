view "full-platform" {
  description = "Complete BuzzVid platform overview"
  system      = "buzzvid"

  filter {
    max_level = 1
  }

  output {
    filename = "full-platform.dot"
    rankdir  = "TB"
  }
}

view "backend-services" {
  description = "Backend service decomposition"
  system      = "buzzvid"

  filter {
    components = ["backend"]
    max_level  = 3
  }

  output {
    filename = "backend-services.dot"
    rankdir  = "LR"
  }
}

view "video-pipeline" {
  description = "Video data flow: upload → storage → CDN → playback"
  system      = "buzzvid"

  filter {
    include_tags  = ["video"]
    show_messages = false
  }

  output {
    filename = "video-pipeline.dot"
    rankdir  = "LR"
  }
}
