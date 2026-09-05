view "architect-overview" {
  description = "Full system architecture with all components and message schemas"
  system      = "Web Application"

  filter {
    show_messages = true
  }
}

view "backend-internals" {
  description = "Backend server ports and message types for backend developers"
  system      = "Web Application"

  filter {
    components    = ["backend"]
    show_messages = true
  }
}

view "frontend-internals" {
  description = "Frontend application internals for frontend developers"
  system      = "Web Application"

  filter {
    max_level     = 3
    components    = ["frontend"]
    show_messages = true
  }
}
