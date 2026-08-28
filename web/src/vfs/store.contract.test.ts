// A single behavioral contract, run against every ProjectStore
// implementation, so a new implementation (a future backend-backed one,
// for instance) is verified against the same rules instead of hand-rolled
// tests being written for each one separately.
import { describe, expect, it } from "vitest";
import { InMemoryProjectStore } from "./inMemoryStore";
import {
  LocalStorageProjectStore,
  type StorageLike,
} from "./localStorageStore";
import type { ProjectStore } from "./store";

export function runProjectStoreContractTests(
  label: string,
  makeStore: () => ProjectStore,
): void {
  describe(`ProjectStore contract: ${label}`, () => {
    describe("project CRUD", () => {
      it("starts with no projects", async () => {
        const store = makeStore();
        expect(await store.listProjects()).toEqual([]);
      });

      it("creates a project with a stable id and matching name", async () => {
        const store = makeStore();
        const project = await store.createProject("drone-v1");
        expect(project.name).toBe("drone-v1");
        expect(project.id).toBeTruthy();
        expect(project.createdAt).toBe(project.updatedAt);
        expect(await store.listProjects()).toEqual([project]);
      });

      it("deletes a project", async () => {
        const store = makeStore();
        const project = await store.createProject("temp");
        await store.deleteProject(project.id);
        expect(await store.listProjects()).toEqual([]);
      });

      it("rejects deleting an unknown project", async () => {
        const store = makeStore();
        await expect(store.deleteProject("does-not-exist")).rejects.toThrow();
      });

      it("renames a project", async () => {
        const store = makeStore();
        const project = await store.createProject("old-name");
        await store.renameProject(project.id, "new-name");
        const [renamed] = await store.listProjects();
        expect(renamed?.name).toBe("new-name");
        expect(renamed?.updatedAt).not.toBe(project.updatedAt);
      });

      it("rejects renaming an unknown project", async () => {
        const store = makeStore();
        await expect(
          store.renameProject("does-not-exist", "x"),
        ).rejects.toThrow();
      });

      it("deleting a project also deletes its nodes", async () => {
        const store = makeStore();
        const project = await store.createProject("temp");
        await store.createFile(project.id, null, "a.hcl", "");
        await store.deleteProject(project.id);
        expect(await store.listNodes(project.id)).toEqual([]);
      });
    });

    describe("file/directory CRUD", () => {
      it("creates a root-level directory and file", async () => {
        const store = makeStore();
        const project = await store.createProject("p");
        const dir = await store.createDirectory(
          project.id,
          null,
          "components",
        );
        const file = await store.createFile(
          project.id,
          null,
          "drone.hcl",
          'system "drone" {}',
        );
        const nodes = await store.listNodes(project.id);
        expect(nodes.map((n) => n.id).toSorted()).toEqual(
          [dir.id, file.id].toSorted(),
        );
        expect(file.revision).toBe(0);
      });

      it("creates a nested file under a directory", async () => {
        const store = makeStore();
        const project = await store.createProject("p");
        const dir = await store.createDirectory(project.id, null, "components");
        const file = await store.createFile(
          project.id,
          dir.id,
          "imu.hcl",
          "",
        );
        expect(file.parentId).toBe(dir.id);
      });

      it("rejects creating a file under an unknown project", async () => {
        const store = makeStore();
        await expect(
          store.createFile("nope", null, "a.hcl", ""),
        ).rejects.toThrow();
      });

      it("rejects creating a node whose parent is a file, not a directory", async () => {
        const store = makeStore();
        const project = await store.createProject("p");
        const file = await store.createFile(
          project.id,
          null,
          "a.hcl",
          "",
        );
        await expect(
          store.createFile(project.id, file.id, "b.hcl", ""),
        ).rejects.toThrow();
      });

      it("rejects creating a node under a parent from a different project", async () => {
        const store = makeStore();
        const projectA = await store.createProject("a");
        const projectB = await store.createProject("b");
        const dirInA = await store.createDirectory(projectA.id, null, "dir");
        await expect(
          store.createFile(projectB.id, dirInA.id, "x.hcl", ""),
        ).rejects.toThrow();
      });

      it("rejects creating a file when a sibling file already has that name", async () => {
        const store = makeStore();
        const project = await store.createProject("p");
        await store.createFile(project.id, null, "a.hcl", "first");
        await expect(
          store.createFile(project.id, null, "a.hcl", "second"),
        ).rejects.toThrow();
      });

      it("rejects creating a directory when a sibling directory already has that name", async () => {
        const store = makeStore();
        const project = await store.createProject("p");
        await store.createDirectory(project.id, null, "components");
        await expect(
          store.createDirectory(project.id, null, "components"),
        ).rejects.toThrow();
      });

      it("rejects creating a directory when a sibling file already has that name", async () => {
        const store = makeStore();
        const project = await store.createProject("p");
        await store.createFile(project.id, null, "components", "");
        await expect(
          store.createDirectory(project.id, null, "components"),
        ).rejects.toThrow();
      });

      it("rejects creating a file when a sibling directory already has that name", async () => {
        const store = makeStore();
        const project = await store.createProject("p");
        await store.createDirectory(project.id, null, "components");
        await expect(
          store.createFile(project.id, null, "components", ""),
        ).rejects.toThrow();
      });

      it("allows two siblings with the same name under different parents", async () => {
        const store = makeStore();
        const project = await store.createProject("p");
        const dirA = await store.createDirectory(project.id, null, "a");
        const dirB = await store.createDirectory(project.id, null, "b");
        await expect(
          store.createFile(project.id, dirA.id, "same.hcl", ""),
        ).resolves.toBeTruthy();
        await expect(
          store.createFile(project.id, dirB.id, "same.hcl", ""),
        ).resolves.toBeTruthy();
      });

      it("allows two siblings with the same name in different projects", async () => {
        const store = makeStore();
        const projectA = await store.createProject("a");
        const projectB = await store.createProject("b");
        await expect(
          store.createFile(projectA.id, null, "same.hcl", ""),
        ).resolves.toBeTruthy();
        await expect(
          store.createFile(projectB.id, null, "same.hcl", ""),
        ).resolves.toBeTruthy();
      });
    });

    describe("rename", () => {
      it("renames a node", async () => {
        const store = makeStore();
        const project = await store.createProject("p");
        const file = await store.createFile(
          project.id,
          null,
          "a.hcl",
          "",
        );
        await store.renameNode(file.id, "b.hcl");
        const [node] = await store.listNodes(project.id);
        expect(node?.name).toBe("b.hcl");
      });

      it("rejects renaming an unknown node", async () => {
        const store = makeStore();
        await expect(store.renameNode("nope", "x")).rejects.toThrow();
      });

      it("rejects renaming a node to a name a sibling already has", async () => {
        const store = makeStore();
        const project = await store.createProject("p");
        await store.createFile(project.id, null, "a.hcl", "");
        const b = await store.createFile(project.id, null, "b.hcl", "");
        await expect(store.renameNode(b.id, "a.hcl")).rejects.toThrow();
      });

      it("allows renaming a node to its own current name (no-op)", async () => {
        const store = makeStore();
        const project = await store.createProject("p");
        const file = await store.createFile(project.id, null, "a.hcl", "");
        await expect(store.renameNode(file.id, "a.hcl")).resolves
          .toBeUndefined();
      });
    });

    describe("move", () => {
      it("moves a file into a directory", async () => {
        const store = makeStore();
        const project = await store.createProject("p");
        const dir = await store.createDirectory(project.id, null, "dir");
        const file = await store.createFile(
          project.id,
          null,
          "a.hcl",
          "",
        );
        await store.moveNode(file.id, dir.id);
        const nodes = await store.listNodes(project.id);
        expect(nodes.find((n) => n.id === file.id)?.parentId).toBe(dir.id);
      });

      it("moves a node back to the project root", async () => {
        const store = makeStore();
        const project = await store.createProject("p");
        const dir = await store.createDirectory(project.id, null, "dir");
        const file = await store.createFile(
          project.id,
          dir.id,
          "a.hcl",
          "",
        );
        await store.moveNode(file.id, null);
        const nodes = await store.listNodes(project.id);
        expect(nodes.find((n) => n.id === file.id)?.parentId).toBeNull();
      });

      it("rejects moving a node under itself", async () => {
        const store = makeStore();
        const project = await store.createProject("p");
        const dir = await store.createDirectory(project.id, null, "dir");
        await expect(store.moveNode(dir.id, dir.id)).rejects.toThrow();
      });

      it("rejects moving a node under one of its own descendants (cycle)", async () => {
        const store = makeStore();
        const project = await store.createProject("p");
        const outer = await store.createDirectory(project.id, null, "outer");
        const inner = await store.createDirectory(
          project.id,
          outer.id,
          "inner",
        );
        await expect(store.moveNode(outer.id, inner.id)).rejects.toThrow();
      });

      it("rejects moving a node to an unknown parent", async () => {
        const store = makeStore();
        const project = await store.createProject("p");
        const file = await store.createFile(
          project.id,
          null,
          "a.hcl",
          "",
        );
        await expect(store.moveNode(file.id, "nope")).rejects.toThrow();
      });

      it("rejects moving a node into a directory that already has a child with the same name", async () => {
        const store = makeStore();
        const project = await store.createProject("p");
        const dir = await store.createDirectory(project.id, null, "dir");
        await store.createFile(project.id, dir.id, "a.hcl", "");
        const rootFile = await store.createFile(project.id, null, "a.hcl", "");
        await expect(store.moveNode(rootFile.id, dir.id)).rejects.toThrow();
      });
    });

    describe("recursive delete", () => {
      it("deletes a directory and everything inside it", async () => {
        const store = makeStore();
        const project = await store.createProject("p");
        const dir = await store.createDirectory(project.id, null, "dir");
        await store.createFile(project.id, dir.id, "a.hcl", "");
        await store.deleteNode(dir.id);
        expect(await store.listNodes(project.id)).toEqual([]);
      });

      it("leaves unrelated nodes untouched", async () => {
        const store = makeStore();
        const project = await store.createProject("p");
        const dir = await store.createDirectory(project.id, null, "dir");
        const other = await store.createFile(
          project.id,
          null,
          "keep.hcl",
          "",
        );
        await store.deleteNode(dir.id);
        const nodes = await store.listNodes(project.id);
        expect(nodes.map((n) => n.id)).toEqual([other.id]);
      });

      it("rejects deleting an unknown node", async () => {
        const store = makeStore();
        await expect(store.deleteNode("nope")).rejects.toThrow();
      });
    });

    describe("revision/updatedAt bookkeeping", () => {
      it("bumps revision and updatedAt on updateFileContent", async () => {
        const store = makeStore();
        const project = await store.createProject("p");
        const file = await store.createFile(
          project.id,
          null,
          "a.hcl",
          "v0",
        );
        expect(file.revision).toBe(0);

        await store.updateFileContent(file.id, "v1");
        const [afterFirst] = await store.listNodes(project.id);
        if (!afterFirst || afterFirst.kind !== "file") {
          throw new Error("expected a file");
        }
        expect(afterFirst.revision).toBe(1);
        expect(afterFirst.content).toBe("v1");
        expect(afterFirst.updatedAt).not.toBe(file.updatedAt);

        await store.updateFileContent(file.id, "v2");
        const [afterSecond] = await store.listNodes(project.id);
        if (!afterSecond || afterSecond.kind !== "file") {
          throw new Error("expected a file");
        }
        expect(afterSecond.revision).toBe(2);
      });

      it("rejects updating the content of a directory", async () => {
        const store = makeStore();
        const project = await store.createProject("p");
        const dir = await store.createDirectory(project.id, null, "dir");
        await expect(store.updateFileContent(dir.id, "x")).rejects.toThrow();
      });

      it("touches the owning project's updatedAt on a node mutation", async () => {
        const store = makeStore();
        const project = await store.createProject("p");
        const file = await store.createFile(
          project.id,
          null,
          "a.hcl",
          "",
        );
        await store.updateFileContent(file.id, "changed");
        const [updatedProject] = await store.listProjects();
        expect(updatedProject?.updatedAt).not.toBe(project.updatedAt);
      });
    });
  });
}

// A deterministic, monotonically-increasing clock so revision/updatedAt
// assertions above never depend on real wall-clock resolution (or risk
// flaking if two calls land in the same millisecond).
function makeTestClock(): () => string {
  let counter = 0;
  return () => new Date(2024, 0, 1, 0, 0, 0, counter++).toISOString();
}

// A minimal Map-backed StorageLike, so the LocalStorageProjectStore run
// below never touches a real `localStorage` (this project's Vitest setup
// has no DOM environment configured).
function makeFakeStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

runProjectStoreContractTests(
  "InMemoryProjectStore",
  () => new InMemoryProjectStore(makeTestClock()),
);

runProjectStoreContractTests(
  "LocalStorageProjectStore",
  () =>
    new LocalStorageProjectStore(
      makeFakeStorage(),
      "contract-test",
      makeTestClock(),
    ),
);
