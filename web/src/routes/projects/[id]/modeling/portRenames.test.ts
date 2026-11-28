import init from "rhizome";
import * as nodeFs from "node:fs/promises";
import * as path from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { openProjectFs, type ProjectFs } from "../../../../vfs/fs";
import { InMemoryProjectStore } from "../../../../vfs/vfsStore";
import { parse_views } from "../../../../rhizome_wasm_wrapper";
import {
  renamePortSpots,
  renamePortsInViewFiles,
  renameVisiblePorts,
} from "./portRenames";

beforeAll(async () => {
  const wasmPath = path.resolve(
    __dirname,
    "../../../../../../crates/rhizome-wasm/pkg/rhizome_wasm_bg.wasm",
  );
  await init({ module_or_path: await nodeFs.readFile(wasmPath) });
});

const rename = [
  { component: "homelab/router", from: "link-thinkcentre", to: "eth" },
];

describe("renamePortSpots", () => {
  it("moves the renamed port's spot on the renamed component only", () => {
    const spots = {
      "homelab/router": {
        "link-thinkcentre": { side: "left", offset: 0.25 },
        wifi: { side: "top", offset: 0.5 },
      },
      "homelab/pc": { "link-thinkcentre": { side: "right", offset: 0.5 } },
    };
    expect(renamePortSpots(spots, rename)).toEqual({
      "homelab/router": {
        eth: { side: "left", offset: 0.25 },
        wifi: { side: "top", offset: 0.5 },
      },
      "homelab/pc": { "link-thinkcentre": { side: "right", offset: 0.5 } },
    });
    // The input is not mutated (it is the undo snapshot's source).
    expect(Object.keys(spots["homelab/router"])).toContain("link-thinkcentre");
  });

  it("keeps an entry already under the new label", () => {
    const spots = { "homelab/router": { "link-thinkcentre": 1, eth: 2 } };
    expect(renamePortSpots(spots, rename)).toEqual(spots);
  });
});

describe("renameVisiblePorts", () => {
  it("replaces the renamed label on the renamed component only", () => {
    expect(
      renameVisiblePorts(
        {
          "homelab/router": ["link-thinkcentre", "wifi"],
          "homelab/pc": ["link-thinkcentre"],
        },
        rename,
      ),
    ).toEqual({
      "homelab/router": ["eth", "wifi"],
      "homelab/pc": ["link-thinkcentre"],
    });
  });
});

describe("renamePortsInViewFiles", () => {
  let fs: ProjectFs;
  const view = (name: string) => `view "${name}" {
  system = "homelab"

  node "homelab/router" {
    x = 0
    y = 0

    port "link-thinkcentre" {
      visible = true
    }
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
    await fs.writeFile("views/broken.hcl", "view {");
    await fs.writeFile(
      "views/unrelated.hcl",
      'view "unrelated" {\n  system = "homelab"\n}\n',
    );
  });

  it("rewrites every other view and returns their previous content", async () => {
    const previous = await renamePortsInViewFiles(fs, rename, "views/open.hcl");

    expect([...previous.keys()]).toEqual(["views/nested/other.hcl"]);
    expect(previous.get("views/nested/other.hcl")).toBe(view("other"));
    const [other] = parse_views(await fs.readFile("views/nested/other.hcl"));
    expect(other?.nodes?.[0]?.ports).toEqual([
      expect.objectContaining({ port: "eth", visible: true }),
    ]);
    // The open view is the caller's to re-key in memory; broken and
    // unrelated views are left byte-identical.
    expect(await fs.readFile("views/open.hcl")).toBe(view("open"));
    expect(await fs.readFile("views/broken.hcl")).toBe("view {");
    expect(await fs.readFile("views/unrelated.hcl")).toBe(
      'view "unrelated" {\n  system = "homelab"\n}\n',
    );
  });

  it("does nothing without renames", async () => {
    expect((await renamePortsInViewFiles(fs, [], null)).size).toBe(0);
    expect(await fs.readFile("views/open.hcl")).toBe(view("open"));
  });
});
