# Examples

Example projects demonstrating rhizome's core capabilities. Each is a
self-contained directory of `.hcl` files that can be passed to `rhizome build`.
The same projects are offered in the web app's example picker.

| Example                            | Domain                                 | Shows                                                                                                           |
| ---------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| [apollo-11/](apollo-11/) | Spaceflight — Apollo 11 mission stack | Large multi-protocol model, several focused views over one system |
| [drone/](drone/)                   | Hardware — quadcopter + ground station | Component decomposition, hardware interfaces with message payloads, multi-system projects, in-progress modeling |
| [social-media/](social-media/)     | Software — short-video platform        | Service-oriented architecture, API + data flow modeling, mixed leaf/non-leaf depth                              |
| [software-house/](software-house/) | Organization — software company        | Departments as components, business processes as interfaces, demonstrating rhizome beyond tech systems            |
| [weather-service/](weather-service/) | Software — encapsulated backend        | Proxy ports and delegation: one boundary port forwarding inward over an N-hop chain                            |
| [web-app/](web-app/) | Software — full-stack web application | Frontend/backend/database split, protocol encapsulation (`https` carrying `jwt`), per-layer views |

Every example intentionally includes incomplete parts (missing full names,
empty non-leaf components) that compile without errors but produce warnings —
showing how rhizome supports incremental, work-in-progress modeling.
