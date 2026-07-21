// Storage-agnostic interface for the frontend's virtual filesystem: many
// projects, each holding a tree of files/directories (see ./types.ts).
//
// Every method returns a Promise, even though every implementation so far
// (LocalStorageProjectStore, InMemoryProjectStore) is fully synchronous
// under the hood. That's deliberate: it keeps the interface shape
// identical to whatever a future network-backed (or sync-queue-backed)
// implementation will need, so adopting one later is a drop-in
// replacement — no call sites elsewhere in the app need to change.
import type {
  FsDirectory,
  FsFile,
  FsFileContentType,
  FsNode,
  Project,
} from "./types";

export interface ProjectStore {
  listProjects(): Promise<Project[]>;
  createProject(name: string): Promise<Project>;
  /** Also deletes every node belonging to the project. Rejects if `id` doesn't exist. */
  deleteProject(id: string): Promise<void>;

  /** Returns every node belonging to `projectId`, in no particular order. */
  listNodes(projectId: string): Promise<FsNode[]>;
  /**
   * Creates a file. `parentId` must be `null` (project root) or the id of
   * an existing directory in the same project; rejects otherwise.
   */
  createFile(
    projectId: string,
    parentId: string | null,
    name: string,
    contentType: FsFileContentType,
    content: string,
  ): Promise<FsFile>;
  /** Same parentId rules as createFile. */
  createDirectory(
    projectId: string,
    parentId: string | null,
    name: string,
  ): Promise<FsDirectory>;
  /** Bumps the file's revision and updatedAt. Rejects if `fileId` is a directory or doesn't exist. */
  updateFileContent(fileId: string, content: string): Promise<void>;
  /** Rejects if `nodeId` doesn't exist. */
  renameNode(nodeId: string, name: string): Promise<void>;
  /**
   * Re-parents `nodeId` under `newParentId` (`null` = project root).
   * Rejects if the new parent doesn't exist, isn't a directory, belongs
   * to a different project, or the move would create a cycle (moving a
   * node under itself or one of its own descendants).
   */
  moveNode(nodeId: string, newParentId: string | null): Promise<void>;
  /** Recursively deletes `nodeId` and everything nested under it. Rejects if it doesn't exist. */
  deleteNode(nodeId: string): Promise<void>;
}
