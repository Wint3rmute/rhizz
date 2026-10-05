// The one `ProjectStore` implementation. Every backend differs *only* in how
// it loads and persists the single `VfsData` blob, so that difference is
// isolated in a two-method `VfsBackend` and the read → ops.* → write cycle
// around it is written once here. All business rules (validation, cascading
// deletes, "touch the owning project" bookkeeping) live in ./operations.ts.
//
// Adding a backend (IndexedDB, a sync queue, …) is now a ~10-line function,
// not another ~150-line class.
import * as ops from "./operations";
import { emptyVfsData, sanitizeVfsData, type VfsData } from "./operations";
import type { ProjectStore } from "./store";
import type { FsDirectory, FsFile, FsNode, Project } from "./types";

/** How one backend loads and persists the whole VFS blob. */
export interface VfsBackend {
  /** Returns a sanitized blob; an absent/unreadable one yields an empty VFS. */
  read(): Promise<VfsData>;
  write(data: VfsData): Promise<void>;
}

// The subset of the DOM `Storage` interface the localStorage backend needs —
// declared locally (rather than depending on `lib.dom.d.ts`'s `Storage`) so
// tests can inject a plain in-memory object instead of requiring a DOM
// environment (this project's Vitest setup has neither jsdom nor happy-dom
// configured).
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

// The subset of fetch the HTTP backend needs (declared locally so tests can
// inject a plain function without matching every fetch overload).
export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export const DEFAULT_STORAGE_KEY = "rhizz:vfs:v1";
const VFS_ENDPOINT = "/api/vfs";

/** A backend holding the blob in memory: no storage, no serialization. */
export function memoryBackend(initial: VfsData = emptyVfsData()): VfsBackend {
  let data = initial;
  return {
    read: () => Promise.resolve(data),
    write: (next) => {
      data = next;
      return Promise.resolve();
    },
  };
}

/**
 * A backend holding the entire VFS (every project + every node) as one JSON
 * document under a single localStorage key. Deliberately the simplest thing
 * that works: no IndexedDB, no per-record keys, no manual indexes —
 * appropriate given the current scale (a handful of small projects).
 */
export function localStorageBackend(
  storage: StorageLike,
  key: string = DEFAULT_STORAGE_KEY,
): VfsBackend {
  return {
    read: () => {
      const raw = storage.getItem(key);
      if (raw === null) return Promise.resolve(emptyVfsData());

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        console.warn(
          `LocalStorageProjectStore: malformed JSON at "${key}"; starting from an empty VFS`,
        );
        return Promise.resolve(emptyVfsData());
      }

      return Promise.resolve(
        sanitizeVfsData(parsed, (message) => {
          console.warn(`LocalStorageProjectStore: ${message} at "${key}"`);
        }),
      );
    },
    write: (data) => {
      storage.setItem(key, JSON.stringify(data));
      return Promise.resolve();
    },
  };
}

/**
 * A backend over the rhizz-server HTTP API. The whole blob is fetched before
 * each mutation and dumped back afterwards — deliberately naive, matching the
 * task directive ("dump the entire VFS state to the server on save, no
 * optimisation for now"). The server expands that payload into one directory
 * of ordinary files per project (see rhizz-server's `storage` module), so
 * nothing about this side of the wire changes. With the server unavailable
 * every operation rejects, so callers see the same rejected-promise surface as
 * elsewhere.
 */
export function httpBackend(
  baseUrl: string,
  fetchImpl: FetchLike = globalThis.fetch,
): VfsBackend {
  const origin = baseUrl.replace(/\/+$/, "");
  const url = `${origin}${VFS_ENDPOINT}`;
  return {
    read: async () => {
      const response = await fetchImpl(url);
      if (!response.ok) {
        throw new Error(`VFS fetch failed: HTTP ${String(response.status)}`);
      }
      return sanitizeVfsData(await response.json());
    },
    write: async (data) => {
      const response = await fetchImpl(url, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        throw new Error(`VFS save failed: HTTP ${String(response.status)}`);
      }
    },
  };
}

/** The `ProjectStore` every backend shares. See ./store.ts for the contract. */
export class VfsProjectStore implements ProjectStore {
  private readonly backend: VfsBackend;
  private readonly now: () => string;
  private readonly newId: () => string;
  // Optional size reporter (see ./metrics.ts): called with the byte size of
  // the blob after every persisted mutation. Absent in tests, Storybook and
  // any non-browser composition — reporting is a browser-only concern, so
  // the store stays dependency-free and every existing construction site
  // keeps working unchanged.
  private readonly onPersisted: ((bytes: number) => void) | undefined;

  // ── Session read cache ──────────────────────────────────────────────────
  //
  // Every call below hands the backend the *whole* VFS, so without a cache
  // one transfer happens per store call — and the path-based facade makes
  // several calls per user-visible operation (a `readdir` plus one
  // `readFile` per file, each of them first calling `listNodes`). Reading a
  // project's sources therefore cost one full VFS transfer per source file,
  // and every later read (a view switch, a stat, a re-read after undo) cost
  // one more.
  //
  // The cached blob is the store's own state: it is filled on first use,
  // updated by every mutation, and never invalidated. Its lifetime is the
  // store instance's, i.e. the page's — a reload builds a new store and
  // reads the truth again. The trade-off is deliberate: a mutation writes
  // this copy out without re-reading first, so this tab is the sole writer
  // of the data it has seen. Two tabs on one project already raced on the
  // whole-blob save; this widens that window rather than adding a new kind
  // of race.
  private cached: VfsData | null = null;
  // The read currently in flight, so concurrent first reads (readProjectSources
  // fans one readFile out per file at once) share one transfer instead of
  // each missing the cache and fetching for itself.
  private pending: Promise<VfsData> | null = null;
  // Mutations run one at a time, each deriving from the previous one's
  // result. Without this, two overlapping mutations both read the same
  // snapshot and the second save erases the first one's change.
  private writeChain: Promise<unknown> = Promise.resolve();

  constructor(
    backend: VfsBackend,
    now: () => string = () => new Date().toISOString(),
    newId: () => string = () => crypto.randomUUID(),
    onPersisted?: (bytes: number) => void,
  ) {
    this.backend = backend;
    this.now = now;
    this.newId = newId;
    this.onPersisted = onPersisted;
  }

  /** The VFS blob, read from the backend on first use and cached after. */
  private async load(): Promise<VfsData> {
    if (this.cached !== null) return this.cached;
    this.pending ??= this.backend.read();
    try {
      const data = await this.pending;
      this.cached = data;
      return data;
    } finally {
      // Cleared by whichever caller settles first; anyone else already
      // awaiting the same read gets the same result, and the next caller
      // finds `cached` set.
      this.pending = null;
    }
  }

  /** Read-only op: project the cached blob, never write back. */
  private async query<T>(op: (data: VfsData) => T): Promise<T> {
    return op(await this.load());
  }

  /**
   * Reports the byte size of the just-persisted blob. Runs after the write
   * settles, so a refused write reports nothing — there is no new persisted
   * size to describe in that case. Measured as the UTF-8 length of the same
   * canonical JSON the backends themselves persist, so the number matches
   * what actually lands in localStorage or on the wire.
   */
  private reportPersistedSize(data: VfsData): void {
    if (this.onPersisted === undefined) return;
    this.onPersisted(new TextEncoder().encode(JSON.stringify(data)).length);
  }

  /**
   * Mutating op: derive the next blob from the cached one, persist it, and
   * keep it as the cache. Queued behind any mutation still running, so each
   * one builds on the state the previous one left.
   */
  private mutate<T>(
    op: (data: VfsData) => { data: VfsData; value: T },
  ): Promise<T> {
    const result = this.writeChain.then(async () => {
      const { data, value } = op(await this.load());
      this.cached = data;
      try {
        await this.backend.write(data);
      } catch (error) {
        // The backend never took this state, so the cache no longer
        // describes what is stored: drop it and let the next read start
        // from the truth rather than from a write that failed.
        this.cached = null;
        throw error;
      }
      this.reportPersistedSize(data);
      return value;
    });
    // Keep the queue alive when this mutation rejects, so one failure
    // doesn't wedge every later one behind it.
    this.writeChain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  listProjects(): Promise<Project[]> {
    return this.query((data) => ops.listProjects(data));
  }

  // Creating and deleting a project announce themselves on the console: those
  // are the two moments where the user's data changes shape, and they are the
  // ones you want to see when a project seems to have vanished. The store is
  // the one place all of it passes through — the /projects page, the navbar's
  // tour flow and Storybook's seeds each take a different route to get here,
  // so logging any higher up would miss some of them.
  //
  // Both logs sit *after* the mutation settles rather than inside the op
  // passed to mutate(). The op runs before the write, so a line emitted there
  // would claim a project that the backend then refused to store — a log that
  // lies about the only thing it exists to report. Naming the project means
  // looking the name up, which the op cannot do without re-deriving what
  // ops.createProject/ops.deleteProject already resolved.
  async createProject(name: string): Promise<Project> {
    const project = await this.mutate((data) => {
      const result = ops.createProject(data, name, this.now());
      return { data: result.data, value: result.project };
    });
    console.log(
      `VfsProjectStore: created project "${project.name}" (${project.id})`,
    );
    return project;
  }

  renameProject(id: string, name: string): Promise<Project> {
    return this.mutate((data) => {
      const result = ops.renameProject(data, id, name, this.now());
      return { data: result.data, value: result.project };
    });
  }

  async deleteProject(id: string): Promise<void> {
    const project = await this.mutate((data) => {
      const result = ops.deleteProject(data, id);
      return { data: result.data, value: result.project };
    });
    console.log(
      `VfsProjectStore: deleted project "${project.name}" (${project.id})`,
    );
  }

  listNodes(projectId: string): Promise<FsNode[]> {
    return this.query((data) => ops.listNodes(data, projectId));
  }

  createFile(
    projectId: string,
    parentId: string | null,
    name: string,
    content: string,
  ): Promise<FsFile> {
    return this.mutate((data) => {
      const result = ops.createFile(
        data,
        this.newId(),
        projectId,
        parentId,
        name,
        content,
        this.now(),
      );
      return { data: result.data, value: result.file };
    });
  }

  createDirectory(
    projectId: string,
    parentId: string | null,
    name: string,
  ): Promise<FsDirectory> {
    return this.mutate((data) => {
      const result = ops.createDirectory(
        data,
        this.newId(),
        projectId,
        parentId,
        name,
        this.now(),
      );
      return { data: result.data, value: result.directory };
    });
  }

  updateFileContent(
    projectId: string,
    fileId: string,
    content: string,
  ): Promise<void> {
    return this.mutate((data) => ({
      data: ops.updateFileContent(data, projectId, fileId, content, this.now()),
      value: undefined,
    }));
  }

  renameNode(projectId: string, nodeId: string, name: string): Promise<void> {
    return this.mutate((data) => ({
      data: ops.renameNode(data, projectId, nodeId, name, this.now()),
      value: undefined,
    }));
  }

  moveNode(
    projectId: string,
    nodeId: string,
    newParentId: string | null,
  ): Promise<void> {
    return this.mutate((data) => ({
      data: ops.moveNode(data, projectId, nodeId, newParentId, this.now()),
      value: undefined,
    }));
  }

  deleteNode(projectId: string, nodeId: string): Promise<void> {
    return this.mutate((data) => ({
      data: ops.deleteNode(data, projectId, nodeId, this.now()),
      value: undefined,
    }));
  }
}

/** The default test double, and the simplest possible backend. */
export class InMemoryProjectStore extends VfsProjectStore {
  constructor(now?: () => string) {
    super(memoryBackend(), now);
  }
}

/** The browser default: one JSON document in localStorage. */
export class LocalStorageProjectStore extends VfsProjectStore {
  constructor(
    storage: StorageLike = globalThis.localStorage,
    key: string = DEFAULT_STORAGE_KEY,
    now?: () => string,
    onPersisted?: (bytes: number) => void,
  ) {
    super(localStorageBackend(storage, key), now, undefined, onPersisted);
  }
}

/** Used when `VITE_RHIZZ_SERVER_URL` is set: persistence via rhizz-server. */
export class ServerProjectStore extends VfsProjectStore {
  constructor(
    baseUrl: string,
    opts: {
      now?: () => string;
      fetch?: FetchLike;
      onPersisted?: (bytes: number) => void;
    } = {},
  ) {
    super(
      httpBackend(baseUrl, opts.fetch),
      opts.now,
      undefined,
      opts.onPersisted,
    );
  }
}
