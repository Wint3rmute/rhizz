// Per-project edit lock, shared reactive state (proposal 0004).
//
// One module singleton (`projectLock`), readable from any component —
// including the navbar, which lives outside the project layout and cannot
// use page-level context. Started by the project layout with the open
// project's id and server URL; localStorage/memory backends pass a null
// URL and stay lock-free (always editable).
//
// Polling keeps the badge and the read-only flag fresh: every few seconds
// the holder re-reads `GET .../state`, and while it holds the lock it
// renews the lease with heartbeats (the server frees abandoned locks on
// its own, so a closed tab needs no goodbye).
import { getOrCreateUsername } from "./identity";
import { toastState } from "../ToastState.svelte";

/** How often the lock state is re-read while a project is open. */
export const LOCK_POLL_MS = 4_000;

/** How often the holder renews its lease (must stay under the 15s lease). */
export const LOCK_HEARTBEAT_MS = 10_000;

// The subset of fetch the lock client needs (declared locally so tests can
// inject a plain function, mirroring `vfs/vfsStore.ts`'s `FetchLike`).
export type LockFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export class ProjectLock {
  /** The open project, or null when no project layout is mounted. */
  projectId: string | null = $state(null);
  /** The rhizz-server origin, or null for local/memory backends. */
  serverUrl: string | null = $state(null);
  /** Our username, resolved once per session. */
  me: string | null = $state(null);
  /** The polled content-hash version, or null when unknown. */
  version: string | null = $state(null);
  /** Who holds the project, or null when it is free. */
  lockedBy: string | null = $state(null);
  /** When the current lease runs out (RFC 3339), if held. */
  lockExpiresAt: string | null = $state(null);

  /** True when someone else holds the project: editors go read-only. */
  readonly = $derived(
    this.lockedBy !== null && this.me !== null && this.lockedBy !== this.me,
  );
  /** True when this client holds the project. */
  holding = $derived(
    this.lockedBy !== null && this.me !== null && this.lockedBy === this.me,
  );
  /** True while polling a server backend for a mounted project. */
  active = $derived(this.projectId !== null && this.serverUrl !== null);

  private fetchImpl: LockFetch = globalThis.fetch;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Starts tracking `projectId` against `serverUrl` (null for local/memory
   * backends, which stay lock-free). Stops any previous project first.
   */
  start(
    projectId: string,
    serverUrl: string | null,
    fetchImpl: LockFetch = globalThis.fetch,
  ): void {
    this.stop();
    this.projectId = projectId;
    this.serverUrl = serverUrl;
    this.fetchImpl = fetchImpl;
    this.me ??= getOrCreateUsername();
    if (serverUrl === null) return;
    void this.refresh();
    this.pollTimer = setInterval(() => void this.refresh(), LOCK_POLL_MS);
    this.heartbeatTimer = setInterval(
      () => void this.maybeHeartbeat(),
      LOCK_HEARTBEAT_MS,
    );
  }

  /** Stops polling and forgets the project. */
  stop(): void {
    if (this.pollTimer !== null) clearInterval(this.pollTimer);
    if (this.heartbeatTimer !== null) clearInterval(this.heartbeatTimer);
    this.pollTimer = null;
    this.heartbeatTimer = null;
    this.projectId = null;
    this.serverUrl = null;
    this.version = null;
    this.lockedBy = null;
    this.lockExpiresAt = null;
  }

  /** Re-reads the project's lock state. Never throws. */
  async refresh(): Promise<void> {
    const { projectId, serverUrl } = this;
    if (projectId === null || serverUrl === null) return;
    let response: Response;
    try {
      response = await this.fetchImpl(
        `${serverUrl.replace(/\/+$/, "")}/api/projects/${projectId}/state`,
      );
    } catch {
      return;
    }
    // Unmounted or switched projects while the request was in flight.
    if (this.projectId !== projectId) return;
    if (response.status === 404) {
      this.version = null;
      this.lockedBy = null;
      this.lockExpiresAt = null;
      return;
    }
    if (!response.ok) return;
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return;
    }
    if (this.projectId !== projectId) return;
    const state = body as {
      version?: unknown;
      lockedBy?: unknown;
      lockExpiresAt?: unknown;
    };
    this.version =
      typeof state.version === "string" ? state.version : this.version;
    this.lockedBy = typeof state.lockedBy === "string" ? state.lockedBy : null;
    this.lockExpiresAt =
      typeof state.lockExpiresAt === "string" ? state.lockExpiresAt : null;
  }

  /** Renews the lease while this client holds it. Never throws. */
  private async maybeHeartbeat(): Promise<void> {
    const { projectId, serverUrl, me } = this;
    if (projectId === null || serverUrl === null || me === null) return;
    if (!this.holding) return;
    let response: Response;
    try {
      response = await this.fetchImpl(
        `${serverUrl.replace(/\/+$/, "")}/api/projects/${projectId}/heartbeat`,
        { method: "POST", headers: { "x-rhizz-user": me } },
      );
    } catch {
      return;
    }
    if (this.projectId !== projectId) return;
    if (response.status === 409) {
      // Lost it (or it lapsed): re-read so the badge flips promptly.
      await this.refresh();
    }
  }
}

/**
 * The shared lock state. Pages, the status bar, and the navbar all read
 * this module singleton; the project layout starts it per open project.
 */
export const projectLock = new ProjectLock();

/**
 * The base version the HTTP backend attaches to per-project writes, or
 * null when there is nothing fresh to compare against (local backends,
 * never polled). Same-user tabs share one holder, so this compare-and-swap
 * token is what protects them from silently overwriting each other.
 */
export function getLockBaseVersion(): string | null {
  return projectLock.active ? projectLock.version : null;
}

/**
 * Handles a refused write: re-reads the lock state, reloads the caller, and
 * tells the user what happened. The caller passes its own reload (and, for
 * draft-holding editors, draft cleanup first): the shared cache was already
 * dropped by the store, so `reload` starts from the truth.
 *
 * A refusal because the lock was lost also flips the project read-only
 * through the refreshed state — the editor stays that way until the holder
 * lets go.
 */
export async function handleLockLost(
  reload: () => Promise<unknown>,
): Promise<void> {
  await projectLock.refresh();
  await reload();
  const holder = projectLock.lockedBy;
  toastState.show(
    holder !== null
      ? `This project is locked by ${holder} — your change was not saved`
      : "The project changed elsewhere — reloaded",
    "warning",
    8000,
  );
}
