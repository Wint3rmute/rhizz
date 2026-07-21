import { describe, expect, it } from "vitest";
import type { FsDirectory, FsFile, FsNode } from "./types";
import {
  buildTree,
  descendantsOf,
  firstHclFile,
  pathOf,
  projectSources,
  type TreeNode,
  wouldCreateCycle,
} from "./tree";

function dir(id: string, name: string, parentId: string | null): FsDirectory {
  return { id, projectId: "p1", parentId, name, kind: "directory" };
}

function file(
  id: string,
  name: string,
  parentId: string | null,
  content = "",
  contentType: FsFile["contentType"] = "hcl",
): FsFile {
  return {
    id,
    projectId: "p1",
    parentId,
    name,
    kind: "file",
    contentType,
    content,
    revision: 0,
    updatedAt: "2024-01-01T00:00:00.000Z",
  };
}

// A small fixture forest:
//
// components/ (dir-components)
//   imu.hcl    (file-imu)
// diagrams/    (dir-diagrams)
//   overview.json (file-overview, contentType: "diagram-layout")
// drone.hcl    (file-drone, root-level)
function fixture(): FsNode[] {
  return [
    dir("dir-components", "components", null),
    file("file-imu", "imu.hcl", "dir-components", 'component "imu" {}'),
    dir("dir-diagrams", "diagrams", null),
    file(
      "file-overview",
      "overview.json",
      "dir-diagrams",
      "{}",
      "diagram-layout",
    ),
    file("file-drone", "drone.hcl", null, 'system "drone" {}'),
  ];
}

// Reduces a TreeNode[] to nested { name, children } for readable
// assertions, without depending on exact object identity/field order.
function names(tree: TreeNode[]): { name: string; children: unknown[] }[] {
  return tree.map((t) => ({
    name: t.node.name,
    children: names(t.children),
  }));
}

describe("buildTree", () => {
  it("nests children under their parent directory", () => {
    const tree = buildTree(fixture());
    expect(names(tree)).toEqual([
      { name: "components", children: [{ name: "imu.hcl", children: [] }] },
      {
        name: "diagrams",
        children: [{ name: "overview.json", children: [] }],
      },
      { name: "drone.hcl", children: [] },
    ]);
  });

  it("returns an empty tree for an empty node list", () => {
    expect(buildTree([])).toEqual([]);
  });

  it("treats a node whose parentId isn't present in the given list as a root", () => {
    // Simulates being handed a slice that doesn't include the parent,
    // e.g. a future listNodes(projectId) call scoped to a subtree.
    const onlyChild = [file("file-imu", "imu.hcl", "dir-components")];
    const tree = buildTree(onlyChild);
    expect(names(tree)).toEqual([{ name: "imu.hcl", children: [] }]);
  });
});

describe("pathOf", () => {
  it("returns just the name for a root-level node", () => {
    expect(pathOf("file-drone", fixture())).toBe("drone.hcl");
  });

  it("joins ancestor names for a nested node", () => {
    expect(pathOf("file-imu", fixture())).toBe("components/imu.hcl");
  });

  it("throws for an id not present in the given nodes", () => {
    expect(() => pathOf("does-not-exist", fixture())).toThrow();
  });

  it("throws instead of looping forever when the nodes contain a cycle", () => {
    const a = dir("a", "a", "b");
    const b = dir("b", "b", "a");
    expect(() => pathOf("a", [a, b])).toThrow();
  });
});

describe("descendantsOf", () => {
  it("returns a directory's children", () => {
    const result = descendantsOf("dir-components", fixture());
    expect(result.map((n) => n.name)).toEqual(["imu.hcl"]);
  });

  it("returns an empty array for a leaf file", () => {
    expect(descendantsOf("file-imu", fixture())).toEqual([]);
  });

  it("returns an empty array for a node with no descendants at all", () => {
    expect(descendantsOf("file-drone", fixture())).toEqual([]);
  });

  it("includes grandchildren, not just direct children", () => {
    const nodes = [
      dir("root", "root", null),
      dir("mid", "mid", "root"),
      file("leaf", "leaf.hcl", "mid"),
    ];
    const result = descendantsOf("root", nodes);
    expect(result.map((n) => n.id).sort()).toEqual(["leaf", "mid"]);
  });
});

describe("wouldCreateCycle", () => {
  it("is always false when moving to the project root", () => {
    expect(wouldCreateCycle("dir-components", null, fixture())).toBe(false);
  });

  it("is true when a node is moved under itself", () => {
    expect(wouldCreateCycle("dir-components", "dir-components", fixture()))
      .toBe(true);
  });

  it("is true when a node is moved under one of its own descendants", () => {
    // Moving "components" under its own child "imu.hcl" would create a
    // cycle.
    expect(wouldCreateCycle("dir-components", "file-imu", fixture())).toBe(
      true,
    );
  });

  it("is false when moving under an unrelated node", () => {
    expect(wouldCreateCycle("dir-components", "dir-diagrams", fixture()))
      .toBe(false);
  });
});

describe("firstHclFile", () => {
  it("returns the first hcl-content file", () => {
    const result = firstHclFile(fixture());
    expect(result?.id).toBe("file-imu");
  });

  it("skips directories and diagram-layout files", () => {
    const nodes = [
      dir("d", "d", null),
      file("layout", "layout.json", null, "{}", "diagram-layout"),
      file("main", "main.hcl", null, 'system "x" {}'),
    ];
    expect(firstHclFile(nodes)?.id).toBe("main");
  });

  it("returns null when there are no hcl files", () => {
    const nodes = [file("layout", "layout.json", null, "{}", "diagram-layout")];
    expect(firstHclFile(nodes)).toBeNull();
  });

  it("returns null for an empty node list", () => {
    expect(firstHclFile([])).toBeNull();
  });
});

describe("projectSources", () => {
  it("includes only hcl-content files, mapped to filename/content", () => {
    const sources = projectSources(fixture());
    expect(sources).toEqual([
      { filename: "components/imu.hcl", content: 'component "imu" {}' },
      { filename: "drone.hcl", content: 'system "drone" {}' },
    ]);
  });

  it("excludes diagram-layout files", () => {
    const sources = projectSources(fixture());
    expect(sources.some((s) => s.filename.includes("overview.json"))).toBe(
      false,
    );
  });

  it("returns an empty array when there are no hcl files", () => {
    const nodes = [file("f", "layout.json", null, "{}", "diagram-layout")];
    expect(projectSources(nodes)).toEqual([]);
  });
});
