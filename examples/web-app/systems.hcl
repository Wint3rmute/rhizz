system "Web Application" {
    description = "Web Application - Tinder for Horses"
    tags        = ["web", "application"]

    component frontend {
        description = "Frontend application"

        port "auth-out" {
            description = "Authentication requests sent to the backend"
            protocol    = "jwt"
            role        = "consumer"

            message "login-request" {
                description = "Login credentials submitted by the user"
                field "username" {
                    type        = "string"
                    description = "User email address"
                }
                field "password" {
                    type        = "string"
                    description = "Hashed password"
                }
            }
        }

        port "api-out" {
            description = "REST API calls sent to the backend"
            protocol    = "https"
            role        = "consumer"

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
        }

        component login_page {
            description = "Available at /login"
            leaf = true

            port "nav-out" {
                description = "Navigation event emitted after a successful login"
                protocol    = "ui-nav"
                role        = "provider"

                message "nav-event" {
                    description = "Signals a page transition"
                    field "destination" {
                        type        = "string"
                        description = "Target page identifier"
                    }
                }
            }
        }

        component settings_page {
            description = "Available at /settings"
            leaf = true

            port "nav-in" {
                description = "Navigation event that opens the settings page"
                protocol    = "ui-nav"
                role        = "consumer"

                message "nav-event" {
                    description = "Signals a page transition"
                    field "destination" {
                        type        = "string"
                        description = "Target page identifier"
                    }
                }
            }
        }

        component main_app {
            description = "Root page (/), shows pictures of horses"

            port "nav-in" {
                description = "Navigation event that enters the main application"
                protocol    = "ui-nav"
                role        = "consumer"

                message "nav-event" {
                    description = "Signals a page transition"
                    field "destination" {
                        type        = "string"
                        description = "Target page identifier"
                    }
                }
            }

            port "settings-out" {
                description = "Navigation event that opens the settings page"
                protocol    = "ui-nav"
                role        = "provider"

                message "nav-event" {
                    description = "Signals a page transition"
                    field "destination" {
                        type        = "string"
                        description = "Target page identifier"
                    }
                }
            }

            component swipe_mode {
                description = "Swipe horses left or right to like or pass"
                leaf = true

                port "match-out" {
                    description = "Match event emitted when a user swipes right"
                    protocol    = "websocket"
                    role        = "provider"

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
            }

            component chat_mode {
                description = "Chat with horses you have matched with"
                leaf = true

                port "match-in" {
                    description = "Match event that opens a new chat thread"
                    protocol    = "websocket"
                    role        = "consumer"

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
            }

            connection "mode-switch" {
                description = "Match event bridge: new matches open a chat thread"
                from = "swipe_mode/match-out"
                to   = "chat_mode/match-in"
            }
        }

        connection "login-to-app" {
            description = "Navigation from the login page into the main application"
            from = "login_page/nav-out"
            to   = "main_app/nav-in"
        }

        connection "app-to-settings" {
            description = "Navigation from the main application to the settings page"
            from = "main_app/settings-out"
            to   = "settings_page/nav-in"
        }
    }

    component backend {
        description = "Backend server"
        leaf = true

        port "auth-in" {
            description = "JWT authentication endpoint"
            protocol    = "jwt"
            role        = "provider"

            message "auth-response" {
                description = "JWT token issued after successful authentication"
                field "token" {
                    type        = "string"
                    description = "Signed JWT access token"
                }
                field "expires" {
                    type        = "uint32"
                    description = "Token lifetime in seconds"
                }
            }
        }

        port "api-in" {
            description = "REST API endpoint"
            protocol    = "https"
            role        = "provider"

            message "api-response" {
                description = "Generic HTTP API response"
                field "status" {
                    type        = "uint16"
                    description = "HTTP status code"
                }
                field "payload" {
                    type        = "bytes"
                    description = "Response body"
                }
            }
        }

        port "db-out" {
            description = "Database query connection"
            protocol    = "postgresql"
            role        = "provider"

            message "db-query" {
                description = "SQL query sent to the database"
                field "sql" {
                    type        = "string"
                    description = "SQL statement"
                }
                field "params" {
                    type        = "bytes"
                    description = "Bound query parameters"
                }
            }
        }
    }

    component database {
        description = "PostgreSQL database"
        leaf = true

        port "db-in" {
            description = "Database query listener"
            protocol    = "postgresql"
            role        = "consumer"

            message "db-query" {
                description = "SQL query received by the database"
                field "sql" {
                    type        = "string"
                    description = "SQL statement"
                }
                field "params" {
                    type        = "bytes"
                    description = "Bound query parameters"
                }
            }
        }
    }

    connection "database-connection" {
        description = "TLS connection from the backend to the database"
        from = "backend/db-out"
        to   = "database/db-in"
    }

    connection "rest-api" {
        description = "REST API served by the backend to the frontend"
        from = "frontend/api-out"
        to   = "backend/api-in"
    }

    connection "auth" {
        description = "JWT authentication API"
        from = "frontend/auth-out"
        to   = "backend/auth-in"
    }
}