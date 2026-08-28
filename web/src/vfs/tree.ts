// Pure tree/path helpers operating on a flat FsNode[] list (see
// ./types.ts). Deliberately has zero Svelte/DOM/storage dependency, so
// it's unit tested directly (see tree.test.ts) without a store.
//
// This is the *only* place that translates between "/"-joined paths and
// the underlying id/parentId graph — everything above this module (see
// ./fs.ts) talks paths only; nothing outside ./vfs should ever need to
// look at an FsNode's id or parentId directly.
//
// Every function here assumes its input forms a valid forest (no cycles)
// except where noted — cycle *prevention* is the job of wouldCreateCycle,
// called by the store's moveNode before a move is applied; these helpers
// don't re-validate that invariant on every call, aside from pathOf's
// defensive guard below.
import { type FsNode, isDirectory } from "./types";

export interface TreeNode {
  node: FsNode;
  children: TreeNode[];
}

// Builds a nested tree (for sidebar rendering) from a flat node list. A
// node is treated as a root when its parentId is null, *or* when
// parentId points at a node that isn't present in `nodes` — this keeps
// the function correct whether it's called with every node in the store,
// or with a pre-filtered slice, without needing a projectId parameter
// here.
export function buildTree(nodes: FsNode[]): TreeNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const childrenOf = new Map<string, FsNode[]>();
  const roots: FsNode[] = [];

  for (const node of nodes) {
    if (node.parentId !== null && byId.has(node.parentId)) {
      const siblings = childrenOf.get(node.parentId) ?? [];
      siblings.push(node);
      childrenOf.set(node.parentId, siblings);
    } else {
      roots.push(node);
    }
  }

  const toTreeNode = (node: FsNode): TreeNode => ({
    node,
    children: (childrenOf.get(node.id) ?? []).map(toTreeNode),
  });

  return roots.map(toTreeNode);
}

// Returns the "/"-joined path from the node's outermost ancestor down to
// itself, e.g. "components/imu.hcl". Throws if `nodeId` isn't present in
// `nodes`, or if a cycle is detected while walking up — callers are
// expected to pass ids from the same node list, and the store is expected
// to keep that list acyclic (see wouldCreateCycle).
export function pathOf(nodeId: string, nodes: FsNode[]): string {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const start = byId.get(nodeId);
  if (start === undefined) {
    throw new Error(`pathOf: no node with id "${nodeId}"`);
  }

  const segments: string[] = [];
  const seen = new Set<string>();
  let current: FsNode | undefined = start;
  while (current !== undefined) {
    if (seen.has(current.id)) {
      throw new Error(`pathOf: cycle detected involving node "${current.id}"`);
    }
    seen.add(current.id);
    segments.unshift(current.name);
    current = current.parentId === null
      ? undefined
      : byId.get(current.parentId);
  }
  return segments.join("/");
}

// Returns every descendant of `nodeId` (not including the node itself),
// in breadth-first order. Used for recursive directory delete, and by
// wouldCreateCycle below.
export function descendantsOf(nodeId: string, nodes: FsNode[]): FsNode[] {
  const childrenOf = new Map<string, FsNode[]>();
  for (const node of nodes) {
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
  nodeId: string,
  newParentId: string | null,
  nodes: FsNode[],
): boolean {
  if (newParentId === null) return false;
  if (newParentId === nodeId) return true;

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  let current = byId.get(newParentId);
  while (current !== undefined) {
    if (current.id === nodeId) return true;
    if (seen.has(current.id)) return false; // defensive: unrelated pre-existing cycle
    seen.add(current.id);
    current = current.parentId === null
      ? undefined
      : byId.get(current.parentId);
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
export function resolveNode(
  nodes: FsNode[],
  path: string,
): FsNode | undefined {
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
export function splitBasename(
  path: string,
): { dirname: string; basename: string } {
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
