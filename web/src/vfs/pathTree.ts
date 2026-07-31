// Builds a nested tree purely from ProjectFs.readdir(".", { recursive: true
// })'s flat Dirent[] output — no ids, no ProjectStore, just path strings.
// This is what FileTree.svelte (the editor's file-tree sidebar) renders;
// unlike vfs/tree.ts's id-based buildTree(), nothing here ever needs to see
// an FsNode or a parentId, keeping the "paths only" boundary established by
// fs.ts intact even in tree-shaping code that lives outside ./vfs.
import type { Dirent } from "./fs";

export interface PathTreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children: PathTreeNode[];
}

// Directories before files, then alphabetically within each — the
// conventional file-tree sidebar ordering.
function compareNodes(a: PathTreeNode, b: PathTreeNode): number {
  if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
  return a.name.localeCompare(b.name);
}

export function buildPathTree(entries: Dirent[]): PathTreeNode[] {
  const byPath = new Map<string, PathTreeNode>();
  const roots: PathTreeNode[] = [];

  // Sorting by depth first guarantees a directory's own node exists in
  // `byPath` before any of its children are processed, regardless of
  // what order `entries` happens to arrive in.
  const byDepth = [...entries].sort(
    (a, b) => a.path.split("/").length - b.path.split("/").length,
  );

  for (const entry of byDepth) {
    const segments = entry.path.split("/");
    const parentPath = segments.slice(0, -1).join("/");
    const node: PathTreeNode = {
      name: entry.name,
      path: entry.path,
      isDirectory: entry.isDirectory(),
      children: [],
    };
    byPath.set(entry.path, node);

    // Defensive fallback (parentPath not found among entries): treat the
    // node as a root rather than silently dropping it.
    const parent = parentPath === "" ? undefined : byPath.get(parentPath);
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortRecursively = (nodes: PathTreeNode[]): PathTreeNode[] => {
    nodes.sort(compareNodes);
    for (const node of nodes) sortRecursively(node.children);
    return nodes;
  };
  return sortRecursively(roots);
}
