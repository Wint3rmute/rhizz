import init from "rhizz";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  apply_model_op,
  compile_system,
  get_example_projects,
  parse_views,
  serialize_model,
  serialize_views,
  WARNING_LEVELS,
  type WarningLevel,
} from "./rhizz_wasm_wrapper";
import { EMPTY_PROJECT_HCL } from "./emptyProject";

beforeAll(async () => {
  const wasmPath = path.resolve(
    __dirname,
    "../../crates/rhizz-wasm/pkg/rhizz_wasm_bg.wasm",
  );
  const buffer = await fs.readFile(wasmPath);
  await init({ module_or_path: buffer });
});

describe("rhizz_wasm_wrapper", () => {
  it("compiles and serializes model via WASM", () => {
    const sources = [
      {
        filename: "system.hcl",
        content: `project {
  name    = "test-proj"
  version = "1.0.0"
}

component "fc" {
  description = "Flight controller"
  leaf        = true
}

system "quad" {
  description = "Quadcopter"

  instance "fc" {
    source = "fc"
  }
}
`,
      },
    ];

    const result = compile_system(sources);
    expect(result.error_count()).toBe(0);
    const model = result.model();
    expect(model).toBeDefined();

    if (model) {
      const hcl = serialize_model(model);
      expect(hcl).toContain(
        'project {\n  name    = "test-proj"\n  version = "1.0.0"\n}',
      );
      expect(hcl).toContain('system "quad"');
      expect(hcl).toContain('component "fc"');
      expect(hcl).toContain('instance "fc" { source = "fc" }');
    }
  });

  it("parses and serializes views with node layout", () => {
    const viewsHcl = `view "main" {
  description = "Main diagram"
  system      = "quad"

  filter {
    max_level = 2
  }

  node "fc" {
    x          = 120
    y          = 240
    width      = 150
    height     = 100
    text_align = "top-left"
  }
}
`;

    const views = parse_views(viewsHcl);
    expect(views).toHaveLength(1);
    expect(views[0]?.label).toBe("main");
    expect(views[0]?.system).toBe("quad");
    expect(views[0]?.nodes).toHaveLength(1);
    expect(views[0]?.nodes?.[0]?.component).toBe("fc");
    expect(views[0]?.nodes?.[0]?.x).toBe(120);
    expect(views[0]?.nodes?.[0]?.y).toBe(240);

    const serialized = serialize_views(views);
    expect(serialized).toContain('view "main"');
    expect(serialized).toContain('node "fc"');
    expect(serialized).toContain("x          = 120");

    const views2 = parse_views(serialized);
    expect(views2).toEqual(views);
  });

  it("compiles the empty-project seed with its default view and no errors", () => {
    const result = compile_system([
      { filename: "main.hcl", content: EMPTY_PROJECT_HCL },
      {
        filename: "diagrams/main.hcl",
        content: 'view "main" { system = "main" }\n',
      },
    ]);
    expect(result.error_count()).toBe(0);
    expect(result.model()).toBeDefined();
  });

  it("surfaces view diagnostics while keeping the resolved model", () => {
    const systemHcl = `component "cpu" { leaf = true }
component "computer" {
  instance "cpu" { source = "cpu" }
}
system "computer-setup" {
  instance "computer" { source = "computer" }
}
`;

    const result = compile_system([
      { filename: "system.hcl", content: systemHcl },
      // Zero view blocks -> E016.
      { filename: "diagrams/empty.hcl", content: 'project { name = "x" }' },
      // Two view blocks -> E016.
      {
        filename: "diagrams/combined.hcl",
        content: 'view "combined" { system = "computer-setup" }\n' +
          'view "other" { system = "computer-setup" }\n',
      },
      // Unknown view system -> E006.
      {
        filename: "diagrams/broken.hcl",
        content: 'view "broken" { system = "nope" }\n',
      },
      // Unknown node path -> W016 (non-blocking).
      {
        filename: "diagrams/overview.hcl",
        content: 'view "overview" {\n' +
          '  system = "computer-setup"\n' +
          '  node "computer-setup/ghost" {\n' +
          "    x = 1\n" +
          "    y = 2\n" +
          "  }\n" +
          "}\n",
      },
    ]);

    const codes = result.diagnostics().map((d) => d.code);
    expect(codes).toContain("E016");
    expect(codes).toContain("E006");
    expect(codes).toContain("W016");

    // View diagnostics must never clear the resolved model.
    expect(result.model()).toBeDefined();
  });

  it("extracts connections from compiled model for diagram rendering", () => {
    const sources = [
      {
        filename: "main.hcl",
        content: `component "c1" { leaf = true }
component "c2" { leaf = true }
system "demo" {
  instance "c1" {
    source = "c1"
  }
  instance "c2" {
    source = "c2"
  }
  connection "link" {
    from = "c1"
    to   = "c2"
  }
}
`,
      },
    ];

    const result = compile_system(sources);
    expect(result.error_count()).toBe(0);
    const model = result.model();
    expect(model).toBeDefined();
    if (!model) return;

    const wasmConns = model.connections();
    expect(wasmConns).toHaveLength(1);

    // The connection's endpoints are arena indices into model.components(). The
    // two definitions (c1, c2) come first, followed by the two system
    // instances, so the instance indices are 2 and 3 — never assume the
    // definition indices.
    const componentsNow = model.components();
    const c1Idx = componentsNow.findIndex((c) =>
      c.label === "c1" && c.parent_system_index !== undefined
    );
    const c2Idx = componentsNow.findIndex((c) =>
      c.label === "c2" && c.parent_system_index !== undefined
    );
    expect(c1Idx).toBeGreaterThanOrEqual(0);
    expect(c2Idx).toBeGreaterThanOrEqual(0);

    // Direct getter access
    expect(wasmConns[0]?.from).toBe(c1Idx);
    expect(wasmConns[0]?.to).toBe(c2Idx);
    expect(wasmConns[0]?.label).toBe("link");

    // Explicit mapping to plain object for computeVisibleConnections
    const mappedConns = wasmConns.map((
      c: { from: number; to: number; label: string },
    ) => ({
      from: c.from,
      to: c.to,
      label: c.label,
    }));
    expect(mappedConns[0]).toEqual({
      from: c1Idx,
      to: c2Idx,
      label: "link",
    });
  });

  it("applies model ops to canonical HCL with logged actions", () => {
    const addSystem = apply_model_op("system.hcl", "", {
      kind: "add_system",
      label: "demo",
    });
    expect(addSystem.applied).toBe(true);
    if (addSystem.hcl === undefined) throw new Error("expected hcl");
    expect(addSystem.actions).toEqual([
      { op: "add_system", label: "demo", description: "" },
    ]);

    const addDef = apply_model_op("system.hcl", addSystem.hcl, {
      kind: "add_component_definition",
      label: "cpu",
      options: { leaf: true },
    });
    expect(addDef.applied).toBe(true);
    if (addDef.hcl === undefined) throw new Error("expected hcl");

    const inst = apply_model_op("system.hcl", addDef.hcl, {
      kind: "add_instance",
      parentPath: "demo",
      label: "a",
      source: "cpu",
    });
    expect(inst.applied).toBe(true);
    if (inst.hcl === undefined) throw new Error("expected hcl");
    expect(inst.hcl).toContain('instance "a" { source = "cpu" }');

    const renamed = apply_model_op("system.hcl", inst.hcl, {
      kind: "rename_component",
      path: "demo/a",
      newLabel: "b",
    });
    expect(renamed.applied).toBe(true);
    expect(renamed.actions).toEqual([
      { op: "rename_component", path: "demo/a", newLabel: "b" },
    ]);
  });

  it("refuses broken baselines and dangling deletes with diagnostics", () => {
    const broken = apply_model_op(
      "system.hcl",
      'system "demo" {\n  this is not valid hcl!!!\n}\n',
      { kind: "add_system", label: "other" },
    );
    expect(broken.applied).toBe(false);
    expect(broken.hcl).toBeUndefined();
    expect(broken.diagnostics.length).toBeGreaterThan(0);
    expect(broken.diagnostics[0]?.code.startsWith("E")).toBe(true);

    const seed = apply_model_op("system.hcl", "", {
      kind: "add_component_definition",
      label: "cpu",
      options: { leaf: true },
    });
    if (seed.hcl === undefined) throw new Error("expected hcl");
    const sys = apply_model_op("system.hcl", seed.hcl, {
      kind: "add_system",
      label: "demo",
    });
    if (sys.hcl === undefined) throw new Error("expected hcl");
    const placed = apply_model_op("system.hcl", sys.hcl, {
      kind: "add_instance",
      parentPath: "demo",
      label: "a",
      source: "cpu",
    });
    if (placed.hcl === undefined) throw new Error("expected hcl");
    const dangling = apply_model_op("system.hcl", placed.hcl, {
      kind: "delete_component",
      path: "cpu",
    });
    expect(dangling.applied).toBe(false);
    expect(dangling.diagnostics.some((d) => d.code === "E014")).toBe(true);
  });

  it("returns embedded example projects from WASM", () => {
    const examples = get_example_projects();
    expect(examples.length).toBeGreaterThanOrEqual(6);

    const apollo = examples.find((e) => e.id === "apollo-11");
    expect(apollo).toBeDefined();
    expect(apollo?.name).toBe("Apollo 11 Mission Stack");
    expect(apollo?.files.length).toBeGreaterThanOrEqual(1);

    const singleFile = examples.find((e) => e.id === "single-file");
    expect(singleFile).toBeDefined();
    expect(singleFile?.files.some((f) => f.path === "system.hcl")).toBe(true);
  });

  describe("warning levels", () => {
    // `fc` has no description (W004, component level) and `loopback`
    // connects `fc` to itself (W005, business level) — one warning of each
    // gated kind, so a level change is observable in both directions.
    const gatedWarnings = [{
      filename: "system.hcl",
      content: `component "fc" {
  leaf = true
}

system "drone" {
  instance "fc" {
    source = "fc"
  }

  connection "loopback" {
    from = "fc"
    to   = "fc"
  }
}
`,
    }];

    // Two instances sharing a label in one system — E001, an error, which no
    // warning level may ever hide.
    const broken = [{
      filename: "system.hcl",
      content: `component "motor" {
  description = "Brushless motor"
}

system "drone" {
  instance "motor" {
    source = "motor"
  }
  instance "motor" {
    source = "motor"
  }
}
`,
    }];

    function codes(
      sources: { filename: string; content: string }[],
      level?: WarningLevel,
    ): string[] {
      return compile_system(sources, level).diagnostics().map((d) => d.code);
    }

    it("forwards the level to WASM, hiding component warnings at business", () => {
      const all = codes(gatedWarnings);
      expect(all).toContain("W004");
      expect(all).toContain("W005");

      const business = codes(gatedWarnings, "business");
      expect(business).not.toContain("W004");
      expect(business).toContain("W005");

      // `architectural` sits between the two: still hides W004, still keeps
      // the business-level W005.
      const architectural = codes(gatedWarnings, "architectural");
      expect(architectural).not.toContain("W004");
      expect(architectural).toContain("W005");
    });

    it("defaults to the most detailed level", () => {
      expect(codes(gatedWarnings)).toEqual(codes(gatedWarnings, "component"));
      expect(WARNING_LEVELS).toEqual([
        "business",
        "architectural",
        "component",
      ]);
    });

    it("never gates errors", () => {
      for (const level of WARNING_LEVELS) {
        const result = compile_system(broken, level);
        expect(result.error_count()).toBeGreaterThan(0);
        expect(result.diagnostics().map((d) => d.code)).toContain("E001");
      }
      expect(compile_system(broken, "business").error_count()).toBe(
        compile_system(broken, "component").error_count(),
      );
    });

    it("rejects an unknown level with a JsError", () => {
      expect(() => compile_system(gatedWarnings, "verbose" as WarningLevel))
        .toThrow(/unknown warning level 'verbose'/);
    });
  });
});
