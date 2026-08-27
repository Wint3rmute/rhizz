# Drone System

A two-system project modeling a consumer quadcopter and its pilot ground
station.

## What it demonstrates

- **Component decomposition** — the flight controller breaks down into MCU, IMU,
  and barometer sub-components with internal SPI/I2C interfaces
- **Interface messages with typed fields** — motor control (DShot), GPS (UBX
  NAV-PVT), and RC link (CRSF) all carry structured message payloads
- **Multi-system projects** — `quadcopter` and `ground-control` coexist in the
  same project, each with their own component tree
- **Visual attributes** — the `gps` component sets `color`, `border`, and `font`
  to demonstrate how diagrams can be styled
- **In-progress modeling** — the `ground-station-pc` component is non-leaf with
  no children and no description, triggering W001 and W004 warnings while still
  compiling cleanly
- **Single-file model** — the complete architecture (protocols + systems +
  components) lives in one `system.hcl`, kept separate from view definitions
- **Views** — four perspectives: top-level overview, power distribution, FC
  internals, and ground station layout

## Files

| File        | Contents                                                                 |
| ----------- | ------------------------------------------------------------------------ |
| `system.hcl`  | Complete system model: project metadata, protocols, and both systems (`quadcopter`, `ground-control`) |
| `views.hcl`   | Four view definitions with different filters                            |