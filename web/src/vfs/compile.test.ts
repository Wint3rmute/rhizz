import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryProjectStore } from "./vfsStore";
import { openProjectFs, type ProjectFs } from "./fs";
import { primaryHclPath, readProjectSources } from "./compile";
import type { Dirent } from "./fs";
import { createProjectWithFiles, projectStore } from "../ProjectState.svelte";

let store: InMemoryProjectStore;
let fs: ProjectFs;

beforeEach(async () => {
  store = new InMemoryProjectStore();
  const project = await store.createProject("p");
  fs = openProjectFs(store, project.id);
});

describe("readProjectSources", () => {
  it("reads every .hcl file, recursively, with its path as filename", async () => {
    await fs.mkdir("components");
    await fs.writeFile("components/imu.hcl", 'component "imu" {}');
    await fs.writeFile("drone.hcl", 'system "drone" {}');

    const sources = await readProjectSources(fs);
    expect(sources.toSorted((a, b) => a.filename.localeCompare(b.filename)))
      .toEqual([
        { filename: "components/imu.hcl", content: 'component "imu" {}' },
        { filename: "drone.hcl", content: 'system "drone" {}' },
      ]);
  });

  it("excludes non-.hcl files", async () => {
    await fs.mkdir("diagrams", { recursive: true });
    await fs.writeFile("diagrams/overview.json", "{}");
    await fs.writeFile("notes.md", "# stray note outside docs/");
    await fs.writeFile("main.hcl", 'system "x" {}');

    const sources = await readProjectSources(fs);
    expect(sources).toEqual([
      { filename: "main.hcl", content: 'system "x" {}' },
    ]);
  });

  it("includes Markdown files under docs/ so the compiler sees them (W018)", async () => {
    await fs.mkdir("docs", { recursive: true });
    await fs.writeFile("docs/motor.md", "# Motor\n");
    await fs.writeFile("main.hcl", 'system "x" {}');

    const sources = await readProjectSources(fs);
    expect(
      sources.toSorted((a, b) => a.filename.localeCompare(b.filename)),
    ).toEqual([
      { filename: "docs/motor.md", content: "# Motor\n" },
      { filename: "main.hcl", content: 'system "x" {}' },
    ]);
  });

  it("includes .hcl files inside diagrams/ in the compilation sources", async () => {
    await fs.mkdir("diagrams", { recursive: true });
    await fs.writeFile(
      "diagrams/overview.hcl",
      'view "overview" { system = "main" }',
    );
    await fs.writeFile("main.hcl", "# empty project without system main");

    const sources = await readProjectSources(fs);
    expect(
      sources.toSorted((a, b) => a.filename.localeCompare(b.filename)),
    ).toEqual([
      {
        filename: "diagrams/overview.hcl",
        content: 'view "overview" { system = "main" }',
      },
      { filename: "main.hcl", content: "# empty project without system main" },
    ]);
  });

  it("returns an empty array for a project with no .hcl files", async () => {
    await fs.writeFile("notes.txt", "just some notes");
    expect(await readProjectSources(fs)).toEqual([]);
  });

  it("returns an empty array for an empty project", async () => {
    expect(await readProjectSources(fs)).toEqual([]);
  });

  it("unpacks example diagrams into diagrams/ at the project root without duplicating", async () => {
    const files = [
      { path: "project.hcl", content: 'project { name = "apollo" }' },
      {
        path: "components/mcu.hcl",
        content: 'component "mcu" { leaf = true }',
      },
      {
        path: "diagrams/main.hcl",
        content: 'view "main" { system = "apollo" }',
      },
    ];

    const project = await createProjectWithFiles("apollo-test", files);
    const projFs = openProjectFs(projectStore, project.id);

    // Root entries should contain project.hcl, components, and diagrams
    const rootEntries = await projFs.readdir(".");
    const rootNames = rootEntries.map((e) => e.name);
    expect(rootNames).toContain("project.hcl");
    expect(rootNames).toContain("components");
    expect(rootNames).toContain("diagrams");
    expect(rootNames).not.toContain(".rhizz");

    // Check diagrams contains main.hcl
    const diagrams = await projFs.readdir("diagrams");
    expect(diagrams.map((e) => e.name)).toContain("main.hcl");

    // Check components directory contains mcu.hcl
    const compEntries = await projFs.readdir("components");
    expect(compEntries.map((e) => e.name)).toContain("mcu.hcl");

    // Compilation sources include model files and diagram layouts alike,
    // matching rhizz-core's own file discovery.
    const sources = await readProjectSources(projFs);
    const filenames = sources.map((s) => s.filename);
    expect(filenames).toContain("project.hcl");
    expect(filenames).toContain("components/mcu.hcl");
    expect(filenames).toContain("diagrams/main.hcl");
  });
});

function dirent(path: string, kind: "file" | "directory"): Dirent {
  return {
    name: path.split("/").pop() ?? path,
    path,
    isFile: () => kind === "file",
    isDirectory: () => kind === "directory",
  };
}

describe("primaryHclPath", () => {
  it("prefers the canonical system file names, in order", () => {
    const entries = [
      dirent("project.hcl", "file"),
      dirent("main.hcl", "file"),
      dirent("system.hcl", "file"),
    ];
    expect(primaryHclPath(entries)).toBe("system.hcl");
    expect(primaryHclPath(entries.filter((e) => e.name !== "system.hcl")))
      .toBe("main.hcl");
  });

  it("never lets the metadata-only project.hcl shadow a real system file", () => {
    expect(
      primaryHclPath([
        dirent("project.hcl", "file"),
        dirent("systems.hcl", "file"),
      ]),
    ).toBe("systems.hcl");
  });

  it("falls back to the first root-level .hcl file when none is canonical", () => {
    expect(primaryHclPath([dirent("custom.hcl", "file")])).toBe("custom.hcl");
  });

  it("ignores diagram layouts, directories and non-.hcl files", () => {
    expect(
      primaryHclPath([
        dirent("diagrams", "directory"),
        dirent("diagrams/main.hcl", "file"),
        dirent("notes.md", "file"),
      ]),
    ).toBe("main.hcl");
  });

  it("returns the fallback when the project has no model file at all", () => {
    expect(primaryHclPath([])).toBe("main.hcl");
    expect(primaryHclPath([], "seed.hcl")).toBe("seed.hcl");
  });
});
