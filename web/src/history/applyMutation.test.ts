import init from "rhizz";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { subscribeToMutations } from "../DocumentStore.svelte";
import { applyModelMutation } from "./applyMutation";

beforeAll(async () => {
  const wasmPath = path.resolve(
    __dirname,
    "../../../crates/rhizz-wasm/pkg/rhizz_wasm_bg.wasm",
  );
  const buffer = await fs.readFile(wasmPath);
  await init({ module_or_path: buffer });
});

function memoryFs(files: Record<string, string> = {}) {
  const store = new Map(Object.entries(files));
  return {
    store,
    async readFile(filePath: string): Promise<string> {
      const content = store.get(filePath);
      if (content === undefined) throw new Error(`missing file: ${filePath}`);
      return content;
    },
    async writeFile(filePath: string, content: string): Promise<void> {
      store.set(filePath, content);
    },
  };
}

async function seedDemo(fs: ReturnType<typeof memoryFs>): Promise<void> {
  let baseline = "";
  for (const op of [
    { kind: "add_component_definition", label: "compA" },
    { kind: "add_component_definition", label: "compB" },
    { kind: "add_system", label: "demo" },
    { kind: "add_instance", parentPath: "demo", label: "a", source: "compA" },
    { kind: "add_instance", parentPath: "demo", label: "b", source: "compB" },
  ] as const) {
    const result = await applyModelMutation(fs, "system.hcl", baseline, op);
    if (!result.applied) throw new Error(`seed op failed: ${op.kind}`);
    const next = fs.store.get("system.hcl");
    if (next === undefined) throw new Error("seed write missing");
    baseline = next;
  }
}

describe("applyModelMutation", () => {
  it("persists Rust-canonical HCL for system/instance ops", async () => {
    const fs = memoryFs();
    const first = await applyModelMutation(fs, "system.hcl", "", {
      kind: "add_system",
      label: "demo",
    });
    expect(first.applied).toBe(true);

    const second = await applyModelMutation(
      fs,
      "system.hcl",
      fs.store.get("system.hcl") ?? "",
      { kind: "add_component_definition", label: "cpu", options: { leaf: true } },
    );
    expect(second.applied).toBe(true);

    const content = fs.store.get("system.hcl") ?? "";
    expect(content).toContain('component "cpu" {');
    expect(content).toContain("leaf        = true");
  });

  it("emits one-line instances via the Rust serializer", async () => {
    const fs = memoryFs();
    await seedDemo(fs);
    const content = fs.store.get("system.hcl") ?? "";
    expect(content).toContain('instance "a" { source = "compA" }');
  });

  it("routes renames through renameComponent: collisions refused, observer notified", async () => {
    const fs = memoryFs();
    await seedDemo(fs);
    const recorded: string[] = [];
    const unsubscribe = subscribeToMutations((action) => {
      recorded.push(action.op);
    });
    try {
      const before = fs.store.get("system.hcl") ?? "";

      // Sibling collision: demo already has "b".
      const refused = await applyModelMutation(fs, "system.hcl", before, {
        kind: "rename_component",
        path: "demo/a",
        newLabel: "b",
      });
      expect(refused.applied).toBe(false);
      expect(fs.store.get("system.hcl")).toBe(before);

      const renamed = await applyModelMutation(fs, "system.hcl", before, {
        kind: "rename_component",
        path: "demo/a",
        newLabel: "c",
      });
      expect(renamed.applied).toBe(true);
      expect(fs.store.get("system.hcl")).toContain('instance "c" { source = "compA" }');
      expect(recorded).toContain("rename_component");
    } finally {
      unsubscribe();
    }
  });

  it("refuses mutations when the baseline has blocking errors, file untouched", async () => {
    const broken = 'system "demo" {\n  this is not valid hcl!!!\n}\n';
    const fs = memoryFs({ "system.hcl": broken });
    const result = await applyModelMutation(fs, "system.hcl", broken, {
      kind: "add_system",
      label: "other",
    });
    expect(result.applied).toBe(false);
    expect(fs.store.get("system.hcl")).toBe(broken);
  });

  it("lets warnings through: unknown nested blocks do not block", async () => {
    const warned = 'system "demo" {\n  unknown_block {}\n}\n';
    const fs = memoryFs({ "system.hcl": warned });
    const result = await applyModelMutation(fs, "system.hcl", warned, {
      kind: "add_system",
      label: "other",
    });
    expect(result.applied).toBe(true);
    expect(fs.store.get("system.hcl")).toContain('system "other"');
  });

  it("create_component falls back to a fresh system when no container exists", async () => {
    const fs = memoryFs();
    const def = await applyModelMutation(fs, "system.hcl", "", {
      kind: "add_component_definition",
      label: "cpu",
      options: { leaf: true },
    });
    expect(def.applied).toBe(true);
    const result = await applyModelMutation(
      fs,
      "system.hcl",
      fs.store.get("system.hcl") ?? "",
      {
        kind: "create_component",
        label: "cpu",
        sourceLabel: "cpu",
      },
    );
    expect(result.applied).toBe(true);
    // No parent key and no systems: definition + "main" system + instance.
    expect(result.path).toBe("main/cpu");
    const content = fs.store.get("system.hcl") ?? "";
    expect(content).toContain('system "main"');
  });

  it("delete_connection_by_label finds nested scopes", async () => {
    const fs = memoryFs();
    await seedDemo(fs);
    let baseline = fs.store.get("system.hcl") ?? "";
    const added = await applyModelMutation(fs, "system.hcl", baseline, {
      kind: "add_connection",
      scopePath: "demo",
      label: "link",
      from: "a",
      to: "b",
    });
    expect(added.applied).toBe(true);
    baseline = fs.store.get("system.hcl") ?? "";
    expect(baseline).toContain('connection "link"');

    const deleted = await applyModelMutation(fs, "system.hcl", baseline, {
      kind: "delete_connection_by_label",
      label: "link",
    });
    expect(deleted.applied).toBe(true);
    expect(fs.store.get("system.hcl")).not.toContain('connection "link"');

    const missing = await applyModelMutation(
      fs,
      "system.hcl",
      fs.store.get("system.hcl") ?? "",
      { kind: "delete_connection_by_label", label: "nope" },
    );
    expect(missing.applied).toBe(false);
  });

  it("reparents through the dispatcher", async () => {
    const fs = memoryFs();
    await seedDemo(fs);
    let baseline = fs.store.get("system.hcl") ?? "";
    const parented = await applyModelMutation(fs, "system.hcl", baseline, {
      kind: "add_component_definition",
      label: "sub",
    });
    expect(parented.applied).toBe(true);
    baseline = fs.store.get("system.hcl") ?? "";
    const inst = await applyModelMutation(fs, "system.hcl", baseline, {
      kind: "add_instance",
      parentPath: "demo",
      label: "sub",
      source: "sub",
    });
    expect(inst.applied).toBe(true);
    baseline = fs.store.get("system.hcl") ?? "";

    const moved = await applyModelMutation(fs, "system.hcl", baseline, {
      kind: "reparent_component",
      sourcePath: "demo/b",
      targetParentPath: "demo/sub",
    });
    expect(moved.applied).toBe(true);
  });
});
