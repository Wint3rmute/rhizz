// Domain types for the frontend's virtual filesystem: multiple projects,
// each holding a tree of files/directories. Deliberately has zero
// Svelte/DOM/storage dependency — see ./tree.ts for the pure tree helpers
// built on top of these types, and TASKS.md (Task 56) for the storage
// layer that will read/write them.
//
// IDs are always client-generated (crypto.randomUUID()), never derived
// from names or paths — this keeps identity stable across renames/moves,
// and means a future backend can accept client-created records directly
// (no server-side ID remapping needed for offline-created data).
import { z } from "zod";

const BaseNodeSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  // null => this node sits at the project's root.
  parentId: z.string().nullable(),
  name: z.string(),
});

export const FsDirectorySchema = BaseNodeSchema.extend({
  kind: z.literal("directory"),
});
export type FsDirectory = z.infer<typeof FsDirectorySchema>;

export const FsFileSchema = BaseNodeSchema.extend({
  kind: z.literal("file"),
  // What a file *is* (an hcl source, a diagram layout, ...) is a matter
  // of naming convention (e.g. a ".hcl" extension) for callers to decide
  // — same as a real filesystem, which has no "content type" concept of
  // its own. See vfs/compile.ts for the one place that convention is
  // actually applied.
  content: z.string(),
  // Bumped on every content write. Cheap now; enough for a naive
  // last-write-wins strategy if/when this ever needs to reconcile with a
  // backend.
  revision: z.number().int().nonnegative(),
  updatedAt: z.string(),
});
export type FsFile = z.infer<typeof FsFileSchema>;

// A node in the tree: either a file or a directory, distinguished by
// `kind` (a discriminated union, so `node.kind === "file"` narrows
// TypeScript's view of `node` to FsFile without a manual cast).
export const FsNodeSchema = z.discriminatedUnion("kind", [
  FsDirectorySchema,
  FsFileSchema,
]);
export type FsNode = z.infer<typeof FsNodeSchema>;

export const ProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Project = z.infer<typeof ProjectSchema>;

// Narrows an FsNode to FsFile. Prefer this over a bare `node.kind ===
// "file"` check at call sites that also want the narrowing (e.g. inside
// `.filter(isFile)`).
export function isFile(node: FsNode): node is FsFile {
  return node.kind === "file";
}

// Narrows an FsNode to FsDirectory.
export function isDirectory(node: FsNode): node is FsDirectory {
  return node.kind === "directory";
}
