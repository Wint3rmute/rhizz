# Rhizz — Rhizomatic Systems Engineering

Code-first [MBSE](https://baczek.me/mbse) tool. Systems are described in `.hcl`
files you can version-control, diff, and review — no GUI required.

## Core Ideas

**Code-first modeling** — components, interfaces, and messages live in plain HCL
(same syntax as Terraform). All `.hcl` files in a directory are merged into one
model, so you can split the description across as many files as you like.

**Completion score** — `rhizz score` measures how fully a system is decomposed.
Sketch a high-level architecture first, fill in details over time, and track
progress numerically:

```
Components:  8/12 complete  (66.7%)
Interfaces:  3/7  complete  (42.9%)
Messages:    5/10 complete  (50.0%)
Overall:     16/29           55.2%
```

**Definable views** — `view` blocks render filtered Graphviz diagrams from the
same model. Show only power paths, zoom into one subsystem, or hide low-level
wiring for a stakeholder review — all without touching the model itself:

```hcl
view "power-paths" {
  system = "quadcopter"
  filter { include_tags = ["power"]; show_messages = false }
  output { filename = "power-paths.dot"; rankdir = "LR" }
}
```

## CLI

```
rhizz check [path]   # parse and validate
rhizz score [path]   # print completion report
rhizz views [path]   # generate .dot diagrams
rhizz build [path]   # all of the above (default)
```

See `SPEC.md`, `SPEC/`, and `examples/` for the full specification and worked
examples.

## Development commands

```bash
~/.cargo/bin/wasm-pack build crates/rhizz-wasm --target web
```

## Links

- [WASM Bindgen Guide](https://wasm-bindgen.github.io/wasm-bindgen/introduction.html) -
  search engines are not finding it for some reason...
