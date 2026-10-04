// Domain types for the frontend's virtual filesystem: multiple projects,
// each holding a tree of files/directories. Deliberately has zero
// Svelte/DOM/storage dependency — see ./tree.ts for the pure tree helpers
// built on top of these types, and TASKS/FINISHED.md (Task 56) for the storage
// layer that will read/write them.
//
// Two kinds of id, deliberately different: a *project*'s id is derived from
// its name (the slug it is addressed by — see ./slug), so renaming a project
// re-addresses it; everything *inside* a project (files, directories) is
// client-generated with crypto.randomUUID(), because those names are
// user-renameable and their identity has to survive a rename. Either way a
// future backend can accept client-created records directly (no server-side
// id remapping needed for offline-created data).
//
// **A node id must be unique across the whole VFS, not merely within its
// project.** `nodes` is one flat array, and the store resolves a node by id
// against all of it: `findNode` (./operations) takes the first match, and
// `updateFileContent` rewrites *every* node whose id matches. Ids that only
// have to be unique per project therefore let a write in one project land in
// another — rhizz-server learned this the hard way, having first derived ids
// from project-relative paths (`views/main.hcl`), which collide across every
// project that has a `views/main.hcl`. Its ids are now project-qualified
// (`drone/views/main.hcl`) for exactly this reason; any future backend owes
// the same.
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
