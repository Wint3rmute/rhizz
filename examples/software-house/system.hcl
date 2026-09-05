project {
  name    = "acme-software"
  version = "0.3.0"
  authors = ["rhizz-examples"]
}

protocol "agile" {
  description = "Agile sprint management"
  roles       = ["provider", "consumer"]

  message "sprint-backlog" {
    description = "Prioritized list of stories for the sprint"
    tags        = ["agile"]

    field "capacity" {
      type        = "uint8"
      description = "Team capacity"
      unit        = "points"
    }

    field "sprint_id" {
      type        = "string"
      description = "Sprint identifier"
    }

    field "stories" {
      type        = "string[]"
      description = "Ordered story IDs"
    }
  }
}

protocol "cicd" {
  description = "Continuous integration and deployment"
  roles       = ["provider", "consumer"]
}

protocol "design" {
  description = "UI/UX design spec delivery"
  roles       = ["provider", "consumer"]

  message "design-spec" {
    description = "Figma link + acceptance criteria"
    tags        = ["process"]

    field "feature_id" {
      type        = "string"
      description = "Feature tracker ID"
    }

    field "figma_url" {
      type        = "string"
      description = "Design file URL"
    }
  }
}

protocol "feedback" {
  description = "Customer feedback stream"
  roles       = ["provider", "consumer"]
}

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

protocol "release" {
  description = "Software release governance"
  roles       = ["provider", "consumer"]

  message "sign-off" {
    description = "Release approval or rejection"
    tags        = ["quality"]

    field "approved" {
      type        = "bool"
      description = "Pass or fail"
    }

    field "build_id" {
      type        = "string"
      description = "Build/version identifier"
    }
  }
}

protocol "test-suites" {
  description = "Test suite distribution"
  roles       = ["provider", "consumer"]
}

protocol "tickets" {
  description = "Issue tracking and bug reporting"
  roles       = ["provider", "consumer"]

  message "bug-ticket" {
    description = "Bug report with reproduction steps"
    tags        = ["quality"]

    field "repro_steps" {
      type        = "string"
      description = "Steps to reproduce"
    }

    field "severity" {
      type        = "enum(critical,major,minor)"
      description = "Bug severity"
    }

    field "ticket_id" {
      type        = "string"
      description = "Issue tracker ID"
    }
  }
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

component "designers" {
  description = "UX/UI design team"
  icon        = "palette"
  tags        = ["team", "creative"]
  leaf        = true

  port "design-out" {
    description = "Design spec delivery"
    protocol    = "design"
    role        = "provider"
    tags        = ["process"]
    external    = true
  }
}

component "engineering" {
  description = "Product engineering department"
  icon        = "gears"
  tags        = ["department", "technical"]

  port "bug-in" {
    description = "Bug intake from QA"
    protocol    = "tickets"
    role        = "consumer"
    tags        = ["process", "quality"]
    external    = true
  }

  port "sprint-in" {
    description = "Sprint backlog intake"
    protocol    = "agile"
    role        = "consumer"
    tags        = ["process", "agile"]
    external    = true
  }

  instance "backend-team" { source = "backend-team" }

  instance "frontend-team" { source = "frontend-team" }

  instance "platform-team" { source = "platform-team" }

  connection "code-review" {
    description  = "Pull request review flow between teams"
    tags         = ["process", "collaboration"]
    from         = "frontend-team/review"
    to           = "backend-team/review"
  }

  connection "deploy-pipeline" {
    description  = "Platform team provides CI/CD to all engineering"
    tags         = ["process", "infra"]
    from         = "platform-team/deploy-out"
    to           = "frontend-team/deploy-in"
  }
}

component "frontend-team" {
  description = "Web and mobile client engineers"
  icon        = "desktop"
  tags        = ["team", "technical"]
  leaf        = true

  port "deploy-in" {
    description = "Receives deployments from platform"
    protocol    = "cicd"
    role        = "consumer"
    tags        = ["process", "infra"]
  }

  port "review" {
    description = "Code review interface"
    protocol    = "pr-review"
    role        = "peer"
    tags        = ["process", "collaboration"]
  }
}

component "manual-qa" {
  description = "Manual / exploratory testing team"
  icon        = "clipboard-check"
  tags        = ["team", "testing"]
  leaf        = true
}

component "operations" {
  icon        = "headset"
  tags        = ["department", "infra"]
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

  port "feedback-in" {
    description = "Customer feedback from Sales"
    protocol    = "feedback"
    role        = "consumer"
    tags        = ["process", "business"]
    external    = true
  }

  port "signoff-in" {
    description = "Release sign-off from QA"
    protocol    = "release"
    role        = "consumer"
    tags        = ["process", "quality"]
    external    = true
  }

  port "sprint-out" {
    description = "Sends sprint backlogs to engineering"
    protocol    = "agile"
    role        = "provider"
    tags        = ["process", "agile"]
    external    = true
  }

  instance "designers" { source = "designers" }

  instance "product-managers" { source = "product-managers" }

  connection "design-handoff" {
    description  = "Designers deliver specs to PMs for grooming"
    tags         = ["process"]
    from         = "designers/design-out"
    to           = "product-managers"
  }
}

component "product-managers" {
  description = "Technical and growth PMs"
  icon        = "briefcase"
  tags        = ["team", "business"]
  leaf        = true
}

component "qa" {
  description = "Quality assurance department"
  icon        = "vial"
  tags        = ["department", "technical"]

  port "bug-out" {
    description = "Files bug reports against engineering"
    protocol    = "tickets"
    role        = "provider"
    tags        = ["process", "quality"]
    external    = true
  }

  port "signoff-out" {
    description = "Approves releases"
    protocol    = "release"
    role        = "provider"
    tags        = ["process", "quality"]
    external    = true
  }

  instance "automation-qa" { source = "automation-qa" }

  instance "manual-qa" { source = "manual-qa" }

  connection "test-handoff" {
    description  = "Automation team provides regression suites to manual QA"
    tags         = ["process", "testing"]
    from         = "automation-qa/suites-out"
    to           = "manual-qa"
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

system "acme-software" {
  description = "Mid-sized product software company"
  tags        = ["organization", "software"]

  instance "engineering" { source = "engineering" }

  instance "operations" { source = "operations" }

  instance "product" { source = "product" }

  instance "qa" { source = "qa" }

  instance "sales" { source = "sales" }

  connection "bug-reports" {
    description  = "QA files bugs against Engineering"
    tags         = ["process", "quality"]
    from         = "/acme-software/qa/bug-out"
    to           = "/acme-software/engineering/bug-in"
  }

  connection "customer-feedback" {
    description  = "Sales relays customer feedback to Product"
    tags         = ["process", "business"]
    from         = "/acme-software/sales/feedback-out"
    to           = "/acme-software/product/feedback-in"
  }

  connection "release-sign-off" {
    description  = "QA approves a build for release"
    tags         = ["process", "quality"]
    from         = "/acme-software/qa/signoff-out"
    to           = "/acme-software/product/signoff-in"
  }

  connection "sprint-planning" {
    description  = "Bi-weekly sprint planning: Product → Engineering"
    tags         = ["process", "agile"]
    from         = "/acme-software/product/sprint-out"
    to           = "/acme-software/engineering/sprint-in"
  }
}
