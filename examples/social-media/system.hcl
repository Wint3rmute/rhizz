project {
  name    = "buzzvid"
  version = "0.3.0"
  authors = ["rhizz-examples"]
}

protocol "grpc" {
  description = "Internal gRPC microservice communication"
  roles       = ["provider", "consumer"]
}

protocol "hls" {
  description = "HLS video streaming"
  roles       = ["provider", "consumer"]
}

protocol "https" {
  description = "HTTP REST API"
  roles       = ["provider", "consumer"]

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

    field "chunk_size" {
      type        = "uint32"
      description = "Upload chunk size"
      unit        = "bytes"
    }

    field "title" {
      type        = "string"
      description = "Video title"
    }
  }
}

protocol "push" {
  description = "Push notifications"
  roles       = ["provider", "consumer"]
}

protocol "s3" {
  description = "Object storage protocol"
  roles       = ["provider", "consumer"]
}

protocol "sql" {
  description = "SQL relational database protocol"
  roles       = ["provider", "consumer"]
}

component "api-gateway" {
  description = "Edge proxy — rate limiting, auth, routing"
  tags        = ["backend", "infra"]
  leaf        = true

  port "internal" {
    description = "Internal RPC to backend"
    protocol    = "grpc"
    role        = "consumer"
    tags        = ["network", "internal"]
  }

  port "public" {
    description = "Public-facing API endpoint"
    protocol    = "https"
    role        = "provider"
    tags        = ["network", "api"]
  }
}

component "backend" {
  description = "Server-side services"
  tags        = ["backend"]

  port "db" {
    description = "Database connection pool"
    protocol    = "sql"
    role        = "consumer"
    tags        = ["data"]
  }

  port "push-out" {
    description = "Push notification sender"
    protocol    = "push"
    role        = "provider"
    tags        = ["notification"]
  }

  port "rpc" {
    description = "Internal RPC endpoint"
    protocol    = "grpc"
    role        = "provider"
    tags        = ["network", "internal"]
  }

  port "storage" {
    description = "Object storage client"
    protocol    = "s3"
    role        = "consumer"
    tags        = ["video", "data"]
  }

  instance "feed-service" { source = "feed-service" }

  instance "recommendation-engine" { source = "recommendation-engine" }

  instance "user-service" { source = "user-service" }

  instance "video-service" { source = "video-service" }

  connection "rec-to-feed" {
    description  = "Recommendation scores fed into feed assembly"
    tags         = ["data"]
    from         = "recommendation-engine"
    to           = "feed-service"
  }

  connection "user-to-feed" {
    description  = "Follow graph lookup for Following tab"
    tags         = ["data"]
    from         = "feed-service"
    to           = "user-service"
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

component "feed-service" {
  description = "Feed assembly from recommendation + follow graph"
  tags        = ["backend", "data"]
  leaf        = true
}

component "feed-ui" {
  description = "Scrollable video feed (For-You / Following)"
  tags        = ["client", "ui"]
  leaf        = true
}

component "mobile-app" {
  description = "iOS/Android client application"
  tags        = ["client", "mobile"]

  port "api" {
    description = "Client-side API endpoint"
    protocol    = "https"
    role        = "consumer"
    tags        = ["network", "api"]
    external    = true
  }

  port "push-in" {
    description = "Push notification receiver"
    protocol    = "push"
    role        = "consumer"
    tags        = ["notification"]
    external    = true
  }

  port "stream-in" {
    description = "HLS/DASH video stream input"
    protocol    = "hls"
    role        = "consumer"
    tags        = ["video", "network"]
    external    = true
  }

  instance "feed-ui" { source = "feed-ui" }

  instance "video-player" { source = "video-player" }

  instance "video-recorder" { source = "video-recorder" }

  connection "playback" {
    description  = "Feed UI requests playback from player"
    tags         = ["client"]
    from         = "feed-ui"
    to           = "video-player"
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

component "recommendation-engine" {
  description = "ML-based video ranking"
  tags        = ["backend", "ml"]
}

component "user-service" {
  description = "Accounts, profiles, follow graph"
  tags        = ["backend", "data"]
  leaf        = true
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

component "video-service" {
  description = "Upload processing, transcoding, storage"
  tags        = ["backend", "video"]
  leaf        = true
}

system "buzzvid" {
  description = "Short-video social media platform"
  tags        = ["software", "web"]

  instance "api-gateway" { source = "api-gateway" }

  instance "backend" { source = "backend" }

  instance "cdn" { source = "cdn" }

  instance "database" { source = "database" }

  instance "mobile-app" { source = "mobile-app" }

  instance "object-store" { source = "object-store" }

  connection "backend-to-db" {
    description  = "SQL queries: backend → database"
    tags         = ["data"]
    from         = "/buzzvid/backend/db"
    to           = "/buzzvid/database/sql"
  }

  connection "backend-to-storage" {
    description  = "Object put/get: video service → blob store"
    tags         = ["video", "data"]
    from         = "/buzzvid/backend/storage"
    to           = "/buzzvid/object-store/s3"
  }

  connection "cdn-origin" {
    description  = "CDN pulls transcoded segments from object store"
    tags         = ["video", "infra"]
    from         = "/buzzvid/cdn/origin"
    to           = "/buzzvid/object-store/s3"
  }

  connection "client-api" {
    description  = "HTTPS REST/gRPC: mobile app ↔ API gateway"
    tags         = ["network", "api"]
    from         = "/buzzvid/mobile-app/api"
    to           = "/buzzvid/api-gateway/public"
  }

  connection "client-streaming" {
    description  = "HLS/DASH video streaming: CDN → mobile app"
    tags         = ["video", "network"]
    from         = "/buzzvid/cdn/stream-out"
    to           = "/buzzvid/mobile-app/stream-in"
  }

  connection "gateway-to-backend" {
    description  = "Internal RPC: gateway → backend services"
    tags         = ["network", "internal"]
    from         = "/buzzvid/api-gateway/internal"
    to           = "/buzzvid/backend/rpc"
  }

  connection "push-notify" {
    description  = "Push notifications: backend → mobile app"
    tags         = ["notification"]
    from         = "/buzzvid/backend/push-out"
    to           = "/buzzvid/mobile-app/push-in"
  }
}
