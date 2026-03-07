# BuzzVid — a simple short-video platform (TikTok clone).
#
# Demonstrates:
#  - Software component decomposition (backend broken into services)
#  - Port/connection model with typed and untyped endpoints
#  - Leaf vs non-leaf at the software level
#  - Intentional incompleteness: the "recommendation-engine" service
#    has no children yet (W001) and some ports have no messages (W011)
#    — the model compiles but scores < 100%.

system "buzzvid" {
  description = "Short-video social media platform"
  tags        = ["software", "web"]
  level       = 0

  # ── Components ────────────────────────────

  component "mobile-app" {
    description = "iOS/Android client application"
    tags        = ["client", "mobile"]
    leaf        = false

    port "api" {
      description = "Client-side API endpoint"
      protocol    = "https"
      role        = "consumer"
      tags        = ["network", "api"]

      message "get-feed" {
        description = "Request next page of video feed"
        tags        = ["api"]

        field "cursor" {
          type        = "string"
          description = "Pagination cursor"
        }
        field "feed_type" {
          type        = "string"
          description = "for_you | following"
        }
      }

      message "upload-video" {
        description = "Initiate video upload"
        tags        = ["api", "video"]

        field "title" {
          type        = "string"
          description = "Video title"
        }
        field "chunk_size" {
          type        = "uint32"
          unit        = "bytes"
          description = "Upload chunk size"
        }
      }
    }

    port "stream-in" {
      description = "HLS/DASH video stream input"
      protocol    = "hls"
      role        = "consumer"
      tags        = ["video", "network"]
    }

    port "push-in" {
      description = "Push notification receiver"
      protocol    = "push"
      role        = "consumer"
      tags        = ["notification"]
    }

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

    connection "playback" {
      description = "Feed UI requests playback from player"
      from        = "feed-ui"
      to          = "video-player"
      tags        = ["client"]
    }
  }

  component "api-gateway" {
    description = "Edge proxy — rate limiting, auth, routing"
    tags        = ["backend", "infra"]
    leaf        = true

    port "public" {
      description = "Public-facing API endpoint"
      protocol    = "https"
      role        = "provider"
      tags        = ["network", "api"]
    }

    port "internal" {
      description = "Internal RPC to backend"
      protocol    = "grpc"
      role        = "consumer"
      tags        = ["network", "internal"]
    }
  }

  component "backend" {
    description = "Server-side services"
    tags        = ["backend"]
    leaf        = false

    port "rpc" {
      description = "Internal RPC endpoint"
      protocol    = "grpc"
      role        = "provider"
      tags        = ["network", "internal"]
    }

    port "db" {
      description = "Database connection pool"
      protocol    = "sql"
      role        = "consumer"
      tags        = ["data"]
    }

    port "storage" {
      description = "Object storage client"
      protocol    = "s3"
      role        = "consumer"
      tags        = ["video", "data"]
    }

    port "push-out" {
      description = "Push notification sender"
      protocol    = "push"
      role        = "provider"
      tags        = ["notification"]
    }

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

    connection "rec-to-feed" {
      description = "Recommendation scores fed into feed assembly"
      from        = "recommendation-engine"
      to          = "feed-service"
      tags        = ["data"]
    }

    connection "user-to-feed" {
      description = "Follow graph lookup for Following tab"
      from        = "feed-service"
      to          = "user-service"
      tags        = ["data"]
    }
  }

  component "cdn" {
    description = "Content delivery network for video segments"
    tags        = ["infra", "video"]
    leaf        = true

    port "origin" {
      description = "Origin pull from object store"
      protocol    = "s3"
      role        = "consumer"
      tags        = ["video", "infra"]
    }

    port "stream-out" {
      description = "HLS/DASH streaming to clients"
      protocol    = "hls"
      role        = "provider"
      tags        = ["video", "network"]
    }
  }

  component "database" {
    description = "PostgreSQL primary store"
    tags        = ["infra", "data"]
    leaf        = true

    port "sql" {
      description = "SQL query endpoint"
      protocol    = "sql"
      role        = "provider"
      tags        = ["data"]
    }
  }

  component "object-store" {
    description = "S3-compatible blob storage for raw + transcoded video"
    tags        = ["infra", "video"]
    leaf        = true

    port "s3" {
      description = "S3-compatible API"
      protocol    = "s3"
      role        = "provider"
      tags        = ["video", "data"]
    }
  }

  # ── Top-level connections ──────────────────

  connection "client-api" {
    description = "HTTPS REST/gRPC: mobile app ↔ API gateway"
    tags        = ["network", "api"]
    from        = "mobile-app:api"
    to          = "api-gateway:public"
  }

  connection "gateway-to-backend" {
    description = "Internal RPC: gateway → backend services"
    tags        = ["network", "internal"]
    from        = "api-gateway:internal"
    to          = "backend:rpc"
  }

  connection "backend-to-db" {
    description = "SQL queries: backend → database"
    tags        = ["data"]
    from        = "backend:db"
    to          = "database:sql"
  }

  connection "backend-to-storage" {
    description = "Object put/get: video service → blob store"
    tags        = ["video", "data"]
    from        = "backend:storage"
    to          = "object-store:s3"
  }

  connection "cdn-origin" {
    description = "CDN pulls transcoded segments from object store"
    tags        = ["video", "infra"]
    from        = "cdn:origin"
    to          = "object-store:s3"
  }

  connection "client-streaming" {
    description = "HLS/DASH video streaming: CDN → mobile app"
    tags        = ["video", "network"]
    from        = "cdn:stream-out"
    to          = "mobile-app:stream-in"
  }

  connection "push-notify" {
    description = "Push notifications: backend → mobile app"
    tags        = ["notification"]
    from        = "backend:push-out"
    to          = "mobile-app:push-in"
  }
}
