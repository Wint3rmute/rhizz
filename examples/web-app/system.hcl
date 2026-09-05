project {
  name    = "web-app"
  version = "0.3.0"
  authors = ["rhizz-examples"]
}

protocol "https" {
  description = "HTTPS REST API"
  roles       = ["provider", "consumer"]

  message "api-request" {
    description = "Generic HTTP API request"

    field "method" {
      type        = "string"
      description = "HTTP method (GET, POST, …)"
    }

    field "path" {
      type        = "string"
      description = "Request path"
    }

    field "payload" {
      type        = "bytes"
      description = "Request body"
    }
  }

  message "api-response" {
    description = "Generic HTTP API response"

    field "payload" {
      type        = "bytes"
      description = "Response body"
    }

    field "status" {
      type        = "uint16"
      description = "HTTP status code"
    }
  }
}

protocol "jwt" {
  description = "JWT authentication protocol"
  roles       = ["provider", "consumer"]

  message "auth-response" {
    description = "JWT token issued after successful authentication"

    field "expires" {
      type        = "uint32"
      description = "Token lifetime in seconds"
    }

    field "token" {
      type        = "string"
      description = "Signed JWT access token"
    }
  }

  message "login-request" {
    description = "Login credentials submitted by the user"

    field "password" {
      type        = "string"
      description = "Hashed password"
    }

    field "username" {
      type        = "string"
      description = "User email address"
    }
  }
}

protocol "postgresql" {
  description = "PostgreSQL wire protocol"
  roles       = ["provider", "consumer"]

  message "db-query" {
    description = "SQL query sent to the database"

    field "params" {
      type        = "bytes"
      description = "Bound query parameters"
    }

    field "sql" {
      type        = "string"
      description = "SQL statement"
    }
  }
}

protocol "ui-nav" {
  description = "Frontend page routing and navigation events"
  roles       = ["provider", "consumer"]

  message "nav-event" {
    description = "Signals a page transition"

    field "destination" {
      type        = "string"
      description = "Target page identifier"
    }
  }
}

protocol "websocket" {
  description = "Real-time bidirectional WebSocket event channel"
  roles       = ["provider", "consumer"]

  message "match-event" {
    description = "A new match created by a right swipe"

    field "horse_id" {
      type        = "uint32"
      description = "Horse profile ID"
    }

    field "match_id" {
      type        = "uint32"
      description = "Unique match identifier"
    }
  }
}

component "backend" {
  description = "Backend server"
  leaf        = true

  port "api-in" {
    description = "REST API endpoint"
    protocol    = "https"
    role        = "provider"
    external    = true
  }

  port "auth-in" {
    description = "JWT authentication endpoint"
    protocol    = "jwt"
    role        = "provider"
    external    = true
  }

  port "db-out" {
    description = "Database query connection"
    protocol    = "postgresql"
    role        = "provider"
    external    = true
  }
}

component "chat_mode" {
  description = "Chat with horses you have matched with"
  leaf        = true

  port "match-in" {
    description = "Match event that opens a new chat thread"
    protocol    = "websocket"
    role        = "consumer"
  }
}

component "database" {
  description = "PostgreSQL database"
  leaf        = true

  port "db-in" {
    description = "Database query listener"
    protocol    = "postgresql"
    role        = "consumer"
    external    = true
  }
}

component "frontend" {
  description = "Frontend application"

  port "api-out" {
    description = "REST API calls sent to the backend"
    protocol    = "https"
    role        = "consumer"
    external    = true
  }

  port "auth-out" {
    description = "Authentication requests sent to the backend"
    protocol    = "jwt"
    role        = "consumer"
    external    = true
  }

  instance "login_page" { source = "login_page" }

  instance "main_app" { source = "main_app" }

  instance "settings_page" { source = "settings_page" }

  connection "app-to-settings" {
    description  = "Navigation from the main application to the settings page"
    from         = "main_app/settings-out"
    to           = "settings_page/nav-in"
  }

  connection "login-to-app" {
    description  = "Navigation from the login page into the main application"
    from         = "login_page/nav-out"
    to           = "main_app/nav-in"
  }
}

component "login_page" {
  description = "Available at /login"
  leaf        = true

  port "nav-out" {
    description = "Navigation event emitted after a successful login"
    protocol    = "ui-nav"
    role        = "provider"
  }
}

component "main_app" {
  description = "Root page (/), shows pictures of horses"

  port "nav-in" {
    description = "Navigation event that enters the main application"
    protocol    = "ui-nav"
    role        = "consumer"
  }

  port "settings-out" {
    description = "Navigation event that opens the settings page"
    protocol    = "ui-nav"
    role        = "provider"
  }

  instance "chat_mode" { source = "chat_mode" }

  instance "swipe_mode" { source = "swipe_mode" }

  connection "mode-switch" {
    description  = "Match event bridge: new matches open a chat thread"
    from         = "swipe_mode/match-out"
    to           = "chat_mode/match-in"
  }
}

component "settings_page" {
  description = "Available at /settings"
  leaf        = true

  port "nav-in" {
    description = "Navigation event that opens the settings page"
    protocol    = "ui-nav"
    role        = "consumer"
  }
}

component "swipe_mode" {
  description = "Swipe horses left or right to like or pass"
  leaf        = true

  port "match-out" {
    description = "Match event emitted when a user swipes right"
    protocol    = "websocket"
    role        = "provider"
  }
}

system "Web Application" {
  description = "Web Application - Tinder for Horses"
  tags        = ["web", "application"]

  instance "backend" { source = "backend" }

  instance "database" { source = "database" }

  instance "frontend" { source = "frontend" }

  connection "auth" {
    description  = "JWT authentication API"
    from         = "/Web Application/frontend/auth-out"
    to           = "/Web Application/backend/auth-in"
  }

  connection "database-connection" {
    description  = "TLS connection from the backend to the database"
    from         = "/Web Application/backend/db-out"
    to           = "/Web Application/database/db-in"
  }

  connection "rest-api" {
    description  = "REST API served by the backend to the frontend"
    from         = "/Web Application/frontend/api-out"
    to           = "/Web Application/backend/api-in"
  }
}
