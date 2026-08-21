# ── Architect overview ────────────────────────────────────────────────────────
# Full system detail: every component, every connection, and all message schemas.
# Intended for a system architect who needs the complete picture.
view "architect-overview" {
  description = "Full system architecture with all components and message schemas"
  system      = "Web Application"

  filter {
    show_messages = true
  }
}

# ── Frontend developer ────────────────────────────────────────────────────────
# Zooms into the frontend sub-tree: login page, settings page, and the main app
# (swipe mode + chat mode) with all navigation messages shown.
view "frontend-internals" {
  description = "Frontend application internals for frontend developers"
  system      = "Web Application"

  filter {
    components    = ["frontend"]
    max_level     = 3
    show_messages = true
  }
}

# ── Backend developer ─────────────────────────────────────────────────────────
# Shows the backend component in isolation with all its ports and message types.
# Useful for developers who own the server-side API.
view "backend-internals" {
  description = "Backend server ports and message types for backend developers"
  system      = "Web Application"

  filter {
    components    = ["backend"]
    show_messages = true
  }
}
