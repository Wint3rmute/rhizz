// A ProjectStore backed by a single localStorage key, holding the entire
// VFS (every project + every node) as one JSON document. Deliberately the
// simplest thing that works: no IndexedDB, no per-record keys, no manual
// indexes — appropriate given the current scale (a handful of small
// projects; see TASKS.md Task 56). All the actual business logic
// (validation, cascading deletes, "touch the owning project" bookkeeping)
// lives in ./operations.ts and is shared with InMemoryProjectStore; this
// class is only responsible for the
// read-parse-validate-mutate-serialize-write cycle around that shared
// core.
import * as ops from "./operations";
import { emptyVfsData, sanitizeVfsData, type VfsData } from "./operations";
import type { ProjectStore } from "./store";
import {
  type FsDirectory,
  type FsFile,
  type FsNode,
  type Project,
} from "./types";

const DEFAULT_STORAGE_KEY = "rhizz:vfs:v1";

// The subset of the DOM `Storage` interface this store actually needs —
// declared locally (rather than depending on `lib.dom.d.ts`'s `Storage`)
// so tests can inject a plain in-memory object instead of requiring a DOM
// environment (this project's Vitest setup has neither jsdom nor
// happy-dom configured — see Task 36's notes in FINISHED_TASKS.md).
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export class LocalStorageProjectStore implements ProjectStore {
  private readonly storage: StorageLike;
  private readonly key: string;
  private readonly now: () => string;

  constructor(
    storage: StorageLike = globalThis.localStorage,
    key: string = DEFAULT_STORAGE_KEY,
    now: () => string = () => new Date().toISOString(),
  ) {
    this.storage = storage;
    this.key = key;
    this.now = now;
  }

  private read(): VfsData {
    const raw = this.storage.getItem(this.key);
    if (raw === null) return emptyVfsData();

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.warn(
        `LocalStorageProjectStore: malformed JSON at "${this.key}"; starting from an empty VFS`,
      );
      return emptyVfsData();
    }

    return sanitizeVfsData(parsed, (message) => {
      console.warn(`LocalStorageProjectStore: ${message} at "${this.key}"`);
    });
  }

  private write(data: VfsData): void {
    this.storage.setItem(this.key, JSON.stringify(data));
  }

  // Runs a synchronous `ops.*` call, converting a synchronous throw into a
  // rejected Promise (matching the async-returning `ProjectStore` interface);
  // keeps the method body non-`async` so eslint's `require-await` doesn't
  // fire, and so callers still `await` a rejection on error.
  private run<T>(op: () => T): Promise<T> {
    try {
      return Promise.resolve(op());
    } catch (err) {
      return Promise.reject(
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  }

  listProjects(): Promise<Project[]> {
    return this.run(() => ops.listProjects(this.read()));
  }

  createProject(name: string): Promise<Project> {
    return this.run(() => {
      const { data, project } = ops.createProject(
        this.read(),
        crypto.randomUUID(),
        name,
        this.now(),
      );
      this.write(data);
      return project;
    });
  }

  renameProject(id: string, name: string): Promise<void> {
    return this.run(() => {
      this.write(ops.renameProject(this.read(), id, name, this.now()));
    });
  }

  deleteProject(id: string): Promise<void> {
    return this.run(() => {
      this.write(ops.deleteProject(this.read(), id));
    });
  }

  listNodes(projectId: string): Promise<FsNode[]> {
    return this.run(() => ops.listNodes(this.read(), projectId));
  }

  createFile(
    projectId: string,
    parentId: string | null,
    name: string,
    content: string,
  ): Promise<FsFile> {
    return this.run(() => {
      const { data, file } = ops.createFile(
        this.read(),
        crypto.randomUUID(),
        projectId,
        parentId,
        name,
        content,
        this.now(),
      );
      this.write(data);
      return file;
    });
  }

  createDirectory(
    projectId: string,
    parentId: string | null,
    name: string,
  ): Promise<FsDirectory> {
    return this.run(() => {
      const { data, directory } = ops.createDirectory(
        this.read(),
        crypto.randomUUID(),
        projectId,
        parentId,
        name,
        this.now(),
      );
      this.write(data);
      return directory;
    });
  }

  updateFileContent(fileId: string, content: string): Promise<void> {
    return this.run(() => {
      this.write(
        ops.updateFileContent(this.read(), fileId, content, this.now()),
      );
    });
  }

  renameNode(nodeId: string, name: string): Promise<void> {
    return this.run(() => {
      this.write(ops.renameNode(this.read(), nodeId, name, this.now()));
    });
  }

  moveNode(nodeId: string, newParentId: string | null): Promise<void> {
    return this.run(() => {
      this.write(ops.moveNode(this.read(), nodeId, newParentId, this.now()));
    });
  }

  deleteNode(nodeId: string): Promise<void> {
    return this.run(() => {
      this.write(ops.deleteNode(this.read(), nodeId, this.now()));
    });
  }
}
