# Weather Service

A small project modeling an encapsulated backend: a `weather-service`
exposes one REST `api` port while internally decomposing into a
`reverse-proxy` and a `listener` socket.

## What it demonstrates

- **Proxy ports** — `weather-service/api` and `reverse-proxy/http` omit
  `protocol`/`role` and inherit both from their delegation target
- **Delegation connections** — ordinary `connection` blocks with one `./port`
  self endpoint (`api-delegation`, `http-delegation`) forward the boundary
  dot inward, one segment per hop
- **Transitive (N-hop) inference** — `api` inherits `rest` through
  `proxy/http` down to `listener/http`, with no re-declaration
- **Encapsulation without leaks** — the system-level `forecast` connection
  names only the boundary (`weather-service/api`); internals never appear in
  `system "app"`
- **Views** — a boundary-level overview plus an opened-up internals view

## Files

| File                 | Contents                                                        |
| -------------------- | --------------------------------------------------------------- |
| `system.hcl`         | Protocols, components with two delegation edges, `system "app"` |
| `views/overview.hcl` | Boundary-level perspective (`max_level = 1`)                    |
| `views/internals.hcl`| Opened-up perspective on `weather-service`                      |
