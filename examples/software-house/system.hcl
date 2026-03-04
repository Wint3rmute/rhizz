# Acme Software Ltd — organizational modeling with rhizz.
#
# Demonstrates that rhizz is not limited to hardware or software systems.
# Here departments are components and business processes are interfaces.
#
# Shows:
#  - Organizational decomposition (departments → teams)
#  - Process modeling via interfaces with message payloads
#  - Mixed completeness: QA is fully decomposed, Sales is a leaf,
#    Operations is non-leaf with no children yet (W001)

system "acme-software" {
  description = "Acme Software Ltd — organization model"
  tags        = ["organization", "processes"]
  level       = 0

  # ── Departments (components) ──────────────

  component "engineering" {
    description = "Product engineering department"
    tags        = ["department", "technical"]
    leaf        = false

    component "frontend-team" {
      description = "Web and mobile UI engineers"
      tags        = ["team", "technical"]
      leaf        = true
    }

    component "backend-team" {
      description = "API and infrastructure engineers"
      tags        = ["team", "technical"]
      leaf        = true
    }

    component "platform-team" {
      description = "CI/CD, observability, developer tooling"
      tags        = ["team", "technical", "infra"]
      leaf        = true
    }

    interface "code-review" {
      description = "Pull request review flow between teams"
      from        = "frontend-team"
      to          = "backend-team"
      direction   = "bidirectional"
      tags        = ["process", "collaboration"]
      leaf        = false

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

    interface "deploy-pipeline" {
      description = "Platform team provides CI/CD to all engineering"
      from        = "platform-team"
      to          = "frontend-team"
      direction   = "unidirectional"
      tags        = ["process", "infra"]
      leaf        = true
    }
  }

  component "product" {
    description = "Product management"
    tags        = ["department", "business"]
    leaf        = false

    component "product-managers" {
      description = "PMs owning roadmap and prioritization"
      tags        = ["team", "business"]
      leaf        = true
    }

    component "designers" {
      description = "UX/UI design team"
      tags        = ["team", "creative"]
      leaf        = true
    }

    interface "design-handoff" {
      description = "Designers deliver specs to PMs for grooming"
      from        = "designers"
      to          = "product-managers"
      direction   = "unidirectional"
      tags        = ["process"]
      leaf        = false

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
  }

  component "qa" {
    description = "Quality assurance department"
    tags        = ["department", "technical"]
    leaf        = false

    component "manual-qa" {
      description = "Manual / exploratory testing team"
      tags        = ["team", "testing"]
      leaf        = true
    }

    component "automation-qa" {
      description = "Test automation engineers"
      tags        = ["team", "testing", "technical"]
      leaf        = true
    }

    interface "test-handoff" {
      description = "Automation team provides regression suites to manual QA"
      from        = "automation-qa"
      to          = "manual-qa"
      direction   = "unidirectional"
      tags        = ["process", "testing"]
      leaf        = true
    }
  }

  component "sales" {
    description = "Sales and business development"
    tags        = ["department", "business"]
    leaf        = true
  }

  # Intentionally incomplete — W001 + W005
  component "operations" {
    tags = ["department", "infra"]
    leaf = false
    # no description → W005
    # no children    → W001
  }

  # ── Cross-department processes (interfaces) ─

  interface "sprint-planning" {
    description = "Bi-weekly sprint planning: Product → Engineering"
    tags        = ["process", "agile"]
    from        = "product"
    to          = "engineering"
    direction   = "unidirectional"
    leaf        = false

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

  interface "bug-reports" {
    description = "QA files bugs against Engineering"
    tags        = ["process", "quality"]
    from        = "qa"
    to          = "engineering"
    direction   = "unidirectional"
    leaf        = false

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

  interface "release-sign-off" {
    description = "QA approves a build for release"
    tags        = ["process", "quality"]
    from        = "qa"
    to          = "product"
    direction   = "unidirectional"
    leaf        = false

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

  interface "customer-feedback" {
    description = "Sales relays customer feedback to Product"
    tags        = ["process", "business"]
    from        = "sales"
    to          = "product"
    direction   = "unidirectional"
    leaf        = true
  }
}
