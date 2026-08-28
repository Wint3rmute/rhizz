import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryProjectStore } from "./inMemoryStore";
import { openProjectFs, type ProjectFs, VfsError } from "./fs";

let store: InMemoryProjectStore;
let projectId: string;
let fs: ProjectFs;

beforeEach(async () => {
  store = new InMemoryProjectStore();
  const project = await store.createProject("p");
  projectId = project.id;
  fs = openProjectFs(store, projectId);
});

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof VfsError) return error.code;
    throw error;
  }
  throw new Error("expected promise to reject");
}

describe("writeFile / readFile", () => {
  it("creates a file that doesn't exist yet", async () => {
    await fs.writeFile("main.hcl", 'system "x" {}');
    expect(await fs.readFile("main.hcl")).toBe('system "x" {}');
  });

  it("overwrites an existing file's content", async () => {
    await fs.writeFile("main.hcl", "v1");
    await fs.writeFile("main.hcl", "v2");
    expect(await fs.readFile("main.hcl")).toBe("v2");
  });

  it("creates a nested file once its parent directory exists", async () => {
    await fs.mkdir("components");
    await fs.writeFile("components/imu.hcl", 'component "imu" {}');
    expect(await fs.readFile("components/imu.hcl")).toBe(
      'component "imu" {}',
    );
  });

  it("readFile rejects with ENOENT for a missing file", async () => {
    expect(await codeOf(fs.readFile("nope.hcl"))).toBe("ENOENT");
  });

  it("readFile rejects with EISDIR when the path is a directory", async () => {
    await fs.mkdir("components");
    expect(await codeOf(fs.readFile("components"))).toBe("EISDIR");
  });

  it("writeFile rejects with ENOENT when the parent directory doesn't exist", async () => {
    expect(await codeOf(fs.writeFile("nope/main.hcl", "x"))).toBe("ENOENT");
  });

  it("writeFile rejects with EISDIR when the path is an existing directory", async () => {
    await fs.mkdir("components");
    expect(await codeOf(fs.writeFile("components", "x"))).toBe("EISDIR");
  });
});

describe("mkdir", () => {
  it("creates a directory", async () => {
    await fs.mkdir("components");
    const stats = await fs.stat("components");
    expect(stats.isDirectory()).toBe(true);
  });

  it("rejects with EEXIST when the path already exists (non-recursive)", async () => {
    await fs.mkdir("components");
    expect(await codeOf(fs.mkdir("components"))).toBe("EEXIST");
  });

  it("rejects with ENOENT when the parent doesn't exist (non-recursive)", async () => {
    expect(await codeOf(fs.mkdir("a/b"))).toBe("ENOENT");
  });

  it("recursive creates every missing intermediate directory", async () => {
    await fs.mkdir("a/b/c", { recursive: true });
    expect((await fs.stat("a")).isDirectory()).toBe(true);
    expect((await fs.stat("a/b")).isDirectory()).toBe(true);
    expect((await fs.stat("a/b/c")).isDirectory()).toBe(true);
  });

  it("recursive is a no-op when the directory already exists", async () => {
    await fs.mkdir("a", { recursive: true });
    await expect(fs.mkdir("a", { recursive: true })).resolves.toBeUndefined();
  });

  it("recursive rejects with ENOTDIR when a segment is actually a file", async () => {
    await fs.writeFile("a", "not a directory");
    expect(await codeOf(fs.mkdir("a/b", { recursive: true }))).toBe(
      "ENOTDIR",
    );
  });
});

describe("readdir", () => {
  it("lists immediate children of the root by default", async () => {
    await fs.writeFile("main.hcl", "");
    await fs.mkdir("components");
    const entries = await fs.readdir();
    expect(entries.map((e) => e.name).toSorted()).toEqual([
      "components",
      "main.hcl",
    ]);
  });

  it("reports isFile/isDirectory correctly", async () => {
    await fs.writeFile("main.hcl", "");
    await fs.mkdir("components");
    const entries = await fs.readdir();
    const file = entries.find((e) => e.name === "main.hcl");
    const dir = entries.find((e) => e.name === "components");
    if (!file || !dir) throw new Error("expected main.hcl and components");
    expect(file.isFile()).toBe(true);
    expect(file.isDirectory()).toBe(false);
    expect(dir.isFile()).toBe(false);
    expect(dir.isDirectory()).toBe(true);
  });

  it("lists the contents of a given subdirectory", async () => {
    await fs.mkdir("components");
    await fs.writeFile("components/imu.hcl", "");
    const entries = await fs.readdir("components");
    expect(entries.map((e) => e.name)).toEqual(["imu.hcl"]);
    expect(entries[0]?.path).toBe("imu.hcl");
  });

  it("returns an empty array for an empty directory", async () => {
    await fs.mkdir("empty");
    expect(await fs.readdir("empty")).toEqual([]);
  });

  it("recursive lists nested entries with full relative paths", async () => {
    await fs.mkdir("components");
    await fs.writeFile("components/imu.hcl", "");
    await fs.writeFile("main.hcl", "");
    const entries = await fs.readdir(".", { recursive: true });
    expect(entries.map((e) => e.path).toSorted()).toEqual([
      "components",
      "components/imu.hcl",
      "main.hcl",
    ]);
  });

  it("rejects with ENOENT for a missing directory", async () => {
    expect(await codeOf(fs.readdir("nope"))).toBe("ENOENT");
  });

  it("rejects with ENOTDIR when the path is a file", async () => {
    await fs.writeFile("main.hcl", "");
    expect(await codeOf(fs.readdir("main.hcl"))).toBe("ENOTDIR");
  });
});

describe("rm", () => {
  it("removes a file", async () => {
    await fs.writeFile("main.hcl", "");
    await fs.rm("main.hcl");
    expect(await codeOf(fs.stat("main.hcl"))).toBe("ENOENT");
  });

  it("removes an empty directory without needing recursive", async () => {
    await fs.mkdir("empty");
    await fs.rm("empty");
    expect(await codeOf(fs.stat("empty"))).toBe("ENOENT");
  });

  it("rejects with ENOTEMPTY for a non-empty directory without recursive", async () => {
    await fs.mkdir("components");
    await fs.writeFile("components/imu.hcl", "");
    expect(await codeOf(fs.rm("components"))).toBe("ENOTEMPTY");
  });

  it("recursive removes a directory and everything inside it", async () => {
    await fs.mkdir("components");
    await fs.writeFile("components/imu.hcl", "");
    await fs.rm("components", { recursive: true });
    expect(await codeOf(fs.stat("components"))).toBe("ENOENT");
    expect(await codeOf(fs.stat("components/imu.hcl"))).toBe("ENOENT");
  });

  it("rejects with ENOENT for a missing path", async () => {
    expect(await codeOf(fs.rm("nope"))).toBe("ENOENT");
  });

  it("force suppresses ENOENT for a missing path", async () => {
    await expect(fs.rm("nope", { force: true })).resolves.toBeUndefined();
  });
});

describe("rename", () => {
  it("renames a file in place", async () => {
    await fs.writeFile("a.hcl", "content");
    await fs.rename("a.hcl", "b.hcl");
    expect(await fs.readFile("b.hcl")).toBe("content");
    expect(await codeOf(fs.readFile("a.hcl"))).toBe("ENOENT");
  });

  it("moves a file into another directory, keeping its name", async () => {
    await fs.mkdir("components");
    await fs.writeFile("a.hcl", "content");
    await fs.rename("a.hcl", "components/a.hcl");
    expect(await fs.readFile("components/a.hcl")).toBe("content");
  });

  it("moves and renames at the same time", async () => {
    await fs.mkdir("components");
    await fs.writeFile("a.hcl", "content");
    await fs.rename("a.hcl", "components/b.hcl");
    expect(await fs.readFile("components/b.hcl")).toBe("content");
  });

  it("rejects with ENOENT when the source doesn't exist", async () => {
    expect(await codeOf(fs.rename("nope.hcl", "a.hcl"))).toBe("ENOENT");
  });

  it("rejects with ENOENT when the destination directory doesn't exist", async () => {
    await fs.writeFile("a.hcl", "");
    expect(await codeOf(fs.rename("a.hcl", "nope/a.hcl"))).toBe("ENOENT");
  });

  it("rejects with EEXIST when the destination path is already taken by a different file", async () => {
    await fs.writeFile("a.hcl", "a-content");
    await fs.writeFile("b.hcl", "b-content");
    expect(await codeOf(fs.rename("a.hcl", "b.hcl"))).toBe("EEXIST");
    // Neither side should have been touched.
    expect(await fs.readFile("a.hcl")).toBe("a-content");
    expect(await fs.readFile("b.hcl")).toBe("b-content");
  });

  it("rejects with EEXIST when the destination path is already taken by a directory", async () => {
    await fs.writeFile("a.hcl", "");
    await fs.mkdir("b");
    expect(await codeOf(fs.rename("a.hcl", "b"))).toBe("EEXIST");
  });

  it("does not reject when the destination path resolves to the same node (no-op rename)", async () => {
    await fs.writeFile("a.hcl", "content");
    await expect(fs.rename("a.hcl", "a.hcl")).resolves.toBeUndefined();
    expect(await fs.readFile("a.hcl")).toBe("content");
  });

  it("never leaves two nodes resolving to the same destination path", async () => {
    await fs.mkdir("components");
    await fs.writeFile("components/a.hcl", "");
    await fs.writeFile("b.hcl", "");
    await expect(
      fs.rename("b.hcl", "components/a.hcl"),
    ).rejects.toThrow();
    // Exactly one entry named "a.hcl" should exist under components/,
    // not two silently-shadowing nodes.
    const entries = await fs.readdir("components");
    expect(entries.filter((e) => e.name === "a.hcl")).toHaveLength(1);
  });

  it("rejects with EINVAL when moving a directory into its own subdirectory", async () => {
    await fs.mkdir("outer");
    await fs.mkdir("outer/inner");
    expect(await codeOf(fs.rename("outer", "outer/inner/outer"))).toBe(
      "EINVAL",
    );
  });
});

describe("stat", () => {
  it("reports isFile() for a file", async () => {
    await fs.writeFile("a.hcl", "");
    const stats = await fs.stat("a.hcl");
    expect(stats.isFile()).toBe(true);
    expect(stats.isDirectory()).toBe(false);
  });

  it("reports isDirectory() for a directory", async () => {
    await fs.mkdir("components");
    const stats = await fs.stat("components");
    expect(stats.isFile()).toBe(false);
    expect(stats.isDirectory()).toBe(true);
  });

  it("rejects with ENOENT for a missing path", async () => {
    expect(await codeOf(fs.stat("nope"))).toBe("ENOENT");
  });
});
