# ── Architect overview ────────────────────────────────────────────────────────
# Full system detail: every component, every connection, and all message schemas.
# Intended for a system architect who needs the complete picture.
view "architect-overview" {
  description = "Full system architecture with all components and message schemas"
  system      = "Web Application"

  filter {
    show_messages = true
  }

  output {
    filename = "architect-overview.dot"
    rankdir  = "TB"
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

  output {
    filename = "frontend-internals.dot"
    rankdir  = "TB"
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

  output {
    filename = "backend-internals.dot"
    rankdir  = "LR"
  }
}

# ── Database administrator ────────────────────────────────────────────────────
# Shows the backend and database components together with the full SQL message
# schema, so a DBA can see exactly what queries the backend sends.
view "data-layer" {
  description = "Database layer: backend-to-database connection and SQL messages"
  system      = "Web Application"

  filter {
    components    = ["backend", "database"]
    show_messages = true
  }

  output {
    filename = "data-layer.dot"
    rankdir  = "LR"
  }
}

# ── DevOps ────────────────────────────────────────────────────────────────────
# Infrastructure-centric view of the three deployed services (frontend, backend,
# database) and the protocols that connect them.  Payloads are hidden to keep
# the diagram clean for deployment and networking decisions.
view "devops-topology" {
  description = "Deployed services and connection protocols for DevOps"
  system      = "Web Application"

  filter {
    max_level     = 1
    show_messages = false
  }

  output {
    filename = "devops-topology.dot"
    rankdir  = "LR"
  }
}

# ── Product owner ─────────────────────────────────────────────────────────────
# Feature-centric view showing the user-facing pages and top-level services
# without technical message details.  Helps product owners reason about features
# and user flows at the right level of abstraction.
view "product-overview" {
  description = "User-facing features and pages for product owners"
  system      = "Web Application"

  filter {
    max_level     = 2
    show_messages = false
  }

  output {
    filename = "product-overview.dot"
    rankdir  = "TB"
  }
}
