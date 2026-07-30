// The virtual filesystem's public, path-based API — deliberately shaped
// after `node:fs/promises` (readFile/writeFile/mkdir/readdir/rm/rename/
// stat), so that browsing/reading/writing a project reads like ordinary
// filesystem code. This is the *only* part of ./vfs that code outside
// this directory should ever import for file access — it never exposes
// an FsNode, an id, or a parentId to its caller. Internally it's backed
// by the id-based ProjectStore ("inode layer", ./store.ts) plus the pure
// path<->node resolution helpers in ./tree.ts, exactly the way a real
// filesystem's syscalls resolve a path down to an inode without ever
// handing the inode number back to userland.
import type { ProjectStore } from "./store";
import { type FsNode, isDirectory, isFile } from "./types";
import {
  resolveDirectory,
  resolveNode,
  splitBasename,
  splitPath,
  wouldCreateCycle,
} from "./tree";

// Thrown for every failure, with a Node-style `code` (e.g. "ENOENT",
// "EISDIR") so callers can branch on `error.code` the same way they
// would for a real `node:fs` error.
export class VfsError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "VfsError";
    this.code = code;
  }
}

// Mirrors the handful of `fs.Dirent` methods callers actually need.
export interface Dirent {
  /** The entry's own name (its final path segment), not a full path. */
  name: string;
  /** Path relative to the `readdir` call's own `path` argument. */
  path: string;
  isFile(): boolean;
  isDirectory(): boolean;
}

// Mirrors the handful of `fs.Stats` methods callers actually need.
export interface Stats {
  isFile(): boolean;
  isDirectory(): boolean;
}

export interface ProjectFs {
  readFile(path: string): Promise<string>;
  /** Creates the file if it doesn't exist yet; overwrites it if it does. */
  writeFile(path: string, content: string): Promise<void>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  /** Defaults to listing the project root. */
  readdir(path?: string, options?: { recursive?: boolean }): Promise<Dirent[]>;
  /** `force: true` suppresses ENOENT for an already-missing path. */
  rm(
    path: string,
    options?: { recursive?: boolean; force?: boolean },
  ): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  stat(path: string): Promise<Stats>;
}

// Opens a filesystem view scoped to one project. `store` is the internal
// id-based ProjectStore; nothing above this function ever needs to touch
// it directly.
export function openProjectFs(
  store: ProjectStore,
  projectId: string,
): ProjectFs {
  return {
    async readFile(path) {
      const nodes = await store.listNodes(projectId);
      const node = resolveNode(nodes, path);
      if (node === undefined) {
        throw new VfsError("ENOENT", `no such file, open '${path}'`);
      }
      if (!isFile(node)) {
        throw new VfsError(
          "EISDIR",
          `illegal operation on a directory, read '${path}'`,
        );
      }
      return node.content;
    },

    async writeFile(path, content) {
      const nodes = await store.listNodes(projectId);
      const { dirname, basename } = splitBasename(path);
      const parent = resolveDirectory(nodes, dirname);
      if (parent === undefined) {
        throw new VfsError("ENOENT", `no such directory, open '${path}'`);
      }

      const existing = nodes.find(
        (n) => n.parentId === parent.id && n.name === basename,
      );
      if (existing === undefined) {
        await store.createFile(projectId, parent.id, basename, content);
        return;
      }
      if (isDirectory(existing)) {
        throw new VfsError(
          "EISDIR",
          `illegal operation on a directory, open '${path}'`,
        );
      }
      await store.updateFileContent(existing.id, content);
    },

    async mkdir(path, options = {}) {
      const segments = splitPath(path);
      if (segments.length === 0) return; // the root always "exists"

      if (!options.recursive) {
        const { dirname, basename } = splitBasename(path);
        const nodes = await store.listNodes(projectId);
        const parent = resolveDirectory(nodes, dirname);
        if (parent === undefined) {
          throw new VfsError("ENOENT", `no such directory, mkdir '${path}'`);
        }
        const existing = nodes.find(
          (n) => n.parentId === parent.id && n.name === basename,
        );
        if (existing !== undefined) {
          throw new VfsError("EEXIST", `file already exists, mkdir '${path}'`);
        }
        await store.createDirectory(projectId, parent.id, basename);
        return;
      }

      // Recursive: walk segment by segment (like `mkdir -p`), creating
      // whatever's missing and reusing whatever already exists.
      let parentId: string | null = null;
      for (const segment of segments) {
        const nodes = await store.listNodes(projectId);
        const existing = nodes.find(
          (n) => n.parentId === parentId && n.name === segment,
        );
        if (existing === undefined) {
          const created = await store.createDirectory(
            projectId,
            parentId,
            segment,
          );
          parentId = created.id;
        } else if (isDirectory(existing)) {
          parentId = existing.id;
        } else {
          throw new VfsError("ENOTDIR", `not a directory, mkdir '${path}'`);
        }
      }
    },

    async readdir(path = ".", options = {}) {
      const nodes = await store.listNodes(projectId);
      const dir = resolveDirectory(nodes, path);
      if (dir === undefined) {
        const target = resolveNode(nodes, path);
        throw target !== undefined
          ? new VfsError("ENOTDIR", `not a directory, scandir '${path}'`)
          : new VfsError("ENOENT", `no such directory, scandir '${path}'`);
      }

      const toDirent = (n: FsNode, entryPath: string): Dirent => ({
        name: n.name,
        path: entryPath,
        isFile: () => isFile(n),
        isDirectory: () => isDirectory(n),
      });

      if (!options.recursive) {
        return nodes
          .filter((n) => n.parentId === dir.id)
          .map((n) => toDirent(n, n.name));
      }

      const results: Dirent[] = [];
      const walk = (parentId: string | null, prefix: string) => {
        for (const n of nodes.filter((c) => c.parentId === parentId)) {
          const entryPath = prefix ? `${prefix}/${n.name}` : n.name;
          results.push(toDirent(n, entryPath));
          if (isDirectory(n)) walk(n.id, entryPath);
        }
      };
      walk(dir.id, "");
      return results;
    },

    async rm(path, options = {}) {
      const nodes = await store.listNodes(projectId);
      const node = resolveNode(nodes, path);
      if (node === undefined) {
        if (options.force) return;
        throw new VfsError(
          "ENOENT",
          `no such file or directory, rm '${path}'`,
        );
      }

      if (isDirectory(node) && !options.recursive) {
        const hasChildren = nodes.some((n) => n.parentId === node.id);
        if (hasChildren) {
          throw new VfsError(
            "ENOTEMPTY",
            `directory not empty, rmdir '${path}'`,
          );
        }
      }

      await store.deleteNode(node.id);
    },

    async rename(oldPath, newPath) {
      const nodes = await store.listNodes(projectId);
      const node = resolveNode(nodes, oldPath);
      if (node === undefined) {
        throw new VfsError(
          "ENOENT",
          `no such file or directory, rename '${oldPath}' -> '${newPath}'`,
        );
      }

      const { dirname, basename } = splitBasename(newPath);
      const newParent = resolveDirectory(nodes, dirname);
      if (newParent === undefined) {
        throw new VfsError(
          "ENOENT",
          `no such directory, rename '${oldPath}' -> '${newPath}'`,
        );
      }

      // Without this check, renaming onto an occupied path would leave
      // two distinct nodes resolving to the same path — resolveNode()
      // would then return whichever one happens to come first, silently
      // shadowing the other. Renaming a path onto itself (same node) is
      // fine and a no-op, same as real fs.rename.
      const existingAtDestination = nodes.find(
        (n) => n.parentId === newParent.id && n.name === basename,
      );
      if (
        existingAtDestination !== undefined &&
        existingAtDestination.id !== node.id
      ) {
        throw new VfsError(
          "EEXIST",
          `dest already exists, rename '${oldPath}' -> '${newPath}'`,
        );
      }

      if (newParent.id !== node.parentId) {
        if (wouldCreateCycle(node.id, newParent.id, nodes)) {
          throw new VfsError(
            "EINVAL",
            `cannot move '${oldPath}' into its own subdirectory, rename '${oldPath}' -> '${newPath}'`,
          );
        }
        await store.moveNode(node.id, newParent.id);
      }
      if (basename !== node.name) {
        await store.renameNode(node.id, basename);
      }
    },

    async stat(path) {
      const nodes = await store.listNodes(projectId);
      const node = resolveNode(nodes, path);
      if (node === undefined) {
        throw new VfsError(
          "ENOENT",
          `no such file or directory, stat '${path}'`,
        );
      }
      return {
        isFile: () => isFile(node),
        isDirectory: () => isDirectory(node),
      };
    },
  };
}
