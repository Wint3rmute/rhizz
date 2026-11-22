import { describe, expect, it } from "vitest";
import { createProjectWithMainFile, projectStore } from "./ProjectState.svelte";
import { openProjectFs } from "./vfs/fs";

describe("createProjectWithMainFile", () => {
  it("seeds main.hcl and an empty docs folder without hidden files", async () => {
    const name = `gitkeep-regression-${String(Date.now())}`;
    const content = 'system "main" {\n  full_name = "Main system"\n}\n';
    const project = await createProjectWithMainFile(name, content);

    const fs = openProjectFs(projectStore, project.id);
    await expect(fs.readFile("main.hcl")).resolves.toBe(content);

    const root = await fs.readdir(".", { recursive: true });
    const paths = root.map((entry) => entry.path);
    // Empty docs/ must persist as a directory entry.
    expect(paths).toContain("docs");
    // No hidden entries (e.g. docs/.gitkeep): the server rejects them with 400.
    expect(
      paths.filter((path) =>
        path.split("/").some((segment) => segment.startsWith(".")),
      ),
    ).toEqual([]);
  });
});
