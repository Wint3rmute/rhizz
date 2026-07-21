// Pure tree helpers operating on a flat FsNode[] list (see ./types.ts).
// Deliberately has zero Svelte/DOM/storage dependency, so it can be unit
// tested directly (see tree.test.ts) without a store, and reused as-is by
// whatever storage layer Task 56 introduces.
//
// Every function here assumes its input forms a valid forest (no cycles)
// except where noted — cycle *prevention* is the job of wouldCreateCycle,
// called by the store's moveNode before a move is applied; these helpers
// don't re-validate that invariant on every call, aside from pathOf's
// defensive guard below.
import { type FsNode, isFile } from "./types";

// A single compiled source file, matching the `{ filename, content }`
// shape rhizz-core's `compile()` — and thus `CompileResultJS.compile` /
// `compile_system` in rhizz_wasm_wrapper.ts — already accepts.
export interface Source {
  filename: string;
  content: string;
}

export interface TreeNode {
  node: FsNode;
  children: TreeNode[];
}

// Builds a nested tree (for sidebar rendering) from a flat node list. A
// node is treated as a root when its parentId is null, *or* when
// parentId points at a node that isn't present in `nodes` — this keeps
// the function correct whether it's called with every node in the store,
// or with a pre-filtered slice (e.g. `listNodes(projectId)`, once Task 56
// exists), without needing a projectId parameter here.
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

// Filters `nodes` down to hcl-content files and maps them to the
// { filename, content } shape the compiler already accepts (see
// `Source` above). `filename` is the node's full VFS path, so compiler
// diagnostics can point at a meaningful path instead of a synthetic
// placeholder like the current hardcoded "all.hcl".
export function projectSources(nodes: FsNode[]): Source[] {
  return nodes
    .filter(isFile)
    .filter((file) => file.contentType === "hcl")
    .map((file) => ({
      filename: pathOf(file.id, nodes),
      content: file.content,
    }));
}
