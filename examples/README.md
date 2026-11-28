# Examples

Example projects demonstrating rhizome's core capabilities. Each is a
self-contained directory of `.hcl` files that can be passed to `rhizome build`.
The same projects are offered in the web app's example picker.

Each example declares its picker title and description in its own `project`
block (`full_name`, `description`); the table below is generated from them.

<!-- BEGIN GENERATED: examples table — edit each example's `project` block, then run `just examples-readme` -->

| Example                              | Name                    | Description                                                              |
| ------------------------------------ | ----------------------- | ------------------------------------------------------------------------ |
| [apollo-11/](apollo-11/)             | Apollo 11 Mission Stack | Trans-lunar, lunar landing, and Deep Space Network architecture          |
| [drone/](drone/)                     | Quadcopter Drone        | Quadcopter drone with ground station and flight controller decomposition |
| [social-media/](social-media/)       | Social Media Platform   | Short-video platform backend services and event streaming pipelines      |
| [software-house/](software-house/)   | Software House          | Organizational model of software engineering departments and processes   |
| [weather-service/](weather-service/) | Weather Service         | Encapsulated backend with proxy ports and delegation                     |
| [web-app/](web-app/)                 | Web Application         | Full-stack web application with frontend, backend API, and database      |

<!-- END GENERATED -->

Every example intentionally includes incomplete parts (missing full names,
empty non-leaf components) that compile without errors but produce warnings —
showing how rhizome supports incremental, work-in-progress modeling.
