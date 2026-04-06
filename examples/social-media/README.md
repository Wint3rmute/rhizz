# Social Media Platform

A short-video platform (TikTok-style) modeled as a single system covering
client, backend services, and infrastructure.

## What it demonstrates

- **Software architecture modeling** — mobile app, API gateway, backend
  services, CDN, database, and object storage as components with clear
  interfaces
- **Nested service decomposition** — the backend component contains user, video,
  feed, and recommendation services with internal interfaces
- **API message contracts** — the client-API interface defines request/response
  messages with typed fields (pagination cursors, upload parameters)
- **Incomplete subsystems** — `recommendation-engine` is non-leaf with no
  children (W001), `push-notify` interface has no messages (W002), showing a
  system still under active design
- **Views** — three perspectives: full platform overview, backend service
  breakdown, and video data pipeline

## Files

| File          | Contents                                                     |
| ------------- | ------------------------------------------------------------ |
| `project.hcl` | Project metadata                                             |
| `system.hcl`  | The `buzzvid` system with all components and interfaces      |
| `views.hcl`   | Three view definitions filtering by component scope and tags |
