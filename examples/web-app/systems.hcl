system "Web Application" {
    description = "Web Application - Tinder for Horses"

    component frontend {
        description = "Frontend application"

        // This feels awkward, I have to write both port and component?
        port login_page { }
        component login_page {
            description = "Available at /login"
            leaf = true
        }

        component settings_page {
            description = "/settings"
            leaf = true
        }

        component main_app {
            description = "at the root (/), shows pictures of horses"

            // Rhiz complains:
            // > 'swipe_mode' is not referenced by any connection
            // I don't understand how to connect it to something...
            component swipe_mode {
                description = "this is where you swap horses left/right"
                leaf = true
            }

            component chat_mode {
                description = "this is where you chat with matched horses"
                leaf = true
            }
        }
    }

    component backend {
        description = "Backend Server"
        leaf = true
    }

    component database {
        description = "Database"
        leaf = true

    }

    connection database-connection {
        from = "backend"
        to = "database"

        description = "tls connection from backend to the database"
    }

    connection rest-api {
        from = "frontend"
        to = "backend"

        description = "REST API served by the backend"
    }

    connection auth {
        from = "frontend:login_page"
        to = "backend"

        description = "JWT token API"
    }
}