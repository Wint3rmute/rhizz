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
// each mutation and dumped back afterwards — deliberately naive, matching the
// task directive ("dump the entire VFS state to the server on save, no
// optimisation for now"). With the server unavailable every operation
 * rejects, so callers see the same rejected-promise surface as elsewhere.
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

  constructor(
    backend: VfsBackend,
    now: () => string = () => new Date().toISOString(),
    newId: () => string = () => crypto.randomUUID(),
  ) {
    this.backend = backend;
    this.now = now;
    this.newId = newId;
  }

  /** Read-only op: load the blob, project from it, never write back. */
  private async query<T>(op: (data: VfsData) => T): Promise<T> {
    return op(await this.backend.read());
  }

  /** Mutating op: load the blob, derive the next one, persist it, return a result. */
  private async mutate<T>(
    op: (data: VfsData) => { data: VfsData; value: T },
  ): Promise<T> {
    const { data, value } = op(await this.backend.read());
    await this.backend.write(data);
    return value;
  }

  listProjects(): Promise<Project[]> {
    return this.query((data) => ops.listProjects(data));
  }

  createProject(name: string, id?: string): Promise<Project> {
    return this.mutate((data) => {
      const result = ops.createProject(
        data,
        id ?? this.newId(),
        name,
        this.now(),
      );
      return { data: result.data, value: result.project };
    });
  }

  renameProject(id: string, name: string): Promise<void> {
    return this.mutate((data) => ({
      data: ops.renameProject(data, id, name, this.now()),
      value: undefined,
    }));
  }

  deleteProject(id: string): Promise<void> {
    return this.mutate((data) => ({
      data: ops.deleteProject(data, id),
      value: undefined,
    }));
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

  updateFileContent(fileId: string, content: string): Promise<void> {
    return this.mutate((data) => ({
      data: ops.updateFileContent(data, fileId, content, this.now()),
      value: undefined,
    }));
  }

  renameNode(nodeId: string, name: string): Promise<void> {
    return this.mutate((data) => ({
      data: ops.renameNode(data, nodeId, name, this.now()),
      value: undefined,
    }));
  }

  moveNode(nodeId: string, newParentId: string | null): Promise<void> {
    return this.mutate((data) => ({
      data: ops.moveNode(data, nodeId, newParentId, this.now()),
      value: undefined,
    }));
  }

  deleteNode(nodeId: string): Promise<void> {
    return this.mutate((data) => ({
      data: ops.deleteNode(data, nodeId, this.now()),
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
  ) {
    super(localStorageBackend(storage, key), now);
  }
}

/** Used when `VITE_RHIZZ_SERVER_URL` is set: persistence via rhizz-server. */
export class ServerProjectStore extends VfsProjectStore {
  constructor(
    baseUrl: string,
    opts: { now?: () => string; fetch?: FetchLike } = {},
  ) {
    super(httpBackend(baseUrl, opts.fetch), opts.now);
  }
}
