# BuzzVid — a simple short-video platform (TikTok clone).
#
# Demonstrates:
#  - Software component decomposition (backend broken into services)
#  - Interface messages with typed fields
#  - Leaf vs non-leaf at the software level
#  - Intentional incompleteness: the "recommendation-engine" service
#    has no children yet (W001) and the "push-notify" interface has
#    no messages (W002) — the model compiles but scores < 100%.

system "buzzvid" {
  description = "Short-video social media platform"
  tags        = ["software", "web"]
  level       = 0

  # ── Components ────────────────────────────

  component "mobile-app" {
    description = "iOS/Android client application"
    tags        = ["client", "mobile"]
    leaf        = false

    component "video-player" {
      description = "Adaptive bitrate video player"
      tags        = ["client", "video"]
      leaf        = true
    }

    component "video-recorder" {
      description = "Camera capture + filters + upload"
      tags        = ["client", "video"]
      leaf        = true
    }

    component "feed-ui" {
      description = "Scrollable video feed (For-You / Following)"
      tags        = ["client", "ui"]
      leaf        = true
    }

    interface "playback" {
      description = "Feed UI requests playback from player"
      from        = "feed-ui"
      to          = "video-player"
      direction   = "unidirectional"
      tags        = ["client"]
      leaf        = true
    }
  }

  component "api-gateway" {
    description = "Edge proxy — rate limiting, auth, routing"
    tags        = ["backend", "infra"]
    leaf        = true
  }

  component "backend" {
    description = "Server-side services"
    tags        = ["backend"]
    leaf        = false

    component "user-service" {
      description = "Accounts, profiles, follow graph"
      tags        = ["backend", "data"]
      leaf        = true
    }

    component "video-service" {
      description = "Upload processing, transcoding, storage"
      tags        = ["backend", "video"]
      leaf        = true
    }

    component "feed-service" {
      description = "Feed assembly from recommendation + follow graph"
      tags        = ["backend", "data"]
      leaf        = true
    }

    # Non-leaf with no children → W001 (work in progress)
    component "recommendation-engine" {
      description = "ML-based video ranking"
      tags        = ["backend", "ml"]
      leaf        = false
    }

    interface "rec-to-feed" {
      description = "Recommendation scores fed into feed assembly"
      from        = "recommendation-engine"
      to          = "feed-service"
      direction   = "unidirectional"
      tags        = ["data"]
      leaf        = false

      message "ranked-videos" {
        description = "Ordered list of video IDs with scores"
        tags        = ["data"]

        field "video_ids" { type = "string[]"; description = "Ordered video IDs" }
        field "scores"    { type = "float32[]"; description = "Relevance scores 0-1" }
      }
    }

    interface "user-to-feed" {
      description = "Follow graph lookup for Following tab"
      from        = "feed-service"
      to          = "user-service"
      direction   = "unidirectional"
      tags        = ["data"]
      leaf        = true
    }
  }

  component "cdn" {
    description = "Content delivery network for video segments"
    tags        = ["infra", "video"]
    leaf        = true
  }

  component "database" {
    description = "PostgreSQL primary store"
    tags        = ["infra", "data"]
    leaf        = true
  }

  component "object-store" {
    description = "S3-compatible blob storage for raw + transcoded video"
    tags        = ["infra", "video"]
    leaf        = true
  }

  # ── Top-level interfaces ──────────────────

  interface "client-api" {
    description = "HTTPS REST/gRPC: mobile app ↔ API gateway"
    tags        = ["network", "api"]
    from        = "mobile-app"
    to          = "api-gateway"
    direction   = "bidirectional"
    leaf        = false

    message "get-feed" {
      description = "Request next page of video feed"
      tags        = ["api"]

      field "cursor"    { type = "string"; description = "Pagination cursor" }
      field "feed_type" { type = "string"; description = "for_you | following" }
    }

    message "upload-video" {
      description = "Initiate video upload"
      tags        = ["api", "video"]

      field "title"      { type = "string"; description = "Video title" }
      field "chunk_size" { type = "uint32"; unit = "bytes"; description = "Upload chunk size" }
    }
  }

  interface "gateway-to-backend" {
    description = "Internal RPC: gateway → backend services"
    tags        = ["network", "internal"]
    from        = "api-gateway"
    to          = "backend"
    direction   = "bidirectional"
    leaf        = true
  }

  interface "backend-to-db" {
    description = "SQL queries: backend → database"
    tags        = ["data"]
    from        = "backend"
    to          = "database"
    direction   = "bidirectional"
    leaf        = true
  }

  interface "backend-to-storage" {
    description = "Object put/get: video service → blob store"
    tags        = ["video", "data"]
    from        = "backend"
    to          = "object-store"
    direction   = "bidirectional"
    leaf        = true
  }

  interface "cdn-origin" {
    description = "CDN pulls transcoded segments from object store"
    tags        = ["video", "infra"]
    from        = "cdn"
    to          = "object-store"
    direction   = "unidirectional"
    leaf        = true
  }

  interface "client-streaming" {
    description = "HLS/DASH video streaming: CDN → mobile app"
    tags        = ["video", "network"]
    from        = "cdn"
    to          = "mobile-app"
    direction   = "unidirectional"
    leaf        = true
  }

  # Non-leaf interface with no messages → W002
  interface "push-notify" {
    description = "Push notifications: backend → mobile app"
    tags        = ["notification"]
    from        = "backend"
    to          = "mobile-app"
    direction   = "unidirectional"
    leaf        = false
    # messages not yet defined — triggers W002
  }
}
