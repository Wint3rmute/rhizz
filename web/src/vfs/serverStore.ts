// A ProjectStore backed by the rhizz-server HTTP API. The whole VFS blob
// is fetched before each mutation and dumped back afterwards —
// deliberately naive, matching the task directive ("dump the entire VFS
// state to the server on save, no optimisation for now"). Same
// read-parse-mutate-serialize-write cycle as LocalStorageProjectStore;
// only the storage medium differs, so all business logic stays in
// ./operations.ts. With the server unavailable every operation rejects —
// callers see the same rejected-promise surface as the other stores'
// error paths.
import * as ops from "./operations";
import { sanitizeVfsData, type VfsData } from "./operations";
import type { ProjectStore } from "./store";
import type { FsDirectory, FsFile, FsNode, Project } from "./types";

const VFS_ENDPOINT = "/api/vfs";

// The subset of fetch the store needs (declared locally so tests can
// inject a plain function without matching every fetch overload).
type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export class ServerProjectStore implements ProjectStore {
  private readonly baseUrl: string;
  private readonly now: () => string;
  private readonly fetchImpl: FetchLike;

  constructor(
    baseUrl: string,
    opts: { now?: () => string; fetch?: FetchLike } = {},
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.now = opts.now ?? (() => new Date().toISOString());
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
  }

  /** Fetches the whole VFS blob, forgiving-parsed like any stored blob. */
  private async read(): Promise<VfsData> {
    const response = await this.fetchImpl(`${this.baseUrl}${VFS_ENDPOINT}`);
    if (!response.ok) {
      throw new Error(`VFS fetch failed: HTTP ${String(response.status)}`);
    }
    return sanitizeVfsData(await response.json());
  }

  /** Dumps the whole VFS blob to the server. */
  private async write(data: VfsData): Promise<void> {
    const response = await this.fetchImpl(`${this.baseUrl}${VFS_ENDPOINT}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      throw new Error(`VFS save failed: HTTP ${String(response.status)}`);
    }
  }

  async listProjects(): Promise<Project[]> {
    return ops.listProjects(await this.read());
  }

  async createProject(name: string, id?: string): Promise<Project> {
    const data = await this.read();
    const { data: next, project } = ops.createProject(
      data,
      id ?? crypto.randomUUID(),
      name,
      this.now(),
    );
    await this.write(next);
    return project;
  }

  async renameProject(id: string, name: string): Promise<void> {
    const data = await this.read();
    await this.write(ops.renameProject(data, id, name, this.now()));
  }

  async deleteProject(id: string): Promise<void> {
    const data = await this.read();
    await this.write(ops.deleteProject(data, id));
  }

  async listNodes(projectId: string): Promise<FsNode[]> {
    return ops.listNodes(await this.read(), projectId);
  }

  async createFile(
    projectId: string,
    parentId: string | null,
    name: string,
    content: string,
  ): Promise<FsFile> {
    const data = await this.read();
    const { data: next, file } = ops.createFile(
      data,
      crypto.randomUUID(),
      projectId,
      parentId,
      name,
      content,
      this.now(),
    );
    await this.write(next);
    return file;
  }

  async createDirectory(
    projectId: string,
    parentId: string | null,
    name: string,
  ): Promise<FsDirectory> {
    const data = await this.read();
    const { data: next, directory } = ops.createDirectory(
      data,
      crypto.randomUUID(),
      projectId,
      parentId,
      name,
      this.now(),
    );
    await this.write(next);
    return directory;
  }

  async updateFileContent(fileId: string, content: string): Promise<void> {
    const data = await this.read();
    await this.write(ops.updateFileContent(data, fileId, content, this.now()));
  }

  async renameNode(nodeId: string, name: string): Promise<void> {
    const data = await this.read();
    await this.write(ops.renameNode(data, nodeId, name, this.now()));
  }

  async moveNode(nodeId: string, newParentId: string | null): Promise<void> {
    const data = await this.read();
    await this.write(ops.moveNode(data, nodeId, newParentId, this.now()));
  }

  async deleteNode(nodeId: string): Promise<void> {
    const data = await this.read();
    await this.write(ops.deleteNode(data, nodeId, this.now()));
  }
}
