project {
  name    = "apollo-11"
  version = "1.0.0"
  authors = ["NASA / rhizz-showcase"]
}

# ── Protocols ──────────────────────────────────────────────────

protocol "unified-s-band" {
  description = "2.2 GHz Unified S-band Earth-space telemetry, voice, and ranging"
  roles       = ["ground", "transceiver"]

  message "downlink-telemetry" {
    description = "Spacecraft state vector, systems health, and cabin telemetry"
    field "mission-elapsed-time" {
      type = "uint32"
      unit = "s"
    }
    field "cabin-pressure" {
      type = "float32"
      unit = "psia"
    }
    field "cabin-temp" {
      type = "float32"
      unit = "degF"
    }
    field "pgncs-state-vector" {
      type = "bytes"
    }
  }

  message "uplink-command" {
    description = "Ground command loads, trajectory state updates, and AGC memory writes"
    field "command-word" {
      type = "uint32"
    }
    field "clock-sync" {
      type = "uint32"
      unit = "ms"
    }
    field "nav-vector-update" {
      type = "bytes"
    }
  }
}

protocol "vhf-inter-spacecraft" {
  description = "VHF lunar orbit inter-spacecraft voice and ranging link"
  roles       = ["csm-transceiver", "lm-transceiver"]

  message "ranging-data" {
    description = "Lunar orbit CSM-to-LM relative distance and range rate"
    field "slant-range" {
      type = "float32"
      unit = "nmi"
    }
    field "range-rate" {
      type = "float32"
      unit = "fps"
    }
  }
}

protocol "docking-tunnel" {
  description = "CSM-to-LM mechanical docking probe, drogue, and pressurized transfer tunnel"
  roles       = ["active-probe", "passive-drogue"]

  message "tunnel-status" {
    description = "Docking latch status, pressure equalization, and crew passage hatch"
    field "latches-locked" {
      type = "bool"
    }
    field "differential-pressure" {
      type = "float32"
      unit = "psi"
    }
    field "hatch-open" {
      type = "bool"
    }
  }
}

protocol "saturn-instrument-unit-umbilical" {
  description = "Saturn V Launch Vehicle Digital Computer (LVDC) to CSM guidance handover and abort sensing"
  roles       = ["instrument-unit", "csm-eds"]

  message "launch-vehicle-telemetry" {
    description = "Saturn V propulsion status, vehicle rates, and Emergency Detection System flags"
    field "stage-thrust-ok" {
      type = "bool"
    }
    field "attitude-error" {
      type = "float32"
      unit = "deg"
    }
    field "angular-rate" {
      type = "float32"
      unit = "deg/s"
    }
    field "abort-request" {
      type = "bool"
    }
  }
}

# ── Top-level Reusable Components ──────────────────────────────

component "saturn-v" {
  description = "Saturn V three-stage launch vehicle with Instrument Unit (IU)"
  icon        = "rocket"
  tags        = ["launch-vehicle", "propulsion"]
  leaf        = true

  port "iu-umbilical" {
    description = "Instrument Unit EDS and guidance interface"
    protocol    = "saturn-instrument-unit-umbilical"
    role        = "instrument-unit"
    external    = true
    tags        = ["guidance", "launch"]
  }
}

component "command-service-module" {
  description = "Apollo Command and Service Module (CSM-107 'Columbia')"
  icon        = "satellite"
  tags        = ["spacecraft", "csm"]
  leaf        = true

  port "s-band-hga" {
    description = "High-gain steerable S-band antenna"
    protocol    = "unified-s-band"
    role        = "transceiver"
    external    = true
    tags        = ["rf", "telemetry"]
  }

  port "vhf-relay" {
    description = "VHF recovery and LM ranging transceiver"
    protocol    = "vhf-inter-spacecraft"
    role        = "csm-transceiver"
    external    = true
    tags        = ["rf", "ranging"]
  }

  port "docking-probe" {
    description = "Active docking probe mechanism and hatch"
    protocol    = "docking-tunnel"
    role        = "active-probe"
    external    = true
    tags        = ["mechanical", "docking"]
  }

  port "eds-interface" {
    description = "Emergency Detection System (EDS) abort interface from IU"
    protocol    = "saturn-instrument-unit-umbilical"
    role        = "csm-eds"
    external    = true
    tags        = ["guidance", "launch"]
  }
}

component "lunar-module" {
  description = "Apollo Lunar Module (LM-5 'Eagle') Descent and Ascent Stages"
  icon        = "moon"
  tags        = ["spacecraft", "lm"]
  leaf        = true

  port "s-band-steerable" {
    description = "Steerable S-band high-gain antenna"
    protocol    = "unified-s-band"
    role        = "transceiver"
    external    = true
    tags        = ["rf", "telemetry"]
  }

  port "vhf-ranging" {
    description = "VHF lunar rendezvous ranging transceiver"
    protocol    = "vhf-inter-spacecraft"
    role        = "lm-transceiver"
    external    = true
    tags        = ["rf", "ranging"]
  }

  port "docking-drogue" {
    description = "Passive docking drogue and upper hatch"
    protocol    = "docking-tunnel"
    role        = "passive-drogue"
    external    = true
    tags        = ["mechanical", "docking"]
  }
}

component "mission-control-center" {
  description = "Manned Space Flight Network (MSFN) & Houston Mission Control Center (MCC)"
  icon        = "tower-broadcast"
  tags        = ["ground", "telemetry"]
  leaf        = true

  port "csm-ground-link" {
    description = "Primary 85-foot dish S-band uplink/downlink to CSM"
    protocol    = "unified-s-band"
    role        = "ground"
    external    = true
    tags        = ["rf", "telemetry"]
  }

  port "lm-ground-link" {
    description = "Secondary Goldstone/Honeysuckle Creek S-band link to LM"
    protocol    = "unified-s-band"
    role        = "ground"
    external    = true
    tags        = ["rf", "telemetry"]
  }
}

# ── System Definition ──────────────────────────────────────────

system "apollo-11" {
  description = "Apollo 11 Mission Stack (AS-506) - Trans-Lunar & Lunar Architecture"
  tags        = ["apollo", "aerospace"]
  level       = 0

  component "saturn-v" {
    source = "saturn-v"
  }

  component "csm" {
    source = "command-service-module"
  }

  component "lm" {
    source = "lunar-module"
  }

  component "mcc" {
    source = "mission-control-center"
  }

  connection "launch-vehicle-eds" {
    description = "Saturn V Instrument Unit to CSM Emergency Detection System"
    tags        = ["launch", "guidance"]
    from        = "saturn-v/iu-umbilical"
    to          = "csm/eds-interface"
  }

  connection "csm-lm-docking" {
    description = "Transposition, docking, and crew transfer tunnel"
    tags        = ["docking", "mechanical"]
    from        = "csm/docking-probe"
    to          = "lm/docking-drogue"
  }

  connection "lunar-orbit-ranging" {
    description = "VHF ranging and rendezvous voice between Columbia and Eagle"
    tags        = ["rf", "ranging"]
    from        = "csm/vhf-relay"
    to          = "lm/vhf-ranging"
  }

  connection "msfn-to-csm" {
    description = "Unified S-band communications link between MCC and CSM"
    tags        = ["rf", "telemetry"]
    from        = "mcc/csm-ground-link"
    to          = "csm/s-band-hga"
  }

  connection "msfn-to-lm" {
    description = "Unified S-band communications link between MCC and Lunar Module"
    tags        = ["rf", "telemetry"]
    from        = "mcc/lm-ground-link"
    to          = "lm/s-band-steerable"
  }
}

# ── Views ──────────────────────────────────────────────────────

view "mission-overview" {
  description = "Full Apollo 11 trans-lunar architecture overview"
  system      = "apollo-11"

  filter {
    max_level     = 2
    show_messages = true
  }
}

view "rf-communications" {
  description = "Earth-to-space and inter-spacecraft RF communications"
  system      = "apollo-11"

  filter {
    include_tags  = ["rf"]
    show_messages = true
  }
}

view "flight-ops" {
  description = "Launch vehicle integration and spacecraft docking interfaces"
  system      = "apollo-11"

  filter {
    include_tags  = ["launch", "docking"]
    show_messages = false
  }
}
