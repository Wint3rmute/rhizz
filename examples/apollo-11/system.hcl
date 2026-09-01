project {
  name    = "apollo-11"
  version = "1.0.0"
  authors = ["NASA / rhizz-showcase"]
}

# ══════════════════════════════════════════════════════════════════════════════
# 1. Protocols & Interface Definitions
# ══════════════════════════════════════════════════════════════════════════════

protocol "unified-s-band" {
  description = "2.2 GHz Unified S-band Earth-space telemetry, voice, and ranging"
  tags        = ["rf", "telemetry", "deep-space"]
  roles       = ["ground-station", "spacecraft-transceiver"]

  message "downlink-telemetry" {
    description = "Spacecraft state vector, systems health, and cabin telemetry"
    field "mission-elapsed-time" {
      type        = "uint32"
      unit        = "s"
      description = "MET timestamp from AGC master clock"
    }
    field "cabin-pressure" {
      type        = "float32"
      unit        = "psia"
      description = "Cabin atmospheric pressure"
    }
    field "cabin-temp" {
      type        = "float32"
      unit        = "degF"
      description = "Cabin ambient temperature"
    }
    field "state-vector" {
      type        = "bytes"
      description = "Position and velocity ephemeris vectors (R, V)"
    }
  }

  message "uplink-command" {
    description = "Ground command loads, trajectory state updates, and AGC memory writes"
    field "command-word" {
      type        = "uint32"
      description = "Encoded ground command instruction"
    }
    field "clock-sync" {
      type        = "uint32"
      unit        = "ms"
      description = "Ground clock synchronization delta"
    }
    field "nav-vector-update" {
      type        = "bytes"
      description = "State vector correction uplinked from Houston"
    }
  }
}

protocol "vhf-inter-spacecraft" {
  description = "VHF lunar orbit inter-spacecraft voice and ranging link"
  tags        = ["rf", "ranging", "lunar-orbit"]
  roles       = ["csm-transceiver", "lm-transceiver"]

  message "ranging-data" {
    description = "Lunar orbit CSM-to-LM relative distance and range rate"
    field "slant-range" {
      type        = "float32"
      unit        = "nmi"
      description = "Direct slant range between CSM and LM"
    }
    field "range-rate" {
      type        = "float32"
      unit        = "fps"
      description = "Relative velocity along line of sight"
    }
  }
}

protocol "docking-tunnel" {
  description = "CSM-to-LM mechanical docking probe, drogue, and pressurized transfer tunnel"
  tags        = ["mechanical", "docking", "pressurized"]
  roles       = ["active-probe", "passive-drogue"]

  message "tunnel-status" {
    description = "Docking latch status, pressure equalization, and crew passage hatch"
    field "latches-locked" {
      type        = "bool"
      description = "12 capture latches engaged"
    }
    field "differential-pressure" {
      type        = "float32"
      unit        = "psi"
      description = "Delta pressure across CM/LM tunnel hatches"
    }
    field "hatch-open" {
      type        = "bool"
      description = "Hatch removed for intravehicular transfer"
    }
  }
}

protocol "saturn-iu-umbilical" {
  description = "Saturn V Launch Vehicle Digital Computer (LVDC) to CSM guidance handover and abort sensing"
  tags        = ["guidance", "launch", "abort"]
  roles       = ["instrument-unit", "csm-eds"]

  message "launch-vehicle-telemetry" {
    description = "Saturn V propulsion status, vehicle rates, and Emergency Detection System flags"
    field "stage-thrust-ok" {
      type        = "bool"
      description = "All operating stage engines producing rated thrust"
    }
    field "attitude-error" {
      type        = "float32"
      unit        = "deg"
      description = "Flight trajectory deviation error"
    }
    field "angular-rate" {
      type        = "float32"
      unit        = "deg/s"
      description = "Vehicle body rotational rate"
    }
    field "abort-request" {
      type        = "bool"
      description = "Automatic EDS abort initiation signal"
    }
  }
}

protocol "pgncs-digital-bus" {
  description = "Primary Guidance, Navigation, and Control System (PGNCS) internal digital bus"
  tags        = ["avionics", "guidance", "digital"]
  roles       = ["computer", "peripheral"]

  message "dsky-update" {
    description = "DSKY 7-segment electroluminescent display update"
    field "verb" {
      type        = "uint8"
      description = "Active two-digit Verb action code"
    }
    field "noun" {
      type        = "uint8"
      description = "Active two-digit Noun data target code"
    }
    field "register-1" {
      type        = "int32"
      description = "Upper 5-digit sign/numeric display value"
    }
    field "register-2" {
      type        = "int32"
      description = "Middle 5-digit sign/numeric display value"
    }
    field "register-3" {
      type        = "int32"
      description = "Lower 5-digit sign/numeric display value"
    }
  }

  message "dsky-key" {
    description = "DSKY keyboard stroke event"
    field "key-code" {
      type        = "uint8"
      description = "Key matrix scan code (VERB, NOUN, 0-9, ENTR, CLR, PRO)"
    }
  }
}

protocol "imu-gimbal-interface" {
  description = "Inertial Measurement Unit resolver coupling and torque pulse interface"
  tags        = ["avionics", "guidance", "imu"]
  roles       = ["imu-platform", "guidance-computer"]

  message "attitude-angles" {
    description = "3-axis gimbal resolver angle readings (Outer, Inner, Middle)"
    field "outer-gimbal" {
      type        = "float32"
      unit        = "deg"
      description = "Outer gimbal angle"
    }
    field "inner-gimbal" {
      type        = "float32"
      unit        = "deg"
      description = "Inner gimbal angle"
    }
    field "middle-gimbal" {
      type        = "float32"
      unit        = "deg"
      description = "Middle gimbal angle (monitored for gimbal lock)"
    }
    field "delta-v-accum" {
      type        = "float32"
      unit        = "fps"
      description = "Integrated PIPA accelerometer velocity increment"
    }
  }
}

protocol "optical-sighting-bus" {
  description = "CSM Scanning Telescope and Sextant optical shaft and trunnion resolver link"
  tags        = ["avionics", "navigation", "optics"]
  roles       = ["optics-unit", "guidance-computer"]

  message "celestial-sighting" {
    description = "Star/landmark navigation sighting mark"
    field "shaft-angle" {
      type        = "float32"
      unit        = "deg"
      description = "Sextant shaft axis position"
    }
    field "trunnion-angle" {
      type        = "float32"
      unit        = "deg"
      description = "Sextant trunnion axis position"
    }
    field "star-id" {
      type        = "uint8"
      description = "Catalog star number (e.g. 33 Navi, 37 Nunki)"
    }
  }
}

protocol "rcs-thruster-command" {
  description = "Jet Driver Electronics firing pulse signals to RCS solenoids"
  tags        = ["control", "rcs", "actuator"]
  roles       = ["controller", "thruster-quad"]

  message "jet-fire-pulse" {
    description = "Discrete pulse command to reaction control thruster valves"
    field "jet-id" {
      type        = "uint8"
      description = "Target thruster quad jet index (1-16)"
    }
    field "duration" {
      type        = "uint16"
      unit        = "ms"
      description = "Pulse firing duration"
    }
  }
}

protocol "propellant-feed" {
  description = "Hypergolic or cryogenic liquid propellant delivery manifold"
  tags        = ["propulsion", "fluid", "propellant"]
  roles       = ["tank", "engine"]

  message "propellant-flow" {
    description = "Propellant mass flow and pressure status"
    field "pressure" {
      type        = "float32"
      unit        = "psia"
      description = "Manifold fluid delivery pressure"
    }
    field "flow-rate" {
      type        = "float32"
      unit        = "lb/s"
      description = "Mass flow rate through propellant valves"
    }
    field "valve-open" {
      type        = "bool"
      description = "Propellant isolation/injector valve position"
    }
  }
}

protocol "eps-28v-dc" {
  description = "Main 28V DC electrical power distribution buses"
  tags        = ["power", "electrical"]
  roles       = ["power-source", "power-load"]

  message "dc-bus-status" {
    description = "Voltage and current telemetry on main DC bus"
    field "voltage" {
      type        = "float32"
      unit        = "V"
      description = "Direct current bus voltage"
    }
    field "current" {
      type        = "float32"
      unit        = "A"
      description = "Total load current draw"
    }
  }
}

protocol "cryo-reactant-supply" {
  description = "Supercritical cryogenic oxygen and hydrogen supply lines"
  tags        = ["power", "cryo", "fluid"]
  roles       = ["tank", "consumer"]

  message "reactant-delivery" {
    description = "Cryogenic reactant flow to fuel cells and ECLSS"
    field "pressure" {
      type        = "float32"
      unit        = "psia"
      description = "Storage tank pressure"
    }
    field "quantity" {
      type        = "float32"
      unit        = "lb"
      description = "Remaining reactant mass"
    }
  }
}

protocol "radar-altimetry" {
  description = "Landing / rendezvous radar range, range-rate, and altitude beams"
  tags        = ["avionics", "radar", "guidance"]
  roles       = ["radar-sensor", "guidance-computer"]

  message "radar-state" {
    description = "Doppler radar altitude and horizontal velocity returns"
    field "altitude" {
      type        = "float32"
      unit        = "ft"
      description = "True radar altitude above lunar terrain"
    }
    field "forward-velocity" {
      type        = "float32"
      unit        = "fps"
      description = "Forward terrain-relative speed"
    }
    field "descent-rate" {
      type        = "float32"
      unit        = "fps"
      description = "Vertical descent velocity"
    }
    field "data-good" {
      type        = "bool"
      description = "Radar lock and signal quality flag"
    }
  }
}

# ══════════════════════════════════════════════════════════════════════════════
# 2. Atomic Reusable Building Blocks (Leaf Components)
# ══════════════════════════════════════════════════════════════════════════════

# ── Ground & Launch Stack Components ───────────────────────────

component "mission-control-center" {
  description = "Manned Space Flight Network (MSFN) & Houston Mission Control Center (MCC)"
  icon        = "tower-broadcast"
  color       = "accent"
  border      = "dashed"
  tags        = ["ground", "telemetry"]
  leaf        = true

  port "csm-ground-link" {
    description = "Primary 85-foot dish S-band uplink/downlink to CSM"
    protocol    = "unified-s-band"
    role        = "ground-station"
    external    = true
    tags        = ["rf", "telemetry"]
  }

  port "lm-ground-link" {
    description = "Secondary Goldstone/Honeysuckle Creek S-band link to LM"
    protocol    = "unified-s-band"
    role        = "ground-station"
    external    = true
    tags        = ["rf", "telemetry"]
  }
}

component "stage-s-ic" {
  description = "Saturn V First Stage (5x Rocketdyne F-1 engines, 7.5M lbf thrust, LOX/RP-1)"
  icon        = "fire"
  tags        = ["saturn-v", "booster", "propulsion"]
  leaf        = true

  port "staging-link" {
    description = "Pyrotechnic stage separation and interstage telemetry"
    protocol    = "saturn-iu-umbilical"
    role        = "instrument-unit"
    external    = true
    tags        = ["staging"]
  }
}

component "stage-s-ii" {
  description = "Saturn V Second Stage (5x Rocketdyne J-2 engines, 1.15M lbf thrust, LOX/LH2)"
  icon        = "fire"
  tags        = ["saturn-v", "propulsion"]
  leaf        = true

  port "staging-in" {
    description = "S-IC to S-II separation interface"
    protocol    = "saturn-iu-umbilical"
    role        = "csm-eds"
    external    = true
    tags        = ["staging"]
  }

  port "staging-out" {
    description = "S-II to S-IVB separation interface"
    protocol    = "saturn-iu-umbilical"
    role        = "instrument-unit"
    external    = true
    tags        = ["staging"]
  }
}

component "stage-s-ivb" {
  description = "Saturn V Third Stage (1x restartable Rocketdyne J-2 engine for Earth orbit & TLI)"
  icon        = "rocket"
  tags        = ["saturn-v", "propulsion", "tli"]
  leaf        = true

  port "staging-in" {
    description = "S-II to S-IVB separation interface"
    protocol    = "saturn-iu-umbilical"
    role        = "csm-eds"
    external    = true
    tags        = ["staging"]
  }

  port "iu-mount" {
    description = "Structural and electrical mount to Instrument Unit"
    protocol    = "saturn-iu-umbilical"
    role        = "csm-eds"
    external    = true
    tags        = ["guidance"]
  }
}

component "instrument-unit" {
  description = "Saturn V Instrument Unit (IBM LVDC, ST-124-M3 inertial platform, EDS)"
  icon        = "microchip"
  tags        = ["saturn-v", "guidance", "avionics"]
  leaf        = true

  port "s-ivb-control" {
    description = "LVDC guidance steering and engine control to S-IVB"
    protocol    = "saturn-iu-umbilical"
    role        = "instrument-unit"
    external    = true
    tags        = ["guidance"]
  }

  port "csm-umbilical" {
    description = "Emergency Detection System (EDS) abort interface to CSM"
    protocol    = "saturn-iu-umbilical"
    role        = "instrument-unit"
    external    = true
    tags        = ["guidance", "launch"]
  }
}

# ── Command Module (CM-107 'Columbia') Components ──────────────

component "cm-cabin-structure" {
  description = "Crew compartment, astronaut couches, manual hand controllers, and forward hatch"
  icon        = "users"
  font        = "italic"
  tags        = ["csm", "structure", "crew"]
  leaf        = true

  port "docking-probe" {
    description = "Active capture probe mechanism and docking ring"
    protocol    = "docking-tunnel"
    role        = "active-probe"
    external    = true
    tags        = ["mechanical", "docking"]
  }

  port "manual-rotation" {
    description = "Rotational Hand Controller (RHC) input to AGC"
    protocol    = "pgncs-digital-bus"
    role        = "peripheral"
    external    = true
    tags        = ["flight-control"]
  }

  port "power-in" {
    description = "28V DC power distribution from SM fuel cells or entry batteries"
    protocol    = "eps-28v-dc"
    role        = "power-load"
    external    = true
    tags        = ["power"]
  }
}

component "cm-agc" {
  description = "Apollo Guidance Computer (Raytheon Block II, 2.048 MHz, 36K ROM / 2K RAM, Luminary/Colossus)"
  icon        = "microchip"
  font        = "bold"
  tags        = ["csm", "avionics", "pgncs", "compute"]
  leaf        = true

  port "dsky-bus" {
    description = "Digital I/O bus to CM DSKY display and keyboard"
    protocol    = "pgncs-digital-bus"
    role        = "computer"
    external    = true
    tags        = ["avionics", "ui"]
  }

  port "imu-bus" {
    description = "CDU coupling and pulse torquing to CM IMU"
    protocol    = "imu-gimbal-interface"
    role        = "guidance-computer"
    external    = true
    tags        = ["avionics", "guidance"]
  }

  port "optics-bus" {
    description = "Optics sextant/telescope mark input"
    protocol    = "optical-sighting-bus"
    role        = "guidance-computer"
    external    = true
    tags        = ["avionics", "navigation"]
  }

  port "rcs-commands" {
    description = "Jet driver firing pulses to CM/SM RCS thruster quads"
    protocol    = "rcs-thruster-command"
    role        = "controller"
    external    = true
    tags        = ["control", "rcs"]
  }

  port "eds-abort-input" {
    description = "Emergency Detection System abort flag from Saturn V IU"
    protocol    = "saturn-iu-umbilical"
    role        = "csm-eds"
    external    = true
    tags        = ["abort", "launch"]
  }

  port "power-in" {
    description = "Regulated 28V DC power supply input"
    protocol    = "eps-28v-dc"
    role        = "power-load"
    external    = true
    tags        = ["power"]
  }
}

component "cm-dsky" {
  description = "Display and Keyboard unit (Main Panel DSKY with electroluminescent status and 7-segment readouts)"
  icon        = "calculator"
  tags        = ["csm", "avionics", "ui"]
  leaf        = true

  port "agc-interface" {
    description = "Digital interface to Apollo Guidance Computer"
    protocol    = "pgncs-digital-bus"
    role        = "peripheral"
    external    = true
    tags        = ["avionics", "ui"]
  }
}

component "cm-imu" {
  description = "Inertial Measurement Unit (3-gimbal platform with 25 IRIG gyros and 16 PIPA accelerometers)"
  icon        = "compass"
  tags        = ["csm", "avionics", "guidance", "imu"]
  leaf        = true

  port "agc-coupling" {
    description = "Resolver angle feedback and gyro torquing signals to AGC"
    protocol    = "imu-gimbal-interface"
    role        = "imu-platform"
    external    = true
    tags        = ["guidance"]
  }
}

component "cm-optics" {
  description = "Optical Subsystem (28x Sextant & 1x Scanning Telescope for celestial star fixes)"
  icon        = "binoculars"
  tags        = ["csm", "avionics", "navigation", "optics"]
  leaf        = true

  port "agc-sighting" {
    description = "Shaft and trunnion angles to AGC on navigational mark"
    protocol    = "optical-sighting-bus"
    role        = "optics-unit"
    external    = true
    tags        = ["navigation"]
  }
}

component "cm-rcs" {
  description = "Command Module Reaction Control System (12x 93-lbf monomethylhydrazine/N2O4 thrusters for re-entry)"
  icon        = "arrows-to-circle"
  tags        = ["csm", "propulsion", "rcs"]
  leaf        = true

  port "driver-signals" {
    description = "Solenoid valve driver signals from AGC"
    protocol    = "rcs-thruster-command"
    role        = "thruster-quad"
    external    = true
    tags        = ["control", "rcs"]
  }
}

# ── Service Module (SM-107) Components ─────────────────────────

component "sm-sps-propellant-tanks" {
  description = "Service Propulsion System Aerozine-50 fuel and N2O4 oxidizer storage tanks"
  icon        = "gas-pump"
  tags        = ["csm", "sm", "propellant", "tanks"]
  leaf        = true

  port "propellant-out" {
    description = "Pressurized propellant feed to SPS engine"
    protocol    = "propellant-feed"
    role        = "tank"
    external    = true
    tags        = ["propulsion"]
  }
}

component "sm-service-propulsion" {
  description = "Service Propulsion System (Aerojet AJ10-137 engine, 20,500 lbf, LOI / TEI burns)"
  icon        = "fire"
  tags        = ["csm", "sm", "propulsion"]
  leaf        = true

  port "propellant-in" {
    description = "Aerozine-50 and N2O4 hypergolic propellant feed"
    protocol    = "propellant-feed"
    role        = "engine"
    external    = true
    tags        = ["propulsion"]
  }
}

component "sm-rcs-quads" {
  description = "Service Module RCS (4x quads of Marquardt R-4D 100-lbf thrusters for translation & attitude)"
  icon        = "arrows-to-dot"
  tags        = ["csm", "sm", "rcs"]
  leaf        = true

  port "driver-signals" {
    description = "Firing pulses from Command Module AGC"
    protocol    = "rcs-thruster-command"
    role        = "thruster-quad"
    external    = true
    tags        = ["control", "rcs"]
  }
}

component "sm-fuel-cells" {
  description = "3x Bacon-type Pratt & Whitney H2-O2 Fuel Cells (28V DC power + potable drinking water)"
  icon        = "battery-full"
  tags        = ["csm", "sm", "eps", "power"]
  leaf        = true

  port "h2-o2-reactant-in" {
    description = "Supercritical oxygen and hydrogen supply"
    protocol    = "cryo-reactant-supply"
    role        = "consumer"
    external    = true
    tags        = ["cryo", "power"]
  }

  port "power-out" {
    description = "Main 28V DC power bus feed to CM and SM systems"
    protocol    = "eps-28v-dc"
    role        = "power-source"
    external    = true
    tags        = ["power"]
  }
}

component "sm-cryogenic-storage" {
  description = "Cryogenic Gas Storage System (Supercritical liquid O2 tanks and liquid H2 tanks)"
  icon        = "snowflake"
  tags        = ["csm", "sm", "cryo", "tanks"]
  leaf        = true

  port "fuel-cell-supply" {
    description = "Cryogenic hydrogen and oxygen feed lines to fuel cells"
    protocol    = "cryo-reactant-supply"
    role        = "tank"
    external    = true
    tags        = ["cryo", "power"]
  }
}

component "sm-high-gain-antenna" {
  description = "Steerable 4-dish S-band high-gain antenna array for lunar distance telemetry & TV"
  icon        = "satellite-dish"
  tags        = ["csm", "sm", "rf", "comms"]
  leaf        = true

  port "rf-ground-link" {
    description = "Deep Space Network / MSFN ground station link"
    protocol    = "unified-s-band"
    role        = "spacecraft-transceiver"
    external    = true
    tags        = ["rf", "telemetry"]
  }

  port "vhf-transceiver" {
    description = "VHF recovery and Lunar Module ranging transceiver"
    protocol    = "vhf-inter-spacecraft"
    role        = "csm-transceiver"
    external    = true
    tags        = ["rf", "ranging"]
  }
}

# ── Lunar Module Ascent Stage (LM-5 'Eagle') Components ────────

component "lm-cabin" {
  description = "Ascent stage pressurized crew cabin, stand-up astronaut stations, and overhead docking drogue"
  icon        = "user-astronaut"
  font        = "italic"
  tags        = ["lm", "ascent", "crew"]
  leaf        = true

  port "docking-drogue" {
    description = "Passive conical docking drogue and overhead transfer hatch"
    protocol    = "docking-tunnel"
    role        = "passive-drogue"
    external    = true
    tags        = ["mechanical", "docking"]
  }

  port "power-in" {
    description = "28V DC power feed from ascent/descent battery buses"
    protocol    = "eps-28v-dc"
    role        = "power-load"
    external    = true
    tags        = ["power"]
  }
}

component "lm-lgc" {
  description = "Lunar Module Guidance Computer (LGC - Luminary software with landing & rendezvous programs)"
  icon        = "microchip"
  font        = "bold"
  tags        = ["lm", "ascent", "avionics", "guidance", "pgncs"]
  leaf        = true

  port "dsky-bus" {
    description = "Digital I/O to LM DSKY"
    protocol    = "pgncs-digital-bus"
    role        = "computer"
    external    = true
    tags        = ["avionics", "ui"]
  }

  port "imu-bus" {
    description = "Resolver signals to LM primary IMU"
    protocol    = "imu-gimbal-interface"
    role        = "guidance-computer"
    external    = true
    tags        = ["guidance"]
  }

  port "landing-radar-input" {
    description = "Doppler altitude and velocity beam returns from landing radar"
    protocol    = "radar-altimetry"
    role        = "guidance-computer"
    external    = true
    tags        = ["radar", "landing"]
  }

  port "rcs-commands" {
    description = "Firing commands to LM ascent stage RCS thruster quads"
    protocol    = "rcs-thruster-command"
    role        = "controller"
    external    = true
    tags        = ["control", "rcs"]
  }

  port "power-in" {
    description = "28V DC power supply input"
    protocol    = "eps-28v-dc"
    role        = "power-load"
    external    = true
    tags        = ["power"]
  }
}

component "lm-dsky" {
  description = "Lunar Module DSKY display and keyboard unit"
  icon        = "calculator"
  tags        = ["lm", "ascent", "avionics", "ui"]
  leaf        = true

  port "lgc-interface" {
    description = "Digital bus link to LGC"
    protocol    = "pgncs-digital-bus"
    role        = "peripheral"
    external    = true
    tags        = ["avionics", "ui"]
  }
}

component "lm-imu" {
  description = "LM Primary Guidance IMU (3-gimbal inertial platform)"
  icon        = "compass"
  tags        = ["lm", "ascent", "guidance", "imu"]
  leaf        = true

  port "lgc-coupling" {
    description = "Gimbal resolver angle signals to LGC"
    protocol    = "imu-gimbal-interface"
    role        = "imu-platform"
    external    = true
    tags        = ["guidance"]
  }
}

component "lm-aps-propellant-tanks" {
  description = "Ascent stage hypergolic Aerozine-50 and N2O4 propellant storage tanks"
  icon        = "gas-pump"
  tags        = ["lm", "ascent", "propellant", "tanks"]
  leaf        = true

  port "propellant-out" {
    description = "Direct propellant feed to APS engine"
    protocol    = "propellant-feed"
    role        = "tank"
    external    = true
    tags        = ["propulsion"]
  }
}

component "lm-ascent-propulsion" {
  description = "Ascent Propulsion System (APS - Bell Aerosystems 3,500 lbf fixed-thrust hypergolic engine)"
  icon        = "fire"
  tags        = ["lm", "ascent", "propulsion"]
  leaf        = true

  port "propellant-in" {
    description = "Aerozine-50 and N2O4 hypergolic fuel feed"
    protocol    = "propellant-feed"
    role        = "engine"
    external    = true
    tags        = ["propulsion"]
  }
}

component "lm-rcs-quads" {
  description = "LM RCS (4x Marquardt 100-lbf thruster clusters mounted on ascent stage)"
  icon        = "arrows-to-dot"
  tags        = ["lm", "ascent", "rcs"]
  leaf        = true

  port "driver-signals" {
    description = "Firing pulses from LGC jet driver electronics"
    protocol    = "rcs-thruster-command"
    role        = "thruster-quad"
    external    = true
    tags        = ["control", "rcs"]
  }
}

component "lm-comms-subsystem" {
  description = "LM Communications (Steerable S-band high-gain antenna, omni antennas, and VHF ranging)"
  icon        = "satellite-dish"
  tags        = ["lm", "ascent", "rf", "comms"]
  leaf        = true

  port "s-band-ground" {
    description = "Unified S-band link to MSFN ground stations"
    protocol    = "unified-s-band"
    role        = "spacecraft-transceiver"
    external    = true
    tags        = ["rf", "telemetry"]
  }

  port "vhf-ranging" {
    description = "VHF ranging transceiver linking to Command Module"
    protocol    = "vhf-inter-spacecraft"
    role        = "lm-transceiver"
    external    = true
    tags        = ["rf", "ranging"]
  }
}

# ── Lunar Module Descent Stage (LM-5 'Eagle') Components ───────

component "lm-dps-propellant-tanks" {
  description = "Descent stage propellant tanks (4x large cylindrical Aerozine-50 and N2O4 tanks)"
  icon        = "gas-pump"
  tags        = ["lm", "descent", "propellant", "tanks"]
  leaf        = true

  port "propellant-out" {
    description = "Manifold feed to throttleable DPS engine"
    protocol    = "propellant-feed"
    role        = "tank"
    external    = true
    tags        = ["propulsion"]
  }
}

component "lm-descent-propulsion" {
  description = "Descent Propulsion System (DPS - TRW throttleable 1,050 to 9,850 lbf engine for lunar landing)"
  icon        = "fire"
  tags        = ["lm", "descent", "propulsion", "landing"]
  leaf        = true

  port "propellant-in" {
    description = "Hypergolic Aerozine-50 and N2O4 propellant supply"
    protocol    = "propellant-feed"
    role        = "engine"
    external    = true
    tags        = ["propulsion"]
  }
}

component "lm-landing-radar" {
  description = "Ryan 4-beam Doppler Landing Radar (Continuous-wave velocity and radar altimeter)"
  icon        = "radar"
  tags        = ["lm", "descent", "radar", "landing"]
  leaf        = true

  port "radar-returns" {
    description = "Altitude and horizontal velocity beam state to LGC"
    protocol    = "radar-altimetry"
    role        = "radar-sensor"
    external    = true
    tags        = ["radar", "landing"]
  }
}

component "lm-batteries" {
  description = "Silver-Zinc primary batteries (4x descent stage 400 Ah batteries + 2x ascent stage 296 Ah)"
  icon        = "battery-three-quarters"
  tags        = ["lm", "eps", "power"]
  leaf        = true

  port "power-out" {
    description = "Main 28V DC electrical power delivery"
    protocol    = "eps-28v-dc"
    role        = "power-source"
    external    = true
    tags        = ["power"]
  }
}

# ══════════════════════════════════════════════════════════════════════════════
# 3. Intermediate Subsystem Assemblies (Composed with `source`)
# ══════════════════════════════════════════════════════════════════════════════

component "saturn-v-stack" {
  description = "Saturn V Launch Vehicle Stack (S-IC First Stage, S-II Second Stage, S-IVB Third Stage, Instrument Unit)"
  icon        = "rocket"
  color       = "primary"
  tags        = ["saturn-v", "launch-vehicle"]
  leaf        = false

  instance "s-ic" { source = "stage-s-ic" }

  instance "s-ii" { source = "stage-s-ii" }

  instance "s-ivb" { source = "stage-s-ivb" }

  instance "iu" { source = "instrument-unit" }

  connection "s1-to-s2-staging" {
    description = "S-IC to S-II staging command and telemetry link"
    tags        = ["staging"]
    from        = "s-ic/staging-link"
    to          = "s-ii/staging-in"
  }

  connection "s2-to-s3-staging" {
    description = "S-II to S-IVB staging command link"
    tags        = ["staging"]
    from        = "s-ii/staging-out"
    to          = "s-ivb/staging-in"
  }

  connection "iu-to-s-ivb-guidance" {
    description = "LVDC steering commands to S-IVB J-2 gimbal actuators"
    tags        = ["guidance"]
    from        = "iu/s-ivb-control"
    to          = "s-ivb/iu-mount"
  }
}

component "command-module" {
  description = "Apollo Command Module (CM-107 'Columbia') Crew Compartment and PGNCS Avionics"
  icon        = "satellite"
  color       = "info"
  tags        = ["csm", "cm", "spacecraft"]
  leaf        = false

  instance "cabin" { source = "cm-cabin-structure" }

  instance "agc" { source = "cm-agc" }

  instance "dsky" { source = "cm-dsky" }

  instance "imu" { source = "cm-imu" }

  instance "optics" { source = "cm-optics" }

  instance "rcs" { source = "cm-rcs" }

  connection "agc-to-dsky" {
    description = "DSKY display updates and keypad entries"
    tags        = ["avionics", "ui"]
    from        = "agc/dsky-bus"
    to          = "dsky/agc-interface"
  }

  connection "agc-to-imu" {
    description = "IMU resolver angle readouts and gyro torquing"
    tags        = ["guidance", "imu"]
    from        = "imu/agc-coupling"
    to          = "agc/imu-bus"
  }

  connection "agc-to-optics" {
    description = "Sextant and telescope navigational sightings"
    tags        = ["navigation", "optics"]
    from        = "optics/agc-sighting"
    to          = "agc/optics-bus"
  }

  connection "agc-to-rcs" {
    description = "Re-entry attitude control firing pulses"
    tags        = ["control", "rcs"]
    from        = "agc/rcs-commands"
    to          = "rcs/driver-signals"
  }

  connection "rhc-manual-input" {
    description = "Astronaut manual rotational hand controller to AGC"
    tags        = ["flight-control"]
    from        = "agc/dsky-bus"
    to          = "cabin/manual-rotation"
  }

  connection "cabin-power-to-agc" {
    description = "Cabin electrical bus feed to Apollo Guidance Computer"
    tags        = ["power"]
    from        = "cabin/power-in"
    to          = "agc/power-in"
  }
}

component "service-module" {
  description = "Apollo Service Module (SM-107) Propulsion, Fuel Cells, Cryogenics, and High Gain Antenna"
  icon        = "solar-panel"
  color       = "secondary"
  tags        = ["csm", "sm", "spacecraft"]
  leaf        = false

  instance "sps-tanks" { source = "sm-sps-propellant-tanks" }

  instance "sps" { source = "sm-service-propulsion" }

  instance "rcs-quads" { source = "sm-rcs-quads" }

  instance "fuel-cells" { source = "sm-fuel-cells" }

  instance "cryo-tanks" { source = "sm-cryogenic-storage" }

  instance "hga" { source = "sm-high-gain-antenna" }

  connection "cryo-to-fuel-cells" {
    description = "Supercritical H2 and O2 feed to fuel cells"
    tags        = ["cryo", "power"]
    from        = "cryo-tanks/fuel-cell-supply"
    to          = "fuel-cells/h2-o2-reactant-in"
  }

  connection "sps-propellant-feed" {
    description = "Aerozine-50 and N2O4 feed to SPS main engine"
    tags        = ["propulsion"]
    from        = "sps-tanks/propellant-out"
    to          = "sps/propellant-in"
  }
}

component "lunar-module-ascent" {
  description = "Apollo Lunar Module Ascent Stage (Cabin, LGC, DSKY, IMU, APS, and Comms)"
  icon        = "moon"
  color       = "success"
  tags        = ["lm", "ascent"]
  leaf        = false

  instance "cabin" { source = "lm-cabin" }

  instance "lgc" { source = "lm-lgc" }

  instance "dsky" { source = "lm-dsky" }

  instance "imu" { source = "lm-imu" }

  instance "aps-tanks" { source = "lm-aps-propellant-tanks" }

  instance "aps" { source = "lm-ascent-propulsion" }

  instance "rcs" { source = "lm-rcs-quads" }

  instance "comms" { source = "lm-comms-subsystem" }

  connection "lgc-to-dsky" {
    description = "Lunar DSKY readout and keystroke bus"
    tags        = ["avionics", "ui"]
    from        = "lgc/dsky-bus"
    to          = "dsky/lgc-interface"
  }

  connection "lgc-to-imu" {
    description = "Primary IMU resolver feedback and gyro torquing"
    tags        = ["guidance", "imu"]
    from        = "imu/lgc-coupling"
    to          = "lgc/imu-bus"
  }

  connection "lgc-to-rcs" {
    description = "Ascent stage attitude control thruster firings"
    tags        = ["control", "rcs"]
    from        = "lgc/rcs-commands"
    to          = "rcs/driver-signals"
  }

  connection "aps-propellant-feed" {
    description = "Ascent propellant feed to APS engine"
    tags        = ["propulsion"]
    from        = "aps-tanks/propellant-out"
    to          = "aps/propellant-in"
  }

  connection "cabin-power-to-lgc" {
    description = "Cabin power bus distribution to LGC"
    tags        = ["power"]
    from        = "cabin/power-in"
    to          = "lgc/power-in"
  }
}

component "lunar-module-descent" {
  description = "Apollo Lunar Module Descent Stage (Throttleable DPS Engine, Landing Radar, Batteries)"
  icon        = "circle-down"
  color       = "warning"
  tags        = ["lm", "descent"]
  leaf        = false

  instance "dps-tanks" { source = "lm-dps-propellant-tanks" }

  instance "dps" { source = "lm-descent-propulsion" }

  instance "landing-radar" { source = "lm-landing-radar" }

  instance "batteries" { source = "lm-batteries" }

  connection "dps-propellant-feed" {
    description = "Descent propellant tanks manifold supply to DPS engine"
    tags        = ["propulsion", "landing"]
    from        = "dps-tanks/propellant-out"
    to          = "dps/propellant-in"
  }
}

# ══════════════════════════════════════════════════════════════════════════════
# 4. Top-Level System Architecture (`system "apollo-11"`)
# ══════════════════════════════════════════════════════════════════════════════

system "apollo-11" {
  description = "Apollo 11 Mission Stack (AS-506) - Trans-Lunar, Lunar Landing, and Deep Space Network Architecture"
  tags        = ["apollo", "aerospace", "nasa"]
  level       = 0

  instance "saturn-v" { source = "saturn-v-stack" }

  instance "cm" { source = "command-module" }

  instance "sm" { source = "service-module" }

  instance "lm-ascent" { source = "lunar-module-ascent" }

  instance "lm-descent" { source = "lunar-module-descent" }

  instance "mcc" { source = "mission-control-center" }

  # ── Launch Vehicle to CSM Connections ─────────

  connection "launch-vehicle-eds" {
    description = "Saturn V Instrument Unit to Command Module Emergency Detection System"
    tags        = ["launch", "guidance", "abort"]
    from        = "saturn-v/iu/csm-umbilical"
    to          = "cm/agc/eds-abort-input"
  }

  # ── CSM Internal Service Connections ──────────

  connection "sm-fuel-cell-power-to-cm" {
    description = "28V DC main electrical power crossfeed from SM fuel cells to Command Module"
    tags        = ["power"]
    from        = "sm/fuel-cells/power-out"
    to          = "cm/cabin/power-in"
  }

  connection "cm-agc-to-sm-rcs" {
    description = "Command Module AGC jet driver signals to Service Module RCS quads"
    tags        = ["control", "rcs"]
    from        = "cm/agc/rcs-commands"
    to          = "sm/rcs-quads/driver-signals"
  }

  # ── CSM to Lunar Module Inter-Spacecraft Connections ──

  connection "csm-lm-docking-tunnel" {
    description = "Transposition, docking, and pressurized crew transfer tunnel"
    tags        = ["docking", "mechanical"]
    from        = "cm/cabin/docking-probe"
    to          = "lm-ascent/cabin/docking-drogue"
  }

  connection "csm-lm-vhf-ranging" {
    description = "VHF lunar rendezvous ranging and voice link between Columbia and Eagle"
    tags        = ["rf", "ranging"]
    from        = "sm/hga/vhf-transceiver"
    to          = "lm-ascent/comms/vhf-ranging"
  }

  # ── Lunar Module Inter-Stage Connections ──────

  connection "lm-landing-radar-to-lgc" {
    description = "Descent stage landing radar Doppler altitude and velocity feed to LGC"
    tags        = ["radar", "landing", "guidance"]
    from        = "lm-descent/landing-radar/radar-returns"
    to          = "lm-ascent/lgc/landing-radar-input"
  }

  connection "lm-descent-battery-power" {
    description = "Descent stage silver-zinc batteries powering ascent stage cabin systems"
    tags        = ["power"]
    from        = "lm-descent/batteries/power-out"
    to          = "lm-ascent/cabin/power-in"
  }

  # ── Ground Network (MSFN) Communications ──────

  connection "msfn-to-csm-s-band" {
    description = "Unified S-band deep space communications link between MCC and CSM high-gain antenna"
    tags        = ["rf", "telemetry"]
    from        = "mcc/csm-ground-link"
    to          = "sm/hga/rf-ground-link"
  }

  connection "msfn-to-lm-s-band" {
    description = "Unified S-band communications link between MCC and Lunar Module steerable antenna"
    tags        = ["rf", "telemetry"]
    from        = "mcc/lm-ground-link"
    to          = "lm-ascent/comms/s-band-ground"
  }
}

# ══════════════════════════════════════════════════════════════════════════════
# 5. Definable Architectural Views
# ══════════════════════════════════════════════════════════════════════════════

view "mission-overview" {
  description = "Complete Apollo 11 trans-lunar architecture overview"
  system      = "apollo-11"

  filter {
    max_level     = 3
    show_messages = true
  }
}

view "pgncs-guidance-navigation" {
  description = "Primary Guidance, Navigation, and Control System (PGNCS) loops on CM and LM"
  system      = "apollo-11"

  filter {
    include_tags  = ["guidance", "avionics", "imu", "navigation", "ui"]
    show_messages = true
  }
}

view "rf-telemetry-network" {
  description = "Unified S-band Earth ground network and inter-spacecraft VHF ranging"
  system      = "apollo-11"

  filter {
    include_tags  = ["rf", "telemetry", "ranging"]
    show_messages = true
  }
}

view "lunar-landing-stack" {
  description = "Lunar Module descent, landing radar, and ascent guidance interfaces"
  system      = "apollo-11"

  filter {
    include_tags  = ["lm", "landing", "radar", "docking"]
    show_messages = true
  }
}

view "power-and-cryo-distribution" {
  description = "Cryogenic reactant storage, SM fuel cells, and 28V DC power distribution"
  system      = "apollo-11"

  filter {
    include_tags  = ["power", "cryo"]
    show_messages = false
  }
}
