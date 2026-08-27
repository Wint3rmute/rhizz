import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryProjectStore } from "./inMemoryStore";
import { openProjectFs, type ProjectFs } from "./fs";
import { readProjectSources } from "./compile";
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
    await fs.mkdir(".rhizz/diagrams", { recursive: true });
    await fs.writeFile(".rhizz/diagrams/overview.json", "{}");
    await fs.writeFile("main.hcl", 'system "x" {}');

    const sources = await readProjectSources(fs);
    expect(sources).toEqual([
      { filename: "main.hcl", content: 'system "x" {}' },
    ]);
  });

  it("excludes .hcl files inside .rhizz/ directory from compilation sources", async () => {
    await fs.mkdir(".rhizz/diagrams", { recursive: true });
    await fs.writeFile(
      ".rhizz/diagrams/overview.hcl",
      'view "overview" { system = "main" }',
    );
    await fs.writeFile("main.hcl", "# empty project without system main");

    const sources = await readProjectSources(fs);
    expect(sources).toEqual([
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

  it("unpacks example diagrams exclusively into .rhizz/diagrams without duplicating at root", async () => {
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

    // Root entries should contain project.hcl, components, and .rhizz, but NOT diagrams
    const rootEntries = await projFs.readdir(".");
    const rootNames = rootEntries.map((e) => e.name);
    expect(rootNames).toContain("project.hcl");
    expect(rootNames).toContain("components");
    expect(rootNames).toContain(".rhizz");
    expect(rootNames).not.toContain("diagrams");

    // Check .rhizz/diagrams contains main.hcl
    const rhizzDiagrams = await projFs.readdir(".rhizz/diagrams");
    expect(rhizzDiagrams.map((e) => e.name)).toContain("main.hcl");

    // Check components directory contains mcu.hcl
    const compEntries = await projFs.readdir("components");
    expect(compEntries.map((e) => e.name)).toContain("mcu.hcl");

    // Check compilation sources: must include project.hcl & components/mcu.hcl, NOT .rhizz diagram files
    const sources = await readProjectSources(projFs);
    const filenames = sources.map((s) => s.filename);
    expect(filenames).toContain("project.hcl");
    expect(filenames).toContain("components/mcu.hcl");
    expect(filenames).not.toContain("diagrams/main.hcl");
    expect(filenames).not.toContain(".rhizz/diagrams/main.hcl");
  });
});
