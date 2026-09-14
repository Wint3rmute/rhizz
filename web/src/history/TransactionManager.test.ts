import init from "rhizz";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { applyModelMutation } from "./applyMutation";
import {
  snapshotTransaction,
  TransactionManager,
} from "./TransactionManager";

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
    readFile(filePath: string): Promise<string> {
      const content = store.get(filePath);
      if (content === undefined) {
        return Promise.reject(new Error(`missing file: ${filePath}`));
      }
      return Promise.resolve(content);
    },
    writeFile(filePath: string, content: string): Promise<void> {
      store.set(filePath, content);
      return Promise.resolve();
    },
  };
}

describe("TransactionManager", () => {
  it("executes, undoes, and redoes a transaction", async () => {
    const manager = new TransactionManager();
    let value = 0;
    const applied = await manager.execute({
      label: "inc",
      do: () => {
        value += 1;
        return true;
      },
      undo: () => {
        value -= 1;
      },
    });
    expect(applied).toBe(true);
    expect(value).toBe(1);
    expect(manager.canUndo).toBe(true);

    expect(await manager.undo()).toBe(true);
    expect(value).toBe(0);
    expect(manager.canRedo).toBe(true);

    expect(await manager.redo()).toBe(true);
    expect(value).toBe(1);
  });

  it("does not push refused transactions and clears redo on new work", async () => {
    const manager = new TransactionManager();
    let value = 0;
    expect(
      await manager.execute({
        label: "refused",
        do: () => false,
        undo: () => {
          value = 99;
        },
      }),
    ).toBe(false);
    expect(manager.canUndo).toBe(false);
    expect(value).toBe(0);
    expect(await manager.undo()).toBe(false);
    expect(await manager.redo()).toBe(false);

    const inc = (label: string) => ({
      label,
      do: () => {
        value += 1;
        return true;
      },
      undo: () => {
        value -= 1;
      },
    });
    await manager.execute(inc("a"));
    await manager.execute(inc("b"));
    expect(value).toBe(2);
    await manager.undo();
    expect(value).toBe(1);
    await manager.execute(inc("c"));
    expect(value).toBe(2);
    expect(manager.canRedo).toBe(false);
  });

  it("caps history at the limit, keeping the most recent entries", async () => {
    const manager = new TransactionManager(2);
    let value = 0;
    for (const label of ["a", "b", "c"]) {
      await manager.execute({
        label,
        do: () => {
          value += 1;
          return true;
        },
        undo: () => {
          value -= 1;
        },
      });
    }
    expect(manager.undoDepth).toBe(2);
    await manager.undo();
    await manager.undo();
    expect(value).toBe(1);
    expect(await manager.undo()).toBe(false);
  });

  it("undoes a model+layout create through one transaction", async () => {
    const mem = memoryFs();
    const manager = new TransactionManager();
    const layout = new Map<string, { x: number; y: number }>();
    let baseline = "";

    const tx = snapshotTransaction({
      label: "create sensor",
      snapshot: () => JSON.stringify({
        hcl: mem.store.get("system.hcl") ?? "",
        layout: [...layout.entries()],
      }),
      apply: async () => {
        const result = await applyModelMutation(
          mem,
          "system.hcl",
          baseline,
          { kind: "create_component", label: "sensor", leaf: true },
        );
        if (!result.applied || !result.path) return false;
        baseline = mem.store.get("system.hcl") ?? "";
        layout.set(result.path, { x: 100, y: 100 });
        return true;
      },
      restore: async (snapshot) => {
        const parsed = JSON.parse(snapshot) as {
          hcl: string;
          layout: [string, { x: number; y: number }][];
        };
        await mem.writeFile("system.hcl", parsed.hcl);
        baseline = parsed.hcl;
        layout.clear();
        for (const [key, pos] of parsed.layout) layout.set(key, pos);
      },
    });

    expect(await manager.execute(tx)).toBe(true);
    expect(baseline).toContain('component "sensor"');
    expect(layout.get("main/sensor")).toEqual({ x: 100, y: 100 });

    // Ctrl+Z undoes both the visual placement and the system.hcl entity.
    expect(await manager.undo()).toBe(true);
    expect(mem.store.get("system.hcl") ?? "").not.toContain(
      'component "sensor"',
    );
    expect(layout.has("main/sensor")).toBe(false);

    // Ctrl+Y restores both the HCL definition and canvas coordinates.
    expect(await manager.redo()).toBe(true);
    expect(mem.store.get("system.hcl") ?? "").toContain(
      'component "sensor"',
    );
    expect(layout.get("main/sensor")).toEqual({ x: 100, y: 100 });
  });

  it("undoes a model delete, restoring scope and label", async () => {
    const mem = memoryFs();
    const manager = new TransactionManager();
    let baseline = "";
    for (
      const op of [
        { kind: "add_component_definition", label: "cpu" },
        { kind: "add_system", label: "main" },
        {
          kind: "add_instance",
          parentPath: "main",
          label: "cpu",
          source: "cpu",
        },
      ] as const
    ) {
      const seeded = await applyModelMutation(mem, "system.hcl", baseline, op);
      if (!seeded.applied) throw new Error(`seed op failed: ${op.kind}`);
      baseline = mem.store.get("system.hcl") ?? "";
    }

    const tx = snapshotTransaction({
      label: "delete main/cpu",
      snapshot: () => mem.store.get("system.hcl") ?? "",
      apply: async () => {
        const result = await applyModelMutation(
          mem,
          "system.hcl",
          baseline,
          { kind: "delete_component", path: "main/cpu" },
        );
        if (!result.applied) return false;
        baseline = mem.store.get("system.hcl") ?? "";
        return true;
      },
      restore: async (snapshot) => {
        await mem.writeFile("system.hcl", snapshot);
        baseline = snapshot;
      },
    });

    expect(await manager.execute(tx)).toBe(true);
    expect(baseline).not.toContain('instance "cpu"');
    expect(await manager.undo()).toBe(true);
    expect(baseline).toContain('instance "cpu"');
    expect(await manager.redo()).toBe(true);
    expect(baseline).not.toContain('instance "cpu"');
  });
});
