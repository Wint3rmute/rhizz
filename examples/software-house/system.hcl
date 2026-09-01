# Acme Software Ltd — organizational modeling with rhizz.
#
# Demonstrates that rhizz is not limited to hardware or software systems.
# Here departments are components and business processes are connections.
#
# Shows:
#  - Organizational decomposition (departments → teams)
#  - Process modeling via connections with port-based message payloads
#  - Mixed completeness: QA is fully decomposed, Sales is a leaf,
#    Operations is non-leaf with no children yet (W001)
# Acme Software — an organizational architecture model of a software house.
#
# Demonstrates:
#  - Non-technical architecture modeling (people/teams/departments)
#  - Multi-level hierarchy (software-house → department → team)
#  - Ports and connections used to model communication channels and handoffs
#  - Protocol definitions describing team communication schemas

project {
  name    = "acme-software"
  version = "0.3.0"
  authors = ["rhizz-examples"]
}

# ── Protocols ─────────────────────────────

protocol "pr-review" {
  description = "Code review process"
  roles       = ["peer"]

  message "review-request" {
    description = "Request for code review"
    tags        = ["process"]

    field "pr_url" {
      type        = "string"
      description = "Pull request URL"
    }
    field "urgency" {
      type        = "enum(low,normal,high)"
      description = "Review priority"
    }
  }
}

protocol "cicd" {
  description = "Continuous integration and deployment"
  roles       = ["provider", "consumer"]
}

protocol "agile" {
  description = "Agile sprint management"
  roles       = ["provider", "consumer"]

  message "sprint-backlog" {
    description = "Prioritized list of stories for the sprint"
    tags        = ["agile"]

    field "sprint_id" {
      type        = "string"
      description = "Sprint identifier"
    }
    field "stories" {
      type        = "string[]"
      description = "Ordered story IDs"
    }
    field "capacity" {
      type        = "uint8"
      unit        = "points"
      description = "Team capacity"
    }
  }
}

protocol "design" {
  description = "UI/UX design spec delivery"
  roles       = ["provider", "consumer"]

  message "design-spec" {
    description = "Figma link + acceptance criteria"
    tags        = ["process"]

    field "figma_url" {
      type        = "string"
      description = "Design file URL"
    }
    field "feature_id" {
      type        = "string"
      description = "Feature tracker ID"
    }
  }
}

protocol "tickets" {
  description = "Issue tracking and bug reporting"
  roles       = ["provider", "consumer"]

  message "bug-ticket" {
    description = "Bug report with reproduction steps"
    tags        = ["quality"]

    field "ticket_id" {
      type        = "string"
      description = "Issue tracker ID"
    }
    field "severity" {
      type        = "enum(critical,major,minor)"
      description = "Bug severity"
    }
    field "repro_steps" {
      type        = "string"
      description = "Steps to reproduce"
    }
  }
}

protocol "release" {
  description = "Software release governance"
  roles       = ["provider", "consumer"]

  message "sign-off" {
    description = "Release approval or rejection"
    tags        = ["quality"]

    field "build_id" {
      type        = "string"
      description = "Build/version identifier"
    }
    field "approved" {
      type        = "bool"
      description = "Pass or fail"
    }
  }
}

protocol "test-suites" {
  description = "Test suite distribution"
  roles       = ["provider", "consumer"]
}

protocol "feedback" {
  description = "Customer feedback stream"
  roles       = ["provider", "consumer"]
}

# ── Component definitions ─────────────────

component "engineering" {
  description = "Product engineering department"
  icon        = "gears"
  tags        = ["department", "technical"]
  leaf        = false

  port "sprint-in" {
    description = "Sprint backlog intake"
    protocol    = "agile"
    role        = "consumer"
    external    = true
    tags        = ["process", "agile"]
  }

  port "bug-in" {
    description = "Bug intake from QA"
    protocol    = "tickets"
    role        = "consumer"
    external    = true
    tags        = ["process", "quality"]
  }

  instance "frontend-team" {
    source = "frontend-team"
  }

  instance "backend-team" {
    source = "backend-team"
  }

  instance "platform-team" {
    source = "platform-team"
  }

  connection "code-review" {
    description = "Pull request review flow between teams"
    tags        = ["process", "collaboration"]
    from        = "frontend-team/review"
    to          = "backend-team/review"
  }

  connection "deploy-pipeline" {
    description = "Platform team provides CI/CD to all engineering"
    tags        = ["process", "infra"]
    from        = "platform-team/deploy-out"
    to          = "frontend-team/deploy-in"
  }
}

component "frontend-team" {
  description = "Web and mobile client engineers"
  icon        = "desktop"
  tags        = ["team", "technical"]
  leaf        = true

  port "review" {
    description = "Code review interface"
    protocol    = "pr-review"
    role        = "peer"
    tags        = ["process", "collaboration"]
  }

  port "deploy-in" {
    description = "Receives deployments from platform"
    protocol    = "cicd"
    role        = "consumer"
    tags        = ["process", "infra"]
  }
}

component "backend-team" {
  description = "API and infrastructure engineers"
  icon        = "server"
  tags        = ["team", "technical"]
  leaf        = true

  port "review" {
    description = "Code review interface"
    protocol    = "pr-review"
    role        = "peer"
    tags        = ["process", "collaboration"]
  }
}

component "platform-team" {
  description = "CI/CD, observability, developer tooling"
  icon        = "cloud"
  tags        = ["team", "technical", "infra"]
  leaf        = true

  port "deploy-out" {
    description = "Provides CI/CD pipeline"
    protocol    = "cicd"
    role        = "provider"
    tags        = ["process", "infra"]
  }
}

component "product" {
  description = "Product management"
  icon        = "lightbulb"
  tags        = ["department", "business"]
  leaf        = false

  port "sprint-out" {
    description = "Sends sprint backlogs to engineering"
    protocol    = "agile"
    role        = "provider"
    external    = true
    tags        = ["process", "agile"]
  }

  port "signoff-in" {
    description = "Release sign-off from QA"
    protocol    = "release"
    role        = "consumer"
    external    = true
    tags        = ["process", "quality"]
  }

  port "feedback-in" {
    description = "Customer feedback from Sales"
    protocol    = "feedback"
    role        = "consumer"
    external    = true
    tags        = ["process", "business"]
  }

  instance "product-managers" {
    source = "product-managers"
  }

  instance "designers" {
    source = "designers"
  }

  connection "design-handoff" {
    description = "Designers deliver specs to PMs for grooming"
    tags        = ["process"]
    from        = "designers/design-out"
    to          = "product-managers"
  }
}

component "product-managers" {
  description = "Technical and growth PMs"
  icon        = "briefcase"
  tags        = ["team", "business"]
  leaf        = true
}

component "designers" {
  description = "UX/UI design team"
  icon        = "palette"
  tags        = ["team", "creative"]
  leaf        = true

  port "design-out" {
    description = "Design spec delivery"
    protocol    = "design"
    role        = "provider"
    external    = true
    tags        = ["process"]
  }
}

component "qa" {
  description = "Quality assurance department"
  icon        = "vial"
  tags        = ["department", "technical"]
  leaf        = false

  port "bug-out" {
    description = "Files bug reports against engineering"
    protocol    = "tickets"
    role        = "provider"
    external    = true
    tags        = ["process", "quality"]
  }

  port "signoff-out" {
    description = "Approves releases"
    protocol    = "release"
    role        = "provider"
    external    = true
    tags        = ["process", "quality"]
  }

  instance "manual-qa" {
    source = "manual-qa"
  }

  instance "automation-qa" {
    source = "automation-qa"
  }

  connection "test-handoff" {
    description = "Automation team provides regression suites to manual QA"
    tags        = ["process", "testing"]
    from        = "automation-qa/suites-out"
    to          = "manual-qa"
  }
}

component "manual-qa" {
  description = "Manual / exploratory testing team"
  icon        = "clipboard-check"
  tags        = ["team", "testing"]
  leaf        = true
}

component "automation-qa" {
  description = "Test automation engineers"
  icon        = "robot"
  tags        = ["team", "testing", "technical"]
  leaf        = true

  port "suites-out" {
    description = "Regression suites"
    protocol    = "test-suites"
    role        = "provider"
    tags        = ["process", "testing"]
  }
}

component "sales" {
  description = "Sales and business development"
  icon        = "handshake"
  tags        = ["department", "business"]
  leaf        = true

  port "feedback-out" {
    description = "Customer feedback relay"
    protocol    = "feedback"
    role        = "provider"
    tags        = ["process", "business"]
  }
}

# Intentionally incomplete — W001 + W004
component "operations" {
  icon = "headset"
  tags = ["department", "infra"]
  leaf = false
  # no description → W004
  # no children    → W001
}

# ── System ────────────────────────────────

system "acme-software" {
  description = "Mid-sized product software company"
  tags        = ["organization", "software"]
  level       = 0

  # ── Instances ──────────────────────────────

  instance "engineering" {
    source = "engineering"
  }

  instance "product" {
    source = "product"
  }

  instance "qa" {
    source = "qa"
  }

  instance "sales" {
    source = "sales"
  }

  instance "operations" {
    source = "operations"
  }

  # ── Cross-department processes (connections) ─

  connection "sprint-planning" {
    description = "Bi-weekly sprint planning: Product → Engineering"
    tags        = ["process", "agile"]
    from        = "product/sprint-out"
    to          = "engineering/sprint-in"
  }

  connection "bug-reports" {
    description = "QA files bugs against Engineering"
    tags        = ["process", "quality"]
    from        = "qa/bug-out"
    to          = "engineering/bug-in"
  }

  connection "release-sign-off" {
    description = "QA approves a build for release"
    tags        = ["process", "quality"]
    from        = "qa/signoff-out"
    to          = "product/signoff-in"
  }

  connection "customer-feedback" {
    description = "Sales relays customer feedback to Product"
    tags        = ["process", "business"]
    from        = "sales/feedback-out"
    to          = "product/feedback-in"
  }
}