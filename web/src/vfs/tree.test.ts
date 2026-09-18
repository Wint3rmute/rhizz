import { describe, expect, it } from "vitest";
import type { FsDirectory, FsNode } from "./types";
import {
  descendantsOf,
  resolveDirectory,
  resolveNode,
  splitBasename,
  splitPath,
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
) {
  return {
    id,
    projectId: "p1",
    parentId,
    name,
    kind: "file" as const,
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
//   overview.json (file-overview)
// drone.hcl    (file-drone, root-level)
function fixture(): FsNode[] {
  return [
    dir("dir-components", "components", null),
    file("file-imu", "imu.hcl", "dir-components", 'component "imu" {}'),
    dir("dir-diagrams", "diagrams", null),
    file("file-overview", "overview.json", "dir-diagrams", "{}"),
    file("file-drone", "drone.hcl", null, 'system "drone" {}'),
  ];
}

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

describe("splitPath", () => {
  it("splits a simple path into segments", () => {
    expect(splitPath("components/imu.hcl")).toEqual(["components", "imu.hcl"]);
  });

  it("treats '', '.', '/' and './' as the root (no segments)", () => {
    expect(splitPath("")).toEqual([]);
    expect(splitPath(".")).toEqual([]);
    expect(splitPath("/")).toEqual([]);
    expect(splitPath("./")).toEqual([]);
  });

  it("ignores leading/trailing slashes and embedded '.' segments", () => {
    expect(splitPath("/components/./imu.hcl/")).toEqual([
      "components",
      "imu.hcl",
    ]);
  });
});

describe("resolveNode", () => {
  it("resolves a root-level file", () => {
    expect(resolveNode(fixture(), "drone.hcl")?.id).toBe("file-drone");
  });

  it("resolves a nested file", () => {
    expect(resolveNode(fixture(), "components/imu.hcl")?.id).toBe("file-imu");
  });

  it("resolves a directory", () => {
    expect(resolveNode(fixture(), "components")?.id).toBe("dir-components");
  });

  it("returns undefined for a missing path", () => {
    expect(resolveNode(fixture(), "nope.hcl")).toBeUndefined();
  });

  it("returns undefined when an intermediate segment doesn't exist", () => {
    expect(resolveNode(fixture(), "nope/imu.hcl")).toBeUndefined();
  });

  it("returns undefined for the root path itself", () => {
    expect(resolveNode(fixture(), "")).toBeUndefined();
  });
});

describe("resolveDirectory", () => {
  it("resolves the project root for an empty/'.' path", () => {
    expect(resolveDirectory(fixture(), "")).toEqual({ id: null });
    expect(resolveDirectory(fixture(), ".")).toEqual({ id: null });
  });

  it("resolves an existing directory", () => {
    expect(resolveDirectory(fixture(), "components")).toEqual({
      id: "dir-components",
    });
  });

  it("returns undefined when the path is a file, not a directory", () => {
    expect(resolveDirectory(fixture(), "drone.hcl")).toBeUndefined();
  });

  it("returns undefined when the path doesn't exist", () => {
    expect(resolveDirectory(fixture(), "nope")).toBeUndefined();
  });
});

describe("splitBasename", () => {
  it("splits a nested path into dirname/basename", () => {
    expect(splitBasename("components/imu.hcl")).toEqual({
      dirname: "components",
      basename: "imu.hcl",
    });
  });

  it("uses '' (the root) as dirname for a top-level path", () => {
    expect(splitBasename("drone.hcl")).toEqual({
      dirname: "",
      basename: "drone.hcl",
    });
  });

  it("throws for the root path itself, which has no basename", () => {
    expect(() => splitBasename("")).toThrow();
    expect(() => splitBasename(".")).toThrow();
  });
});
