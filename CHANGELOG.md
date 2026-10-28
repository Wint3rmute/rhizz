## Unreleased

### Feat

- **web**: auto-capture landing backgrounds in VRT flow
- **modeling**: unify ports across read-only diagrams, labels only, no dots
- **modeling**: persist per-view port outline spots in view HCL
- **modeling**: prototype draggable port dots with labels and follow-the-dot edges

### Fix

- **web**: refresh README/book landing shot from VRT baseline
- **web**: fill landing hero to viewport height in EmptyLanding shot
- **modeling**: keep port tooltip on one line for stable title text
- **modeling**: slide ports along the outline during tweens
- **modeling**: carry ports through view transition tweens

### Refactor

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
