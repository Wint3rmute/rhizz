import init from "rhizz";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { DocumentStore } from "../DocumentStore.svelte";
import { resolveInstanceStoreParent } from "./placement";

beforeAll(async () => {
  const wasmPath = path.resolve(
    __dirname,
    "../../../crates/rhizz-wasm/pkg/rhizz_wasm_bg.wasm",
  );
  const buffer = await fs.readFile(wasmPath);
  await init({ module_or_path: buffer });
});

describe("resolveInstanceStoreParent", () => {
  it("redirects children of an instance to its definition body", () => {
    const doc = new DocumentStore();
    doc.addComponentDefinition("sensor", { leaf: true });
    doc.addSystem("main");
    doc.addInstance("main", "sensor", "sensor");

    expect(resolveInstanceStoreParent(doc, "main/sensor")).toBe("sensor");
  });

  it("keeps system and definition parents as-is", () => {
    const doc = new DocumentStore();
    doc.addComponentDefinition("sensor", { leaf: true });
    doc.addSystem("main");

    expect(resolveInstanceStoreParent(doc, "main")).toBe("main");
    expect(resolveInstanceStoreParent(doc, "sensor")).toBe("sensor");
  });

  it("keeps unknown parents as-is", () => {
    const doc = new DocumentStore();
    doc.addSystem("main");

    expect(resolveInstanceStoreParent(doc, "main/ghost")).toBe("main/ghost");
  });

  it("persists a redirected child so it resolves under the instance path", () => {
    const doc = new DocumentStore();
    doc.addComponentDefinition("sensor", { leaf: true });
    doc.addSystem("main");
    doc.addInstance("main", "sensor", "sensor");
    doc.addComponentDefinition("imu", { leaf: true });

    // What handleModalCreateComponent does for a double-click-created child.
    const storeParent = resolveInstanceStoreParent(doc, "main/sensor");
    doc.addInstance(storeParent, "imu", "imu");

    expect(doc.systemHcl).toContain('instance "imu"');
    expect(doc.compileResult.error_count()).toBe(0);
    expect(doc.model?.component_keys()).toContain("main/sensor/imu");
  });
});
