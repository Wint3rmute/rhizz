# Drone System

A two-system project modeling a consumer quadcopter and its pilot ground station.

## What it demonstrates

- **Component decomposition** — the flight controller breaks down into MCU, IMU, and barometer sub-components with internal SPI/I2C interfaces
- **Interface messages with typed fields** — motor control (DShot), GPS (UBX NAV-PVT), and RC link (CRSF) all carry structured message payloads
- **Multi-system projects** — `quadcopter` and `ground-control` coexist in the same project, each with their own component tree
- **In-progress modeling** — the `ground-station-pc` component is non-leaf with no children and no description, triggering W001 and W005 warnings while still compiling cleanly
- **Views** — four perspectives: top-level overview, power distribution, FC internals, and ground station layout

## Files

| File | Contents |
|------|----------|
| `project.hcl` | Project metadata |
| `systems.hcl` | Both systems: `quadcopter` (complete) and `ground-control` (in-progress) |
| `views.hcl` | Four view definitions with different filters |
