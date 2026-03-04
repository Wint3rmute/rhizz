# Examples

Three example projects demonstrating rhizz's core capabilities. Each is a self-contained directory of `.hcl` files that can be passed to `rhizz build`.

| Example | Domain | Shows |
|---------|--------|-------|
| [drone/](drone/) | Hardware — quadcopter + ground station | Component decomposition, hardware interfaces with message payloads, multi-system projects, in-progress modeling |
| [social-media/](social-media/) | Software — short-video platform | Service-oriented architecture, API + data flow modeling, mixed leaf/non-leaf depth |
| [software-house/](software-house/) | Organization — software company | Departments as components, business processes as interfaces, demonstrating rhizz beyond tech systems |

All three examples intentionally include incomplete parts (missing descriptions, empty non-leaf components) that compile without errors but produce warnings — showing how rhizz supports incremental, work-in-progress modeling.
