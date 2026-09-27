import init from "rhizz";
import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { compile_system } from "../rhizz_wasm_wrapper";
import { sceneFromModel } from "../modelView";
import {
  detailViewFor,
  docFor,
  linkedKeys,
} from "./useDiagramDrilldown.svelte";
import type { Dirent } from "../vfs/fs";

beforeAll(async () => {
  const wasmPath = nodePath.resolve(
    __dirname,
    "../../../crates/rhizz-wasm/pkg/rhizz_wasm_bg.wasm",
  );
  await init({ module_or_path: await nodeFs.readFile(wasmPath) });
});

const HCL = `component "battery" {
  full_name = "Main power source"
  leaf = true
}
component "controller" {
  leaf = false
  instance "mcu" {
    source = "mcu"
  }
}
component "mcu" {
  leaf = true
}
system "demo-system" {
  instance "battery" {
    source = "battery"
  }
  instance "controller" {
    source = "controller"
  }
}
`;

function entry(name: string): Dirent {
  return { name, path: name, isFile: () => true, isDirectory: () => false };
}

function sceneFor() {
  const model = compile_system([{ filename: "system.hcl", content: HCL }])
    .model();
  return sceneFromModel(model, {
    "demo-system/controller": { x: 0, y: 0 },
    "demo-system/battery": { x: 300, y: 0 },
  });
}

describe("detailViewFor", () => {
  it("resolves a node's detail view by its label", () => {
    const scene = sceneFor();
    expect(
      detailViewFor([entry("controller.hcl")], scene, "demo-system/controller")
        ?.path,
    ).toBe("controller.hcl");
  });

  it("returns undefined when no view matches", () => {
    const scene = sceneFor();
    expect(
      detailViewFor([entry("controller.hcl")], scene, "demo-system/battery"),
    ).toBeUndefined();
  });

  it("returns undefined for an unknown key", () => {
    expect(detailViewFor([], sceneFor(), "nope")).toBeUndefined();
  });
});

describe("linkedKeys", () => {
  it("lists only the nodes that have a detail view", () => {
    const scene = sceneFor();
    expect(linkedKeys([entry("controller.hcl")], scene)).toEqual([
      "demo-system/controller",
    ]);
  });

  it("is empty when no views have been listed yet", () => {
    expect(linkedKeys([], sceneFor())).toEqual([]);
  });
});

describe("docFor", () => {
  const docs = [{ key: "battery", content: "Stores charge.\n" }];

  it("prepends the component's full_name as a heading", () => {
    expect(docFor(docs, sceneFor(), "demo-system/battery")).toBe(
      "# Main power source\n\nStores charge.\n",
    );
  });

  it("returns null when the component has no doc", () => {
    expect(docFor(docs, sceneFor(), "demo-system/controller")).toBeNull();
  });

  it("returns null for no hovered node or an unknown key", () => {
    expect(docFor(docs, sceneFor(), null)).toBeNull();
    expect(docFor(docs, sceneFor(), "nope")).toBeNull();
  });
});
