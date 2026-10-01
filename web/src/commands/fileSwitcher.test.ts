import { beforeEach, describe, expect, it } from "vitest";
import { VIEW_LAYOUT_DIR } from "../routes/projects/[id]/modeling/persistence";
import { InMemoryProjectStore } from "../vfs/vfsStore";
import { openProjectFs, type ProjectFs } from "../vfs/fs";
import {
  fileSwitcherItems,
  readProjectEntries,
  switcherScopeForPath,
  switcherTargetFor,
  viewPaths,
} from "./fileSwitcher";

const ENTRIES = [
  {
    name: "views",
    path: "views",
    isFile: () => false,
    isDirectory: () => true,
  },
  {
    name: "main.hcl",
    path: "views/main.hcl",
    isFile: () => true,
    isDirectory: () => false,
  },
  {
    name: "engine.hcl",
    path: "views/drone/engine.hcl",
    isFile: () => true,
    isDirectory: () => false,
  },
  {
    name: "notes.md",
    path: "views/notes.md",
    isFile: () => true,
    isDirectory: () => false,
  },
  {
    name: "system.hcl",
    path: "system.hcl",
    isFile: () => true,
    isDirectory: () => false,
  },
];

describe("switcherScopeForPath", () => {
  it("offers views on the pages that draw diagrams", () => {
    expect(switcherScopeForPath("/projects/p/modeling")).toBe("views");
    expect(switcherScopeForPath("/projects/p/modeling/main.hcl")).toBe("views");
    expect(switcherScopeForPath("/projects/p/explore")).toBe("views");
  });

  it("offers the whole project on the code page", () => {
    expect(switcherScopeForPath("/projects/p/code")).toBe("files");
    expect(switcherScopeForPath("/projects/p/code?file=main.hcl")).toBe(
      "files",
    );
  });

  it("falls back to the whole project on pages that are about neither", () => {
    expect(switcherScopeForPath("/projects/p/overview")).toBe("files");
    expect(switcherScopeForPath("/projects/p/inventory")).toBe("files");
    expect(switcherScopeForPath("/projects/p/inventory/battery")).toBe("files");
    expect(switcherScopeForPath("/projects")).toBe("files");
    expect(switcherScopeForPath("/")).toBe("files");
  });

  it("does not mistake a project id for a subpage", () => {
    expect(switcherScopeForPath("/projects/modeling")).toBe("files");
    expect(switcherScopeForPath("/projects/code/explore")).toBe("views");
  });
});

describe("switcherTargetFor", () => {
  it("addresses a view by its path relative to views/", () => {
    expect(switcherTargetFor("main.hcl", "views")).toEqual({
      kind: "view",
      view: "main.hcl",
    });
    expect(switcherTargetFor("drone/engine.hcl", "views")).toEqual({
      kind: "view",
      view: "drone/engine.hcl",
    });
  });

  it("addresses a file by its project-relative path", () => {
    expect(switcherTargetFor("docs/engine.md", "files")).toEqual({
      kind: "file",
      path: "docs/engine.md",
    });
  });

  it("round-trips a row's own label, which is the only thing a host has", () => {
    for (const scope of ["views", "files"] as const) {
      for (const item of fileSwitcherItems(ENTRIES, scope)) {
        expect(switcherTargetFor(item.label, scope)).toEqual(
          scope === "views"
            ? { kind: "view", view: item.label }
            : { kind: "file", path: item.label },
        );
      }
    }
  });
});

describe("viewPaths", () => {
  it("lists the project's view files without their folder, sorted", () => {
    expect(viewPaths([...ENTRIES].reverse())).toEqual([
      "drone/engine.hcl",
      "main.hcl",
    ]);
  });

  it("is what the views scope offers, one-for-one", () => {
    expect(fileSwitcherItems(ENTRIES, "views").map((i) => i.label)).toEqual(
      viewPaths(ENTRIES),
    );
  });
});

describe("fileSwitcherItems", () => {
  const entries = ENTRIES;

  it("shows views without their folder, and says where they live", () => {
    const items = fileSwitcherItems(entries, "views");
    expect(items.map((i) => i.label)).toEqual(["drone/engine.hcl", "main.hcl"]);
    expect(items[0]?.detail).toBe(VIEW_LAYOUT_DIR);
  });

  it("keeps a view's nested path, because that is what the route addresses", () => {
    const items = fileSwitcherItems(entries, "views");
    expect(items.map((i) => i.id)).toEqual([
      "view:drone/engine.hcl",
      "view:main.hcl",
    ]);
  });

  it("drops the views directory itself and non-HCL files", () => {
    const labels = fileSwitcherItems(entries, "views").map((i) => i.label);
    expect(labels).not.toContain(VIEW_LAYOUT_DIR);
    expect(labels).not.toContain("notes.md");
  });

  it("shows every project file on its own path when the scope is files", () => {
    const items = fileSwitcherItems(entries, "files");
    expect(items.map((i) => i.label)).toEqual([
      "system.hcl",
      "views/drone/engine.hcl",
      "views/main.hcl",
      "views/notes.md",
    ]);
    expect(items.map((i) => i.id)[0]).toBe("file:system.hcl");
  });

  it("gives every item a distinct id, since the list is keyed on it", () => {
    for (const scope of ["views", "files"] as const) {
      const ids = fileSwitcherItems(entries, scope).map((i) => i.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('searches the folder a view lives in, so "views" finds them', () => {
    const [item] = fileSwitcherItems(entries, "views");
    expect(item?.hint).toContain(VIEW_LAYOUT_DIR);
  });

  it("sorts by label, so the untyped list is predictable", () => {
    // The same listing in a different order must offer the same rows in the
    // same order: readdir's sequence is a store implementation detail, and a
    // palette whose untyped list reshuffles between opens is unusable.
    const shuffled = [...entries].reverse();
    expect(fileSwitcherItems(shuffled, "views").map((i) => i.label)).toEqual([
      "drone/engine.hcl",
      "main.hcl",
    ]);
    expect(fileSwitcherItems(shuffled, "files").map((i) => i.label)).toEqual([
      "system.hcl",
      "views/drone/engine.hcl",
      "views/main.hcl",
      "views/notes.md",
    ]);
  });
});

describe("readProjectEntries", () => {
  let fs: ProjectFs;

  beforeEach(async () => {
    const store = new InMemoryProjectStore();
    const project = await store.createProject("switcher");
    fs = openProjectFs(store, project.id);
    await fs.writeFile("system.hcl", 'system "demo" {}\n');
    await fs.mkdir(VIEW_LAYOUT_DIR, { recursive: true });
    await fs.writeFile(`${VIEW_LAYOUT_DIR}/main.hcl`, 'view "main" {}\n');
    await fs.mkdir(`${VIEW_LAYOUT_DIR}/drone`, { recursive: true });
    await fs.writeFile(
      `${VIEW_LAYOUT_DIR}/drone/engine.hcl`,
      'view "engine" {}\n',
    );
    await fs.mkdir("docs", { recursive: true });
    await fs.writeFile("docs/engine.md", "# engine\n");
  });

  it("hands back project-relative paths, so both scopes read the same rows", async () => {
    const entries = await readProjectEntries(fs);
    expect(entries.filter((e) => e.isFile()).map((e) => e.path)).toContain(
      `${VIEW_LAYOUT_DIR}/main.hcl`,
    );
  });

  it("lists the project's view files", async () => {
    const items = fileSwitcherItems(await readProjectEntries(fs), "views");
    expect(items.map((i) => i.label)).toEqual([
      "drone/engine.hcl",
      "main.hcl",
    ]);
  });

  it("lists every project file, views included", async () => {
    const items = fileSwitcherItems(await readProjectEntries(fs), "files");
    expect(items.map((i) => i.label)).toEqual([
      "docs/engine.md",
      "system.hcl",
      "views/drone/engine.hcl",
      "views/main.hcl",
    ]);
  });

  it("finds no views in a project that has none yet", async () => {
    const store = new InMemoryProjectStore();
    const project = await store.createProject("no-views");
    const bare = openProjectFs(store, project.id);
    await bare.writeFile("main.hcl", 'system "demo" {}\n');
    expect(fileSwitcherItems(await readProjectEntries(bare), "views")).toEqual(
      [],
    );
    // The same project still offers its one file, so the switcher is not
    // simply empty everywhere.
    expect(fileSwitcherItems(await readProjectEntries(bare), "files"))
      .toHaveLength(
        1,
      );
  });
});
