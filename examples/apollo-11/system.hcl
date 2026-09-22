project {
  name    = "apollo-11"
  version = "1.0.0"
  authors = ["NASA / rhizz-showcase"]
}

protocol "cryo-reactant-supply" {
  full_name = "Supercritical cryogenic oxygen and hydrogen supply lines"
  tags        = ["power", "cryo", "fluid"]
  roles       = ["tank", "consumer"]

  message "reactant-delivery" {
    full_name = "Cryogenic reactant flow to fuel cells and ECLSS"

    field "pressure" {
      type        = "float32"
      full_name = "Storage tank pressure"
      unit        = "psia"
    }

    field "quantity" {
      type        = "float32"
      full_name = "Remaining reactant mass"
      unit        = "lb"
    }
  }
}

protocol "docking-tunnel" {
  full_name = "CSM-to-LM mechanical docking probe, drogue, and pressurized transfer tunnel"
  tags        = ["mechanical", "docking", "pressurized"]
  roles       = ["active-probe", "passive-drogue"]

  message "tunnel-status" {
    full_name = "Docking latch status, pressure equalization, and crew passage hatch"

    field "differential-pressure" {
      type        = "float32"
      full_name = "Delta pressure across CM/LM tunnel hatches"
      unit        = "psi"
    }

    field "hatch-open" {
      type        = "bool"
      full_name = "Hatch removed for intravehicular transfer"
    }

    field "latches-locked" {
      type        = "bool"
      full_name = "12 capture latches engaged"
    }
  }
}

protocol "eps-28v-dc" {
  full_name = "Main 28V DC electrical power distribution buses"
  tags        = ["power", "electrical"]
  roles       = ["power-source", "power-load"]

  message "dc-bus-status" {
    full_name = "Voltage and current telemetry on main DC bus"

    field "current" {
      type        = "float32"
      full_name = "Total load current draw"
      unit        = "A"
    }

    field "voltage" {
      type        = "float32"
      full_name = "Direct current bus voltage"
      unit        = "V"
    }
  }
}

protocol "imu-gimbal-interface" {
  full_name = "Inertial Measurement Unit resolver coupling and torque pulse interface"
  tags        = ["avionics", "guidance", "imu"]
  roles       = ["imu-platform", "guidance-computer"]

  message "attitude-angles" {
    full_name = "3-axis gimbal resolver angle readings (Outer, Inner, Middle)"

    field "delta-v-accum" {
      type        = "float32"
      full_name = "Integrated PIPA accelerometer velocity increment"
      unit        = "fps"
    }

    field "inner-gimbal" {
      type        = "float32"
      full_name = "Inner gimbal angle"
      unit        = "deg"
    }

    field "middle-gimbal" {
      type        = "float32"
      full_name = "Middle gimbal angle (monitored for gimbal lock)"
      unit        = "deg"
    }

    field "outer-gimbal" {
      type        = "float32"
      full_name = "Outer gimbal angle"
      unit        = "deg"
    }
  }
}

protocol "optical-sighting-bus" {
  full_name = "CSM Scanning Telescope and Sextant optical shaft and trunnion resolver link"
  tags        = ["avionics", "navigation", "optics"]
  roles       = ["optics-unit", "guidance-computer"]

  message "celestial-sighting" {
    full_name = "Star/landmark navigation sighting mark"

    field "shaft-angle" {
      type        = "float32"
      full_name = "Sextant shaft axis position"
      unit        = "deg"
    }

    field "star-id" {
      type        = "uint8"
      full_name = "Catalog star number (e.g. 33 Navi, 37 Nunki)"
    }

    field "trunnion-angle" {
      type        = "float32"
      full_name = "Sextant trunnion axis position"
      unit        = "deg"
    }
  }
}

protocol "pgncs-digital-bus" {
  full_name = "Primary Guidance, Navigation, and Control System (PGNCS) internal digital bus"
  tags        = ["avionics", "guidance", "digital"]
  roles       = ["computer", "peripheral"]

  message "dsky-key" {
    full_name = "DSKY keyboard stroke event"

    field "key-code" {
      type        = "uint8"
      full_name = "Key matrix scan code (VERB, NOUN, 0-9, ENTR, CLR, PRO)"
    }
  }

  message "dsky-update" {
    full_name = "DSKY 7-segment electroluminescent display update"

    field "noun" {
      type        = "uint8"
      full_name = "Active two-digit Noun data target code"
    }

    field "register-1" {
      type        = "int32"
      full_name = "Upper 5-digit sign/numeric display value"
    }

    field "register-2" {
      type        = "int32"
      full_name = "Middle 5-digit sign/numeric display value"
    }

    field "register-3" {
      type        = "int32"
      full_name = "Lower 5-digit sign/numeric display value"
    }

    field "verb" {
      type        = "uint8"
      full_name = "Active two-digit Verb action code"
    }
  }
}

protocol "propellant-feed" {
  full_name = "Hypergolic or cryogenic liquid propellant delivery manifold"
  tags        = ["propulsion", "fluid", "propellant"]
  roles       = ["tank", "engine"]

  message "propellant-flow" {
    full_name = "Propellant mass flow and pressure status"

    field "flow-rate" {
      type        = "float32"
      full_name = "Mass flow rate through propellant valves"
      unit        = "lb/s"
    }

    field "pressure" {
      type        = "float32"
      full_name = "Manifold fluid delivery pressure"
      unit        = "psia"
    }

    field "valve-open" {
      type        = "bool"
      full_name = "Propellant isolation/injector valve position"
    }
  }
}

protocol "radar-altimetry" {
  full_name = "Landing / rendezvous radar range, range-rate, and altitude beams"
  tags        = ["avionics", "radar", "guidance"]
  roles       = ["radar-sensor", "guidance-computer"]

  message "radar-state" {
    full_name = "Doppler radar altitude and horizontal velocity returns"

    field "altitude" {
      type        = "float32"
      full_name = "True radar altitude above lunar terrain"
      unit        = "ft"
    }

    field "data-good" {
      type        = "bool"
      full_name = "Radar lock and signal quality flag"
    }

    field "descent-rate" {
      type        = "float32"
      full_name = "Vertical descent velocity"
      unit        = "fps"
    }

    field "forward-velocity" {
      type        = "float32"
      full_name = "Forward terrain-relative speed"
      unit        = "fps"
    }
  }
}

protocol "rcs-thruster-command" {
  full_name = "Jet Driver Electronics firing pulse signals to RCS solenoids"
  tags        = ["control", "rcs", "actuator"]
  roles       = ["controller", "thruster-quad"]

  message "jet-fire-pulse" {
    full_name = "Discrete pulse command to reaction control thruster valves"

    field "duration" {
      type        = "uint16"
      full_name = "Pulse firing duration"
      unit        = "ms"
    }

    field "jet-id" {
      type        = "uint8"
      full_name = "Target thruster quad jet index (1-16)"
    }
  }
}

protocol "saturn-iu-umbilical" {
  full_name = "Saturn V Launch Vehicle Digital Computer (LVDC) to CSM guidance handover and abort sensing"
  tags        = ["guidance", "launch", "abort"]
  roles       = ["instrument-unit", "csm-eds"]

  message "launch-vehicle-telemetry" {
    full_name = "Saturn V propulsion status, vehicle rates, and Emergency Detection System flags"

    field "abort-request" {
      type        = "bool"
      full_name = "Automatic EDS abort initiation signal"
    }

    field "angular-rate" {
      type        = "float32"
      full_name = "Vehicle body rotational rate"
      unit        = "deg/s"
    }

    field "attitude-error" {
      type        = "float32"
      full_name = "Flight trajectory deviation error"
      unit        = "deg"
    }

    field "stage-thrust-ok" {
      type        = "bool"
      full_name = "All operating stage engines producing rated thrust"
    }
  }
}

protocol "unified-s-band" {
  full_name = "2.2 GHz Unified S-band Earth-space telemetry, voice, and ranging"
  tags        = ["rf", "telemetry", "deep-space"]
  roles       = ["ground-station", "spacecraft-transceiver"]

  message "downlink-telemetry" {
    full_name = "Spacecraft state vector, systems health, and cabin telemetry"

    field "cabin-pressure" {
      type        = "float32"
      full_name = "Cabin atmospheric pressure"
      unit        = "psia"
    }

    field "cabin-temp" {
      type        = "float32"
      full_name = "Cabin ambient temperature"
      unit        = "degF"
    }

    field "mission-elapsed-time" {
      type        = "uint32"
      full_name = "MET timestamp from AGC master clock"
      unit        = "s"
    }

    field "state-vector" {
      type        = "bytes"
      full_name = "Position and velocity ephemeris vectors (R, V)"
    }
  }

  message "uplink-command" {
    full_name = "Ground command loads, trajectory state updates, and AGC memory writes"

    field "clock-sync" {
      type        = "uint32"
      full_name = "Ground clock synchronization delta"
      unit        = "ms"
    }

    field "command-word" {
      type        = "uint32"
      full_name = "Encoded ground command instruction"
    }

    field "nav-vector-update" {
      type        = "bytes"
      full_name = "State vector correction uplinked from Houston"
    }
  }
}

protocol "vhf-inter-spacecraft" {
  full_name = "VHF lunar orbit inter-spacecraft voice and ranging link"
  tags        = ["rf", "ranging", "lunar-orbit"]
  roles       = ["csm-transceiver", "lm-transceiver"]

  message "ranging-data" {
    full_name = "Lunar orbit CSM-to-LM relative distance and range rate"

    field "range-rate" {
      type        = "float32"
      full_name = "Relative velocity along line of sight"
      unit        = "fps"
    }

    field "slant-range" {
      type        = "float32"
      full_name = "Direct slant range between CSM and LM"
      unit        = "nmi"
    }
  }
}

component "cm-agc" {
  full_name = "Apollo Guidance Computer (Raytheon Block II, 2.048 MHz, 36K ROM / 2K RAM, Luminary/Colossus)"
  icon        = "microchip"
  font        = "bold"
  tags        = ["csm", "avionics", "pgncs", "compute"]
  leaf        = true

  port "dsky-bus" {
    full_name = "Digital I/O bus to CM DSKY display and keyboard"
    protocol    = "pgncs-digital-bus"
    role        = "computer"
    tags        = ["avionics", "ui"]
    external    = true
  }

  port "eds-abort-input" {
    full_name = "Emergency Detection System abort flag from Saturn V IU"
    protocol    = "saturn-iu-umbilical"
    role        = "csm-eds"
    tags        = ["abort", "launch"]
    external    = true
  }

  port "imu-bus" {
    full_name = "CDU coupling and pulse torquing to CM IMU"
    protocol    = "imu-gimbal-interface"
    role        = "guidance-computer"
    tags        = ["avionics", "guidance"]
    external    = true
  }

  port "optics-bus" {
    full_name = "Optics sextant/telescope mark input"
    protocol    = "optical-sighting-bus"
    role        = "guidance-computer"
    tags        = ["avionics", "navigation"]
    external    = true
  }

  port "power-in" {
    full_name = "Regulated 28V DC power supply input"
    protocol    = "eps-28v-dc"
    role        = "power-load"
    tags        = ["power"]
    external    = true
  }

  port "rcs-commands" {
    full_name = "Jet driver firing pulses to CM/SM RCS thruster quads"
    protocol    = "rcs-thruster-command"
    role        = "controller"
    tags        = ["control", "rcs"]
    external    = true
  }
}

component "cm-cabin-structure" {
  full_name = "Crew compartment, astronaut couches, manual hand controllers, and forward hatch"
  icon        = "users"
  font        = "italic"
  tags        = ["csm", "structure", "crew"]
  leaf        = true

  port "docking-probe" {
    full_name = "Active capture probe mechanism and docking ring"
    protocol    = "docking-tunnel"
    role        = "active-probe"
    tags        = ["mechanical", "docking"]
    external    = true
  }

  port "manual-rotation" {
    full_name = "Rotational Hand Controller (RHC) input to AGC"
    protocol    = "pgncs-digital-bus"
    role        = "peripheral"
    tags        = ["flight-control"]
    external    = true
  }

  port "power-in" {
    full_name = "28V DC power distribution from SM fuel cells or entry batteries"
    protocol    = "eps-28v-dc"
    role        = "power-load"
    tags        = ["power"]
    external    = true
  }
}

component "cm-dsky" {
  full_name = "Display and Keyboard unit (Main Panel DSKY with electroluminescent status and 7-segment readouts)"
  icon        = "calculator"
  tags        = ["csm", "avionics", "ui"]
  leaf        = true

  port "agc-interface" {
    full_name = "Digital interface to Apollo Guidance Computer"
    protocol    = "pgncs-digital-bus"
    role        = "peripheral"
    tags        = ["avionics", "ui"]
    external    = true
  }
}

component "cm-imu" {
  full_name = "Inertial Measurement Unit (3-gimbal platform with 25 IRIG gyros and 16 PIPA accelerometers)"
  icon        = "compass"
  tags        = ["csm", "avionics", "guidance", "imu"]
  leaf        = true

  port "agc-coupling" {
    full_name = "Resolver angle feedback and gyro torquing signals to AGC"
    protocol    = "imu-gimbal-interface"
    role        = "imu-platform"
    tags        = ["guidance"]
    external    = true
  }
}

component "cm-optics" {
  full_name = "Optical Subsystem (28x Sextant & 1x Scanning Telescope for celestial star fixes)"
  icon        = "binoculars"
  tags        = ["csm", "avionics", "navigation", "optics"]
  leaf        = true

  port "agc-sighting" {
    full_name = "Shaft and trunnion angles to AGC on navigational mark"
    protocol    = "optical-sighting-bus"
    role        = "optics-unit"
    tags        = ["navigation"]
    external    = true
  }
}

component "cm-rcs" {
  full_name = "Command Module Reaction Control System (12x 93-lbf monomethylhydrazine/N2O4 thrusters for re-entry)"
  icon        = "arrows-to-circle"
  tags        = ["csm", "propulsion", "rcs"]
  leaf        = true

  port "driver-signals" {
    full_name = "Solenoid valve driver signals from AGC"
    protocol    = "rcs-thruster-command"
    role        = "thruster-quad"
    tags        = ["control", "rcs"]
    external    = true
  }
}

component "command-module" {
  full_name = "Apollo Command Module (CM-107 'Columbia') Crew Compartment and PGNCS Avionics"
  icon        = "satellite"
  color       = "info"
  tags        = ["csm", "cm", "spacecraft"]

  instance "agc" { source = "cm-agc" }

  instance "cabin" { source = "cm-cabin-structure" }

  instance "dsky" { source = "cm-dsky" }

  instance "imu" { source = "cm-imu" }

  instance "optics" { source = "cm-optics" }

  instance "rcs" { source = "cm-rcs" }

  connection "agc-to-dsky" {
    full_name  = "DSKY display updates and keypad entries"
    tags         = ["avionics", "ui"]
    from         = "agc/dsky-bus"
    to           = "dsky/agc-interface"
  }

  connection "agc-to-imu" {
    full_name  = "IMU resolver angle readouts and gyro torquing"
    tags         = ["guidance", "imu"]
    from         = "imu/agc-coupling"
    to           = "agc/imu-bus"
  }

  connection "agc-to-optics" {
    full_name  = "Sextant and telescope navigational sightings"
    tags         = ["navigation", "optics"]
    from         = "optics/agc-sighting"
    to           = "agc/optics-bus"
  }

  connection "agc-to-rcs" {
    full_name  = "Re-entry attitude control firing pulses"
    tags         = ["control", "rcs"]
    from         = "agc/rcs-commands"
    to           = "rcs/driver-signals"
  }

  connection "cabin-power-to-agc" {
    full_name  = "Cabin electrical bus feed to Apollo Guidance Computer"
    tags         = ["power"]
    from         = "cabin/power-in"
    to           = "agc/power-in"
  }

  connection "rhc-manual-input" {
    full_name  = "Astronaut manual rotational hand controller to AGC"
    tags         = ["flight-control"]
    from         = "agc/dsky-bus"
    to           = "cabin/manual-rotation"
  }
}

component "instrument-unit" {
  full_name = "Saturn V Instrument Unit (IBM LVDC, ST-124-M3 inertial platform, EDS)"
  icon        = "microchip"
  tags        = ["saturn-v", "guidance", "avionics"]
  leaf        = true

  port "csm-umbilical" {
    full_name = "Emergency Detection System (EDS) abort interface to CSM"
    protocol    = "saturn-iu-umbilical"
    role        = "instrument-unit"
    tags        = ["guidance", "launch"]
    external    = true
  }

  port "s-ivb-control" {
    full_name = "LVDC guidance steering and engine control to S-IVB"
    protocol    = "saturn-iu-umbilical"
    role        = "instrument-unit"
    tags        = ["guidance"]
    external    = true
  }
}

component "lm-aps-propellant-tanks" {
  full_name = "Ascent stage hypergolic Aerozine-50 and N2O4 propellant storage tanks"
  icon        = "gas-pump"
  tags        = ["lm", "ascent", "propellant", "tanks"]
  leaf        = true

  port "propellant-out" {
    full_name = "Direct propellant feed to APS engine"
    protocol    = "propellant-feed"
    role        = "tank"
    tags        = ["propulsion"]
    external    = true
  }
}

component "lm-ascent-propulsion" {
  full_name = "Ascent Propulsion System (APS - Bell Aerosystems 3,500 lbf fixed-thrust hypergolic engine)"
  icon        = "fire"
  tags        = ["lm", "ascent", "propulsion"]
  leaf        = true

  port "propellant-in" {
    full_name = "Aerozine-50 and N2O4 hypergolic fuel feed"
    protocol    = "propellant-feed"
    role        = "engine"
    tags        = ["propulsion"]
    external    = true
  }
}

component "lm-batteries" {
  full_name = "Silver-Zinc primary batteries (4x descent stage 400 Ah batteries + 2x ascent stage 296 Ah)"
  icon        = "battery-three-quarters"
  tags        = ["lm", "eps", "power"]
  leaf        = true

  port "power-out" {
    full_name = "Main 28V DC electrical power delivery"
    protocol    = "eps-28v-dc"
    role        = "power-source"
    tags        = ["power"]
    external    = true
  }
}

component "lm-cabin" {
  full_name = "Ascent stage pressurized crew cabin, stand-up astronaut stations, and overhead docking drogue"
  icon        = "user-astronaut"
  font        = "italic"
  tags        = ["lm", "ascent", "crew"]
  leaf        = true

  port "docking-drogue" {
    full_name = "Passive conical docking drogue and overhead transfer hatch"
    protocol    = "docking-tunnel"
    role        = "passive-drogue"
    tags        = ["mechanical", "docking"]
    external    = true
  }

  port "power-in" {
    full_name = "28V DC power feed from ascent/descent battery buses"
    protocol    = "eps-28v-dc"
    role        = "power-load"
    tags        = ["power"]
    external    = true
  }
}

component "lm-comms-subsystem" {
  full_name = "LM Communications (Steerable S-band high-gain antenna, omni antennas, and VHF ranging)"
  icon        = "satellite-dish"
  tags        = ["lm", "ascent", "rf", "comms"]
  leaf        = true

  port "s-band-ground" {
    full_name = "Unified S-band link to MSFN ground stations"
    protocol    = "unified-s-band"
    role        = "spacecraft-transceiver"
    tags        = ["rf", "telemetry"]
    external    = true
  }

  port "vhf-ranging" {
    full_name = "VHF ranging transceiver linking to Command Module"
    protocol    = "vhf-inter-spacecraft"
    role        = "lm-transceiver"
    tags        = ["rf", "ranging"]
    external    = true
  }
}

component "lm-descent-propulsion" {
  full_name = "Descent Propulsion System (DPS - TRW throttleable 1,050 to 9,850 lbf engine for lunar landing)"
  icon        = "fire"
  tags        = ["lm", "descent", "propulsion", "landing"]
  leaf        = true

  port "propellant-in" {
    full_name = "Hypergolic Aerozine-50 and N2O4 propellant supply"
    protocol    = "propellant-feed"
    role        = "engine"
    tags        = ["propulsion"]
    external    = true
  }
}

component "lm-dps-propellant-tanks" {
  full_name = "Descent stage propellant tanks (4x large cylindrical Aerozine-50 and N2O4 tanks)"
  icon        = "gas-pump"
  tags        = ["lm", "descent", "propellant", "tanks"]
  leaf        = true

  port "propellant-out" {
    full_name = "Manifold feed to throttleable DPS engine"
    protocol    = "propellant-feed"
    role        = "tank"
    tags        = ["propulsion"]
    external    = true
  }
}

component "lm-dsky" {
  full_name = "Lunar Module DSKY display and keyboard unit"
  icon        = "calculator"
  tags        = ["lm", "ascent", "avionics", "ui"]
  leaf        = true

  port "lgc-interface" {
    full_name = "Digital bus link to LGC"
    protocol    = "pgncs-digital-bus"
    role        = "peripheral"
    tags        = ["avionics", "ui"]
    external    = true
  }
}

component "lm-imu" {
  full_name = "LM Primary Guidance IMU (3-gimbal inertial platform)"
  icon        = "compass"
  tags        = ["lm", "ascent", "guidance", "imu"]
  leaf        = true

  port "lgc-coupling" {
    full_name = "Gimbal resolver angle signals to LGC"
    protocol    = "imu-gimbal-interface"
    role        = "imu-platform"
    tags        = ["guidance"]
    external    = true
  }
}

component "lm-landing-radar" {
  full_name = "Ryan 4-beam Doppler Landing Radar (Continuous-wave velocity and radar altimeter)"
  icon        = "radar"
  tags        = ["lm", "descent", "radar", "landing"]
  leaf        = true

  port "radar-returns" {
    full_name = "Altitude and horizontal velocity beam state to LGC"
    protocol    = "radar-altimetry"
    role        = "radar-sensor"
    tags        = ["radar", "landing"]
    external    = true
  }
}

component "lm-lgc" {
  full_name = "Lunar Module Guidance Computer (LGC - Luminary software with landing & rendezvous programs)"
  icon        = "microchip"
  font        = "bold"
  tags        = ["lm", "ascent", "avionics", "guidance", "pgncs"]
  leaf        = true

  port "dsky-bus" {
    full_name = "Digital I/O to LM DSKY"
    protocol    = "pgncs-digital-bus"
    role        = "computer"
    tags        = ["avionics", "ui"]
    external    = true
  }

  port "imu-bus" {
    full_name = "Resolver signals to LM primary IMU"
    protocol    = "imu-gimbal-interface"
    role        = "guidance-computer"
    tags        = ["guidance"]
    external    = true
  }

  port "landing-radar-input" {
    full_name = "Doppler altitude and velocity beam returns from landing radar"
    protocol    = "radar-altimetry"
    role        = "guidance-computer"
    tags        = ["radar", "landing"]
    external    = true
  }

  port "power-in" {
    full_name = "28V DC power supply input"
    protocol    = "eps-28v-dc"
    role        = "power-load"
    tags        = ["power"]
    external    = true
  }

  port "rcs-commands" {
    full_name = "Firing commands to LM ascent stage RCS thruster quads"
    protocol    = "rcs-thruster-command"
    role        = "controller"
    tags        = ["control", "rcs"]
    external    = true
  }
}

component "lm-rcs-quads" {
  full_name = "LM RCS (4x Marquardt 100-lbf thruster clusters mounted on ascent stage)"
  icon        = "arrows-to-dot"
  tags        = ["lm", "ascent", "rcs"]
  leaf        = true

  port "driver-signals" {
    full_name = "Firing pulses from LGC jet driver electronics"
    protocol    = "rcs-thruster-command"
    role        = "thruster-quad"
    tags        = ["control", "rcs"]
    external    = true
  }
}

component "lunar-module-ascent" {
  full_name = "Apollo Lunar Module Ascent Stage (Cabin, LGC, DSKY, IMU, APS, and Comms)"
  icon        = "moon"
  color       = "success"
  tags        = ["lm", "ascent"]

  instance "aps" { source = "lm-ascent-propulsion" }

  instance "aps-tanks" { source = "lm-aps-propellant-tanks" }

  instance "cabin" { source = "lm-cabin" }

  instance "comms" { source = "lm-comms-subsystem" }

  instance "dsky" { source = "lm-dsky" }

  instance "imu" { source = "lm-imu" }

  instance "lgc" { source = "lm-lgc" }

  instance "rcs" { source = "lm-rcs-quads" }

  connection "aps-propellant-feed" {
    full_name  = "Ascent propellant feed to APS engine"
    tags         = ["propulsion"]
    from         = "aps-tanks/propellant-out"
    to           = "aps/propellant-in"
  }

  connection "cabin-power-to-lgc" {
    full_name  = "Cabin power bus distribution to LGC"
    tags         = ["power"]
    from         = "cabin/power-in"
    to           = "lgc/power-in"
  }

  connection "lgc-to-dsky" {
    full_name  = "Lunar DSKY readout and keystroke bus"
    tags         = ["avionics", "ui"]
    from         = "lgc/dsky-bus"
    to           = "dsky/lgc-interface"
  }

  connection "lgc-to-imu" {
    full_name  = "Primary IMU resolver feedback and gyro torquing"
    tags         = ["guidance", "imu"]
    from         = "imu/lgc-coupling"
    to           = "lgc/imu-bus"
  }

  connection "lgc-to-rcs" {
    full_name  = "Ascent stage attitude control thruster firings"
    tags         = ["control", "rcs"]
    from         = "lgc/rcs-commands"
    to           = "rcs/driver-signals"
  }
}

component "lunar-module-descent" {
  full_name = "Apollo Lunar Module Descent Stage (Throttleable DPS Engine, Landing Radar, Batteries)"
  icon        = "circle-down"
  color       = "warning"
  tags        = ["lm", "descent"]

  instance "batteries" { source = "lm-batteries" }

  instance "dps" { source = "lm-descent-propulsion" }

  instance "dps-tanks" { source = "lm-dps-propellant-tanks" }

  instance "landing-radar" { source = "lm-landing-radar" }

  connection "dps-propellant-feed" {
    full_name  = "Descent propellant tanks manifold supply to DPS engine"
    tags         = ["propulsion", "landing"]
    from         = "dps-tanks/propellant-out"
    to           = "dps/propellant-in"
  }
}

component "mission-control-center" {
  full_name = "Manned Space Flight Network (MSFN) & Houston Mission Control Center (MCC)"
  icon        = "tower-broadcast"
  color       = "accent"
  border      = "dashed"
  tags        = ["ground", "telemetry"]
  leaf        = true

  port "csm-ground-link" {
    full_name = "Primary 85-foot dish S-band uplink/downlink to CSM"
    protocol    = "unified-s-band"
    role        = "ground-station"
    tags        = ["rf", "telemetry"]
    external    = true
  }

  port "lm-ground-link" {
    full_name = "Secondary Goldstone/Honeysuckle Creek S-band link to LM"
    protocol    = "unified-s-band"
    role        = "ground-station"
    tags        = ["rf", "telemetry"]
    external    = true
  }
}

component "saturn-v-stack" {
  full_name = "Saturn V Launch Vehicle Stack (S-IC First Stage, S-II Second Stage, S-IVB Third Stage, Instrument Unit)"
  icon        = "rocket"
  color       = "primary"
  tags        = ["saturn-v", "launch-vehicle"]

  instance "iu" { source = "instrument-unit" }

  instance "s-ic" { source = "stage-s-ic" }

  instance "s-ii" { source = "stage-s-ii" }

  instance "s-ivb" { source = "stage-s-ivb" }

  connection "iu-to-s-ivb-guidance" {
    full_name  = "LVDC steering commands to S-IVB J-2 gimbal actuators"
    tags         = ["guidance"]
    from         = "iu/s-ivb-control"
    to           = "s-ivb/iu-mount"
  }

  connection "s1-to-s2-staging" {
    full_name  = "S-IC to S-II staging command and telemetry link"
    tags         = ["staging"]
    from         = "s-ic/staging-link"
    to           = "s-ii/staging-in"
  }

  connection "s2-to-s3-staging" {
    full_name  = "S-II to S-IVB staging command link"
    tags         = ["staging"]
    from         = "s-ii/staging-out"
    to           = "s-ivb/staging-in"
  }
}

component "service-module" {
  full_name = "Apollo Service Module (SM-107) Propulsion, Fuel Cells, Cryogenics, and High Gain Antenna"
  icon        = "solar-panel"
  color       = "secondary"
  tags        = ["csm", "sm", "spacecraft"]

  instance "cryo-tanks" { source = "sm-cryogenic-storage" }

  instance "fuel-cells" { source = "sm-fuel-cells" }

  instance "hga" { source = "sm-high-gain-antenna" }

  instance "rcs-quads" { source = "sm-rcs-quads" }

  instance "sps" { source = "sm-service-propulsion" }

  instance "sps-tanks" { source = "sm-sps-propellant-tanks" }

  connection "cryo-to-fuel-cells" {
    full_name  = "Supercritical H2 and O2 feed to fuel cells"
    tags         = ["cryo", "power"]
    from         = "cryo-tanks/fuel-cell-supply"
    to           = "fuel-cells/h2-o2-reactant-in"
  }

  connection "sps-propellant-feed" {
    full_name  = "Aerozine-50 and N2O4 feed to SPS main engine"
    tags         = ["propulsion"]
    from         = "sps-tanks/propellant-out"
    to           = "sps/propellant-in"
  }
}

component "sm-cryogenic-storage" {
  full_name = "Cryogenic Gas Storage System (Supercritical liquid O2 tanks and liquid H2 tanks)"
  icon        = "snowflake"
  tags        = ["csm", "sm", "cryo", "tanks"]
  leaf        = true

  port "fuel-cell-supply" {
    full_name = "Cryogenic hydrogen and oxygen feed lines to fuel cells"
    protocol    = "cryo-reactant-supply"
    role        = "tank"
    tags        = ["cryo", "power"]
    external    = true
  }
}

component "sm-fuel-cells" {
  full_name = "3x Bacon-type Pratt & Whitney H2-O2 Fuel Cells (28V DC power + potable drinking water)"
  icon        = "battery-full"
  tags        = ["csm", "sm", "eps", "power"]
  leaf        = true

  port "h2-o2-reactant-in" {
    full_name = "Supercritical oxygen and hydrogen supply"
    protocol    = "cryo-reactant-supply"
    role        = "consumer"
    tags        = ["cryo", "power"]
    external    = true
  }

  port "power-out" {
    full_name = "Main 28V DC power bus feed to CM and SM systems"
    protocol    = "eps-28v-dc"
    role        = "power-source"
    tags        = ["power"]
    external    = true
  }
}

component "sm-high-gain-antenna" {
  full_name = "Steerable 4-dish S-band high-gain antenna array for lunar distance telemetry & TV"
  icon        = "satellite-dish"
  tags        = ["csm", "sm", "rf", "comms"]
  leaf        = true

  port "rf-ground-link" {
    full_name = "Deep Space Network / MSFN ground station link"
    protocol    = "unified-s-band"
    role        = "spacecraft-transceiver"
    tags        = ["rf", "telemetry"]
    external    = true
  }

  port "vhf-transceiver" {
    full_name = "VHF recovery and Lunar Module ranging transceiver"
    protocol    = "vhf-inter-spacecraft"
    role        = "csm-transceiver"
    tags        = ["rf", "ranging"]
    external    = true
  }
}

component "sm-rcs-quads" {
  full_name = "Service Module RCS (4x quads of Marquardt R-4D 100-lbf thrusters for translation & attitude)"
  icon        = "arrows-to-dot"
  tags        = ["csm", "sm", "rcs"]
  leaf        = true

  port "driver-signals" {
    full_name = "Firing pulses from Command Module AGC"
    protocol    = "rcs-thruster-command"
    role        = "thruster-quad"
    tags        = ["control", "rcs"]
    external    = true
  }
}

component "sm-service-propulsion" {
  full_name = "Service Propulsion System (Aerojet AJ10-137 engine, 20,500 lbf, LOI / TEI burns)"
  icon        = "fire"
  tags        = ["csm", "sm", "propulsion"]
  leaf        = true

  port "propellant-in" {
    full_name = "Aerozine-50 and N2O4 hypergolic propellant feed"
    protocol    = "propellant-feed"
    role        = "engine"
    tags        = ["propulsion"]
    external    = true
  }
}

component "sm-sps-propellant-tanks" {
  full_name = "Service Propulsion System Aerozine-50 fuel and N2O4 oxidizer storage tanks"
  icon        = "gas-pump"
  tags        = ["csm", "sm", "propellant", "tanks"]
  leaf        = true

  port "propellant-out" {
    full_name = "Pressurized propellant feed to SPS engine"
    protocol    = "propellant-feed"
    role        = "tank"
    tags        = ["propulsion"]
    external    = true
  }
}

component "stage-s-ic" {
  full_name = "Saturn V First Stage (5x Rocketdyne F-1 engines, 7.5M lbf thrust, LOX/RP-1)"
  icon        = "fire"
  tags        = ["saturn-v", "booster", "propulsion"]
  leaf        = true

  port "staging-link" {
    full_name = "Pyrotechnic stage separation and interstage telemetry"
    protocol    = "saturn-iu-umbilical"
    role        = "instrument-unit"
    tags        = ["staging"]
    external    = true
  }
}

component "stage-s-ii" {
  full_name = "Saturn V Second Stage (5x Rocketdyne J-2 engines, 1.15M lbf thrust, LOX/LH2)"
  icon        = "fire"
  tags        = ["saturn-v", "propulsion"]
  leaf        = true

  port "staging-in" {
    full_name = "S-IC to S-II separation interface"
    protocol    = "saturn-iu-umbilical"
    role        = "csm-eds"
    tags        = ["staging"]
    external    = true
  }

  port "staging-out" {
    full_name = "S-II to S-IVB separation interface"
    protocol    = "saturn-iu-umbilical"
    role        = "instrument-unit"
    tags        = ["staging"]
    external    = true
  }
}

component "stage-s-ivb" {
  full_name = "Saturn V Third Stage (1x restartable Rocketdyne J-2 engine for Earth orbit & TLI)"
  icon        = "rocket"
  tags        = ["saturn-v", "propulsion", "tli"]
  leaf        = true

  port "iu-mount" {
    full_name = "Structural and electrical mount to Instrument Unit"
    protocol    = "saturn-iu-umbilical"
    role        = "csm-eds"
    tags        = ["guidance"]
    external    = true
  }

  port "staging-in" {
    full_name = "S-II to S-IVB separation interface"
    protocol    = "saturn-iu-umbilical"
    role        = "csm-eds"
    tags        = ["staging"]
    external    = true
  }
}

system "apollo-11" {
  full_name = "Apollo 11 Mission Stack (AS-506) - Trans-Lunar, Lunar Landing, and Deep Space Network Architecture"
  tags        = ["apollo", "aerospace", "nasa"]

  instance "cm" { source = "command-module" }

  instance "lm-ascent" { source = "lunar-module-ascent" }

  instance "lm-descent" { source = "lunar-module-descent" }

  instance "mcc" { source = "mission-control-center" }

  instance "saturn-v" { source = "saturn-v-stack" }

  instance "sm" { source = "service-module" }

  connection "cm-agc-to-sm-rcs" {
    full_name  = "Command Module AGC jet driver signals to Service Module RCS quads"
    tags         = ["control", "rcs"]
    from         = "/apollo-11/cm/agc/rcs-commands"
    to           = "/apollo-11/sm/rcs-quads/driver-signals"
  }

  connection "csm-lm-docking-tunnel" {
    full_name  = "Transposition, docking, and pressurized crew transfer tunnel"
    tags         = ["docking", "mechanical"]
    from         = "/apollo-11/cm/cabin/docking-probe"
    to           = "/apollo-11/lm-ascent/cabin/docking-drogue"
  }

  connection "csm-lm-vhf-ranging" {
    full_name  = "VHF lunar rendezvous ranging and voice link between Columbia and Eagle"
    tags         = ["rf", "ranging"]
    from         = "/apollo-11/sm/hga/vhf-transceiver"
    to           = "/apollo-11/lm-ascent/comms/vhf-ranging"
  }

  connection "launch-vehicle-eds" {
    full_name  = "Saturn V Instrument Unit to Command Module Emergency Detection System"
    tags         = ["launch", "guidance", "abort"]
    from         = "/apollo-11/saturn-v/iu/csm-umbilical"
    to           = "/apollo-11/cm/agc/eds-abort-input"
  }

  connection "lm-descent-battery-power" {
    full_name  = "Descent stage silver-zinc batteries powering ascent stage cabin systems"
    tags         = ["power"]
    from         = "/apollo-11/lm-descent/batteries/power-out"
    to           = "/apollo-11/lm-ascent/cabin/power-in"
  }

  connection "lm-landing-radar-to-lgc" {
    full_name  = "Descent stage landing radar Doppler altitude and velocity feed to LGC"
    tags         = ["radar", "landing", "guidance"]
    from         = "/apollo-11/lm-descent/landing-radar/radar-returns"
    to           = "/apollo-11/lm-ascent/lgc/landing-radar-input"
  }

  connection "msfn-to-csm-s-band" {
    full_name  = "Unified S-band deep space communications link between MCC and CSM high-gain antenna"
    tags         = ["rf", "telemetry"]
    from         = "/apollo-11/mcc/csm-ground-link"
    to           = "/apollo-11/sm/hga/rf-ground-link"
  }

  connection "msfn-to-lm-s-band" {
    full_name  = "Unified S-band communications link between MCC and Lunar Module steerable antenna"
    tags         = ["rf", "telemetry"]
    from         = "/apollo-11/mcc/lm-ground-link"
    to           = "/apollo-11/lm-ascent/comms/s-band-ground"
  }

  connection "sm-fuel-cell-power-to-cm" {
    full_name  = "28V DC main electrical power crossfeed from SM fuel cells to Command Module"
    tags         = ["power"]
    from         = "/apollo-11/sm/fuel-cells/power-out"
    to           = "/apollo-11/cm/cabin/power-in"
  }
}
