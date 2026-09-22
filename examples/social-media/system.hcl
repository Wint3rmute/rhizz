project {
  name    = "buzzvid"
  version = "0.3.0"
  authors = ["rhizz-examples"]
}

protocol "grpc" {
  full_name = "Internal gRPC microservice communication"
  roles       = ["provider", "consumer"]
}

protocol "hls" {
  full_name = "HLS video streaming"
  roles       = ["provider", "consumer"]
}

protocol "https" {
  full_name = "HTTP REST API"
  roles       = ["provider", "consumer"]

  message "get-feed" {
    full_name = "Request next page of video feed"
    tags        = ["api"]

    field "cursor" {
      type        = "string"
      full_name = "Pagination cursor"
    }

    field "feed_type" {
      type        = "string"
      full_name = "for_you | following"
    }
  }

  message "upload-video" {
    full_name = "Initiate video upload"
    tags        = ["api", "video"]

    field "chunk_size" {
      type        = "uint32"
      full_name = "Upload chunk size"
      unit        = "bytes"
    }

    field "title" {
      type        = "string"
      full_name = "Video title"
    }
  }
}

protocol "push" {
  full_name = "Push notifications"
  roles       = ["provider", "consumer"]
}

protocol "s3" {
  full_name = "Object storage protocol"
  roles       = ["provider", "consumer"]
}

protocol "sql" {
  full_name = "SQL relational database protocol"
  roles       = ["provider", "consumer"]
}

component "api-gateway" {
  full_name = "Edge proxy — rate limiting, auth, routing"
  tags        = ["backend", "infra"]
  leaf        = true

  port "internal" {
    full_name = "Internal RPC to backend"
    protocol    = "grpc"
    role        = "consumer"
    tags        = ["network", "internal"]
  }

  port "public" {
    full_name = "Public-facing API endpoint"
    protocol    = "https"
    role        = "provider"
    tags        = ["network", "api"]
  }
}

component "backend" {
  full_name = "Server-side services"
  tags        = ["backend"]

  port "db" {
    full_name = "Database connection pool"
    protocol    = "sql"
    role        = "consumer"
    tags        = ["data"]
  }

  port "push-out" {
    full_name = "Push notification sender"
    protocol    = "push"
    role        = "provider"
    tags        = ["notification"]
  }

  port "rpc" {
    full_name = "Internal RPC endpoint"
    protocol    = "grpc"
    role        = "provider"
    tags        = ["network", "internal"]
  }

  port "storage" {
    full_name = "Object storage client"
    protocol    = "s3"
    role        = "consumer"
    tags        = ["video", "data"]
  }

  instance "feed-service" { source = "feed-service" }

  instance "recommendation-engine" { source = "recommendation-engine" }

  instance "user-service" { source = "user-service" }

  instance "video-service" { source = "video-service" }

  connection "rec-to-feed" {
    full_name  = "Recommendation scores fed into feed assembly"
    tags         = ["data"]
    from         = "recommendation-engine"
    to           = "feed-service"
  }

  connection "user-to-feed" {
    full_name  = "Follow graph lookup for Following tab"
    tags         = ["data"]
    from         = "feed-service"
    to           = "user-service"
  }
}

component "cdn" {
  full_name = "Content delivery network for video segments"
  tags        = ["infra", "video"]
  leaf        = true

  port "origin" {
    full_name = "Origin pull from object store"
    protocol    = "s3"
    role        = "consumer"
    tags        = ["video", "infra"]
  }

  port "stream-out" {
    full_name = "HLS/DASH streaming to clients"
    protocol    = "hls"
    role        = "provider"
    tags        = ["video", "network"]
  }
}

component "database" {
  full_name = "PostgreSQL primary store"
  tags        = ["infra", "data"]
  leaf        = true

  port "sql" {
    full_name = "SQL query endpoint"
    protocol    = "sql"
    role        = "provider"
    tags        = ["data"]
  }
}

component "feed-service" {
  full_name = "Feed assembly from recommendation + follow graph"
  tags        = ["backend", "data"]
  leaf        = true
}

component "feed-ui" {
  full_name = "Scrollable video feed (For-You / Following)"
  tags        = ["client", "ui"]
  leaf        = true
}

component "mobile-app" {
  full_name = "iOS/Android client application"
  tags        = ["client", "mobile"]

  port "api" {
    full_name = "Client-side API endpoint"
    protocol    = "https"
    role        = "consumer"
    tags        = ["network", "api"]
    external    = true
  }

  port "push-in" {
    full_name = "Push notification receiver"
    protocol    = "push"
    role        = "consumer"
    tags        = ["notification"]
    external    = true
  }

  port "stream-in" {
    full_name = "HLS/DASH video stream input"
    protocol    = "hls"
    role        = "consumer"
    tags        = ["video", "network"]
    external    = true
  }

  instance "feed-ui" { source = "feed-ui" }

  instance "video-player" { source = "video-player" }

  instance "video-recorder" { source = "video-recorder" }

  connection "playback" {
    full_name  = "Feed UI requests playback from player"
    tags         = ["client"]
    from         = "feed-ui"
    to           = "video-player"
  }
}

component "object-store" {
  full_name = "S3-compatible blob storage for raw + transcoded video"
  tags        = ["infra", "video"]
  leaf        = true

  port "s3" {
    full_name = "S3-compatible API"
    protocol    = "s3"
    role        = "provider"
    tags        = ["video", "data"]
  }
}

component "recommendation-engine" {
  full_name = "ML-based video ranking"
  tags        = ["backend", "ml"]
}

component "user-service" {
  full_name = "Accounts, profiles, follow graph"
  tags        = ["backend", "data"]
  leaf        = true
}

component "video-player" {
  full_name = "Adaptive bitrate video player"
  tags        = ["client", "video"]
  leaf        = true
}

component "video-recorder" {
  full_name = "Camera capture + filters + upload"
  tags        = ["client", "video"]
  leaf        = true
}

component "video-service" {
  full_name = "Upload processing, transcoding, storage"
  tags        = ["backend", "video"]
  leaf        = true
}

system "buzzvid" {
  full_name = "Short-video social media platform"
  tags        = ["software", "web"]

  instance "api-gateway" { source = "api-gateway" }

  instance "backend" { source = "backend" }

  instance "cdn" { source = "cdn" }

  instance "database" { source = "database" }

  instance "mobile-app" { source = "mobile-app" }

  instance "object-store" { source = "object-store" }

  connection "backend-to-db" {
    full_name  = "SQL queries: backend → database"
    tags         = ["data"]
    from         = "/buzzvid/backend/db"
    to           = "/buzzvid/database/sql"
  }

  connection "backend-to-storage" {
    full_name  = "Object put/get: video service → blob store"
    tags         = ["video", "data"]
    from         = "/buzzvid/backend/storage"
    to           = "/buzzvid/object-store/s3"
  }

  connection "cdn-origin" {
    full_name  = "CDN pulls transcoded segments from object store"
    tags         = ["video", "infra"]
    from         = "/buzzvid/cdn/origin"
    to           = "/buzzvid/object-store/s3"
  }

  connection "client-api" {
    full_name  = "HTTPS REST/gRPC: mobile app ↔ API gateway"
    tags         = ["network", "api"]
    from         = "/buzzvid/mobile-app/api"
    to           = "/buzzvid/api-gateway/public"
  }

  connection "client-streaming" {
    full_name  = "HLS/DASH video streaming: CDN → mobile app"
    tags         = ["video", "network"]
    from         = "/buzzvid/cdn/stream-out"
    to           = "/buzzvid/mobile-app/stream-in"
  }

  connection "gateway-to-backend" {
    full_name  = "Internal RPC: gateway → backend services"
    tags         = ["network", "internal"]
    from         = "/buzzvid/api-gateway/internal"
    to           = "/buzzvid/backend/rpc"
  }

  connection "push-notify" {
    full_name  = "Push notifications: backend → mobile app"
    tags         = ["notification"]
    from         = "/buzzvid/backend/push-out"
    to           = "/buzzvid/mobile-app/push-in"
  }
}
