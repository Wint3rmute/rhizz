// Pure tree/path helpers operating on a flat FsNode[] list (see
// ./types.ts). Deliberately has zero Svelte/DOM/storage dependency, so
// it's unit tested directly (see tree.test.ts) without a store.
//
// This is the *only* place that translates between "/"-joined paths and
// the underlying id/parentId graph — everything above this module (see
// ./fs.ts) talks paths only; nothing outside ./vfs should ever need to
// look at an FsNode's id or parentId directly. (Rendering a nested tree
// for a sidebar is a *path*-shaped job — see ./pathTree.ts, which works
// off readdir's flat Dirent[] and never sees an FsNode.)
//
// Every function here assumes its input forms a valid forest (no cycles)
// except where noted — cycle *prevention* is the job of wouldCreateCycle,
// called by the store's moveNode before a move is applied.
import { type FsNode, isDirectory } from "./types";

// Returns every descendant of `nodeId` (not including the node itself),
// in breadth-first order. Used for recursive directory delete, and by
// wouldCreateCycle below.
//
// Scoped to `projectId`: only that project's nodes can be a descendant, so a
// node in another project that happens to share an id is not walked into.
export function descendantsOf(
  projectId: string,
  nodeId: string,
  nodes: FsNode[],
): FsNode[] {
  const childrenOf = new Map<string, FsNode[]>();
  for (const node of nodes) {
    if (node.projectId !== projectId) continue;
    if (node.parentId === null) continue;
    const siblings = childrenOf.get(node.parentId) ?? [];
    siblings.push(node);
    childrenOf.set(node.parentId, siblings);
  }

  const result: FsNode[] = [];
  const queue = [...(childrenOf.get(nodeId) ?? [])];
  while (queue.length > 0) {
    const next = queue.shift();
    if (next === undefined) break;
    result.push(next);
    queue.push(...(childrenOf.get(next.id) ?? []));
  }
  return result;
}

// Whether re-parenting `nodeId` under `newParentId` would create a cycle
// — i.e. `newParentId` is `nodeId` itself, or one of its descendants.
// Moving to the project root (`newParentId === null`) is never a cycle.
// Intended to guard a future ProjectStore.moveNode before it applies a
// move.
export function wouldCreateCycle(
  projectId: string,
  nodeId: string,
  newParentId: string | null,
  nodes: FsNode[],
): boolean {
  if (newParentId === null) return false;
  if (newParentId === nodeId) return true;

  const byId = new Map(
    nodes.filter((n) => n.projectId === projectId).map((n) => [n.id, n]),
  );
  const seen = new Set<string>();
  let current = byId.get(newParentId);
  while (current !== undefined) {
    if (current.id === nodeId) return true;
    if (seen.has(current.id)) return false; // defensive: unrelated pre-existing cycle
    seen.add(current.id);
    current =
      current.parentId === null ? undefined : byId.get(current.parentId);
  }
  return false;
}

// Splits a "/"-joined path into non-empty segments, ignoring leading/
// trailing slashes and "." segments — so "", ".", "/", "./" all resolve
// to the project root (an empty segment list). Parent-relative ".."
// segments aren't supported; every path is resolved from the project
// root down, matching how callers (see fs.ts) always deal in
// project-rooted paths, never a "current working directory".
export function splitPath(path: string): string[] {
  return path.split("/").filter((segment) => segment !== "" && segment !== ".");
}

// Resolves a path to the node at that path, or `undefined` if any
// segment along the way doesn't exist (or the path is the project root
// itself, which has no corresponding FsNode).
export function resolveNode(nodes: FsNode[], path: string): FsNode | undefined {
  let parentId: string | null = null;
  let found: FsNode | undefined;
  for (const segment of splitPath(path)) {
    found = nodes.find((n) => n.parentId === parentId && n.name === segment);
    if (found === undefined) return undefined;
    parentId = found.id;
  }
  return found;
}

// Resolves the *directory* a path refers to, returning its id (or `null`
// for the project root itself). Returns `undefined` if the path doesn't
// exist, or exists but isn't a directory. Used by operations that need a
// parentId to act within (mkdir, writeFile, readdir, rename's
// destination).
export function resolveDirectory(
  nodes: FsNode[],
  path: string,
): { id: string | null } | undefined {
  const segments = splitPath(path);
  if (segments.length === 0) return { id: null };

  const node = resolveNode(nodes, path);
  if (node === undefined || !isDirectory(node)) return undefined;
  return { id: node.id };
}

// Splits a path into its parent directory path and final segment (the
// "basename"), e.g. "components/imu.hcl" -> { dirname: "components",
// basename: "imu.hcl" }. A single-segment path's dirname is "" (the
// project root). Throws for an empty/root path, which has no basename.
export function splitBasename(path: string): {
  dirname: string;
  basename: string;
} {
  const segments = splitPath(path);
  const basename = segments[segments.length - 1];
  if (basename === undefined) {
    throw new Error(`splitBasename: "${path}" has no basename (it's the root)`);
  }
  return {
    dirname: segments.slice(0, -1).join("/"),
    basename,
  };
}

// Resolves the project-relative path of the node with `nodeId` (e.g.
// "views/main.hcl"), or `undefined` when no such node exists in the
// project. The inverse of resolveNode: walks parentId links up to the
// project root. Scoped to `projectId`, so a same-id node in another project
// is never followed.
export function pathOfNode(
  projectId: string,
  nodeId: string,
  nodes: FsNode[],
): string | undefined {
  const byId = new Map(
    nodes.filter((n) => n.projectId === projectId).map((n) => [n.id, n]),
  );
  const segments: string[] = [];
  const seen = new Set<string>();
  let id: string | null = nodeId;
  while (id !== null) {
    if (seen.has(id)) return undefined; // defensive: a cycle
    seen.add(id);
    const node = byId.get(id);
    if (node === undefined) return undefined; // dangling parent
    segments.unshift(node.name);
    id = node.parentId;
  }
  return segments.join("/");
}

// Every file and directory entry of one project as server-write entries:
// project-relative paths with content for files, bare paths for
// directories. Used by the HTTP backend's per-project writes; sorted by
// path so payloads are deterministic.
export function projectFiles(
  projectId: string,
  nodes: FsNode[],
): { path: string; content?: string }[] {
  const entries: { path: string; content?: string }[] = [];
  for (const node of nodes) {
    if (node.projectId !== projectId) continue;
    const path = pathOfNode(projectId, node.id, nodes);
    if (path === undefined) continue; // defensive: dangling parent
    if (isDirectory(node)) entries.push({ path });
    else entries.push({ path, content: node.content });
  }
  return entries.sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
}
