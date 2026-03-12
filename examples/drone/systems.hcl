# Two systems in one project: the drone itself and the ground control station.
# Connections at the top level of each system connect sibling components.
# The "ground-control" system is deliberately less complete — shows
# in-progress modeling that still compiles cleanly (W001/W004 warnings only).

system "quadcopter" {
  description = "Consumer quadcopter drone"
  tags        = ["hardware", "drone"]
  level       = 0

  # ── Components ────────────────────────────

  component "flight-controller" {
    source = "flight-controller"
  }

  component "esc" {
    description = "4-in-1 ESC board"
    tags        = ["electronics", "power", "motor"]
    leaf        = true

    port "motor-in" {
      description = "DShot600 motor control input"
      protocol    = "dshot600"
      role        = "consumer"
      tags        = ["motor", "data"]
    }

    port "power-in" {
      description = "Battery main power input"
      protocol    = "power-dc"
      role        = "consumer"
      tags        = ["power"]
    }

    port "bec-out" {
      description = "5V BEC regulated output"
      protocol    = "power-dc"
      role        = "provider"
      tags        = ["power"]
    }
  }

  component "gps" {
    description = "u-blox M10 GNSS receiver"
    tags        = ["electronics", "sensor", "navigation"]
    leaf        = true

    port "serial" {
      description = "UART data port"
      protocol    = "uart"
      role        = "peer"
      tags        = ["data", "navigation"]
    }
  }

  component "battery" {
    description = "4S 1300mAh LiPo"
    tags        = ["power"]
    leaf        = true

    port "power-out" {
      description = "Main discharge output"
      protocol    = "power-dc"
      role        = "provider"
      tags        = ["power"]
    }
  }

  component "radio-rx" {
    description = "ELRS 868MHz receiver"
    tags        = ["electronics", "rf"]
    leaf        = true

    port "crsf" {
      description = "CRSF serial output"
      protocol    = "crsf"
      role        = "provider"
      tags        = ["rf", "control"]
    }
  }

  component "vtx" {
    description = "5.8GHz video transmitter"
    tags        = ["electronics", "rf", "video"]
    leaf        = true

    port "video-in" {
      description = "Analog video input"
      protocol    = "analog-video"
      role        = "consumer"
      tags        = ["video"]
    }
  }

  component "camera" {
    description = "FPV camera (analog)"
    tags        = ["electronics", "video"]
    leaf        = true

    port "video-out" {
      description = "Analog video output"
      protocol    = "analog-video"
      role        = "provider"
      tags        = ["video"]
    }
  }

  # ── Connections ────────────────────────────

  connection "motor-control" {
    description = "DShot600 motor signals"
    tags        = ["motor", "data"]
    from        = "flight-controller:motor-out"
    to          = "esc:motor-in"
  }

  connection "gps-serial" {
    description = "UART link: FC ↔ GPS"
    tags        = ["data", "navigation"]
    from        = "flight-controller:gps-serial"
    to          = "gps:serial"
  }

  connection "rc-link" {
    description = "CRSF serial: receiver → FC"
    tags        = ["rf", "control"]
    from        = "radio-rx:crsf"
    to          = "flight-controller:rc-in"
  }

  connection "power-main" {
    description = "Battery → ESC main power"
    tags        = ["power"]
    from        = "battery:power-out"
    to          = "esc:power-in"
  }

  connection "power-bec" {
    description = "ESC 5V BEC → flight controller"
    tags        = ["power"]
    from        = "esc:bec-out"
    to          = "flight-controller"
  }

  connection "video-feed" {
    description = "Analog video: camera → VTX"
    tags        = ["video"]
    from        = "camera:video-out"
    to          = "vtx:video-in"
  }
}

# ════════════════════════════════════════════
# Ground control — intentionally incomplete.
# Shows that a system can be a work-in-progress:
# non-leaf components without children trigger W001,
# missing descriptions trigger W004, but no errors.
# ════════════════════════════════════════════

system "ground-control" {
  description = "Pilot ground station"
  tags        = ["hardware", "ground"]
  level       = 0

  component "transmitter" {
    description = "ELRS radio transmitter"
    tags        = ["electronics", "rf"]
    leaf        = true
  }

  component "goggles" {
    description = "FPV goggles with DVR"
    tags        = ["electronics", "video"]
    leaf        = true
  }

  # This component is non-leaf but has no children yet → W001
  component "ground-station-pc" {
    tags = ["compute"]
    leaf = false
    # description intentionally missing → W004
    # children not yet modeled   → W001
  }

  connection "rf-control" {
    description = "868MHz control link: TX → drone"
    tags        = ["rf", "control"]
    from        = "transmitter"
    to          = "ground-station-pc"
  }

  connection "video-downlink" {
    description = "5.8GHz analog video reception"
    tags        = ["video", "rf"]
    from        = "ground-station-pc"
    to          = "goggles"
  }
}
