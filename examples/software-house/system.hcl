project {
  name    = "acme-software"
  version = "0.3.0"
  authors = ["rhizz-examples"]
}

protocol "agile" {
  full_name = "Agile sprint management"
  roles       = ["provider", "consumer"]

  message "sprint-backlog" {
    full_name = "Prioritized list of stories for the sprint"
    tags        = ["agile"]

    field "capacity" {
      type        = "uint8"
      full_name = "Team capacity"
      unit        = "points"
    }

    field "sprint_id" {
      type        = "string"
      full_name = "Sprint identifier"
    }

    field "stories" {
      type        = "string[]"
      full_name = "Ordered story IDs"
    }
  }
}

protocol "cicd" {
  full_name = "Continuous integration and deployment"
  roles       = ["provider", "consumer"]
}

protocol "design" {
  full_name = "UI/UX design spec delivery"
  roles       = ["provider", "consumer"]

  message "design-spec" {
    full_name = "Figma link + acceptance criteria"
    tags        = ["process"]

    field "feature_id" {
      type        = "string"
      full_name = "Feature tracker ID"
    }

    field "figma_url" {
      type        = "string"
      full_name = "Design file URL"
    }
  }
}

protocol "feedback" {
  full_name = "Customer feedback stream"
  roles       = ["provider", "consumer"]
}

protocol "pr-review" {
  full_name = "Code review process"
  roles       = ["peer"]

  message "review-request" {
    full_name = "Request for code review"
    tags        = ["process"]

    field "pr_url" {
      type        = "string"
      full_name = "Pull request URL"
    }

    field "urgency" {
      type        = "enum(low,normal,high)"
      full_name = "Review priority"
    }
  }
}

protocol "release" {
  full_name = "Software release governance"
  roles       = ["provider", "consumer"]

  message "sign-off" {
    full_name = "Release approval or rejection"
    tags        = ["quality"]

    field "approved" {
      type        = "bool"
      full_name = "Pass or fail"
    }

    field "build_id" {
      type        = "string"
      full_name = "Build/version identifier"
    }
  }
}

protocol "test-suites" {
  full_name = "Test suite distribution"
  roles       = ["provider", "consumer"]
}

protocol "tickets" {
  full_name = "Issue tracking and bug reporting"
  roles       = ["provider", "consumer"]

  message "bug-ticket" {
    full_name = "Bug report with reproduction steps"
    tags        = ["quality"]

    field "repro_steps" {
      type        = "string"
      full_name = "Steps to reproduce"
    }

    field "severity" {
      type        = "enum(critical,major,minor)"
      full_name = "Bug severity"
    }

    field "ticket_id" {
      type        = "string"
      full_name = "Issue tracker ID"
    }
  }
}

component "automation-qa" {
  full_name = "Test automation engineers"
  icon        = "robot"
  tags        = ["team", "testing", "technical"]
  leaf        = true

  port "suites-out" {
    full_name = "Regression suites"
    protocol    = "test-suites"
    role        = "provider"
    tags        = ["process", "testing"]
  }
}

component "backend-team" {
  full_name = "API and infrastructure engineers"
  icon        = "server"
  tags        = ["team", "technical"]
  leaf        = true

  port "review" {
    full_name = "Code review interface"
    protocol    = "pr-review"
    role        = "peer"
    tags        = ["process", "collaboration"]
  }
}

component "designers" {
  full_name = "UX/UI design team"
  icon        = "palette"
  tags        = ["team", "creative"]
  leaf        = true

  port "design-out" {
    full_name = "Design spec delivery"
    protocol    = "design"
    role        = "provider"
    tags        = ["process"]
    external    = true
  }
}

component "engineering" {
  full_name = "Product engineering department"
  icon        = "gears"
  tags        = ["department", "technical"]

  port "bug-in" {
    full_name = "Bug intake from QA"
    protocol    = "tickets"
    role        = "consumer"
    tags        = ["process", "quality"]
    external    = true
  }

  port "sprint-in" {
    full_name = "Sprint backlog intake"
    protocol    = "agile"
    role        = "consumer"
    tags        = ["process", "agile"]
    external    = true
  }

  instance "backend-team" { source = "backend-team" }

  instance "frontend-team" { source = "frontend-team" }

  instance "platform-team" { source = "platform-team" }

  connection "code-review" {
    full_name  = "Pull request review flow between teams"
    tags         = ["process", "collaboration"]
    from         = "frontend-team/review"
    to           = "backend-team/review"
  }

  connection "deploy-pipeline" {
    full_name  = "Platform team provides CI/CD to all engineering"
    tags         = ["process", "infra"]
    from         = "platform-team/deploy-out"
    to           = "frontend-team/deploy-in"
  }
}

component "frontend-team" {
  full_name = "Web and mobile client engineers"
  icon        = "desktop"
  tags        = ["team", "technical"]
  leaf        = true

  port "deploy-in" {
    full_name = "Receives deployments from platform"
    protocol    = "cicd"
    role        = "consumer"
    tags        = ["process", "infra"]
  }

  port "review" {
    full_name = "Code review interface"
    protocol    = "pr-review"
    role        = "peer"
    tags        = ["process", "collaboration"]
  }
}

component "manual-qa" {
  full_name = "Manual / exploratory testing team"
  icon        = "clipboard-check"
  tags        = ["team", "testing"]
  leaf        = true
}

component "operations" {
  icon        = "headset"
  tags        = ["department", "infra"]
}

component "platform-team" {
  full_name = "CI/CD, observability, developer tooling"
  icon        = "cloud"
  tags        = ["team", "technical", "infra"]
  leaf        = true

  port "deploy-out" {
    full_name = "Provides CI/CD pipeline"
    protocol    = "cicd"
    role        = "provider"
    tags        = ["process", "infra"]
  }
}

component "product" {
  full_name = "Product management"
  icon        = "lightbulb"
  tags        = ["department", "business"]

  port "feedback-in" {
    full_name = "Customer feedback from Sales"
    protocol    = "feedback"
    role        = "consumer"
    tags        = ["process", "business"]
    external    = true
  }

  port "signoff-in" {
    full_name = "Release sign-off from QA"
    protocol    = "release"
    role        = "consumer"
    tags        = ["process", "quality"]
    external    = true
  }

  port "sprint-out" {
    full_name = "Sends sprint backlogs to engineering"
    protocol    = "agile"
    role        = "provider"
    tags        = ["process", "agile"]
    external    = true
  }

  instance "designers" { source = "designers" }

  instance "product-managers" { source = "product-managers" }

  connection "design-handoff" {
    full_name  = "Designers deliver specs to PMs for grooming"
    tags         = ["process"]
    from         = "designers/design-out"
    to           = "product-managers"
  }
}

component "product-managers" {
  full_name = "Technical and growth PMs"
  icon        = "briefcase"
  tags        = ["team", "business"]
  leaf        = true
}

component "qa" {
  full_name = "Quality assurance department"
  icon        = "vial"
  tags        = ["department", "technical"]

  port "bug-out" {
    full_name = "Files bug reports against engineering"
    protocol    = "tickets"
    role        = "provider"
    tags        = ["process", "quality"]
    external    = true
  }

  port "signoff-out" {
    full_name = "Approves releases"
    protocol    = "release"
    role        = "provider"
    tags        = ["process", "quality"]
    external    = true
  }

  instance "automation-qa" { source = "automation-qa" }

  instance "manual-qa" { source = "manual-qa" }

  connection "test-handoff" {
    full_name  = "Automation team provides regression suites to manual QA"
    tags         = ["process", "testing"]
    from         = "automation-qa/suites-out"
    to           = "manual-qa"
  }
}

component "sales" {
  full_name = "Sales and business development"
  icon        = "handshake"
  tags        = ["department", "business"]
  leaf        = true

  port "feedback-out" {
    full_name = "Customer feedback relay"
    protocol    = "feedback"
    role        = "provider"
    tags        = ["process", "business"]
  }
}

system "acme-software" {
  full_name = "Mid-sized product software company"
  tags        = ["organization", "software"]

  instance "engineering" { source = "engineering" }

  instance "operations" { source = "operations" }

  instance "product" { source = "product" }

  instance "qa" { source = "qa" }

  instance "sales" { source = "sales" }

  connection "bug-reports" {
    full_name  = "QA files bugs against Engineering"
    tags         = ["process", "quality"]
    from         = "/acme-software/qa/bug-out"
    to           = "/acme-software/engineering/bug-in"
  }

  connection "customer-feedback" {
    full_name  = "Sales relays customer feedback to Product"
    tags         = ["process", "business"]
    from         = "/acme-software/sales/feedback-out"
    to           = "/acme-software/product/feedback-in"
  }

  connection "release-sign-off" {
    full_name  = "QA approves a build for release"
    tags         = ["process", "quality"]
    from         = "/acme-software/qa/signoff-out"
    to           = "/acme-software/product/signoff-in"
  }

  connection "sprint-planning" {
    full_name  = "Bi-weekly sprint planning: Product → Engineering"
    tags         = ["process", "agile"]
    from         = "/acme-software/product/sprint-out"
    to           = "/acme-software/engineering/sprint-in"
  }
}
