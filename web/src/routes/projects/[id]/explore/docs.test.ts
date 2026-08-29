import { describe, expect, it } from "vitest";
import { InMemoryProjectStore } from "../../../../vfs/inMemoryStore";
import { openProjectFs } from "../../../../vfs/fs";
import { DOCS_DIR, readProjectDocs } from "./docs";

async function makeFs() {
  const store = new InMemoryProjectStore();
  const project = await store.createProject("docs-test");
  return openProjectFs(store, project.id);
}

describe("readProjectDocs", () => {
  it("returns an empty list when there is no docs directory", async () => {
    const fs = await makeFs();
    expect(await readProjectDocs(fs)).toEqual([]);
  });

  it("reads docs keyed by path minus the .md suffix", async () => {
    const fs = await makeFs();
    await fs.mkdir(`${DOCS_DIR}/home-monitor/controller`, { recursive: true });
    await fs.writeFile(`${DOCS_DIR}/home-monitor/sensor.md`, "# Sensor");
    await fs.writeFile(
      `${DOCS_DIR}/home-monitor/controller/mcu.md`,
      "# MCU",
    );

    const docs = await readProjectDocs(fs);
    expect(docs).toEqual([
      { key: "home-monitor/controller/mcu", content: "# MCU" },
      { key: "home-monitor/sensor", content: "# Sensor" },
    ]);
  });

  it("ignores non-markdown files in the docs directory", async () => {
    const fs = await makeFs();
    await fs.mkdir(DOCS_DIR, { recursive: true });
    await fs.writeFile(`${DOCS_DIR}/notes.txt`, "not a doc");
    await fs.writeFile(`${DOCS_DIR}/readme.md`, "# Readme");

    const docs = await readProjectDocs(fs);
    expect(docs).toEqual([{ key: "readme", content: "# Readme" }]);
  });
});
