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

  async listProjects(): Promise<Project[]> {
    return ops.listProjects(this.data);
  }

  async createProject(name: string): Promise<Project> {
    const { data, project } = ops.createProject(
      this.data,
      crypto.randomUUID(),
      name,
      this.now(),
    );
    this.data = data;
    return project;
  }

  async renameProject(id: string, name: string): Promise<void> {
    this.data = ops.renameProject(this.data, id, name, this.now());
  }

  async deleteProject(id: string): Promise<void> {
    this.data = ops.deleteProject(this.data, id);
  }

  async listNodes(projectId: string): Promise<FsNode[]> {
    return ops.listNodes(this.data, projectId);
  }

  async createFile(
    projectId: string,
    parentId: string | null,
    name: string,
    content: string,
  ): Promise<FsFile> {
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
  }

  async createDirectory(
    projectId: string,
    parentId: string | null,
    name: string,
  ): Promise<FsDirectory> {
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
  }

  async updateFileContent(fileId: string, content: string): Promise<void> {
    this.data = ops.updateFileContent(this.data, fileId, content, this.now());
  }

  async renameNode(nodeId: string, name: string): Promise<void> {
    this.data = ops.renameNode(this.data, nodeId, name, this.now());
  }

  async moveNode(nodeId: string, newParentId: string | null): Promise<void> {
    this.data = ops.moveNode(this.data, nodeId, newParentId, this.now());
  }

  async deleteNode(nodeId: string): Promise<void> {
    this.data = ops.deleteNode(this.data, nodeId, this.now());
  }
}
