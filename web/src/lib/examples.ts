// Hardcoded example systems for prototype exploration.
// Each entry is a set of Source files that compile into a Model via rhizz-wasm.

import type { Source } from "./types.ts";

export interface Example {
  name: string;
  description: string;
  sources: Source[];
}

export const EXAMPLES: Example[] = [
  {
    name: "Quadcopter Drone",
    description: "Consumer quadcopter with flight controller, ESC, GPS, and FPV video",
    sources: [
      {
        filename: "project.hcl",
        content: `project {
  name    = "drone-system"
  version = "0.3.0"
}`,
      },
      {
        filename: "components/flight-controller.hcl",
        content: `component "flight-controller" {
  description = "Main flight computer"
  tags        = ["electronics", "compute"]
  leaf        = false

  port "motor-out" {
    description = "DShot600 motor control output"
    protocol    = "dshot600"
    role        = "provider"
    tags        = ["motor", "data"]

    message "throttle" {
      description = "Per-motor throttle command"
      field "motor_id" { type = "uint8";  description = "Motor index 1-4" }
      field "value"    { type = "uint16"; description = "Throttle 0-2047" }
    }
  }

  port "gps-serial" {
    description = "UART link for GPS data"
    protocol    = "uart"
    role        = "peer"
    tags        = ["data", "navigation"]

    message "nav-pvt" {
      description = "Navigation position/velocity/time solution"
      field "latitude"  { type = "int32"; unit = "deg*1e7"; description = "Latitude"  }
      field "longitude" { type = "int32"; unit = "deg*1e7"; description = "Longitude" }
      field "altitude"  { type = "int32"; unit = "mm";      description = "Altitude above MSL" }
      field "fix_type"  { type = "uint8";                   description = "GNSS fix type" }
    }
  }

  port "rc-in" {
    description = "CRSF serial: receiver to FC"
    protocol    = "crsf"
    role        = "consumer"
    tags        = ["rf", "control"]

    message "rc-channels" {
      description = "16 RC channel values"
      field "channels" { type = "uint16[16]"; description = "Channel values 172-1811" }
    }
  }

  component "mcu" {
    description = "STM32H7 ARM Cortex-M7"
    tags        = ["electronics", "compute"]
    leaf        = true

    port "spi" {
      description = "SPI master bus"
      protocol    = "spi"
      role        = "provider"
      tags        = ["data"]
    }
  }

  component "imu" {
    description = "BMI270 6-axis IMU"
    tags        = ["electronics", "sensor"]
    leaf        = true

    port "spi" {
      description = "SPI slave interface"
      protocol    = "spi"
      role        = "consumer"
      tags        = ["data"]
    }
  }

  component "barometer" {
    description = "BMP390 barometric pressure sensor"
    tags        = ["electronics", "sensor"]
    leaf        = true
  }

  connection "spi-imu" {
    description = "SPI bus: MCU to IMU"
    tags        = ["data"]
    from        = "mcu:spi"
    to          = "imu:spi"
  }

  connection "i2c-baro" {
    description = "I2C bus: MCU to barometer"
    tags        = ["data"]
    from        = "mcu"
    to          = "barometer"
  }
}`,
      },
      {
        filename: "systems.hcl",
        content: `system "quadcopter" {
  description = "Consumer quadcopter drone"
  tags        = ["hardware", "drone"]
  level       = 0

  component "flight-controller" {
    source = "flight-controller"
  }

  component "esc" {
    description = "4-in-1 ESC board"
    tags        = ["electronics", "power", "motor"]
    leaf        = true

    port "motor-in" {
      description = "DShot600 motor control input"
      protocol    = "dshot600"
      role        = "consumer"
      tags        = ["motor", "data"]
    }

    port "power-in" {
      description = "Battery main power input"
      protocol    = "power-dc"
      role        = "consumer"
      tags        = ["power"]
    }

    port "bec-out" {
      description = "5V BEC regulated output"
      protocol    = "power-dc"
      role        = "provider"
      tags        = ["power"]
    }
  }

  component "gps" {
    description = "u-blox M10 GNSS receiver"
    tags        = ["electronics", "sensor", "navigation"]
    leaf        = true

    port "serial" {
      description = "UART data port"
      protocol    = "uart"
      role        = "peer"
      tags        = ["data", "navigation"]
    }
  }

  component "battery" {
    description = "4S 1300mAh LiPo"
    tags        = ["power"]
    leaf        = true

    port "power-out" {
      description = "Main discharge output"
      protocol    = "power-dc"
      role        = "provider"
      tags        = ["power"]
    }
  }

  component "radio-rx" {
    description = "ELRS 868MHz receiver"
    tags        = ["electronics", "rf"]
    leaf        = true

    port "crsf" {
      description = "CRSF serial output"
      protocol    = "crsf"
      role        = "provider"
      tags        = ["rf", "control"]
    }
  }

  component "vtx" {
    description = "5.8GHz video transmitter"
    tags        = ["electronics", "rf", "video"]
    leaf        = true

    port "video-in" {
      description = "Analog video input"
      protocol    = "analog-video"
      role        = "consumer"
      tags        = ["video"]
    }
  }

  component "camera" {
    description = "FPV camera (analog)"
    tags        = ["electronics", "video"]
    leaf        = true

    port "video-out" {
      description = "Analog video output"
      protocol    = "analog-video"
      role        = "provider"
      tags        = ["video"]
    }
  }

  connection "motor-control" {
    description = "DShot600 motor signals"
    tags        = ["motor", "data"]
    from        = "flight-controller:motor-out"
    to          = "esc:motor-in"
  }

  connection "gps-serial" {
    description = "UART link: FC to GPS"
    tags        = ["data", "navigation"]
    from        = "flight-controller:gps-serial"
    to          = "gps:serial"
  }

  connection "rc-link" {
    description = "CRSF serial: receiver to FC"
    tags        = ["rf", "control"]
    from        = "radio-rx:crsf"
    to          = "flight-controller:rc-in"
  }

  connection "power-main" {
    description = "Battery to ESC main power"
    tags        = ["power"]
    from        = "battery:power-out"
    to          = "esc:power-in"
  }

  connection "power-bec" {
    description = "ESC 5V BEC to flight controller"
    tags        = ["power"]
    from        = "esc:bec-out"
    to          = "flight-controller"
  }

  connection "video-feed" {
    description = "Analog video: camera to VTX"
    tags        = ["video"]
    from        = "camera:video-out"
    to          = "vtx:video-in"
  }
}`,
      },
    ],
  },
  {
    name: "BuzzVid (Social Media)",
    description: "Short-video platform with mobile app, API gateway, backend services, and CDN",
    sources: [
      {
        filename: "project.hcl",
        content: `project {
  name    = "buzzvid"
  version = "0.1.0"
}`,
      },
      {
        filename: "system.hcl",
        content: `system "buzzvid" {
  description = "Short-video social media platform"
  tags        = ["software", "web"]
  level       = 0

  component "mobile-app" {
    description = "iOS/Android client application"
    tags        = ["client", "mobile"]
    leaf        = false

    port "api" {
      description = "Client-side API endpoint"
      protocol    = "https"
      role        = "consumer"
      tags        = ["network", "api"]
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
      description = "Scrollable video feed"
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
    description = "S3-compatible blob storage"
    tags        = ["infra", "video"]
    leaf        = true

    port "s3" {
      description = "S3-compatible API"
      protocol    = "s3"
      role        = "provider"
      tags        = ["video", "data"]
    }
  }

  connection "client-api" {
    description = "HTTPS: mobile app to API gateway"
    tags        = ["network", "api"]
    from        = "mobile-app:api"
    to          = "api-gateway:public"
  }

  connection "gateway-to-backend" {
    description = "Internal RPC: gateway to backend"
    tags        = ["network", "internal"]
    from        = "api-gateway:internal"
    to          = "backend:rpc"
  }

  connection "backend-to-db" {
    description = "SQL queries: backend to database"
    tags        = ["data"]
    from        = "backend:db"
    to          = "database:sql"
  }

  connection "backend-to-storage" {
    description = "Object put/get: backend to blob store"
    tags        = ["video", "data"]
    from        = "backend:storage"
    to          = "object-store:s3"
  }

  connection "cdn-origin" {
    description = "CDN pulls from object store"
    tags        = ["video", "infra"]
    from        = "cdn:origin"
    to          = "object-store:s3"
  }

  connection "client-streaming" {
    description = "HLS streaming: CDN to mobile app"
    tags        = ["video", "network"]
    from        = "cdn:stream-out"
    to          = "mobile-app:stream-in"
  }

  connection "push-notify" {
    description = "Push notifications: backend to mobile app"
    tags        = ["notification"]
    from        = "backend:push-out"
    to          = "mobile-app:push-in"
  }
}`,
      },
    ],
  },
];
