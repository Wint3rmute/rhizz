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

system "acme-software" {
  description = "Acme Software Ltd — organization model"
  tags        = ["organization", "processes"]
  level       = 0

  # ── Departments (components) ──────────────

  component "engineering" {
    description = "Product engineering department"
    tags        = ["department", "technical"]
    leaf        = false

    port "sprint-in" {
      description = "Receives sprint backlogs from product"
      protocol    = "agile"
      role        = "consumer"
      tags        = ["process", "agile"]
    }

    port "bug-in" {
      description = "Receives bug reports from QA"
      protocol    = "tickets"
      role        = "consumer"
      tags        = ["process", "quality"]
    }

    component "frontend-team" {
      description = "Web and mobile UI engineers"
      tags        = ["team", "technical"]
      leaf        = true

      port "review" {
        description = "Code review interface"
        protocol    = "pr-review"
        role        = "peer"
        tags        = ["process", "collaboration"]

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

      port "deploy-in" {
        description = "Receives deployments from platform"
        protocol    = "cicd"
        role        = "consumer"
        tags        = ["process", "infra"]
      }
    }

    component "backend-team" {
      description = "API and infrastructure engineers"
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
      tags        = ["team", "technical", "infra"]
      leaf        = true

      port "deploy-out" {
        description = "Provides CI/CD pipeline"
        protocol    = "cicd"
        role        = "provider"
        tags        = ["process", "infra"]
      }
    }

    connection "code-review" {
      description = "Pull request review flow between teams"
      tags        = ["process", "collaboration"]
      from        = "frontend-team:review"
      to          = "backend-team:review"
    }

    connection "deploy-pipeline" {
      description = "Platform team provides CI/CD to all engineering"
      tags        = ["process", "infra"]
      from        = "platform-team:deploy-out"
      to          = "frontend-team:deploy-in"
    }
  }

  component "product" {
    description = "Product management"
    tags        = ["department", "business"]
    leaf        = false

    port "sprint-out" {
      description = "Sends sprint backlogs to engineering"
      protocol    = "agile"
      role        = "provider"
      tags        = ["process", "agile"]

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

    port "feedback-in" {
      description = "Receives customer feedback from sales"
      protocol    = "feedback"
      role        = "consumer"
      tags        = ["process", "business"]
    }

    port "signoff-in" {
      description = "Receives release sign-offs from QA"
      protocol    = "release"
      role        = "consumer"
      tags        = ["process", "quality"]
    }

    component "product-managers" {
      description = "PMs owning roadmap and prioritization"
      tags        = ["team", "business"]
      leaf        = true
    }

    component "designers" {
      description = "UX/UI design team"
      tags        = ["team", "creative"]
      leaf        = true

      port "design-out" {
        description = "Design spec delivery"
        protocol    = "design"
        role        = "provider"
        tags        = ["process"]

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

    connection "design-handoff" {
      description = "Designers deliver specs to PMs for grooming"
      tags        = ["process"]
      from        = "designers:design-out"
      to          = "product-managers"
    }
  }

  component "qa" {
    description = "Quality assurance department"
    tags        = ["department", "technical"]
    leaf        = false

    port "bug-out" {
      description = "Files bug reports against engineering"
      protocol    = "tickets"
      role        = "provider"
      tags        = ["process", "quality"]

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

    port "signoff-out" {
      description = "Approves releases"
      protocol    = "release"
      role        = "provider"
      tags        = ["process", "quality"]

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

    component "manual-qa" {
      description = "Manual / exploratory testing team"
      tags        = ["team", "testing"]
      leaf        = true
    }

    component "automation-qa" {
      description = "Test automation engineers"
      tags        = ["team", "testing", "technical"]
      leaf        = true

      port "suites-out" {
        description = "Regression suites"
        protocol    = "test-suites"
        role        = "provider"
        tags        = ["process", "testing"]
      }
    }

    connection "test-handoff" {
      description = "Automation team provides regression suites to manual QA"
      tags        = ["process", "testing"]
      from        = "automation-qa:suites-out"
      to          = "manual-qa"
    }
  }

  component "sales" {
    description = "Sales and business development"
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
    tags = ["department", "infra"]
    leaf = false
    # no description → W004
    # no children    → W001
  }

  # ── Cross-department processes (connections) ─

  connection "sprint-planning" {
    description = "Bi-weekly sprint planning: Product → Engineering"
    tags        = ["process", "agile"]
    from        = "product:sprint-out"
    to          = "engineering:sprint-in"
  }

  connection "bug-reports" {
    description = "QA files bugs against Engineering"
    tags        = ["process", "quality"]
    from        = "qa:bug-out"
    to          = "engineering:bug-in"
  }

  connection "release-sign-off" {
    description = "QA approves a build for release"
    tags        = ["process", "quality"]
    from        = "qa:signoff-out"
    to          = "product:signoff-in"
  }

  connection "customer-feedback" {
    description = "Sales relays customer feedback to Product"
    tags        = ["process", "business"]
    from        = "sales:feedback-out"
    to          = "product:feedback-in"
  }
}
