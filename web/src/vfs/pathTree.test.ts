import { describe, expect, it } from "vitest";
import type { Dirent } from "./fs";
import { buildPathTree } from "./pathTree";

function dirent(path: string, kind: "file" | "directory"): Dirent {
  const segments = path.split("/");
  return {
    name: segments[segments.length - 1],
    path,
    isFile: () => kind === "file",
    isDirectory: () => kind === "directory",
  };
}

// Reduces a tree to nested { name, isDirectory, children } for readable
// assertions, without depending on object identity/field order.
function shape(
  nodes: ReturnType<typeof buildPathTree>,
): { name: string; isDirectory: boolean; children: unknown[] }[] {
  return nodes.map((n) => ({
    name: n.name,
    isDirectory: n.isDirectory,
    children: shape(n.children),
  }));
}

describe("buildPathTree", () => {
  it("returns an empty tree for no entries", () => {
    expect(buildPathTree([])).toEqual([]);
  });

  it("keeps root-level entries at the top level", () => {
    const tree = buildPathTree([
      dirent("main.hcl", "file"),
      dirent("components", "directory"),
    ]);
    expect(shape(tree)).toEqual([
      { name: "components", isDirectory: true, children: [] },
      { name: "main.hcl", isDirectory: false, children: [] },
    ]);
  });

  it("nests files under their parent directory", () => {
    const tree = buildPathTree([
      dirent("components", "directory"),
      dirent("components/imu.hcl", "file"),
      dirent("drone.hcl", "file"),
    ]);
    expect(shape(tree)).toEqual([
      {
        name: "components",
        isDirectory: true,
        children: [{ name: "imu.hcl", isDirectory: false, children: [] }],
      },
      { name: "drone.hcl", isDirectory: false, children: [] },
    ]);
  });

  it("handles multiple levels of nesting", () => {
    const tree = buildPathTree([
      dirent("a", "directory"),
      dirent("a/b", "directory"),
      dirent("a/b/c.hcl", "file"),
    ]);
    expect(shape(tree)).toEqual([
      {
        name: "a",
        isDirectory: true,
        children: [{
          name: "b",
          isDirectory: true,
          children: [{ name: "c.hcl", isDirectory: false, children: [] }],
        }],
      },
    ]);
  });

  it("sorts directories before files, then alphabetically within each", () => {
    const tree = buildPathTree([
      dirent("z.hcl", "file"),
      dirent("b-dir", "directory"),
      dirent("a.hcl", "file"),
      dirent("a-dir", "directory"),
    ]);
    expect(tree.map((n) => n.name)).toEqual([
      "a-dir",
      "b-dir",
      "a.hcl",
      "z.hcl",
    ]);
  });

  it("produces the same tree regardless of input order", () => {
    const entries = [
      dirent("components", "directory"),
      dirent("components/imu.hcl", "file"),
      dirent("drone.hcl", "file"),
    ];
    const forward = buildPathTree(entries);
    const reversed = buildPathTree([...entries].reverse());
    expect(shape(forward)).toEqual(shape(reversed));
  });

  it("treats an entry whose parent isn't present in the list as a root", () => {
    // Simulates a caller passing an already-scoped slice of entries
    // (e.g. one subdirectory's contents) rather than the whole tree.
    const tree = buildPathTree([dirent("components/imu.hcl", "file")]);
    expect(shape(tree)).toEqual([
      { name: "imu.hcl", isDirectory: false, children: [] },
    ]);
  });

  it("includes an empty directory with no children", () => {
    const tree = buildPathTree([dirent("empty", "directory")]);
    expect(shape(tree)).toEqual([
      { name: "empty", isDirectory: true, children: [] },
    ]);
  });
});
