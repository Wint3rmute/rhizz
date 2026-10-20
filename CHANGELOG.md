## Unreleased

### Feat

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

- **server**: allow public hostname on MCP endpoint

### Refactor

- **web**: extract shared DiagramSceneView presenter for diagram transitions

## 0.6 (2026-10-19)

Baseline of Rhizz.
