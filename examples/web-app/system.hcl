project {
  name    = "web-app"
  version = "0.3.0"
  authors = ["rhizz-examples"]
}

protocol "https" {
  full_name = "HTTPS REST API"
  roles       = ["provider", "consumer"]

  message "api-request" {
    full_name = "Generic HTTP API request"

    field "method" {
      type        = "string"
      full_name = "HTTP method (GET, POST, …)"
    }

    field "path" {
      type        = "string"
      full_name = "Request path"
    }

    field "payload" {
      type        = "bytes"
      full_name = "Request body"
    }
  }

  message "api-response" {
    full_name = "Generic HTTP API response"

    field "payload" {
      type        = "bytes"
      full_name = "Response body"
    }

    field "status" {
      type        = "uint16"
      full_name = "HTTP status code"
    }
  }
}

protocol "jwt" {
  full_name = "JWT authentication protocol"
  roles       = ["provider", "consumer"]

  message "auth-response" {
    full_name = "JWT token issued after successful authentication"

    field "expires" {
      type        = "uint32"
      full_name = "Token lifetime in seconds"
    }

    field "token" {
      type        = "string"
      full_name = "Signed JWT access token"
    }
  }

  message "login-request" {
    full_name = "Login credentials submitted by the user"

    field "password" {
      type        = "string"
      full_name = "Hashed password"
    }

    field "username" {
      type        = "string"
      full_name = "User email address"
    }
  }
}

protocol "postgresql" {
  full_name = "PostgreSQL wire protocol"
  roles       = ["provider", "consumer"]

  message "db-query" {
    full_name = "SQL query sent to the database"

    field "params" {
      type        = "bytes"
      full_name = "Bound query parameters"
    }

    field "sql" {
      type        = "string"
      full_name = "SQL statement"
    }
  }
}

protocol "ui-nav" {
  full_name = "Frontend page routing and navigation events"
  roles       = ["provider", "consumer"]

  message "nav-event" {
    full_name = "Signals a page transition"

    field "destination" {
      type        = "string"
      full_name = "Target page identifier"
    }
  }
}

protocol "websocket" {
  full_name = "Real-time bidirectional WebSocket event channel"
  roles       = ["provider", "consumer"]

  message "match-event" {
    full_name = "A new match created by a right swipe"

    field "horse_id" {
      type        = "uint32"
      full_name = "Horse profile ID"
    }

    field "match_id" {
      type        = "uint32"
      full_name = "Unique match identifier"
    }
  }
}

component "backend" {
  full_name = "Backend server"
  leaf        = true

  port "api-in" {
    full_name = "REST API endpoint"
    protocol    = "https"
    role        = "provider"
    external    = true
  }

  port "auth-in" {
    full_name = "JWT authentication endpoint"
    protocol    = "jwt"
    role        = "provider"
    external    = true
  }

  port "db-out" {
    full_name = "Database query connection"
    protocol    = "postgresql"
    role        = "provider"
    external    = true
  }
}

component "chat_mode" {
  full_name = "Chat with horses you have matched with"
  leaf        = true

  port "match-in" {
    full_name = "Match event that opens a new chat thread"
    protocol    = "websocket"
    role        = "consumer"
  }
}

component "database" {
  full_name = "PostgreSQL database"
  leaf        = true

  port "db-in" {
    full_name = "Database query listener"
    protocol    = "postgresql"
    role        = "consumer"
    external    = true
  }
}

component "frontend" {
  full_name = "Frontend application"

  port "api-out" {
    full_name = "REST API calls sent to the backend"
    protocol    = "https"
    role        = "consumer"
    external    = true
  }

  port "auth-out" {
    full_name = "Authentication requests sent to the backend"
    protocol    = "jwt"
    role        = "consumer"
    external    = true
  }

  instance "login_page" { source = "login_page" }

  instance "main_app" { source = "main_app" }

  instance "settings_page" { source = "settings_page" }

  connection "app-to-settings" {
    full_name  = "Navigation from the main application to the settings page"
    from         = "main_app/settings-out"
    to           = "settings_page/nav-in"
  }

  connection "login-to-app" {
    full_name  = "Navigation from the login page into the main application"
    from         = "login_page/nav-out"
    to           = "main_app/nav-in"
  }
}

component "login_page" {
  full_name = "Available at /login"
  leaf        = true

  port "nav-out" {
    full_name = "Navigation event emitted after a successful login"
    protocol    = "ui-nav"
    role        = "provider"
  }
}

component "main_app" {
  full_name = "Root page (/), shows pictures of horses"

  port "nav-in" {
    full_name = "Navigation event that enters the main application"
    protocol    = "ui-nav"
    role        = "consumer"
  }

  port "settings-out" {
    full_name = "Navigation event that opens the settings page"
    protocol    = "ui-nav"
    role        = "provider"
  }

  instance "chat_mode" { source = "chat_mode" }

  instance "swipe_mode" { source = "swipe_mode" }

  connection "mode-switch" {
    full_name  = "Match event bridge: new matches open a chat thread"
    from         = "swipe_mode/match-out"
    to           = "chat_mode/match-in"
  }
}

component "settings_page" {
  full_name = "Available at /settings"
  leaf        = true

  port "nav-in" {
    full_name = "Navigation event that opens the settings page"
    protocol    = "ui-nav"
    role        = "consumer"
  }
}

component "swipe_mode" {
  full_name = "Swipe horses left or right to like or pass"
  leaf        = true

  port "match-out" {
    full_name = "Match event emitted when a user swipes right"
    protocol    = "websocket"
    role        = "provider"
  }
}

system "Web Application" {
  full_name = "Web Application - Tinder for Horses"
  tags        = ["web", "application"]

  instance "backend" { source = "backend" }

  instance "database" { source = "database" }

  instance "frontend" { source = "frontend" }

  connection "auth" {
    full_name  = "JWT authentication API"
    from         = "/Web Application/frontend/auth-out"
    to           = "/Web Application/backend/auth-in"
  }

  connection "database-connection" {
    full_name  = "TLS connection from the backend to the database"
    from         = "/Web Application/backend/db-out"
    to           = "/Web Application/database/db-in"
  }

  connection "rest-api" {
    full_name  = "REST API served by the backend to the frontend"
    from         = "/Web Application/frontend/api-out"
    to           = "/Web Application/backend/api-in"
  }
}
