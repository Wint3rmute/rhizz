view "video-pipeline" {
  full_name = "Video data flow: upload → storage → CDN → playback"
  system      = "buzzvid"

  filter {
    include_tags  = ["video"]
  }
}
