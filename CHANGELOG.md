## Unreleased

### Feat

- **web**: show the documentation button with the component's fields
- **web**: add a reset to default button for diagram transition time
- **web**: explain why a connected port cannot be hidden
- **web**: explain view filters in a tooltip next to Include tags
- **web**: ease diagram transitions in and out so they start and stop gently
- **web**: slide block labels smoothly when a diagram switch changes their alignment
- **modeling**: show unconnected ports in a view from the Components tree
- **web**: edit a view's filter tags as chips in the Modeling sidebar
- **core**: warn when a view misses components its include_tags filter requires
- **web**: always open on the landing page, with your projects one click away

### Fix

- **web**: stop a parent block from covering its children during diagram transitions
- **web**: stretch the expanded diagnostics panel across the full window width
- **book**: make `just bs` work in a clean environment

## 0.15.0 (2026-11-27)

### BREAKING CHANGE

- the CLI binary is now `rhizome` (was `rhizz`), the crates
are `rhizome-*`, and the `RHIZZ_*` environment variables (e.g. RHIZZ_ADDR,
RHIZZ_DATA_DIR) are now `RHIZOME_*`. The default data dir is `rhizome-data`.

### Feat

- **web**: round the corners of the browser tab icon
- **web**: show the browser tab icon as a dark logo on a white background
- **web**: show the Rhizome logo in tabs of browsers without SVG icon support
- **web**: show the Rhizome logo as the browser tab icon
- **web**: show project logo on landing page
- **logo**: poster stills for the videos, dark variants on GitHub's canvas
- **logo**: 5-second intro animation that settles into the lockup
- **logo**: dark-background variants, swapped in by the brandbook
- **logo**: render the animated-gradient mark as Full HD MP4
- **logo**: strip construction sheet down to the bare drawing
- **logo**: construction sheet with generator-derived helper lines
- **mcp**: add create_project tool
- **web**: show the logo mark in the navbar next to the Rhizz text
- **logo**: esoteric concept set (tree of life, Metatron graph, seed of life, mandala, kamea sigil, natal chart)
- **logo**: hairline concept set after the Thousand Plateaus covers
- **logo**: second-round concepts (refined plateau/mesh, R monogram, zz network, nested systems, rhizome stem)
- **logo**: fixed-tangent notch fillets and stronger dot-joint fillets
- **palette**: add open-settings and toggle-theme actions
- **web**: dock network status at bar far right, hide below sm
- **web**: ring spinner plus idle Project Saved pill
- **web**: network activity tracker and bottom-bar widget
- **web**: move theme toggle and tour entry into settings
- **web**: add global settings modal with theme, warning level and transition

### Fix

- **web**: align landing logo inline with the Rhizome wordmark
- **web**: apply navbar logo mask via quoted style directives
- **ci**: parse ImageMagick 7 AE output in assets-check
- **web**: clip modeling toolbar so it cannot overlap sidebars
- **web**: satisfy typescript-eslint 8.74 rules
- **deps**: bump minimatch via npm audit fix
- **web**: dismiss settings modal with Escape
- **web**: wrap settings help text instead of truncating
- **nix**: drop pinned coverage toolchain, Rust 1.99.1 with LLVM 23 tools

### Refactor

- rename the application from Rhizz to Rhizome
- share the empty-project seed between core, wasm and web
- **web**: unify zoom-to-fill margin at 0.9 via FIT_FRACTION
- **nix**: inline landing pipeline into task scripts, drop scripts/ dir
- **nix**: drop vestigial coverage and wasm tooling from default devshell
- **nix**: single-source task toolchains for scripts and devshell
- **nix**: point CI at runnable task scripts instead of the devshell
- **nix**: runnable task scripts instead of one big devshell

### Perf

- **vrt**: stop modal stories waiting out Storybook's animation cap

## 0.14.0 (2026-11-23)

### BREAKING CHANGE

- overwrite_model removed; use create_file with path system.hcl or main.hcl instead

### Feat

- **modeling**: draw delegation arrows by flow direction
- **modeling**: surround placed descendants when showing a parent
- **mcp**: migrate to modern-only 2026-07-28 stateless transport
- **mcp**: tighten input schemas to match runtime validation
- **mcp**: remove overwrite_model, keep create_file as single whole-file write
- **server**: shorten MCP versions to 16-char SHA-256 prefix
- **server**: add title and safety hints to MCP tools
- set external on delegation conversion in the same dialog
- convert typed delegation outer into proxy in one step

### Fix

- **deps**: bump rmcp to 3.11.0
- **deps**: bump url to 2.5.9 (RUSTSEC-2026-0592)
- **web**: stop seeding docs/.gitkeep in new projects
- **web**: surface server error body in VFS failure messages
- **server**: avoid string-slice clippy lints in short versions
- keep connection label weight stable when selected

### Refactor

- **nix**: runnable task scripts instead of one big devshell
- **core**: remove unused applied_none after AddConnection wipe
- **web,docs**: remove add_connection, keep connect_components
- **server**: remove add_connection tool, keep connect_components
- **core**: remove AddConnection op, keep connect_components
- **web**: seed stories from shared cross-level fixture

## 0.13.0 (2026-11-19)

### Feat

- require release headline in just bump
- **mcp**: info-level audit log for every tool call
- **mcp**: generic create_file + edit_file replacing create_doc/edit_documentation
- **proxy**: inspector badges, delegation dialog variant, MCP docs
- **proxy**: inspector badges, delegation dialog variant, omission-preserving updates
- **web**: proxy inspector badges, delegation dialog variant, omission-preserving updates
- **core**: track delegation terminal source; read model surfaces proxy/delegation
- **web**: delegation direct-or-omitted resolution and arrowless edges
- **core**: delegation scoring, round-trip, weather-service example
- **core**: delegation endpoints, proxy inference, E021/E022

### Fix

- **server**: serialize VFS file writes with MCP file tools
- **mcp**: silence clippy on audit log helper
- **mcp**: refuse empty edits, clarify view-on-broken-model refusal, file VFS-lock follow-up
- **web**: side-handle nested drop opens delegation dialog without pageerror

## 0.12.0 (2026-11-16)

### Feat

- remove connection start_side/end_side routing overrides
- **web**: endpoint icons in connection inspector, copy cleanup

### Fix

- **deps**: bump rustix to 1.1.6 for RUSTSEC-2026-0486

## 0.11.1 (2026-11-09)

### Fix

- **deps**: bump rmcp to 3.9 for RUSTSEC-2026-0462

## 0.11.0 (2026-11-09)

### Feat

- **web**: add unlock button to project lock menu
- **web**: show release tag in build footer
- **server**: expose build tag via /api/version
- **web**: explain Projected badge and disabled rows via title tooltips
- **web**: upload first change immediately, debounce the rest
- **web**: grey out unshowable connections with explanatory tooltip
- **web**: tween follower canvas into remote diagram changes
- **core**: reject slash in block labels with E004
- **web**: omit inward projected ancestor-descendant edges
- **web**: draggable projected port dots with persistence
- **web**: draw projected edges on canvas
- **web**: list all connections with Projected badge in sidebar
- **web**: add projection resolver for projected connections

### Fix

- **coverage**: pin coverage to Rust 1.98.1 until 1.99 profiles are fixed
- **deps**: bump wasm-bindgen to 0.2.130 to match nixpkgs
- **clippy**: satisfy assert_is_empty and double_must_use lints from nixpkgs bump
- **nix**: skip cargo-llvm-cov self-tests broken by nixpkgs bump
- **web**: fade ports with their edges during view transitions
- **web**: generate VFS ids without requiring a secure context

### Refactor

- **coverage**: provision pinned toolchain via coverage devshell
- **web**: drop obsolete lock VRT baselines
- **web**: remove lock badge from diagnostics status bar

## 0.10.0 (2026-11-06)

### Feat

- **web**: freeze Modeling inspectors and tree while locked by another user
- **web**: freeze Modeling canvas while locked by another user
- **web**: follower auto-reload on remote version change
- **web**: fold lock badge into project title trigger
- **server,web**: tune and harden project locks, mark 0004 implemented
- **server**: add voluntary lock release endpoint
- **mcp**: enforce AI project lock on writes, echo version and lock on reads
- **web**: follow project locks with read-only UI
- **server**: replace whole-VFS PUT with per-project writes
- **server**: add per-project lock manager and project state

### Fix

- **web**: log rejected project saves to Sentry
- **web**: scope server writes to changed projects with fresh versions
- anchor single-knee connection labels to the longer leg
- render connection labels as pills like port labels

## 0.9.0 (2026-11-01)

### Feat

- add grid and zoom-to-fill toolbar to explore and inventory diagrams
- **modeling**: allow selecting which ports to remove on delete
- **modeling**: hide port labels unused by drawn edges
- **mcp**: add overwrite_model whole-file repair tool
- **modeling**: restyle port labels as solid node-colored tags
- **modeling**: smart single- vs double-knee connection routing
- **web**: auto-capture landing backgrounds in VRT flow
- **modeling**: unify ports across read-only diagrams, labels only, no dots
- **modeling**: persist per-view port outline spots in view HCL
- **modeling**: prototype draggable port dots with labels and follow-the-dot edges

### Fix

- gate port dots on selection in modeling canvas
- rewrite connections on component instance rename
- revert bundled landing images to unblock VRT, keep port baselines
- run vrt-accept landing steps under nix for reproducibility
- unify port visibility to drawn connections only
- **core**: satisfy clippy for selective port removal
- **web**: drop port-less connection coverage, use port-path language
- **core**: require port paths in add_connection, clean endpoint language
- **mcp**: include overwrite_model in tools/list expectation
- **web**: use port paths in refused-delete e2e fixture
- **book**: name port paths in book examples
- **web**: use port paths in connection unit tests
- **server**: require port paths in connection tools
- **core**: require port path in every connection endpoint (E003)
- **examples**: name port paths in all connections
- **web**: refresh README/book landing shot from VRT baseline
- **web**: fill landing hero to viewport height in EmptyLanding shot
- **modeling**: keep port tooltip on one line for stable title text
- **modeling**: slide ports along the outline during tweens
- **modeling**: carry ports through view transition tweens

### Refactor

- reuse modeling toolbar with grid and zoom-to-fill on inventory and explore
- **modeling**: unify port types on DiagramStaticPort, drop dead code
- **web**: copy landing backgrounds in vrt-accept recipe
- **modeling**: require portsByIndex on all diagram views

## 0.8.0 (2026-10-28)

### Feat

- **mcp**: add create_doc tool for docs
- **mcp**: add edit_documentation tool for docs
- **mcp**: add connection, port and protocol mutation tools
- **mcp**: add model-mutation tools part 2
- **mcp**: add model-mutation tools part 1

## 0.7.0 (2026-10-25)

### BREAKING CHANGE

- a connection that sets encapsulates no longer compiles.
Remove E003 and E004 with their spec files; the codes are not reused.

### Feat

- **mcp**: add model-mutation tools part 1
- **server**: add MCP tools: `list_files`, `read_file`, `check_project`
- **modeling**: animate connection preview line
- **modeling**: say Keep and confirm connection removal with a toast
- **modeling**: delete connection popup with port cleanup
- **web**: render markdown in DaisyUI toast alerts
- **inventory**: edit protocol encapsulates as a searchable list
- **modeling**: show port connection status in connection inspector
- **web**: show port flags inline and name the connection in the dialog preview
- **web**: add New connection dialog that creates the ports with the connection
- **core**: add connect_components op that creates a connection with its ports
- **web**: link a connection's protocol to its Inventory entry
- **web**: replace the Interfaces placeholder with a Protocols tab
- **web**: project protocol messages and filter protocols for the inventory
- **web**: mirror protocol ops and read protocol usage
- **core**: add add_protocol, update_protocol and delete_protocol ops
- **web**: extract connection inspector with protocol, connection and realization panels (W.2)
- **web**: add protocol read helpers for the connection inspector (W.2)
- **core**: add update_connection op and connection read model (W.1)
- **core**: warn on incomplete connections (W019) and migrate examples
- **web**: animate book-example view transitions
- **core**: warn on realization hierarchy and protocol compatibility (W020, W021)
- **rhizz-server**: paginate MCP fetch_projects output
- **core**: resolve realized_by and detect cycles (0002.3)
- **core**: resolve protocol encapsulates and detect cycles (0002.2)
- **server**: add proof-of-concept MCP endpoint
- **core**: add protocol leaf/encapsulates and connection realized_by schema

### Fix

- **server**: require a model source for read_file and refuse non-regular or oversized files
- **web**: make inline code readable and keep toast dismiss button visible
- **server**: allow public hostname on MCP endpoint

### Refactor

- cargo update
- **modeling**: inline single-use port key helper
- **core**: reuse known scope label in port cleanup
- **core**: merge delete connection port branches
- **modeling**: trim delete-connection request and labels
- **web**: reuse action fields for connect op replay
- **web**: drop unreachable escape branch in dialog
- **core**: share label checks in connect op
- **core**: inline connect params into connect components
- **web**: delete unused LCA connection helper
- **core**: remove connection.encapsulates
- **web**: extract shared DiagramSceneView presenter for diagram transitions

## 0.6 (2026-10-19)

Baseline of Rhizz.
