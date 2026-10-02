import { beforeEach, describe, expect, it } from "vitest";
import { VIEW_LAYOUT_DIR } from "../routes/projects/[id]/modeling/persistence";
import { InMemoryProjectStore } from "../vfs/vfsStore";
import { openProjectFs, type ProjectFs } from "../vfs/fs";
import { fileItems, fileTargetFor, readProjectEntries } from "./fileSwitcher";

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

describe("fileTargetFor", () => {
  it("sends a view to the canvas, addressed by its path within views/", () => {
    expect(fileTargetFor("views/main.hcl")).toEqual({
      kind: "view",
      view: "main.hcl",
    });
    // A view in a folder keeps its whole path — that is what the modeling
    // route's rest param takes.
    expect(fileTargetFor("views/drone/engine.hcl")).toEqual({
      kind: "view",
      view: "drone/engine.hcl",
    });
  });

  it("sends everything else to the editor, by its project path", () => {
    expect(fileTargetFor("system.hcl")).toEqual({
      kind: "file",
      path: "system.hcl",
    });
    expect(fileTargetFor("docs/engine.md")).toEqual({
      kind: "file",
      path: "docs/engine.md",
    });
  });

  it("does not treat a non-HCL file under views/ as a view", () => {
    // views/notes.md is a file that happens to sit in that folder; the
    // canvas has no such page, and the editor is the only place it opens.
    expect(fileTargetFor("views/notes.md")).toEqual({
      kind: "file",
      path: "views/notes.md",
    });
  });

  it("does not treat a folder merely named views elsewhere as views", () => {
    expect(fileTargetFor("docs/views/main.hcl")).toEqual({
      kind: "file",
      path: "docs/views/main.hcl",
    });
  });
});

describe("fileItems", () => {
  it("lists every project file, once", () => {
    expect(fileItems(ENTRIES).map((i) => i.label)).toEqual([
      "system.hcl",
      "views/drone/engine.hcl",
      "views/main.hcl",
      "views/notes.md",
    ]);
  });

  it("never lists a directory", () => {
    expect(fileItems(ENTRIES).map((i) => i.label)).not.toContain(
      VIEW_LAYOUT_DIR,
    );
  });

  it("keeps the project-relative path as the label, which is what it opens", () => {
    // One list, one rule: a row's label is the path fileTargetFor reads, so
    // a host can navigate from a chosen row with nothing but its label.
    for (const item of fileItems(ENTRIES)) {
      expect(fileTargetFor(item.label).kind).toBeTypeOf("string");
    }
    expect(fileTargetFor("views/main.hcl").kind).toBe("view");
  });

  it("gives every item a distinct id, since the list is keyed on it", () => {
    const ids = fileItems(ENTRIES).map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("sorts by label, so the untyped list is predictable", () => {
    // readdir's order is a store implementation detail; a list that
    // reshuffles between opens is unusable.
    expect(fileItems([...ENTRIES].reverse()).map((i) => i.label)).toEqual(
      fileItems(ENTRIES).map((i) => i.label),
    );
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

  it("hands back project-relative paths, so labels are openable as they read", async () => {
    const entries = await readProjectEntries(fs);
    expect(entries.filter((e) => e.isFile()).map((e) => e.path)).toContain(
      `${VIEW_LAYOUT_DIR}/main.hcl`,
    );
  });

  it("lists every file of a real project", async () => {
    expect(fileItems(await readProjectEntries(fs)).map((i) => i.label)).toEqual(
      [
        "docs/engine.md",
        "system.hcl",
        "views/drone/engine.hcl",
        "views/main.hcl",
      ],
    );
  });
});
