view "video-pipeline" {
  description = "Video data flow: upload → storage → CDN → playback"
  system      = "buzzvid"

  filter {
    include_tags  = ["video"]
  }
}
