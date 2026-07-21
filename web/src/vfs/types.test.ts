import { describe, expect, it } from "vitest";
import {
  type FsDirectory,
  FsDirectorySchema,
  type FsFile,
  FsFileSchema,
  FsNodeSchema,
  isDirectory,
  isFile,
  ProjectSchema,
} from "./types";

const validFile: FsFile = {
  id: "file-1",
  projectId: "project-1",
  parentId: null,
  name: "drone.hcl",
  kind: "file",
  contentType: "hcl",
  content: 'system "drone" {}',
  revision: 0,
  updatedAt: "2024-01-01T00:00:00.000Z",
};

const validDirectory: FsDirectory = {
  id: "dir-1",
  projectId: "project-1",
  parentId: null,
  name: "components",
  kind: "directory",
};

describe("FsFileSchema", () => {
  it("accepts a well-formed file", () => {
    expect(FsFileSchema.safeParse(validFile).success).toBe(true);
  });

  it("rejects a file with a non-integer revision", () => {
    const result = FsFileSchema.safeParse({ ...validFile, revision: 1.5 });
    expect(result.success).toBe(false);
  });

  it("rejects a file with a negative revision", () => {
    const result = FsFileSchema.safeParse({ ...validFile, revision: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown contentType", () => {
    const result = FsFileSchema.safeParse({
      ...validFile,
      contentType: "yaml",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a file missing required fields", () => {
    const { content, ...withoutContent } = validFile;
    expect(FsFileSchema.safeParse(withoutContent).success).toBe(false);
  });
});

describe("FsDirectorySchema", () => {
  it("accepts a well-formed directory", () => {
    expect(FsDirectorySchema.safeParse(validDirectory).success).toBe(true);
  });

  it("rejects a directory carrying file-only fields (wrong kind literal aside)", () => {
    // A directory schema doesn't know about `content`/`revision`, but
    // extra keys should still parse fine (zod ignores unknown keys by
    // default) — kind mismatch is what actually matters.
    const result = FsDirectorySchema.safeParse({
      ...validDirectory,
      kind: "file",
    });
    expect(result.success).toBe(false);
  });
});

describe("FsNodeSchema (discriminated union)", () => {
  it("accepts both a file and a directory", () => {
    expect(FsNodeSchema.safeParse(validFile).success).toBe(true);
    expect(FsNodeSchema.safeParse(validDirectory).success).toBe(true);
  });

  it("rejects a node with an unrecognized kind", () => {
    const result = FsNodeSchema.safeParse({
      ...validDirectory,
      kind: "symlink",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a node missing parentId (null is required, not optional)", () => {
    const { parentId, ...withoutParentId } = validDirectory;
    expect(FsNodeSchema.safeParse(withoutParentId).success).toBe(false);
  });
});

describe("ProjectSchema", () => {
  it("accepts a well-formed project", () => {
    const project = {
      id: "project-1",
      name: "drone-v1",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    };
    expect(ProjectSchema.safeParse(project).success).toBe(true);
  });

  it("rejects a project missing a name", () => {
    const { name, ...withoutName } = {
      id: "project-1",
      name: "drone-v1",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    };
    expect(ProjectSchema.safeParse(withoutName).success).toBe(false);
  });
});

describe("isFile / isDirectory", () => {
  it("isFile is true for a file and false for a directory", () => {
    expect(isFile(validFile)).toBe(true);
    expect(isFile(validDirectory)).toBe(false);
  });

  it("isDirectory is true for a directory and false for a file", () => {
    expect(isDirectory(validDirectory)).toBe(true);
    expect(isDirectory(validFile)).toBe(false);
  });
});
