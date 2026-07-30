import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryProjectStore } from "./inMemoryStore";
import { openProjectFs, type ProjectFs } from "./fs";
import { readProjectSources } from "./compile";

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

  it("returns an empty array for a project with no .hcl files", async () => {
    await fs.writeFile("notes.txt", "just some notes");
    expect(await readProjectSources(fs)).toEqual([]);
  });

  it("returns an empty array for an empty project", async () => {
    expect(await readProjectSources(fs)).toEqual([]);
  });
});
