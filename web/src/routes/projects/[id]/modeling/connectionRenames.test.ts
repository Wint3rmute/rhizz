import init from "rhizome";
import * as nodeFs from "node:fs/promises";
import * as path from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { openProjectFs, type ProjectFs } from "../../../../vfs/fs";
import { InMemoryProjectStore } from "../../../../vfs/vfsStore";
import { parse_views } from "../../../../rhizome_wasm_wrapper";
import {
  renameConnectionsInViewFiles,
  renameSavedConnections,
} from "./connectionRenames";

beforeAll(async () => {
  const wasmPath = path.resolve(
    __dirname,
    "../../../../../../crates/rhizome-wasm/pkg/rhizome_wasm_bg.wasm",
  );
  await init({ module_or_path: await nodeFs.readFile(wasmPath) });
});

const rename = [{ systems: ["home"], from: "ethernet", to: "lan" }];

describe("renameSavedConnections", () => {
  it("moves the renamed connection's entry in a view over its system", () => {
    const saved = { ethernet: { hidden: true }, app: { hidden: true } };
    expect(renameSavedConnections(saved, rename, "home")).toEqual({
      lan: { hidden: true },
      app: { hidden: true },
    });
    // The input is not mutated (it is the undo snapshot's source).
    expect(Object.keys(saved)).toContain("ethernet");
  });

  it("leaves views over another system alone", () => {
    const saved = { ethernet: { hidden: true } };
    expect(renameSavedConnections(saved, rename, "office")).toEqual(saved);
  });

  it("keeps an entry already under the new label", () => {
    const saved = { ethernet: { hidden: true }, lan: { hidden: false } };
    expect(renameSavedConnections(saved, rename, "home")).toEqual(saved);
  });
});

describe("renameConnectionsInViewFiles", () => {
  let fs: ProjectFs;
  const view = (name: string, system = "home") => `view "${name}" {
  system = "${system}"

  connection "ethernet" {
    hidden = true
  }
}
`;

  beforeEach(async () => {
    const store = new InMemoryProjectStore();
    const project = await store.createProject("p");
    fs = openProjectFs(store, project.id);
    await fs.mkdir("views/nested", { recursive: true });
    await fs.writeFile("views/open.hcl", view("open"));
    await fs.writeFile("views/nested/other.hcl", view("other"));
    await fs.writeFile("views/office.hcl", view("office", "office"));
    await fs.writeFile("views/broken.hcl", "view {");
  });

  it("rewrites every other view over the system and returns their previous content", async () => {
    const previous = await renameConnectionsInViewFiles(
      fs,
      rename,
      "views/open.hcl",
    );

    expect([...previous.keys()]).toEqual(["views/nested/other.hcl"]);
    expect(previous.get("views/nested/other.hcl")).toBe(view("other"));
    const [other] = parse_views(await fs.readFile("views/nested/other.hcl"));
    expect(other?.connections).toEqual([
      expect.objectContaining({ connection: "lan", hidden: true }),
    ]);
    // The open view is the caller's to re-key in memory; views over another
    // system and broken views are left byte-identical.
    expect(await fs.readFile("views/open.hcl")).toBe(view("open"));
    expect(await fs.readFile("views/office.hcl")).toBe(
      view("office", "office"),
    );
    expect(await fs.readFile("views/broken.hcl")).toBe("view {");
  });

  it("does nothing without renames", async () => {
    expect((await renameConnectionsInViewFiles(fs, [], null)).size).toBe(0);
  });
});
