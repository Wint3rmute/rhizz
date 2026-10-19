# 0004: Locking and Collaboration

- **Status:** draft
- **Author:** @wint3rmute
- **Created:** 2026.10.19

## Motivation

With `rhizz web`, several people can open the same project, but the editor
saves the whole VFS to the server (`PUT /api/vfs`), and the last save wins.
A stale tab silently overwrites a colleague's model, or deletes projects it
does not know about. Model and layout edits are not mergeable, so conflicts
must be prevented rather than resolved.

## Design

**One editor per project at a time.** A project is locked by the first user who
edits it; everyone else sees it read-only and follows the editor's changes.

- **Scope:** the whole project. One edit usually changes `system.hcl` and a
  view together, so finer locks buy little.
- **Auto-acquire:** a project opens read-only. The first edit acquires the lock.
  If someone else holds it, the edit is refused and the editor stays read-only.
- **Lease:** the lock is a short lease, renewed by the holder's client while the
  tab is open. A crashed tab or lost connection frees the project when the
  lease runs out.
- **Idle release:** the lock is also released after 1 minute without edits, so
  an abandoned tab does not block the project.
- **Server-side enforcement:** the server rejects writes to a project from
  anyone who does not hold its lock. The UI is not trusted.
- **Per-project writes:** the whole-VFS `PUT` is replaced by per-project writes,
  so one client can no longer overwrite or delete another's projects.
- **Lock state in memory:** locks are not persisted. A server restart releases
  them.
- **Watchers poll:** read-only clients periodically ask the server for the
  project's version and lock state, and reload when the version changes.
  No push channel.
- **Identity (PoC):** the username is kept in `localStorage` and sent with each
  request. The server trusts it. There is no authentication. MCP-using entities get a hardcoded `AI` username.
- **No override:** there is no force-unlock. A stuck lock clears itself.
- **Losing the lock:** if a save is refused because the lock was lost, the
  client discards its unsaved edits, reloads the project and becomes read-only.

**UI:** a locked project shows a lock icon (🔒) in the navbar. Clicking it shows
who holds the lock.

## Diagnostics

None.

## Scoring and views

No change.

## Compatibility

No change to `.hcl` files or canonical output. Locks live only in the server.
The `PUT /api/vfs` endpoint is replaced; the bundled frontend and server
change together.

Out of scope: edits made outside the web app (git, a text editor on the data
dir) are not covered by locks. They show up to watchers as a version change.

## Alternatives

- **Per-file locks:** rejected. Edits span several files, and the server has no
  stable file IDs (they derive from paths).
- **Optimistic versioning (reject stale writes):** rejected. A conflict loses
  someone's work and the edits cannot be merged.
- **Live push (WebSocket/SSE) and live per-keystroke sync:** deferred. Polling
  is enough for an MVP and can later be replaced behind the same lock/version
  state.
- **Admin force-unlock, folder locks:** deferred.

## Open questions

- Should a project list show lock icons too?
- Lock and poll timings (lease length, poll interval) are tuned during
  implementation.
