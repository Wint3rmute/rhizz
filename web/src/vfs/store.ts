// Storage-agnostic, *id-based* interface for the frontend's virtual
// filesystem — the "inode layer". This is an internal implementation
// detail of ./vfs: real filesystems don't expose inode numbers to
// userland either. Everything outside this directory should go through
// the path-based facade in ./fs.ts (ProjectFs/openProjectFs) instead of
// importing ProjectStore directly — the one exception is ProjectState.svelte,
// which needs whole-project operations (listProjects/createProject/
// renameProject/deleteProject) that have no path-based equivalent, since
// a "project" here is closer to a separate mounted volume than a path
// within one.
//
// Every method returns a Promise, even though every implementation so far
// (LocalStorageProjectStore, InMemoryProjectStore) is fully synchronous
// under the hood. That's deliberate: it keeps the interface shape
// identical to whatever a future network-backed (or sync-queue-backed)
// implementation will need, so adopting one later is a drop-in
// replacement — no call sites elsewhere in the app need to change.
import type { FsDirectory, FsFile, FsNode, Project } from "./types";

export interface ProjectStore {
  listProjects(): Promise<Project[]>;
  /**
   * Creates a project whose id is the slug of `name` (see ./slug), so the
   * address is derived, never supplied. Rejects with `DuplicateProjectError`
   * when that address is taken, or `InvalidProjectNameError` when the name
   * has nothing usable in it.
   */
  createProject(name: string): Promise<Project>;
  /**
   * Renames a project, re-deriving its id from the new name and carrying
   * every one of its nodes to the new id. Returns the project under its new
   * address. Rejects if `id` doesn't exist, or if the new address is taken
   * (`DuplicateProjectError`) or unusable (`InvalidProjectNameError`).
   */
  renameProject(id: string, name: string): Promise<Project>;
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
    content: string,
  ): Promise<FsFile>;
  /** Same parentId rules as createFile. */
  createDirectory(
    projectId: string,
    parentId: string | null,
    name: string,
  ): Promise<FsDirectory>;
  /** Bumps the file's revision and updatedAt. Rejects if `fileId` is a directory or doesn't exist. */
  updateFileContent(
    projectId: string,
    fileId: string,
    content: string,
  ): Promise<void>;
  /** Rejects if `nodeId` doesn't exist. */
  renameNode(projectId: string, nodeId: string, name: string): Promise<void>;
  /**
   * Re-parents `nodeId` under `newParentId` (`null` = project root).
   * Rejects if the new parent doesn't exist, isn't a directory, belongs
   * to a different project, or the move would create a cycle (moving a
   * node under itself or one of its own descendants).
   */
  moveNode(
    projectId: string,
    nodeId: string,
    newParentId: string | null,
  ): Promise<void>;
  /** Recursively deletes `nodeId` and everything nested under it. Rejects if it doesn't exist. */
  deleteNode(projectId: string, nodeId: string): Promise<void>;
}
