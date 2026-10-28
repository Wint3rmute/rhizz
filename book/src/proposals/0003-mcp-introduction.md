# 0003: MCP Introduction

- **Status:** implemented (steps 1–3; 0004 locking/`AI` identity still open)
- **Author:** @wint3rmute
- **Created:** 2026.10.19

## Motivation

Rhizz models are plain HCL, so AI assistants can already read and edit files
on disk. They cannot talk to a running `rhizz web` server, where projects
live, and there is no standard way for an AI client to discover what the
server offers. The
[Model Context Protocol (MCP)](https://en.wikipedia.org/wiki/Model_Context_Protocol)
is that standard. This proposal exposes the server's projects to AI clients in
three steps: reading, then model mutations, then documentation edits.

## Design

The existing server (`rhizz-server`) additionally speaks MCP, over the
streamable HTTP transport, at `/mcp`. It is part of the same router and process
as the web app and the VFS API, and works on the same data dir. There is no new
binary, port or flag. It uses the official Rust MCP SDK (`rmcp`) and offers
tools only (no resources or prompts).

The MCP layer holds no model logic. Like every other frontend, it only does I/O
and presentation on top of `rhizz-core`.

### Step 1: reading

All tools are read-only.

| Tool | Purpose |
| ---- | ------- |
| `fetch_projects` | List projects (id, name, createdAt, updatedAt), without files. |
| `list_files` | List the files of one project. |
| `read_file` | Read a window of one project file, given a line offset and a number of lines. The result includes the file's total line count and a per-file version, which changes whenever the file's contents change, so a client can page through large files and detect that the file changed between reads. |
| `check_project` | Run the compiler on a project and return diagnostics and the completion score. |

`read_file` serves the raw HCL (and docs) as stored, so an AI client sees the
same text a human would in a text editor. Paths are confined to the project's
directory, with the same exclusions as the VFS storage (hidden entries,
symlinks).

**Implemented (2026-10):** all four tools ship on `/mcp` in `rhizz-server`.
The version for `read_file` and `list_files` files is hex SHA-256 of the whole
file content — deliberately not the VFS's mtime-based `revision` — and is the
value step 3's compare-and-swap edits will require. `read_file`'s `offset` is
0-based, a past-the-end offset returns an empty window, `limit` defaults to
100 and is capped at 500, and a window includes `totalLines`. `list_files`
entries carry `kind` (`"file"`/`"directory"`); files also carry `revision`
and `version`. Unknown projects, confinement violations, and reading a
directory or missing path are tool errors (`isError`), not protocol errors.

### Step 2: mutations

Mutations reuse the declarative model operations of `rhizz-core`
(`ModelOp` in `mutation.rs`), the same ones the web editor sends. The server
loads the project's `system.hcl`, applies the op through `mutate_to_hcl`, and
writes the canonical HCL back. The tool surface is a thin mapping of the ops:
one tool per op, with the op's name and parameters.

| Tool | `ModelOp` |
| ---- | --------- |
| `add_system` | `add_system` |
| `add_component_definition` | `add_component_definition` |
| `add_instance` | `add_instance` |
| `rename_component` | `rename_component` |
| `reparent_component` | `reparent_component` |
| `update_component` | `update_component` |
| `update_system` | `update_system` |
| `delete_component` | `delete_component` |
| `delete_system` | `delete_system` |
| `add_connection` | `add_connection` |
| `connect_components` | `connect_components` |
| `delete_connection_by_label` | `delete_connection_by_label` |
| `update_connection` | `update_connection` |
| `add_protocol` | `add_protocol` |
| `update_protocol` | `update_protocol` |
| `delete_protocol` | `delete_protocol` |

- **Not exposed:** `create_component`. It is a UI convenience with implicit
  container fallbacks. AI clients use the explicit `add_component_definition`
  and `add_instance` instead.
- **Documented connection path:** `connect_components` is the documented path
  for AI clients: it creates the connection and the ports it ends on (plus an
  optional protocol stub) as one atomic op. `add_connection` stays for
  port-less bare connections (gradual specification) but is not the path
  clients should reach for first. This closes the open question on
  connections and ports below: ports are created through
  `connect_components`, patched through `update_component`, and cleaned up
  through `delete_connection_by_label` with `remove_ports`.
- **Results:** a tool returns whether the op applied, the created path where
  relevant, and any warnings. A refused op (a guard refusal, or a model that
  would no longer resolve, such as deleting a definition still in use) is
  reported with its diagnostics, and the file is left untouched. A mutation
  can never persist a broken model.
- **Scope of a mutation:** `system.hcl` only. Views and docs are not touched,
  so a deleted component may leave dangling view nodes, which the compiler
  reports as warnings.
- **New operations:** a new `ModelOp` gets a tool in the same change. The op
  set stays defined in one place, `rhizz-core`. `tool_name_for_op` in
  `mcp.rs` maps every `ModelOp` variant to its tool (or to nothing for the
  `create_component` exception) with an exhaustive match and no wildcard arm,
  and the `op_tool_mapping_covers_every_model_op` test checks the mapped
  names against the live `tools/list` response — so the table above cannot
  silently drift from the core's op set.
- **Implemented (2026-10, part 3):** `connect_components`,
  `update_connection`, `add_protocol`, `update_protocol` and
  `delete_protocol` ship on `/mcp`, completing the step-2 surface: every
  `ModelOp` except `create_component` is now exposed.
- **Locking:** mutations are writes like any other and respect project locking
  ([0004](0004-locking-and-collab.md)). An op acquires the lock and is
  refused while a human holds it. Mutations act as the hardcoded user `AI`,
  the identity 0004 reserves for MCP clients. The mutation step should not
  ship before 0004, or must accept last-writer-wins.
- **No auth:** like the rest of the server, the endpoint has no authentication
  at this stage of the project and assumes a trusted environment.

### Step 3: documentation

Docs (`docs/**.md`) are plain Markdown, not HCL, so they are edited through a
text-oriented interface rather than `ModelOp`s. The tools are:

| Tool | Purpose |
| ---- | ------- |
| `create_doc` | Create a new doc file, or overwrite an existing one whole. |
| `edit_documentation` | Replace one exact span of text in an existing doc. |

- **Edit mode:** `edit_documentation` takes `path`, `old_text`, `new_text`,
  and the `version` the client last read. `old_text` must match exactly once
  in the file. Zero matches or several matches are refused, and the file is
  left untouched. Line-number edits and unified diffs are not offered: line
  numbers go stale as soon as the file changes, and models produce malformed
  diffs.
- **Version guard:** the version is a content hash of the file.
  `edit_documentation` and `create_doc` (on an existing file) are refused when
  the supplied version differs from the file on disk, so the client re-reads
  before retrying. This is compare-and-swap, and it resolves the stale-read
  question in step 1.
- **Paths:** the same confinement as `read_file`: `docs/**.md` within the
  project, with hidden entries and symlinks excluded.
- **Writes:** atomic, through the same write path as the VFS save, so a
  failed write never leaves a partial file.
- **Locking and identity:** as in step 2, the edit acquires the project lock
  and is refused while a human holds it, and acts as user `AI`.
- **Implemented (2026-10):** `edit_documentation` and `create_doc` ship on
  `/mcp`. `edit_documentation` replaces one exact span in an existing
  `docs/**.md` file; `create_doc` creates a new doc (parents included) or
  overwrites an existing one whole, requiring the `version` `read_file`
  returned when the file already exists. Both return the new `version` and
  `totalLines`. 0004 is not implemented, so this is compare-and-swap only,
  with no project lock and no `AI` identity: reads, version checks, and
  writes happen under one held lock inside the blocking task, so two writes
  sent with the same version cannot both apply.
- **Scope:** docs only. Changes to `system.hcl` still go through the step 2
  ops.

## Diagnostics

None.

## Scoring and views

No change.

## Compatibility

No change to `.hcl` files or canonical output. The change is additive: one new
route, and existing routes behave as before. A mutation rewrites `system.hcl` in
canonical form, exactly as the web editor does.

## Alternatives

- **A stdio MCP server in the CLI** (for example `rhizz mcp`): works without a
  running server, but cannot see state in `rhizz web` and needs a second
  entry point. It may be added later over the same tools.
- **A separate MCP process or crate:** rejected. It would duplicate data access
  and configuration for no benefit at this scale.
- **A custom HTTP/JSON API for AI clients:** rejected. MCP gives discovery and
  client support for free.
- **A single `apply_op` tool taking any `ModelOp` as JSON:** fewer tools, but
  worse discoverability for clients, which see one large tagged union instead
  of small tools with their own descriptions.
- **Letting the AI client write raw HCL files:** rejected for the server API.
  Ops keep the result canonical and validated, and a broken model cannot be
  persisted.

## Open questions


- ~~What the per-file version is, and whether mutation tools accept it to refuse
  ops based on a stale read.~~ Resolved for docs in step 3: the version is a
  content hash, and `edit_doc` and `create_doc` require it. Whether the step 2
  mutation tools should also require it is still open.
- ~~Whether connections and ports need dedicated ops. The core only has
  `add_connection`/`delete_connection_by_label`, and ports only through
  component patches.~~ Resolved: `connect_components` is the dedicated
  connection-plus-ports op (one atomic call creates the connection and its
  endpoint ports, plus an optional protocol stub). Ports are otherwise
  managed through `update_component` patches and `delete_connection_by_label`
  with `remove_ports`.
