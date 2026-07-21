// Pure, synchronous operations on VfsData — the single JSON-serializable
// snapshot of every project and every node. Shared by every ProjectStore
// implementation (LocalStorageProjectStore, InMemoryProjectStore, ...) so
// business rules (validation, cascading deletes, "project last touched"
// bookkeeping) live in exactly one place instead of being reimplemented
// per backend. Every function either returns a new VfsData (never
// mutating its input) or throws; none of them perform I/O — that's the
// caller's job (see localStorageStore.ts/inMemoryStore.ts).
import {
  type FsDirectory,
  type FsFile,
  type FsFileContentType,
  type FsNode,
  isDirectory,
  isFile,
  type Project,
} from "./types";
import { descendantsOf, wouldCreateCycle } from "./tree";

export interface VfsData {
  version: 1;
  projects: Project[];
  nodes: FsNode[];
}

export function emptyVfsData(): VfsData {
  return { version: 1, projects: [], nodes: [] };
}

function findProject(data: VfsData, id: string): Project {
  const project = data.projects.find((p) => p.id === id);
  if (project === undefined) {
    throw new Error(`No project with id "${id}"`);
  }
  return project;
}

function findNode(data: VfsData, id: string): FsNode {
  const node = data.nodes.find((n) => n.id === id);
  if (node === undefined) {
    throw new Error(`No node with id "${id}"`);
  }
  return node;
}

// Bumps a project's updatedAt to reflect that one of its nodes changed.
// Returns a new array rather than mutating `projects`.
function touchProject(
  projects: Project[],
  projectId: string,
  now: string,
): Project[] {
  return projects.map((p) => p.id === projectId ? { ...p, updatedAt: now } : p);
}

// Validates that `parentId` (if given) refers to an existing directory
// belonging to `projectId`. Throws otherwise — used by both node creation
// (parent must exist before a child can be created under it) and
// moveNode (the new parent must exist and be a directory).
function assertValidParent(
  data: VfsData,
  projectId: string,
  parentId: string | null,
): void {
  if (parentId === null) return;
  const parent = findNode(data, parentId);
  if (parent.projectId !== projectId) {
    throw new Error(
      `Parent "${parentId}" belongs to a different project than "${projectId}"`,
    );
  }
  if (!isDirectory(parent)) {
    throw new Error(`Parent "${parentId}" is a file, not a directory`);
  }
}

export function listProjects(data: VfsData): Project[] {
  return [...data.projects];
}

export function createProject(
  data: VfsData,
  id: string,
  name: string,
  now: string,
): { data: VfsData; project: Project } {
  const project: Project = { id, name, createdAt: now, updatedAt: now };
  return {
    data: { ...data, projects: [...data.projects, project] },
    project,
  };
}

export function deleteProject(data: VfsData, id: string): VfsData {
  findProject(data, id); // throws if missing
  return {
    ...data,
    projects: data.projects.filter((p) => p.id !== id),
    nodes: data.nodes.filter((n) => n.projectId !== id),
  };
}

export function renameProject(
  data: VfsData,
  id: string,
  name: string,
  now: string,
): VfsData {
  findProject(data, id); // throws if missing
  return {
    ...data,
    projects: data.projects.map((p) =>
      p.id === id ? { ...p, name, updatedAt: now } : p
    ),
  };
}

export function listNodes(data: VfsData, projectId: string): FsNode[] {
  return data.nodes.filter((n) => n.projectId === projectId);
}

export function createFile(
  data: VfsData,
  id: string,
  projectId: string,
  parentId: string | null,
  name: string,
  contentType: FsFileContentType,
  content: string,
  now: string,
): { data: VfsData; file: FsFile } {
  findProject(data, projectId); // throws if missing
  assertValidParent(data, projectId, parentId);

  const file: FsFile = {
    id,
    projectId,
    parentId,
    name,
    kind: "file",
    contentType,
    content,
    revision: 0,
    updatedAt: now,
  };

  return {
    data: {
      ...data,
      projects: touchProject(data.projects, projectId, now),
      nodes: [...data.nodes, file],
    },
    file,
  };
}

export function createDirectory(
  data: VfsData,
  id: string,
  projectId: string,
  parentId: string | null,
  name: string,
  now: string,
): { data: VfsData; directory: FsDirectory } {
  findProject(data, projectId); // throws if missing
  assertValidParent(data, projectId, parentId);

  const directory: FsDirectory = {
    id,
    projectId,
    parentId,
    name,
    kind: "directory",
  };

  return {
    data: {
      ...data,
      projects: touchProject(data.projects, projectId, now),
      nodes: [...data.nodes, directory],
    },
    directory,
  };
}

export function updateFileContent(
  data: VfsData,
  fileId: string,
  content: string,
  now: string,
): VfsData {
  const node = findNode(data, fileId);
  if (!isFile(node)) {
    throw new Error(`Node "${fileId}" is a directory, not a file`);
  }

  const updated: FsFile = {
    ...node,
    content,
    revision: node.revision + 1,
    updatedAt: now,
  };
  const nodes = data.nodes.map((n) => n.id === fileId ? updated : n);

  return {
    ...data,
    projects: touchProject(data.projects, node.projectId, now),
    nodes,
  };
}

export function renameNode(
  data: VfsData,
  nodeId: string,
  name: string,
  now: string,
): VfsData {
  const node = findNode(data, nodeId);
  const nodes = data.nodes.map((n) => n.id === nodeId ? { ...n, name } : n);

  return {
    ...data,
    projects: touchProject(data.projects, node.projectId, now),
    nodes,
  };
}

export function moveNode(
  data: VfsData,
  nodeId: string,
  newParentId: string | null,
  now: string,
): VfsData {
  const node = findNode(data, nodeId);
  assertValidParent(data, node.projectId, newParentId);

  if (wouldCreateCycle(nodeId, newParentId, data.nodes)) {
    throw new Error(
      `Moving "${nodeId}" under "${newParentId}" would create a cycle`,
    );
  }

  const nodes = data.nodes.map((n) =>
    n.id === nodeId ? { ...n, parentId: newParentId } : n
  );

  return {
    ...data,
    projects: touchProject(data.projects, node.projectId, now),
    nodes,
  };
}

export function deleteNode(
  data: VfsData,
  nodeId: string,
  now: string,
): VfsData {
  const node = findNode(data, nodeId);
  const toDelete = new Set([
    nodeId,
    ...descendantsOf(nodeId, data.nodes).map((n) => n.id),
  ]);

  return {
    ...data,
    projects: touchProject(data.projects, node.projectId, now),
    nodes: data.nodes.filter((n) => !toDelete.has(n.id)),
  };
}
