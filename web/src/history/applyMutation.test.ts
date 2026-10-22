import init from "rhizz";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { subscribeToMutations } from "../mutationObserver";
import type { ModelAction } from "../actionLog";
import { compile_system } from "../rhizz_wasm_wrapper";
import {
  applyModelMutation,
  checkModelMutation,
  type ModelMutationOp,
} from "./applyMutation";

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
      {
        kind: "add_component_definition",
        label: "cpu",
        options: { leaf: true },
      },
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
      // Refusals record nothing.
      expect(recorded).toEqual([]);

      const renamed = await applyModelMutation(fs, "system.hcl", before, {
        kind: "rename_component",
        path: "demo/a",
        newLabel: "c",
      });
      expect(renamed.applied).toBe(true);
      expect(fs.store.get("system.hcl")).toContain(
        'instance "c" { source = "compA" }',
      );
      expect(recorded).toContain("rename_component");
    } finally {
      unsubscribe();
    }
  });

  it("reports instance updates against their definition", async () => {
    const fs = memoryFs();
    await seedDemo(fs);
    const recorded: ModelAction[] = [];
    const unsubscribe = subscribeToMutations((action) => {
      recorded.push(action);
    });
    try {
      const result = await applyModelMutation(
        fs,
        "system.hcl",
        fs.store.get("system.hcl") ?? "",
        {
          kind: "update_component",
          path: "demo/a",
          patch: { full_name: "hot chip" },
        },
      );
      expect(result.applied).toBe(true);
      expect(fs.store.get("system.hcl")).toContain("hot chip");
      // Body edits land on the reused definition, not the instance.
      expect(recorded).toContainEqual({
        op: "update_component",
        path: "compA",
        patch: { full_name: "hot chip" },
      });
    } finally {
      unsubscribe();
    }
  });

  it("persists port edits via update patch on the definition", async () => {
    const fs = memoryFs();
    await seedDemo(fs);
    const recorded: ModelAction[] = [];
    const unsubscribe = subscribeToMutations((action) => {
      recorded.push(action);
    });
    try {
      const result = await applyModelMutation(
        fs,
        "system.hcl",
        fs.store.get("system.hcl") ?? "",
        {
          kind: "update_component",
          path: "demo/a",
          patch: { ports: [{ label: "p", role: "peer" }] },
        },
      );
      expect(result.applied).toBe(true);
      expect(fs.store.get("system.hcl")).toContain('port "p"');
      expect(recorded).toContainEqual({
        op: "update_component",
        path: "compA",
        patch: { ports: [{ label: "p", role: "peer" }] },
      });
    } finally {
      unsubscribe();
    }
  });

  it("deletes instances before their definitions", async () => {
    const fs = memoryFs();
    await seedDemo(fs);
    const baseline = fs.store.get("system.hcl") ?? "";

    const delInst = await applyModelMutation(fs, "system.hcl", baseline, {
      kind: "delete_component",
      path: "demo/b",
    });
    expect(delInst.applied).toBe(true);
    const afterInst = fs.store.get("system.hcl") ?? "";
    expect(afterInst).not.toContain('instance "b"');

    // The definition is deletable once no instance uses it.
    const delDef = await applyModelMutation(fs, "system.hcl", afterInst, {
      kind: "delete_component",
      path: "compB",
    });
    expect(delDef.applied).toBe(true);
    expect(fs.store.get("system.hcl")).not.toContain('component "compB"');

    // ...but not while still instanced (would dangle E014).
    const refused = await applyModelMutation(
      fs,
      "system.hcl",
      fs.store.get("system.hcl") ?? "",
      { kind: "delete_component", path: "compA" },
    );
    expect(refused.applied).toBe(false);
  });

  it("builds nested instances with relative endpoints that compile", async () => {
    const fs = memoryFs();
    let baseline = "";
    for (const op of [
      { kind: "add_component_definition", label: "antenna" },
      { kind: "add_component_definition", label: "rf" },
      { kind: "add_component_definition", label: "dsp" },
      { kind: "add_component_definition", label: "baseband" },
      { kind: "add_system", label: "mobile" },
      {
        kind: "add_instance",
        parentPath: "mobile",
        label: "antenna",
        source: "antenna",
      },
      {
        kind: "add_instance",
        parentPath: "mobile",
        label: "baseband",
        source: "baseband",
      },
      {
        kind: "add_instance",
        parentPath: "baseband",
        label: "rf",
        source: "rf",
      },
      {
        kind: "add_instance",
        parentPath: "baseband",
        label: "dsp",
        source: "dsp",
      },
      {
        kind: "add_connection",
        scopePath: "mobile",
        label: "rf-antenna",
        from: "baseband/rf",
        to: "antenna",
      },
      {
        kind: "add_connection",
        scopePath: "mobile",
        label: "rf-dsp",
        from: "baseband/rf",
        to: "baseband/dsp",
      },
    ] as const) {
      const result = await applyModelMutation(fs, "system.hcl", baseline, op);
      if (!result.applied) throw new Error(`seed op failed: ${op.kind}`);
      baseline = fs.store.get("system.hcl") ?? "";
    }
    expect(baseline).toContain('from         = "/mobile/baseband/rf"');
    expect(baseline).not.toContain("baseband:rf");
    expect(
      compile_system([
        { filename: "system.hcl", content: baseline },
      ]).error_count(),
    ).toBe(0);
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

  it("create_component without sourceLabel creates a definition and places an instance", async () => {
    const fs = memoryFs();
    const result = await applyModelMutation(fs, "system.hcl", "", {
      kind: "create_component",
      label: "sensor",
      leaf: true,
    });
    expect(result.applied).toBe(true);
    // Fresh model: definition + "main" system + instance, path under main.
    expect(result.path).toBe("main/sensor");
    const content = fs.store.get("system.hcl") ?? "";
    expect(content).toContain('component "sensor"');
    expect(content).toContain('system "main"');
    expect(content).toContain('instance "sensor"');
  });

  it("create_component under an instance persists in the definition body", async () => {
    const fs = memoryFs();
    let baseline = "";
    for (const op of [
      { kind: "add_component_definition", label: "sensor" },
      { kind: "add_system", label: "main" },
      {
        kind: "add_instance",
        parentPath: "main",
        label: "sensor",
        source: "sensor",
      },
    ] as const) {
      const seeded = await applyModelMutation(fs, "system.hcl", baseline, op);
      if (!seeded.applied) throw new Error(`seed op failed: ${op.kind}`);
      baseline = fs.store.get("system.hcl") ?? "";
    }
    const result = await applyModelMutation(fs, "system.hcl", baseline, {
      kind: "create_component",
      label: "imu",
      parentKey: "main/sensor",
      leaf: true,
    });
    expect(result.applied).toBe(true);
    expect(result.path).toBe("main/sensor/imu");
    const content = fs.store.get("system.hcl") ?? "";
    // The child persists in the sensor definition body, so it still
    // resolves after a write round-trip (instance blocks carry only
    // `source`, E012).
    expect(content).toContain('instance "imu"');
  });

  it("add_connection under an instance persists in the definition body", async () => {
    // UI regression: wiring two children of an instance (e.g. main/drone)
    // silently dropped the connection — instance blocks carry only `source`.
    const fs = memoryFs();
    let baseline = "";
    for (const op of [
      { kind: "add_component_definition", label: "drone" },
      { kind: "add_component_definition", label: "battery" },
      { kind: "add_component_definition", label: "flight-controller" },
      { kind: "add_system", label: "main" },
      {
        kind: "add_instance",
        parentPath: "main",
        label: "drone",
        source: "drone",
      },
      {
        kind: "add_instance",
        parentPath: "drone",
        label: "battery",
        source: "battery",
      },
      {
        kind: "add_instance",
        parentPath: "drone",
        label: "flight-controller",
        source: "flight-controller",
      },
    ] as const) {
      const seeded = await applyModelMutation(fs, "system.hcl", baseline, op);
      if (!seeded.applied) throw new Error(`seed op failed: ${op.kind}`);
      baseline = fs.store.get("system.hcl") ?? "";
    }
    const added = await applyModelMutation(fs, "system.hcl", baseline, {
      kind: "add_connection",
      scopePath: "main/drone",
      label: "power-supply",
      from: "battery",
      to: "flight-controller",
    });
    expect(added.applied).toBe(true);
    const content = fs.store.get("system.hcl") ?? "";
    expect(content).toContain('connection "power-supply"');

    const deleted = await applyModelMutation(fs, "system.hcl", content, {
      kind: "delete_connection_by_label",
      label: "power-supply",
    });
    expect(deleted.applied).toBe(true);
    expect(fs.store.get("system.hcl")).not.toContain(
      'connection "power-supply"',
    );
  });

  describe("connect_components", () => {
    const connect = (
      overrides: Partial<
        Extract<ModelMutationOp, { kind: "connect_components" }>
      > = {},
    ): ModelMutationOp => ({
      kind: "connect_components",
      scopePath: "demo",
      label: "a-to-b",
      from: { component: "a", port: { new: { label: "link-b" } } },
      to: { component: "b", port: { new: { label: "link-a" } } },
      ...overrides,
    });

    const seeded = async () => {
      const fs = memoryFs();
      await seedDemo(fs);
      return { fs, baseline: fs.store.get("system.hcl") ?? "" };
    };

    it("writes the ports and the connection in one file write", async () => {
      const { fs, baseline } = await seeded();
      let writes = 0;
      const write = fs.writeFile.bind(fs);
      fs.writeFile = (filePath, content) => {
        writes++;
        return write(filePath, content);
      };

      const result = await applyModelMutation(
        fs,
        "system.hcl",
        baseline,
        connect(),
      );

      expect(result.applied).toBe(true);
      expect(writes).toBe(1);
      const content = fs.store.get("system.hcl") ?? "";
      expect(content).toContain('port "link-b"');
      expect(content).toContain('port "link-a"');
      expect(content).toContain('connection "a-to-b"');
      // The serializer writes endpoints as absolute paths.
      expect(content).toMatch(/from\s*=\s*"\/demo\/a\/link-b"/);
      expect(content).toMatch(/to\s*=\s*"\/demo\/b\/link-a"/);
    });

    it("reports the gesture as a single action", async () => {
      const { fs, baseline } = await seeded();
      const seen: ModelAction[] = [];
      const unsubscribe = subscribeToMutations((action) => seen.push(action));
      try {
        await applyModelMutation(
          fs,
          "system.hcl",
          baseline,
          connect({ createProtocol: "spi" }),
        );
      } finally {
        unsubscribe();
      }
      expect(seen.map((a) => a.op)).toEqual(["connect_components"]);
    });

    it("creates the stub protocol the ports name", async () => {
      const { fs, baseline } = await seeded();
      const result = await applyModelMutation(
        fs,
        "system.hcl",
        baseline,
        connect({
          createProtocol: "spi",
          from: {
            component: "a",
            port: { new: { label: "link-b", protocol: "spi" } },
          },
          to: {
            component: "b",
            port: { new: { label: "link-a", protocol: "spi" } },
          },
        }),
      );
      expect(result.applied).toBe(true);
      const content = fs.store.get("system.hcl") ?? "";
      expect(content).toContain('protocol "spi"');
      expect(
        compile_system([{ filename: "system.hcl", content }]).error_count(),
      ).toBe(0);
    });

    it("refuses a taken connection name and leaves the file alone", async () => {
      const { fs, baseline } = await seeded();
      await applyModelMutation(fs, "system.hcl", baseline, connect());
      const connected = fs.store.get("system.hcl") ?? "";

      const result = await applyModelMutation(
        fs,
        "system.hcl",
        connected,
        connect({
          from: { component: "a", port: { new: { label: "x" } } },
          to: { component: "b", port: { new: { label: "y" } } },
        }),
      );

      expect(result.applied).toBe(false);
      expect(result.refusal).toContain("already exists");
      expect(fs.store.get("system.hcl")).toBe(connected);
    });

    it("dry-runs the same verdict", async () => {
      const { baseline } = await seeded();
      expect(checkModelMutation("system.hcl", baseline, connect())).toBe(
        undefined,
      );
      expect(
        checkModelMutation(
          "system.hcl",
          baseline,
          connect({
            from: { component: "ghost", port: { new: { label: "p" } } },
          }),
        ),
      ).toContain("unknown component");
    });
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

  it("explains a refused op with the resolver's error messages", async () => {
    const fs = memoryFs();
    let baseline = "";
    const setup: ModelMutationOp[] = [
      {
        kind: "add_component_definition",
        label: "cpu",
        options: { leaf: true },
      },
      { kind: "add_system", label: "demo" },
      { kind: "add_instance", parentPath: "demo", label: "a", source: "cpu" },
    ];
    for (const op of setup) {
      const result = await applyModelMutation(fs, "system.hcl", baseline, op);
      expect(result.applied).toBe(true);
      baseline = fs.store.get("system.hcl") ?? "";
    }

    // The definition is still instanced, so the delete must be refused and
    // the reason must name the definition.
    const refused = await applyModelMutation(fs, "system.hcl", baseline, {
      kind: "delete_component",
      path: "cpu",
    });
    expect(refused.applied).toBe(false);
    expect(refused.refusal).toContain("cpu");
  });

  it("reports a refusal without writing, before any confirm", async () => {
    const fs = memoryFs();
    let baseline = "";
    const setup: ModelMutationOp[] = [
      {
        kind: "add_component_definition",
        label: "cpu",
        options: { leaf: true },
      },
      { kind: "add_component_definition", label: "fc" },
      { kind: "add_instance", parentPath: "fc", label: "mcu", source: "cpu" },
      { kind: "add_system", label: "demo" },
      { kind: "add_instance", parentPath: "demo", label: "f", source: "fc" },
      {
        kind: "add_connection",
        scopePath: "demo",
        label: "link",
        from: "/demo/f/mcu",
        to: "/demo/f",
      },
    ];
    for (const op of setup) {
      const result = await applyModelMutation(fs, "system.hcl", baseline, op);
      expect(result.applied).toBe(true);
      baseline = fs.store.get("system.hcl") ?? "";
    }

    // The connection in `demo` still uses `f/mcu`, so the delete is refused.
    const op: ModelMutationOp = {
      kind: "delete_component",
      path: "demo/f/mcu",
    };
    const refusal = checkModelMutation("system.hcl", baseline, op);
    expect(refusal).toContain("mcu");
    // The check leaves the model untouched.
    expect(fs.store.get("system.hcl")).toBe(baseline);
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

  describe("update_connection", () => {
    // Same two-bank chain as modelView.test.ts, in one file.
    const CHAIN = `protocol "payment" {}
protocol "https" {
  leaf = false
}
component "bank" {
  leaf = true
  port "pay" {
    protocol = "payment"
  }
  port "web" {
    protocol = "https"
  }
}
system "banking" {
  instance "bank-a" {
    source = "bank"
  }
  instance "bank-b" {
    source = "bank"
  }
  connection "fund-transfer" {
    from        = "bank-a/pay"
    to          = "bank-b/pay"
    realized_by = ["http-request"]
  }
  connection "http-request" {
    from = "bank-a/web"
    to   = "bank-b/web"
  }
}
`;

    it("writes a full name and a realized_by entry to the file", async () => {
      const fs = memoryFs({ "system.hcl": CHAIN });
      const result = await applyModelMutation(fs, "system.hcl", CHAIN, {
        kind: "update_connection",
        scopePath: "banking",
        label: "fund-transfer",
        patch: {
          full_name: "Funds transfer",
          realized_by: [{ scopePath: "banking", label: "http-request" }],
        },
      });
      expect(result.applied).toBe(true);
      const written = fs.store.get("system.hcl") ?? "";
      expect(written).toContain('"Funds transfer"');
      expect(written).toContain('realized_by  = ["http-request"]');
    });

    it("refuses a realized_by cycle and writes nothing", async () => {
      const fs = memoryFs({ "system.hcl": CHAIN });
      const result = await applyModelMutation(fs, "system.hcl", CHAIN, {
        kind: "update_connection",
        scopePath: "banking",
        label: "http-request",
        patch: {
          realized_by: [{ scopePath: "banking", label: "fund-transfer" }],
        },
      });
      // `fund-transfer` already realizes via `http-request`, so this closes a loop.
      expect(result.applied).toBe(false);
      expect(result.refusal).toMatch(/realiz/i);
      expect(fs.store.get("system.hcl")).toBe(CHAIN);
    });

    it("refuses a patch whose target does not exist", async () => {
      const fs = memoryFs({ "system.hcl": CHAIN });
      const result = await applyModelMutation(fs, "system.hcl", CHAIN, {
        kind: "update_connection",
        scopePath: "banking",
        label: "http-request",
        patch: {
          realized_by: [{ scopePath: "banking", label: "nope" }],
        },
      });
      expect(result.applied).toBe(false);
      expect(fs.store.get("system.hcl")).toBe(CHAIN);
    });
  });
});

describe("protocol ops", () => {
  const SPI = `protocol "spi" {
  leaf = true
}
component "mcu" {
  leaf = true
  port "uart" {
    protocol = "spi"
    role     = "peer"
  }
}
`;

  it("adds a protocol, writes it, and records the action", async () => {
    const fs = memoryFs();
    const actions: ModelAction[] = [];
    const unsubscribe = subscribeToMutations((action) => actions.push(action));
    try {
      const result = await applyModelMutation(fs, "system.hcl", "", {
        kind: "add_protocol",
        label: "spi",
        options: { leaf: true, full_name: "Serial" },
      });
      expect(result.applied).toBe(true);
    } finally {
      unsubscribe();
    }
    expect(fs.store.get("system.hcl")).toContain('protocol "spi"');
    expect(actions).toEqual([
      {
        op: "add_protocol",
        label: "spi",
        options: { full_name: "Serial", leaf: true },
      },
    ]);
  });

  it("refuses a second protocol with the same label and says why", async () => {
    const fs = memoryFs({ "system.hcl": SPI });
    const result = await applyModelMutation(fs, "system.hcl", SPI, {
      kind: "add_protocol",
      label: "spi",
    });
    expect(result.applied).toBe(false);
    expect(result.refusal).toMatch(/already exists/);
    expect(fs.store.get("system.hcl")).toBe(SPI);
  });

  it("updates a protocol's leaf flag in place", async () => {
    const fs = memoryFs({ "system.hcl": SPI });
    const result = await applyModelMutation(fs, "system.hcl", SPI, {
      kind: "update_protocol",
      path: "spi",
      patch: { leaf: false },
    });
    expect(result.applied).toBe(true);
    expect(fs.store.get("system.hcl")).toContain('protocol "spi" {\n}\n');
  });

  it("refuses an encapsulates cycle and leaves the file untouched", async () => {
    const base = `protocol "a" {
  encapsulates = ["b"]
}
protocol "b" {}
`;
    const fs = memoryFs({ "system.hcl": base });
    const result = await applyModelMutation(fs, "system.hcl", base, {
      kind: "update_protocol",
      path: "b",
      patch: { encapsulates: ["a"] },
    });
    expect(result.applied).toBe(false);
    expect(result.refusal).toMatch(/circular protocol encapsulation/);
    expect(fs.store.get("system.hcl")).toBe(base);
  });

  it("refuses to delete a protocol a port still uses, naming the port", async () => {
    const fs = memoryFs({ "system.hcl": SPI });
    const result = await applyModelMutation(fs, "system.hcl", SPI, {
      kind: "delete_protocol",
      path: "spi",
    });
    expect(result.applied).toBe(false);
    expect(result.refusal).toMatch(/port `uart` of `mcu`/);
    expect(fs.store.get("system.hcl")).toBe(SPI);
  });

  it("deletes a protocol once no port uses it", async () => {
    const unused = `protocol "spi" {}
component "mcu" {
  leaf = true
}
`;
    const fs = memoryFs({ "system.hcl": unused });
    const result = await applyModelMutation(fs, "system.hcl", unused, {
      kind: "delete_protocol",
      path: "spi",
    });
    expect(result.applied).toBe(true);
    expect(fs.store.get("system.hcl")).not.toContain("protocol");
  });
});
