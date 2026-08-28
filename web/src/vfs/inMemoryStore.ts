// A fast, dependency-free ProjectStore backed by an in-memory VfsData
// object — no storage, no serialization. Used as the default test double
// for anything exercising ProjectStore (see store.contract.test.ts), and
// as the simplest possible reference for what LocalStorageProjectStore
// layers persistence on top of.
import * as ops from "./operations";
import { emptyVfsData, type VfsData } from "./operations";
import type { ProjectStore } from "./store";
import type { FsDirectory, FsFile, FsNode, Project } from "./types";

export class InMemoryProjectStore implements ProjectStore {
  private data: VfsData = emptyVfsData();
  private readonly now: () => string;

  constructor(now: () => string = () => new Date().toISOString()) {
    this.now = now;
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
    return this.run(() => ops.listProjects(this.data));
  }

  createProject(name: string): Promise<Project> {
    return this.run(() => {
      const { data, project } = ops.createProject(
        this.data,
        crypto.randomUUID(),
        name,
        this.now(),
      );
      this.data = data;
      return project;
    });
  }

  renameProject(id: string, name: string): Promise<void> {
    return this.run(() => {
      this.data = ops.renameProject(this.data, id, name, this.now());
    });
  }

  deleteProject(id: string): Promise<void> {
    return this.run(() => {
      this.data = ops.deleteProject(this.data, id);
    });
  }

  listNodes(projectId: string): Promise<FsNode[]> {
    return this.run(() => ops.listNodes(this.data, projectId));
  }

  createFile(
    projectId: string,
    parentId: string | null,
    name: string,
    content: string,
  ): Promise<FsFile> {
    return this.run(() => {
      const { data, file } = ops.createFile(
        this.data,
        crypto.randomUUID(),
        projectId,
        parentId,
        name,
        content,
        this.now(),
      );
      this.data = data;
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
        this.data,
        crypto.randomUUID(),
        projectId,
        parentId,
        name,
        this.now(),
      );
      this.data = data;
      return directory;
    });
  }

  updateFileContent(fileId: string, content: string): Promise<void> {
    return this.run(() => {
      this.data = ops.updateFileContent(this.data, fileId, content, this.now());
    });
  }

  renameNode(nodeId: string, name: string): Promise<void> {
    return this.run(() => {
      this.data = ops.renameNode(this.data, nodeId, name, this.now());
    });
  }

  moveNode(nodeId: string, newParentId: string | null): Promise<void> {
    return this.run(() => {
      this.data = ops.moveNode(this.data, nodeId, newParentId, this.now());
    });
  }

  deleteNode(nodeId: string): Promise<void> {
    return this.run(() => {
      this.data = ops.deleteNode(this.data, nodeId, this.now());
    });
  }
}
